// Asking the box to start a cycle: the extension's only write.
//
// The whole of it, minus the HTTP, which is the injected transport. What this module is *for* is
// the wording: a click that produces no visible change is indistinguishable from a click that
// did nothing, so every outcome — started, refused by a gate, or never delivered — comes back as
// a sentence somebody can read in a menu.
//
// Two rules about those sentences:
//
//   * a **refusal** is the box's own words, passed through. The orchestrator knows why it will
//     not run; this module does not second-guess it, and an unfamiliar `gate` still shows its
//     `reason`.
//   * a **failure** is worded here, from HTTP statuses and from `GError` codes the transport has
//     already mapped — never from a GLib message, which is localised. On this laptop a refused
//     connection says "Conexión rehusada".

import { describeAddress } from './address.js';

/** A reply larger than this is not a two-field JSON object. */
const MAX_BODY_BYTES = 64 * 1024;

/** How long to wait for a box that has to read a queue and fork before answering. */
export const DEFAULT_TIMEOUT_SECONDS = 15;

/**
 * The URL to post to, or null when no host is configured.
 *
 * Deliberately built from the same normalisation `/state` uses, so a pasted heartbeat URL, a
 * bare host and an IPv6 literal all work here exactly as they do there.
 */
export function cycleUrl(host, port) {
    const address = describeAddress(host, port);
    return address === null ? null : `http://${address}/cycle`;
}

/**
 * One attempt to start a cycle.
 *
 * Resolves to `{ started, gate, reason }` and never rejects: every caller is a menu handler
 * inside the Shell, where an unhandled rejection is a log line nobody reads and a menu that
 * never updates.
 *
 * `gate` is a word to branch on — the orchestrator's own vocabulary, plus this module's own for
 * the failures that never reached it. `reason` is always a sentence, and always present when
 * `started` is false.
 */
export class CycleClient {
    constructor({ transport, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS }) {
        this._transport = transport;
        this._timeoutSeconds = timeoutSeconds;
        this._inFlight = false;
    }

    /** True while a request is out. The menu refuses to have two posts outstanding. */
    get busy() {
        return this._inFlight;
    }

    async requestCycle({ host, port, secret = '', override = false }) {
        const url = cycleUrl(host, port);
        if (url === null) {
            return {
                started: false,
                gate: 'unconfigured',
                reason: 'no orchestrator address is set',
            };
        }

        if (this._inFlight) {
            return {
                started: false,
                gate: 'busy',
                reason: 'a request is already on its way',
            };
        }

        this._inFlight = true;
        try {
            return await this._post(url, secret, override);
        } finally {
            this._inFlight = false;
        }
    }

    async _post(url, secret, override) {
        const body = JSON.stringify({
            // Only when there is one: sending `"secret": ""` to a box without a secret would be
            // accepted anyway, but sending nothing is the truthful request.
            ...(secret ? { secret } : {}),
            ...(override ? { override: true } : {}),
        });

        let reply;
        try {
            reply = await this._transport.post(url, body, this._timeoutSeconds);
        } catch (error) {
            // The transport has already turned a GError code into a fixed English phrase.
            return {
                started: false,
                gate: 'unreachable',
                reason: error?.reason ?? 'the request failed',
            };
        }

        return interpretCycleReply(reply.status, reply.body);
    }
}

/**
 * An HTTP reply in, an outcome out.
 *
 * Separate from the class so that every status and every malformed body can be checked without
 * a transport at all.
 */
export function interpretCycleReply(status, rawBody) {
    if (status === 404) {
        // Not the user's mistake, and worth saying plainly: this is what an un-updated box looks
        // like, and no amount of retrying will change it.
        return {
            started: false,
            gate: 'unsupported',
            reason: 'this box does not support starting cycles',
        };
    }

    if (status === 401) {
        return {
            started: false,
            gate: 'unauthorised',
            reason: 'the box rejected the shared secret',
        };
    }

    const body = typeof rawBody === 'string' ? rawBody : '';
    if (body.length > MAX_BODY_BYTES) {
        return {
            started: false,
            gate: 'malformed',
            reason: 'the reply was too large to be an answer',
        };
    }

    let parsed = null;
    try {
        parsed = JSON.parse(body);
    } catch {
        parsed = null;
    }

    const usable = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);

    if (!usable) {
        // A 200 with no usable body is not a start: claiming otherwise would show "starting…"
        // for a cycle nobody asked for.
        return {
            started: false,
            gate: status === 200 ? 'malformed' : 'unreachable',
            reason: status === 200
                ? 'the box answered, but not with an answer'
                : `the server answered HTTP ${status}`,
        };
    }

    if (parsed.started === true)
        return { started: true, gate: null, reason: null };

    const gate = typeof parsed.gate === 'string' && parsed.gate !== '' ? parsed.gate : 'refused';
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() !== ''
        ? parsed.reason.trim().replace(/\s+/g, ' ')
        : 'the orchestrator refused, without saying why';

    return { started: false, gate, reason };
}
