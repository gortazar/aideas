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

// How many of a blocked idea's questions the menu lists, and how long each may be. A menu is a
// glance: the full text is in PLAN.md, and the answered open question settled on three lines of
// at most two rendered lines each. The character cap is what makes "two lines" true without the
// model knowing the menu's width — the widget wraps and ellipsizes whatever it is given.
const MENU_QUESTIONS_SHOWN = 3;
const MENU_QUESTION_MAX_CHARS = 120;

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
    // The stop file, said in the one line somebody reads at a glance. The two cases are
    // genuinely different: a paused idle queue will not start anything, while a paused running
    // one is winding down and still committing — "stopping", not "stopped".
    const paused = reading.paused === true;

    if (!reading.running)
        return paused ? 'Idle — paused' : 'Idle';

    const elapsed = reading.cycleStartedAt === null
        ? null
        : formatDuration(now - reading.cycleStartedAt);
    const agents = reading.agents.length > 0
        ? `, ${plural(reading.agents.length, 'agent')}`
        : '';
    const suffix = paused ? ' — stopping' : '';

    return elapsed === null
        ? `Cycle running${agents}${suffix}`
        : `Cycle running for ${elapsed}${agents}${suffix}`;
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
    return detail(
        updated,
        lockAge === null ? null : `lock renewed ${lockAge} ago`,
        // Named, not just reported: this panel can create that file, and someone who finds the
        // fleet paused with no panel in front of them needs to know what to delete.
        reading.paused === true ? '.orchestrator/stop exists' : null);
}

/**
 * The questions to list under a blocked row, and how many are left over.
 *
 * Only blocked rows: a question is a thing somebody has to answer before that idea moves, and a
 * ready row carrying stray texts is not the menu's business. `openQuestions` is the whole count
 * even when fewer texts were sent, so "+n more" counts everything not shown, not just what the
 * server withheld.
 */
function questionsFor(row, sectionId) {
    if (sectionId !== 'blocked' || row.openQuestionTexts.length === 0)
        return { questions: [], notShown: 0 };

    const shown = row.openQuestionTexts.slice(0, MENU_QUESTIONS_SHOWN).map(question =>
        question.length > MENU_QUESTION_MAX_CHARS
            ? `${question.slice(0, MENU_QUESTION_MAX_CHARS - 1).replace(/\s+\S*$/, '')}…`
            : question);

    const total = row.openQuestions ?? row.openQuestionTexts.length;
    return { questions: shown, notShown: Math.max(0, total - shown.length) };
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

    const { questions, notShown } = questionsFor(row, sectionId);

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
        // What this idea is actually waiting to be told, listed under it. The row's own detail
        // line ("3 unanswered questions") stays as the summary above them.
        questions,
        questionsNotShown: notShown,
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
                kind: 'failure',
                text: 'Set the orchestrator address in preferences',
                detail: 'aideas needs the host or IP of the box, reachable over the VPN',
            };
        case Status.UNAVAILABLE:
            return {
                kind: 'failure',
                text: 'The orchestrator cannot read its queue',
                detail: reading.reason,
            };
        default:
            return {
                kind: 'failure',
                text: 'Orchestrator unreachable',
                detail: detail(host, reading.reason),
            };
    }
}

/** Gates a `Run anyway` may get past. The rest are about safety, not convenience. */
const OVERRIDABLE_GATES = ['allowed-hours', 'heartbeat'];

/**
 * The two things in this menu that do something, and the third that appears when one of them
 * is refused for a reason a person can decide to ignore.
 *
 * Every one of them carries why it cannot be clicked, because an item that is simply grey is
 * indistinguishable from a broken one. And every outcome of a click stays on screen as the
 * item's detail line: a click whose only visible effect is nothing at all is exactly the
 * failure the "Run a cycle" button has to avoid.
 */
