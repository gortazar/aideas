// Wording for the two spans of time the menu shows: how long the cycle has been running,
// and how old the reading on screen is.
//
// Pure and Shell-free, so it is tested without a compositor. Everything here takes seconds
// and returns a string; nothing reads a clock — the caller passes the difference, which is
// what makes the whole menu reproducible in a test.

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Is this a number we can do arithmetic on? `null` and NaN both mean "not known". */
function usable(seconds) {
    return typeof seconds === 'number' && Number.isFinite(seconds);
}

/**
 * A span, at one or two units of precision: `45 s`, `12 min`, `2 h 5 min`, `3 d 4 h`.
 *
 * Returns null when the span is unknown, so a caller can leave the phrase out entirely
 * rather than print "unknown" inside a sentence.
 *
 * A negative span is clamped to zero rather than rejected: the laptop's clock and the box's
 * clock are not the same clock, and a reading from one second in the future is a skew of a
 * second, not an error worth showing anybody.
 */
export function formatDuration(seconds) {
    if (!usable(seconds))
        return null;

    const total = Math.max(0, Math.round(seconds));

    if (total < MINUTE)
        return `${total} s`;
    if (total < HOUR)
        return `${Math.floor(total / MINUTE)} min`;

    if (total < DAY) {
        const hours = Math.floor(total / HOUR);
        const minutes = Math.floor((total % HOUR) / MINUTE);
        return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
    }

    const days = Math.floor(total / DAY);
    const hours = Math.floor((total % DAY) / HOUR);
    return hours ? `${days} d ${hours} h` : `${days} d`;
}

/**
 * How old something is: `just now`, `8 s ago`, `12 min ago`.
 *
 * "just now" covers the first few seconds, because a number that changes every second in a
 * menu you are reading is noise. Returns null when the age is unknown — the caller then says
 * "never updated", which is a different statement from "updated 0 s ago".
 */
export function formatAge(seconds) {
    if (!usable(seconds))
        return null;
    if (seconds < 5)
        return 'just now';
    return `${formatDuration(seconds)} ago`;
}
