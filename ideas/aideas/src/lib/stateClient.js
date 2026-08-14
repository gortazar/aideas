// Reading `/state`, and remembering what it said.
//
// The HTTP itself is a seam: `transport.send(url, timeoutSeconds)` resolves to
// `{ status, body }` or rejects with an `Error` carrying a `reason` — a short, stable English
// phrase, never a localised GLib message. `soupTransport.js` is the real one; the tests pass a
// function. Everything else about a reading is decided here, where it can be tested without a
// network:
//
//   * **single-flight** — a second read while one is in the air joins the first rather than
//     stacking another request onto a box that is already slow to answer.
//   * **last good** — the most recent `ok` reading is kept, with the time it was taken, so a
//     failure can show what was true a minute ago instead of an empty menu.
//   * **failure counting** — how many attempts in a row have failed, which is what the
//     backoff and the scheduler need.
//
// It has no timers and reads no clock of its own: `clock()` is injected.

import { parseState, unconfiguredReading, unreachableReading, Status } from './state.js';
import { stateUrl, describeAddress } from './address.js';

/** A body larger than this is not a queue. The real one is ~120 bytes per idea. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** How long a single request may take before it is abandoned. */
export const DEFAULT_TIMEOUT_SECONDS = 10;

export class StateClient {
    /**
     * @param {object} options
     * @param {{send: function(string, number): Promise<{status: number, body: string}>}} options.transport
     * @param {function(): number} options.clock  unix seconds
     * @param {number} [options.timeoutSeconds]
     */
    constructor({ transport, clock, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS }) {
        this._transport = transport;
        this._clock = clock;
        this._timeoutSeconds = timeoutSeconds;

        this._inFlight = null;
        this._reading = unconfiguredReading();
        this._fetchedAt = null;
        this._lastGood = null;
        this._failures = 0;
        this._host = null;
    }

    /**
     * Everything the UI needs to render, without fetching anything.
     *
     * The same object shape `AideasIndicator.update()` takes, so "show what we know" is one
     * call and cannot drift from "show what we just read".
     */
    snapshot() {
        return {
            reading: this._reading,
            fetchedAt: this._fetchedAt,
            lastGood: this._lastGood,
            host: this._host,
            failures: this._failures,
        };
    }

    /** How many attempts in a row have failed. 0 right after a success. */
    get failures() {
        return this._failures;
    }

    /** True while a request is in the air. */
    get busy() {
        return this._inFlight !== null;
    }

    /**
     * Read `/state` once from `host:port`, and fold the result into what we know.
     *
     * Resolves to the new snapshot. Never rejects: a failure is a reading, not an exception —
     * every caller is a timer callback or a menu handler inside the Shell, where an unhandled
     * rejection is a log entry nobody reads and a UI that never updates.
     */
    read({ host, port }) {
        // Single-flight. Joining the in-flight promise means a menu opening during a slow
        // request gets that request's answer, rather than starting a second one.
        if (this._inFlight !== null)
            return this._inFlight;

        this._inFlight = this._read({ host, port }).then(snapshot => {
            this._inFlight = null;
            return snapshot;
        }, () => {
            // _read is written not to throw; if it ever does, the client must not wedge with
            // a stale _inFlight that blocks every future read.
            this._inFlight = null;
            return this.snapshot();
        });

        return this._inFlight;
    }

    async _read({ host, port }) {
        const url = stateUrl(host, port);
        this._host = describeAddress(host, port);

        if (url === null) {
            // Nothing was attempted, so this is not a failure to back off from: there is
            // nothing to retry until a preference changes.
            this._reading = unconfiguredReading();
            this._fetchedAt = null;
            this._failures = 0;
            return this.snapshot();
        }

        let reading;
        try {
            const { status, body } = await this._transport.send(url, this._timeoutSeconds);
            reading = this._interpret(status, body);
        } catch (error) {
            reading = unreachableReading(error?.reason ?? 'the request failed');
        }

        this._reading = reading;
        this._fetchedAt = this._clock();

        if (reading.status === Status.OK) {
            this._lastGood = { reading, fetchedAt: this._fetchedAt };
            this._failures = 0;
        } else {
            // `available: false` counts as a failure for backoff purposes: the box is there,
            // but nothing it says will change until someone fixes its environment, so there
            // is no point asking every 30 s.
            this._failures += 1;
        }

        return this.snapshot();
    }

    /** An HTTP reply in, a reading out. */
    _interpret(status, body) {
        if (status !== 200)
            return unreachableReading(`the server answered HTTP ${status}`);

        if (typeof body !== 'string')
            return unreachableReading('the reply had no body');

        if (body.length > MAX_BODY_BYTES)
            return unreachableReading('the reply was too large to be a queue');

        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch {
            return unreachableReading('the reply was not JSON');
        }

        return parseState(parsed);
    }
}