function actionItems(reading, actions) {
    const {
        refreshing = false, cycleInFlight = false, cycleOutcome = null,
        stopInFlight = null, stopOutcome = null,
        editor = null, openOutcome = null,
    } = actions ?? {};
    const unconfigured = reading.status === Status.UNCONFIGURED;
    const unreachable = reading.status === Status.UNREACHABLE;
    const running = reading.status === Status.OK && reading.running;
    const paused = reading.status === Status.OK && reading.paused === true;

    const items = [];

    items.push({
        action: 'refresh',
        label: refreshing ? 'Checking…' : 'Check now',
        // The header's own "updated just now" is the answer to this click, so this line only
        // ever explains a *refusal* to act.
        detail: unconfigured ? 'no orchestrator address is set' : null,
        sensitive: !refreshing && !unconfigured,
    });

    const cycleDetail = () => {
        if (cycleInFlight)
            return null;
        if (cycleOutcome === null)
            return null;
        if (cycleOutcome.started)
            return 'asked the box to start one';
        return cycleOutcome.reason;
    };

    let blocked = null;
    if (cycleInFlight)
        blocked = null; // the label already says it
    else if (unconfigured)
        blocked = 'no orchestrator address is set';
    else if (unreachable)
        blocked = 'the box cannot be reached';
    // Paused before running, because that is the order `cycle_preflight()` applies: a paused box
    // with a cycle winding down refuses at `stop-file`, not at `lock`. Naming the lock here
    // would be naming a gate the box would not have reached.
    else if (paused)
        // Not "try and be refused": the stop-file gate is one of the three a `Run anyway`
        // deliberately cannot pass, so the way to run a cycle here is to resume, visibly.
        blocked = 'the queue is paused';
    else if (running)
        blocked = 'a cycle is already running';

    items.push({
        action: 'cycle',
        label: cycleInFlight ? 'Cycle starting…' : 'Run a cycle',
        detail: blocked ?? cycleDetail(),
        sensitive: !cycleInFlight && !unconfigured && !unreachable && !running && !paused,
    });

    // Only after a refusal, and only for the gates that are about *when* it is convenient to
    // build. A pause, a spent budget or a held lock are not things to click past.
    //
    // `blocked === null` as well, which is not redundant: a refusal is remembered, and the box
    // can move on from the state that produced it. An override left on screen after the queue
    // has been paused would be offering to skip the one gate it provably cannot.
    const refusedGate = cycleOutcome && !cycleOutcome.started ? cycleOutcome.gate : null;
    if (!cycleInFlight && blocked === null && OVERRIDABLE_GATES.includes(refusedGate)) {
        items.push({
            action: 'override',
            label: 'Run anyway',
            detail: 'ignores the schedule and the laptop heartbeat',
            sensitive: true,
        });
    }

    items.push(stopItem({ paused, running, unconfigured, unreachable },
        stopInFlight, stopOutcome));

    items.push(openItem(editor, openOutcome));

    return items;
}

/**
 * Opening the queue in an editor — the one item here that has nothing to do with the box.
 *
 * The queue is `README.md` on this laptop, so this item is live whatever the orchestrator is
 * doing: writing an idea down is always possible. What it does depend on is two preferences, and
 * when either is wrong the item is **insensitive with the reason**, never a silent no-op. When
 * both are right the detail line is the path itself: an editor that opens the wrong checkout
 * loses the idea you just typed into it, and seeing the path first is the cheap guard.
 */
function openItem(editor, outcome) {
    // No editor information at all means the extension has not worked out where the repository
    // is — which is the same situation as not having one configured, and reads the same way.
    const problem = editor === null
        ? 'set the repository path in preferences'
        : editor.problem;

    return {
        action: 'open',
        label: 'Add an idea',
        detail: outcome ?? problem ?? editor?.path ?? null,
        sensitive: problem === null,
    };
}

/**
 * One item with three readings, because the stop file has three meanings.
 *
 * It stops a running cycle, it pauses a queue where nothing is running, and — because nothing in
 * the orchestrator ever removes it — it has to offer its own undo. That last reading is not a
 * convenience: a button that could only ever create the file would pause the fleet for ever, and
 * the symptom of that is an orchestrator that looks broken rather than paused.
 */
function stopItem({ paused, running, unconfigured, unreachable }, inFlight, outcome) {
    const label = (() => {
        if (inFlight === 'resume')
            return 'Resuming…';
        if (inFlight)
            return running ? 'Stopping…' : 'Pausing…';
        if (paused)
            return 'Resume the queue';
        // With nothing known about the box, "Stop the cycle" would assert there is one.
        return running ? 'Stop the cycle' : 'Pause the queue';
    })();

    const standing = (() => {
        if (unconfigured)
            return 'no orchestrator address is set';
        if (unreachable)
            return 'the box cannot be reached';
        // Not a failure and not a timeout: agents are checked between phases, so a wind-down
        // takes as long as they take. Saying nothing here reads as a button that did nothing.
        if (paused && running)
            return 'a cycle is still winding down';
        return null;
    })();

    return {
        action: 'stop',
        label,
        // In flight, the label is the whole message. Otherwise the last outcome — which is the
        // box's own sentence, refusal or not — outranks the standing line, except for the two
        // that say clicking cannot work at all.
        detail: inFlight
            ? null
            : ((unconfigured || unreachable) ? standing : (outcome?.reason ?? standing)),
        sensitive: !inFlight && !unconfigured && !unreachable,
    };
}

/**
 * Build the whole menu.
 *
 * `now` and `fetchedAt` are unix seconds and are always passed in — nothing here reads a
 * clock. `lastGood` is the previous `ok` reading and its timestamp, if there is one: when the
 * current attempt failed, the menu shows that earlier reading marked stale beneath the
 * failure, rather than emptying itself and losing the last thing anybody knew.
 */
export function buildMenu({
    reading, now, fetchedAt = null, lastGood = null, host = null, actions = null,
}) {
    if (reading.status === Status.OK) {
        return {
            actions: actionItems(reading, actions),
            header: {
                text: cycleText(reading, now),
                detail: readingDetail(reading, now, fetchedAt),
            },
            sections: group(reading, now),
            // `kind` is what tells the item list whether this message is the headline (a
            // failure, which goes above the cycle line) or a footnote to a healthy reading.
            message: reading.rows.length === 0
                ? {
                    kind: 'empty',
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
            actions: actionItems(reading, actions),
            header: { text: 'No reading yet', detail: null },
            sections: [],
            message,
            footer: null,
            stale: false,
        };
    }

    return {
        actions: actionItems(reading, actions),
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
