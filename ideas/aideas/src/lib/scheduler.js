// When to read `/state`.
//
// The timer is a seam — `timer.add(seconds, callback)` / `timer.remove(handle)`, which is
// GLib.timeout_add_seconds in the Shell and a controllable queue in the tests — so every rule
// here is asserted in milliseconds instead of minutes.
//
// The rules, and why each one exists:
//
//   * **One timer, ever.** Two timers means two polls per interval, forever, and it is the
//     classic extension leak: rescheduling without removing what was already pending.
//   * **The next poll is scheduled after the previous one finishes**, not alongside it. A box
//     that takes 20 s to answer must not accumulate a queue of requests behind it.
//   * **Nothing at all while the session is locked or idle.** A laptop asleep on a desk must
//     not wake up to talk to a VPN host. Resuming polls immediately, because whatever is on
//     screen is by then as old as the sleep was.
//   * **Faster while the menu is open**, because somebody is looking at it — and briskly even
//     when the box is unreachable, since watching it reconnect is exactly what that person is
//     doing. That override lasts only as long as the menu is open.
//   * **Slower while it keeps failing**, per backoff.js.

import { nextDelaySeconds } from './backoff.js';

/** How often to re-read while somebody has the menu open. */
export const MENU_OPEN_INTERVAL_SECONDS = 5;

export class PollScheduler {
    /**
     * @param {object} options
     * @param {function(): Promise} options.onPoll  does one read; awaited before rescheduling
     * @param {{add: function(number, function): *, remove: function(*): void}} options.timer
     * @param {function(): number} [options.failures]  consecutive failures, for the backoff
     * @param {number} [options.intervalSeconds]
     */
    constructor({ onPoll, timer, failures = () => 0, intervalSeconds = 30 }) {
        this._onPoll = onPoll;
        this._timer = timer;
        this._failures = failures;
        this._intervalSeconds = intervalSeconds;

        this._handle = null;
        this._running = false;
        this._menuOpen = false;
        this._suppressed = false;
        this._polling = false;
    }

    /** Is a timer pending? */
    get scheduled() {
        return this._handle !== null;
    }

    get running() {
        return this._running;
    }

    /** The wait the next scheduling will use, given the interval, the menu and the failures. */
    get delaySeconds() {
        if (this._menuOpen)
            return Math.min(this._intervalSeconds, MENU_OPEN_INTERVAL_SECONDS);
        return nextDelaySeconds({
            intervalSeconds: this._intervalSeconds,
            failures: this._failures(),
        });
    }

    /** Start polling: once now, then on the interval. */
    start() {
        if (this._running)
            return Promise.resolve();
        this._running = true;
        return this._pollAndReschedule();
    }

    /** Stop polling and cancel anything pending. Safe to call twice. */
    stop() {
        this._running = false;
        this._cancel();
    }

    /** The poll interval changed in preferences. Applies from the next wait onwards. */
    setIntervalSeconds(seconds) {
        if (seconds === this._intervalSeconds)
            return;
        this._intervalSeconds = seconds;
        // Re-time what is already pending: a change from 300 s to 10 s should not be invisible
        // for the next five minutes.
        if (this._running && this._handle !== null)
            this._schedule();
    }

    /**
     * The menu opened or closed.
     *
     * Opening reads straight away — the menu should not show a reading from 29 seconds ago
     * while the user waits for the next tick — and then keeps the faster rate until it closes.
     */
    setMenuOpen(open) {
        if (open === this._menuOpen)
            return Promise.resolve();
        this._menuOpen = open;

        if (!this._running || this._suppressed)
            return Promise.resolve();

        if (open)
            return this._pollAndReschedule();

        this._schedule();
        return Promise.resolve();
    }

    /**
     * The session locked or went idle (true), or came back (false).
     *
     * Coming back polls immediately: whatever is on screen is as stale as the sleep was long.
     */
    setSuppressed(suppressed) {
        if (suppressed === this._suppressed)
            return Promise.resolve();
        this._suppressed = suppressed;

        if (!this._running)
            return Promise.resolve();

        if (suppressed) {
            this._cancel();
            return Promise.resolve();
        }
        return this._pollAndReschedule();
    }

    /** Poll now, whatever the timer says — what a "refresh" action would call. */
    pollNow() {
        if (!this._running || this._suppressed)
            return Promise.resolve();
        return this._pollAndReschedule();
    }

    async _pollAndReschedule() {
        this._cancel();

        // A poll already in the air will schedule the next one when it finishes; starting
        // another here would double the rate for as long as the box stays slow.
        if (this._polling)
            return;

        this._polling = true;
        try {
            await this._onPoll();
        } finally {
            this._polling = false;
            if (this._running && !this._suppressed)
                this._schedule();
        }
    }

    _schedule() {
        this._cancel();
        this._handle = this._timer.add(this.delaySeconds, () => {
            this._handle = null;
            // Deliberately not awaited: this is a GLib timeout callback, which cannot wait.
            // _pollAndReschedule() owns the next scheduling either way.
            this._pollAndReschedule();
            return false;
        });
    }

    _cancel() {
        if (this._handle !== null) {
            this._timer.remove(this._handle);
            this._handle = null;
        }
    }
}
