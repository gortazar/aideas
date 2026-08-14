// How long to wait before trying again.
//
// A laptop off the VPN will fail every single poll, possibly for days. Polling a host that is
// not there every 30 s forever is not free: each attempt is a DNS lookup, a connect and a
// timeout, and on a laptop that is a small tax on the battery for no information. So failures
// stretch the interval out to a ceiling, and one success puts it straight back.
//
// No jitter, deliberately: jitter exists to stop many clients synchronising against one
// server, and this is one laptop talking to one box. A predictable interval is easier to
// reason about in a menu that shows how old its reading is.

/** Doubling: 30 s, 60 s, 120 s, 240 s, then the ceiling. */
export const DEFAULT_FACTOR = 2;

/** Five minutes: long enough to stop costing anything, short enough that reconnecting is
 *  noticed while you are still looking at the screen. */
export const DEFAULT_CEILING_SECONDS = 300;

/**
 * The delay after `failures` consecutive failures.
 *
 * `failures` of 0 means the last attempt succeeded, and the answer is the plain interval.
 * The result is never below the interval and never above the ceiling — and never above the
 * interval either, if someone has configured an interval longer than the ceiling.
 */
export function nextDelaySeconds({
    intervalSeconds,
    failures = 0,
    ceilingSeconds = DEFAULT_CEILING_SECONDS,
    factor = DEFAULT_FACTOR,
}) {
    const base = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 30;
    const ceiling = Number.isFinite(ceilingSeconds) && ceilingSeconds > 0
        ? Math.max(base, ceilingSeconds)
        : base;

    const count = Number.isInteger(failures) && failures > 0 ? failures : 0;
    if (count === 0)
        return base;

    // Cap the exponent before multiplying: 2 ** 2000 is Infinity, and Infinity * 30 is not a
    // number anybody can wait for.
    const steps = Math.min(count, 30);
    const delay = base * Math.pow(factor, steps);

    return Math.min(ceiling, Math.round(delay));
}
