// The whole menu, as data: a reading in, a header line, sections of rows and at most one
// message out. Pure, Shell-free and clock-injected, so the menu a user would see is a value a
// test can compare against — no compositor, no St widgets, no waiting.
//
// The division of labour with state.js: that module decides *what the orchestrator said*,
// this one decides *how it reads*. Neither decides what an idea's state means — `state` and
// `note` are the orchestrator's words and are shown as given. The extension supplies
// grouping and wording, never judgement.

import { Status } from './state.js';
import { formatDuration, formatAge } from './duration.js';

/** Sections, in the order that matters when you glance at the menu. */
const SECTIONS = [
    { id: 'running', title: 'Running', states: ['running'] },
    { id: 'blocked', title: 'Blocked', states: ['blocked'] },
    { id: 'ready', title: 'Ready', states: ['ready'] },
    // Everything else, quieter: queued duplicates, unplanned ideas, and any state word this
    // version of the extension has never heard of.
    { id: 'other', title: 'Also in the queue', states: null },
];

/** Join the parts of a detail line, dropping the ones that are not known. */
function detail(...parts) {
    const kept = parts.filter(part => typeof part === 'string' && part !== '');
    return kept.length > 0 ? kept.join(' · ') : null;
}

function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The cycle sentence: what the box is doing, at a glance.
 *
 * `Cycle running for 12 min, 2 agents` while a cycle is up, `Idle` when it is not. The
 * elapsed time is dropped rather than faked when `cycleStartedAt` is missing, and the agent
 * count is dropped when the lock listed none — both are shapes the contract allows.
 */
function cycleText(reading, now) {
    if (!reading.running)
        return 'Idle';

    const elapsed = reading.cycleStartedAt === null
        ? null
        : formatDuration(now - reading.cycleStartedAt);
    const agents = reading.agents.length > 0
        ? `, ${plural(reading.agents.length, 'agent')}`
        : '';

    return elapsed === null
        ? `Cycle running${agents}`
        : `Cycle running for ${elapsed}${agents}`;
}

/**
 * How old what you are looking at is — so a frozen panel is visibly frozen rather than
 * quietly lying — and, when it is known, how long ago the box last renewed its lock.
 *
 * The lock age is worth a line in both directions: while running it is proof the cycle is
 * still alive, and while idle a large one is the fingerprint of a cycle that was killed
 * rather than one that finished.
 */
function readingDetail(reading, now, fetchedAt, { stale = false } = {}) {
    const age = fetchedAt === null || fetchedAt === undefined
        ? null
        : formatAge(now - fetchedAt);
    const updated = age === null
        ? 'never updated'
        : (stale ? `last good reading ${age}` : `updated ${age}`);

    const lockAge = formatDuration(reading.lockAgeSeconds);
    return detail(updated, lockAge === null ? null : `lock renewed ${lockAge} ago`);
}

/** One menu row's text. Keyed by position, which the contract makes the only unique field. */
function describeRow(row, sectionId, reading, now) {
    const version = row.version === null ? null : `v${row.version}`;

    let rest = null;
    switch (sectionId) {
        case 'running': {
            // The span is the cycle's, not this idea's: the orchestrator does not report
            // per-idea start times, and inventing one would be a lie with a number in it.
            const elapsed = reading.cycleStartedAt === null
                ? null
                : formatDuration(now - reading.cycleStartedAt);
            rest = elapsed === null ? null : `running for ${elapsed}`;
            break;
        }
        case 'blocked':
            // The note already says "2 unanswered questions"; the count is the fallback for
            // a blocked row whose note came back empty.
            rest = row.note !== ''
                ? row.note
                : (row.openQuestions === null ? null : plural(row.openQuestions, 'unanswered question'));
            break;
        case 'ready':
            rest = row.note !== '' ? row.note : null;
            break;
        default:
            // An unrecognised state word is shown as itself, so a queue this version does not
            // fully understand still reads as a complete account of itself.
            rest = row.known
                ? (row.note !== '' ? row.note : null)
                : detail(row.state, row.note !== '' ? row.note : null);
            break;
    }

    return {
        key: `${row.position}:${row.slug}`,
        position: row.position,
        slug: row.slug,
        label: row.slug,
        detail: sectionId === 'blocked' || sectionId === 'ready'
            ? detail(rest)
            : detail(version, rest),
        // What the next cycle would pick up. Only ready rows ever carry it.
        marker: row.willRunNext ? 'next' : null,
    };
}

function group(reading, now) {
    const claimed = new Set(
        SECTIONS.flatMap(section => section.states ?? []));

    return SECTIONS
        .map(section => {
            const rows = reading.rows.filter(row => section.states === null
                ? !claimed.has(row.state)
                : section.states.includes(row.state));
            return {
                id: section.id,
                title: section.title,
                rows: rows.map(row => describeRow(row, section.id, reading, now)),
            };
        })
        // An empty section is not information; it is furniture.
        .filter(section => section.rows.length > 0);
}

/**
 * What went wrong, worded for someone who knows the box exists but not what it is doing.
 *
 * `unavailable` and `unreachable` are kept apart deliberately: one is a configured box
 * telling you it cannot read its own queue, the other is silence. They mean opposite things.
 */
function failureMessage(reading, host) {
    switch (reading.status) {
        case Status.UNCONFIGURED:
            return {
                text: 'Set the orchestrator address in preferences',
                detail: 'aideas needs the host or IP of the box, reachable over the VPN',
            };
        case Status.UNAVAILABLE:
            return {
                text: 'The orchestrator cannot read its queue',
                detail: reading.reason,
            };
        default:
            return {
                text: 'Orchestrator unreachable',
                detail: detail(host, reading.reason),
            };
    }
}

/**
 * Build the whole menu.
 *
 * `now` and `fetchedAt` are unix seconds and are always passed in — nothing here reads a
 * clock. `lastGood` is the previous `ok` reading and its timestamp, if there is one: when the
 * current attempt failed, the menu shows that earlier reading marked stale beneath the
 * failure, rather than emptying itself and losing the last thing anybody knew.
 */
export function buildMenu({ reading, now, fetchedAt = null, lastGood = null, host = null }) {
    if (reading.status === Status.OK) {
        return {
            header: {
                text: cycleText(reading, now),
                detail: readingDetail(reading, now, fetchedAt),
            },
            sections: group(reading, now),
            message: reading.rows.length === 0
                ? {
                    text: 'The queue is empty',
                    detail: 'README.md has no entries under ## Ideas',
                }
                : null,
            footer: reading.droppedRows > 0
                ? `${reading.droppedRows} further ` +
                  `${reading.droppedRows === 1 ? 'entry' : 'entries'} not shown`
                : null,
            stale: false,
        };
    }

    const message = failureMessage(reading, host);

    if (lastGood === null || !lastGood.reading || lastGood.reading.status !== Status.OK) {
        return {
            header: { text: 'No reading yet', detail: null },
            sections: [],
            message,
            footer: null,
            stale: false,
        };
    }

    return {
        header: {
            text: cycleText(lastGood.reading, now),
            detail: readingDetail(lastGood.reading, now, lastGood.fetchedAt, { stale: true }),
        },
        sections: group(lastGood.reading, now),
        message,
        footer: null,
        stale: true,
    };
}
