// Pausing the queue, and letting it go again: the extension's second write.
//
// The same shape as `cycleClient.js` — one attempt, never rejecting, a sentence for every
// outcome — and the same division of labour: a **refusal** is the box's own words passed
// through, a **failure** is worded here from statuses and from `GError` codes the transport has
// already mapped, never from a localised GLib message.
//
// Two things are particular to this one:
//
//   * **The two directions are opposites.** A stop misread as a resume would un-pause a queue
//     somebody meant to hold still. `resume: true` is sent as a literal boolean and the box
//     accepts nothing else, so there is no shape in between to get wrong.
//   * **`paused` can be `null`, and that is not `false`.** A box that could not look, a reply
//     that never arrived and a body that is not an answer all leave the panel not knowing. "Not
//     paused" is a claim; this module makes it only when the box made it.

import { describeAddress } from './address.js';
import { replyObject, sentence } from './jsonReply.js';

/** How long to wait for a box that only has to touch or unlink one file. */
export const DEFAULT_TIMEOUT_SECONDS = 15;

/** The URL to post to, or null when no host is configured. */
export function stopUrl(host, port) {
    const address = describeAddress(host, port);
    return address === null ? null : `http://${address}/stop`;
}

/** An outcome with nothing known about the queue's state. */
function unknown(gate, reason) {
    return { paused: null, changed: false, gate, reason };
}

/**
 * One attempt to pause or resume the queue.
 *
 * Resolves to `{ paused, changed, gate, reason }` and never rejects. `gate` is `null` when the
 * box carried the request out — including when it had nothing to do, which comes back as
 * `changed: false` and is a perfectly good answer, not a failure.
 */
export class StopClient {
    constructor({ transport, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS }) {
        this._transport = transport;
        this._timeoutSeconds = timeoutSeconds;
        this._inFlight = false;
    }

    /** True while a request is out. The menu refuses to have two posts outstanding. */
    get busy() {
        return this._inFlight;
    }

    async requestStop({ host, port, secret = '', resume = false }) {
        const url = stopUrl(host, port);
        if (url === null)
            return unknown('unconfigured', 'no orchestrator address is set');

        if (this._inFlight)
            return unknown('busy', 'a request is already on its way');

        this._inFlight = true;
        try {
            return await this._post(url, secret, resume);
        } finally {
            this._inFlight = false;
        }
    }

    async _post(url, secret, resume) {
        const body = JSON.stringify({
            // Only when there is one: sending `"secret": ""` to a box without a secret would be
            // accepted anyway, but sending nothing is the truthful request.
            ...(secret ? { secret } : {}),
            ...(resume ? { resume: true } : {}),
        });

        let reply;
        try {
            reply = await this._transport.post(url, body, this._timeoutSeconds);
        } catch (error) {
            // The transport has already turned a GError code into a fixed English phrase.
            return unknown('unreachable', error?.reason ?? 'the request failed');
        }

        return interpretStopReply(reply.status, reply.body);
    }
}

/**
 * An HTTP reply in, an outcome out.
 *
 * Separate from the class so that every status and every malformed body can be checked without
 * a transport at all.
 */
export function interpretStopReply(status, rawBody) {
    if (status === 404) {
        // An un-updated box, not the user's mistake, and no amount of retrying changes it.
        return unknown('unsupported', 'this box does not support stopping cycles');
    }

    if (status === 401)
        return unknown('unauthorised', 'the box rejected the shared secret');

    const { object: parsed, problem } = replyObject(rawBody);

    if (problem === 'too-large')
        return unknown('malformed', 'the reply was too large to be an answer');

    if (problem) {
        return status === 200
            ? unknown('malformed', 'the box answered, but not with an answer')
            : unknown('unreachable', `the server answered HTTP ${status}`);
    }

    const gate = typeof parsed.gate === 'string' && parsed.gate !== '' ? parsed.gate : null;
    const paused = parsed.paused === true ? true : (parsed.paused === false ? false : null);

    // A body with neither a gate nor a usable `paused` has told us nothing. Reading it as a
    // success would put "Paused" on screen on the strength of a reply that never said so.
    if (gate === null && paused === null)
        return unknown('malformed', 'the box answered, but not with an answer');

    return {
        paused,
        changed: parsed.changed === true,
        gate,
        reason: sentence(parsed.reason)
            ?? (gate === null
                ? 'the orchestrator did not say what it did'
                : 'the orchestrator refused, without saying why'),
    };
}
