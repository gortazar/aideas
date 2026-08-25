// The real HTTP, over libsoup 3.
//
// This is the only file in the extension that talks to the network, and it is the seam
// `StateClient` is written against, so it does exactly one thing: one GET, asynchronously,
// with a hard deadline, resolving to `{status, body}` or rejecting with an `Error` carrying a
// short English `reason`.
//
// Three rules, each learned from how this fails in practice:
//
//   1. **Asynchronous, always.** A synchronous request to a VPN host that is asleep blocks the
//      Shell's main loop, which freezes the whole desktop — the pointer included.
//   2. **Our own deadline, not just the session's.** Soup's `timeout` covers a stalled socket,
//      not a server that accepts the connection and then thinks for two minutes. A cancellable
//      fired from a timer is what actually bounds a request.
//   3. **Reasons come from error codes, never from messages.** GLib messages are localised —
//      on this laptop a refused connection says "Conexión rehusada" — and a reason that
//      changes with the locale cannot be tested or read by anyone else. So the code is mapped
//      to a fixed phrase here.
//
// It runs under plain gjs as well as inside the Shell, which is why tests/http can drive it
// against a real server with no compositor in sight.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

/** Bodies above this are not read at all: the real one is ~120 bytes per idea. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** Gio error codes, mapped to phrases that fit after "orchestrator unreachable — ". */
const IO_ERROR_REASONS = new Map([
    [Gio.IOErrorEnum.CONNECTION_REFUSED, 'connection refused'],
    [Gio.IOErrorEnum.HOST_NOT_FOUND, 'host not found'],
    [Gio.IOErrorEnum.HOST_UNREACHABLE, 'host unreachable'],
    [Gio.IOErrorEnum.NETWORK_UNREACHABLE, 'network unreachable'],
    [Gio.IOErrorEnum.TIMED_OUT, 'the connection timed out'],
    [Gio.IOErrorEnum.CONNECTION_CLOSED, 'the connection was closed'],
    [Gio.IOErrorEnum.NOT_FOUND, 'host not found'],
    [Gio.IOErrorEnum.PROXY_FAILED, 'the proxy refused'],
    [Gio.IOErrorEnum.INVALID_ARGUMENT, 'the address could not be used'],
]);

/**
 * The reply's status, as a number.
 *
 * `message.get_status()` marshals its return through libsoup's `Status` *enumeration*, and that
 * enumeration does not contain every status a server may send: a 429 makes GJS throw "429 is not
 * a valid value for enumeration Status" — inside the async callback, where the throw settles
 * nothing and the request hangs for ever. The `status-code` property is the same value without
 * the marshalling, and a proxy answering 429 or 451 is not a reason to wedge the poller.
 */
function statusOf(message) {
    const code = message.status_code;
    if (Number.isInteger(code) && code > 0)
        return code;
    try {
        return message.get_status();
    } catch {
        return 0; // unknowable: the caller reports it as a failed request
    }
}

/** An Error the client will turn into an unreachable reading. */
function transportError(reason, cause = null) {
    const error = new Error(`aideas: ${reason}`);
    error.reason = reason;
    if (cause)
        error.cause = cause;
    return error;
}

/** Resolver failures have their own domain: DNS said no, before any socket was opened. */
const RESOLVER_REASONS = new Map([
    [Gio.ResolverError.NOT_FOUND, 'host not found'],
    [Gio.ResolverError.TEMPORARY_FAILURE, 'the name could not be resolved yet'],
    [Gio.ResolverError.INTERNAL, 'the resolver failed'],
]);

/**
 * What to call a GError, without reading its localised message.
 *
 * `GLib.Error.matches()` is the supported way to ask "is this that error": a GError's `domain`
 * is a numeric quark, not a name, so comparing strings would silently never match — which is
 * exactly the bug the integration test caught.
 */
export function reasonFor(error) {
    if (!error || typeof error.matches !== 'function')
        return 'the request failed';

    for (const [code, reason] of IO_ERROR_REASONS) {
        if (error.matches(Gio.IOErrorEnum, code))
            return reason;
    }

    for (const [code, reason] of RESOLVER_REASONS) {
        if (error.matches(Gio.ResolverError, code))
            return reason;
    }

    if (error.matches(Gio.TlsError, Gio.TlsError.MISC))
        return 'the TLS handshake failed';

    return 'the request failed';
}

export class SoupTransport {
    constructor() {
        this._session = new Soup.Session({ user_agent: 'aideas-shell/0.1 ' });
    }

    /**
     * GET `url`, giving up after `timeoutSeconds`.
     *
     * @returns {Promise<{status: number, body: string}>}
     */
    send(url, timeoutSeconds) {
        return this._request('GET', url, null, timeoutSeconds);
    }

    /**
     * POST `body` (a string, sent as JSON) to `url`, giving up after `timeoutSeconds`.
     *
     * The same deadlines and the same reason-mapping as a GET, because the failures are the
     * same failures: a box asleep behind a VPN does not care which verb was used.
     */
    post(url, body, timeoutSeconds) {
        return this._request('POST', url, body, timeoutSeconds);
    }

    _request(method, url, body, timeoutSeconds) {
        return new Promise((resolve, reject) => {
            if (this._session === null) {
                reject(transportError('the extension is shutting down'));
                return;
            }

            let message;
            try {
                message = Soup.Message.new(method, url);
            } catch (error) {
                reject(transportError('the address could not be used', error));
                return;
            }
            if (message === null) {
                // Soup.Message.new returns null rather than throwing for a URL it cannot parse.
                reject(transportError('the address could not be used'));
                return;
            }

            // A cache would be worse than useless here: the whole point is what is true now.
            message.request_headers.append('Cache-Control', 'no-cache');

            if (body !== null) {
                message.set_request_body_from_bytes(
                    'application/json', new GLib.Bytes(new TextEncoder().encode(body)));
            }

            const cancellable = new Gio.Cancellable();
            let settled = false;
            const seconds = Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
                ? Math.ceil(timeoutSeconds)
                : 10;

            const deadline = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
                if (!settled) {
                    settled = true;
                    cancellable.cancel();
                    reject(transportError(`timed out after ${seconds} s`));
                }
                return GLib.SOURCE_REMOVE;
            });

            const finish = () => {
                if (deadline)
                    GLib.source_remove(deadline);
            };

            this._session.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
                    if (settled) {
                        // The deadline already rejected; nothing to do but let it go.
                        return;
                    }
                    settled = true;
                    finish();

                    let bytes;
                    try {
                        bytes = session.send_and_read_finish(result);
                    } catch (error) {
                        reject(transportError(reasonFor(error), error));
                        return;
                    }

                    const status = statusOf(message);
                    const data = bytes?.get_data() ?? null;

                    if (data !== null && data.length > MAX_BODY_BYTES) {
                        reject(transportError('the reply was too large to be a queue'));
                        return;
                    }

                    let body;
                    try {
                        body = data === null ? '' : new TextDecoder().decode(data);
                    } catch {
                        // Not valid UTF-8, so certainly not the JSON we asked for.
                        reject(transportError('the reply was not text'));
                        return;
                    }

                    resolve({ status, body });
                });
        });
    }

    /**
     * Abandon anything in flight and drop the session.
     *
     * Called from `disable()`. Without this, a request outstanding at screen-lock time would
     * come back to a callback whose extension no longer exists.
     */
    destroy() {
        this._session?.abort();
        this._session = null;
    }
}
