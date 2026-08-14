// Turning whatever came back from `GET /state` into something the menu can render.
//
// Two rules, both from docs/state-contract.md:
//
//   1. **Nothing about the shape is trusted.** A missing key, a wrong type, a null where a
//      number belongs, a queue of 10 000 rows — each is handled, not thrown. An unhandled
//      throw inside a GNOME Shell extension damages the whole session, so this module has no
//      failure mode other than returning a reading that says what went wrong.
//   2. **Nothing is classified here.** `state` and `note` are the orchestrator's words and
//      are passed through; an unrecognised `state` keeps its own name rather than being
//      dropped or guessed at. This module normalises types and vocabulary, never meaning.
//
// Pure and Shell-free: no Soup, no clock, no settings. The four readings it produces are the
// whole failure taxonomy the UI has to render.

/** The four outcomes of an attempt to read the orchestrator's state. */
export const Status = {
    /** The box answered, the queue was read. Carries `ideas`. */
    OK: 'ok',
    /** The box answered `available: false` — it is there, but it cannot read its own queue. */
    UNAVAILABLE: 'unavailable',
    /** Nothing usable came back: refused, timed out, not JSON, not /state. */
    UNREACHABLE: 'unreachable',
    /** No address has been configured yet, so nothing was even attempted. */
    UNCONFIGURED: 'unconfigured',
};

/** The closed `state` vocabulary of docs/state-contract.md. */
export const KNOWN_STATES = ['running', 'ready', 'blocked', 'queued', 'to be planned'];

// A queue this long is a bug or a hostile body, not a queue. Rows beyond the cap are
// counted and dropped: building 10 000 menu items would hang the Shell for seconds.
const MAX_ROWS = 200;

const VERSION_PATTERN = /^\d+\.\d+$/;

function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number, or null. Rejects NaN, Infinity, null, booleans and numeric strings. */
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A non-empty string with its edges trimmed, or null. */
function text(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

/** A whole number at or above `minimum`, or null. Accepts 3.0, rejects 3.5. */
function counted(value, minimum) {
    const number = finiteNumber(value);
    if (number === null || !Number.isInteger(number) || number < minimum)
        return null;
    return number;
}

/**
 * One row of the queue, with every field either usable or null.
 *
 * `position` falls back to the row's index because the contract makes it the only unique
 * field — it is what the menu keys rows by, and duplicate slugs are normal.
 */
function normaliseRow(raw, index) {
    const row = isObject(raw) ? raw : {};
    const state = text(row.state);
    const version = text(row.version);

    return {
        position: counted(row.position, 1) ?? index + 1,
        // A row with no slug is still a row: the queue has an entry here, and hiding it
        // would make the menu a shorter story than the truth.
        slug: text(row.slug) ?? '(unnamed)',
        version: version !== null && VERSION_PATTERN.test(version) ? version : null,
        state: state ?? 'unknown',
        // Unknown states render in their own section rather than being dropped, so a new
        // orchestrator word shows up as itself instead of vanishing from the menu.
        known: state !== null && KNOWN_STATES.includes(state),
        note: text(row.note) ?? '',
        willRunNext: row.will_run_next === true,
        openQuestions: counted(row.open_questions, 1),
        targetVersion: (() => {
            const target = text(row.target_version);
            return target !== null && VERSION_PATTERN.test(target) ? target : null;
        })(),
    };
}

/** A reading that says the address has not been configured yet. */
export function unconfiguredReading() {
    return { status: Status.UNCONFIGURED };
}

/**
 * A reading that says the box could not be reached, and why.
 *
 * The client builds these: a refused connection, a DNS failure, a timeout, a non-200, a body
 * that is not JSON or is too large to bother parsing. `reason` is shown to the user, so it
 * should be a phrase that fits after "orchestrator unreachable — ".
 */
export function unreachableReading(reason) {
    return { status: Status.UNREACHABLE, reason: text(reason) ?? 'no reason given' };
}

/**
 * Normalise a parsed `/state` body into a reading.
 *
 * Takes the result of `JSON.parse`, not the bytes: deciding that a body is not JSON at all is
 * the client's job, and it reports that as unreachable. Anything that is JSON but is not a
 * `/state` body is unreachable too — the usual cause is an address or port pointing at some
 * other HTTP server, and "that is not the orchestrator" is the useful thing to say.
 */
export function parseState(body) {
    if (!isObject(body))
        return unreachableReading('the reply was not a JSON object');

    if (body.available === false) {
        return {
            status: Status.UNAVAILABLE,
            reason: text(body.reason) ?? 'the orchestrator did not say why',
        };
    }

    if (body.available !== true)
        return unreachableReading('that address answered, but not with /state');

    const ideas = Array.isArray(body.ideas) ? body.ideas : [];
    const lockAge = finiteNumber(body.lock_age_seconds);

    return {
        status: Status.OK,
        // `running` is the orchestrator's own verdict on liveness — it has already applied
        // the lock's TTL — so it is read as a boolean and never re-derived from lock age.
        running: body.running === true,
        agents: Array.isArray(body.agents)
            ? body.agents.map(agent => text(agent)).filter(agent => agent !== null)
            : [],
        cycleStartedAt: finiteNumber(body.cycle_started_at),
        // Present even on a dead cycle, where a climbing age is the visible symptom of a box
        // that stopped renewing its lock. Negative would be clock skew; clamp it.
        lockAgeSeconds: lockAge === null ? null : Math.max(0, Math.round(lockAge)),
        rows: ideas.slice(0, MAX_ROWS).map(normaliseRow),
        droppedRows: Math.max(0, ideas.length - MAX_ROWS),
    };
}
