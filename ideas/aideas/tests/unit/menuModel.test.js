// The menu, asserted as data. Every test here is a menu somebody could be looking at.

import { suite, test, assertEquals, assertDeepEquals, assert } from '../harness.js';
import { buildMenu } from '../../src/lib/menuModel.js';
import { parseState, unreachableReading, unconfiguredReading } from '../../src/lib/state.js';

const NOW = 1755180000;

/** A parsed reading, from the wire shape, so the tests exercise the real pipeline. */
function reading(overrides = {}, ideas = []) {
    return parseState({
        available: true,
        running: false,
        agents: [],
        cycle_started_at: null,
        lock_age_seconds: null,
        ideas,
        ...overrides,
    });
}

function idea(overrides = {}) {
    return {
        position: 1, slug: 'alpha', version: '0.1', state: 'ready',
        note: 'not started', will_run_next: false, ...overrides,
    };
}

function menu(args) {
    return buildMenu({ now: NOW, fetchedAt: NOW, ...args });
}

/** Sections as `id: slug, slug` strings — a compact way to assert the whole shape. */
function shape(built) {
    return built.sections.map(s => `${s.id}: ${s.rows.map(r => r.label).join(', ')}`);
}

function section(built, id) {
    return built.sections.find(s => s.id === id);
}

suite('the header line', () => {
    test('a running cycle says for how long, and how many agents', () => {
        const built = menu({ reading: reading({
            running: true, agents: ['alpha', 'beta'], cycle_started_at: NOW - 12 * 60,
        }) });

        assertEquals(built.header.text, 'Cycle running for 12 min, 2 agents');
    });

    test('one agent is singular', () => {
        const built = menu({ reading: reading({
            running: true, agents: ['alpha'], cycle_started_at: NOW - 90,
        }) });

        assertEquals(built.header.text, 'Cycle running for 1 min, 1 agent');
    });

    test('a lock that listed no agents drops the count rather than saying zero', () => {
        const built = menu({ reading: reading({
            running: true, agents: [], cycle_started_at: NOW - 60,
        }) });

        assertEquals(built.header.text, 'Cycle running for 1 min');
    });

    test('an unknown start time drops the span rather than faking one', () => {
        const built = menu({ reading: reading({
            running: true, agents: ['alpha'], cycle_started_at: null,
        }) });

        assertEquals(built.header.text, 'Cycle running, 1 agent');
    });

    test('an idle box says so', () => {
        assertEquals(menu({ reading: reading() }).header.text, 'Idle');
    });

    test('the age of the reading is shown, so a frozen panel looks frozen', () => {
        assertEquals(menu({ reading: reading(), fetchedAt: NOW - 8 }).header.detail,
            'updated 8 s ago');
        assertEquals(menu({ reading: reading(), fetchedAt: NOW }).header.detail,
            'updated just now');
    });

    test('a reading with no timestamp says never updated', () => {
        assertEquals(menu({ reading: reading(), fetchedAt: null }).header.detail,
            'never updated');
    });

    test('the lock age rides along when the box reported one', () => {
        const built = menu({
            reading: reading({ running: true, cycle_started_at: NOW - 600, lock_age_seconds: 42 }),
            fetchedAt: NOW - 3,
        });

        assertEquals(built.header.detail, 'updated just now · lock renewed 42 s ago');
    });

    test('an idle box with an old lock shows it — that is a killed cycle, not a finished one', () => {
        const built = menu({
            reading: reading({ running: false, lock_age_seconds: 7200 }),
            fetchedAt: NOW,
        });

        assertEquals(built.header.text, 'Idle');
        assertEquals(built.header.detail, 'updated just now · lock renewed 2 h ago');
    });
});

suite('grouping', () => {
    test('the four sections come in the order that matters at a glance', () => {
        const built = menu({ reading: reading(
            { running: true, agents: ['runner'], cycle_started_at: NOW - 300 },
            [
                idea({ position: 1, slug: 'fresh', state: 'ready' }),
                idea({ position: 2, slug: 'later', state: 'queued', note: 'behind #1' }),
                idea({ position: 3, slug: 'runner', state: 'running', note: 'an agent is working on it now' }),
                idea({ position: 4, slug: 'asker', state: 'blocked', note: '2 unanswered questions', open_questions: 2 }),
            ]) });

        assertDeepEquals(shape(built), [
            'running: runner',
            'blocked: asker',
            'ready: fresh',
            'other: later',
        ]);
        assertDeepEquals(built.sections.map(s => s.title),
            ['Running', 'Blocked', 'Ready', 'Also in the queue']);
    });

    test('empty sections are left out — an empty section is furniture, not information', () => {
        const built = menu({ reading: reading({}, [idea({ state: 'ready' })]) });

        assertDeepEquals(shape(built), ['ready: alpha']);
    });

    test('queue order is kept inside a section', () => {
        const built = menu({ reading: reading({}, [
            idea({ position: 1, slug: 'first' }),
            idea({ position: 2, slug: 'second' }),
            idea({ position: 3, slug: 'third' }),
        ]) });

        assertDeepEquals(section(built, 'ready').rows.map(r => r.label),
            ['first', 'second', 'third']);
    });

    test('the same slug twice in Running is fine — the contract allows it', () => {
        // A running slug with two queued entries comes back as two running rows.
        const built = menu({ reading: reading(
            { running: true, agents: ['alpha'], cycle_started_at: NOW - 60 },
            [
                idea({ position: 1, slug: 'alpha', state: 'running' }),
                idea({ position: 2, slug: 'alpha', state: 'running' }),
            ]) });

        const rows = section(built, 'running').rows;
        assertEquals(rows.length, 2);
        assert(rows[0].key !== rows[1].key, 'rows must be distinguishable — keyed by position');
        assertDeepEquals(rows.map(r => r.key), ['1:alpha', '2:alpha']);
    });

    test('to be planned and unknown states share the quiet section', () => {
        const built = menu({ reading: reading({}, [
            idea({ position: 1, slug: 'unplanned', state: 'to be planned', note: 'no PLAN.md yet' }),
            idea({ position: 2, slug: 'odd', state: 'hibernating', note: '' }),
        ]) });

        assertDeepEquals(shape(built), ['other: unplanned, odd']);
    });
});

suite('row wording', () => {
    test('a running row carries its version and the cycle\'s span', () => {
        const built = menu({ reading: reading(
            { running: true, agents: ['alpha'], cycle_started_at: NOW - 12 * 60 },
            [idea({ slug: 'alpha', version: '0.4', state: 'running' })]) });

        const [row] = section(built, 'running').rows;
        assertEquals(row.label, 'alpha');
        assertEquals(row.detail, 'v0.4 · running for 12 min');
    });

    test('a running row with an unknown version or span drops that part', () => {
        const built = menu({ reading: reading(
            { running: true, agents: ['alpha'], cycle_started_at: null },
            [idea({ slug: 'alpha', version: 'nonsense', state: 'running' })]) });

        assertEquals(section(built, 'running').rows[0].detail, null);
    });

    test('a blocked row says how many questions, in the orchestrator\'s own words', () => {
        const built = menu({ reading: reading({}, [
            idea({ slug: 'asker', state: 'blocked', note: '2 unanswered questions', open_questions: 2 }),
        ]) });

        const [row] = section(built, 'blocked').rows;
        assertEquals(row.label, 'asker');
        assertEquals(row.detail, '2 unanswered questions');
    });

    test('a blocked row with no note falls back to its count', () => {
        const built = menu({ reading: reading({}, [
            idea({ slug: 'asker', state: 'blocked', note: '', open_questions: 1 }),
        ]) });

        assertEquals(section(built, 'blocked').rows[0].detail, '1 unanswered question');
    });

    test('a blocked row with neither says nothing rather than something invented', () => {
        const built = menu({ reading: reading({}, [
            idea({ slug: 'asker', state: 'blocked', note: '' }),
        ]) });

        assertEquals(section(built, 'blocked').rows[0].detail, null);
    });

    test('a blocked row carries its questions, and nothing left over', () => {
        const built = menu({ reading: reading({}, [
            idea({ slug: 'asker', state: 'blocked', note: '2 unanswered questions',
                open_questions: 2,
                open_question_texts: ['Should the bulb be grey?', 'Which port?'] }),
        ]) });

        const [row] = section(built, 'blocked').rows;
        assertDeepEquals(row.questions, ['Should the bulb be grey?', 'Which port?']);
        assertEquals(row.questionsNotShown, 0);
        assertEquals(row.detail, '2 unanswered questions', 'the summary line is unchanged');
    });

    test('at most three are listed, and the rest are counted', () => {
        const built = menu({ reading: reading({}, [
            idea({ slug: 'asker', state: 'blocked', note: '7 unanswered questions',
                open_questions: 7,
                open_question_texts: ['one', 'two', 'three', 'four', 'five'] }),
        ]) });

        const [row] = section(built, 'blocked').rows;
        assertDeepEquals(row.questions, ['one', 'two', 'three']);
        assertEquals(row.questionsNotShown, 4,
            'counted against the whole count, not just what the server sent');
    });

    test('a question too long for two lines is cut at a word boundary', () => {
        const long = `${'word '.repeat(40)}end`;
        const built = menu({ reading: reading({}, [
            idea({ slug: 'asker', state: 'blocked', open_questions: 1,
                open_question_texts: [long] }),
        ]) });

        const [question] = section(built, 'blocked').rows[0].questions;
        assert(question.length <= 120, `${question.length} characters in a menu row`);
        assert(question.endsWith('…'), 'and it says it was cut');
        assert(!/\bwor…$/.test(question), 'not mid-word');
    });

    test('a blocked row with no questions has none — nothing changes for it', () => {
        const built = menu({ reading: reading({}, [
            idea({ slug: 'asker', state: 'blocked', note: 'STATUS.md says blocked' }),
        ]) });

        const [row] = section(built, 'blocked').rows;
        assertDeepEquals(row.questions, []);
        assertEquals(row.questionsNotShown, 0);
        assertEquals(row.detail, 'STATUS.md says blocked');
    });

    test('a row that is not blocked never lists questions', () => {
        const built = menu({ reading: reading({}, [
            idea({ position: 1, slug: 'fresh', state: 'ready',
                open_question_texts: ['stray'] }),
            idea({ position: 2, slug: 'later', state: 'queued', note: 'behind #1',
                open_question_texts: ['stray'] }),
        ]) });

        for (const row of section(built, 'ready').rows.concat(section(built, 'other').rows))
            assertDeepEquals(row.questions, [], `${row.label} should list nothing`);
    });

    test('questions are there behind a running cycle too', () => {
        const built = menu({ reading: reading(
            { running: true, agents: ['alpha'], cycle_started_at: NOW - 60 },
            [
                idea({ position: 1, slug: 'alpha', state: 'running' }),
                idea({ position: 2, slug: 'asker', state: 'blocked', open_questions: 1,
                    open_question_texts: ['Still waiting on this?'] }),
            ]) });

        assertDeepEquals(section(built, 'blocked').rows[0].questions,
            ['Still waiting on this?'],
            'a blocked idea is blocked whether or not something else is running');
    });

    test('a ready row shows the note as served', () => {
        const built = menu({ reading: reading({}, [
            idea({ slug: 'aideas', state: 'ready', note: 'minor update -> v0.3', will_run_next: true }),
        ]) });

        const [row] = section(built, 'ready').rows;
        assertEquals(row.detail, 'minor update -> v0.3');
    });

    test('the row the next cycle would pick is marked, and only that row', () => {
        const built = menu({ reading: reading({}, [
            idea({ position: 1, slug: 'first', will_run_next: true }),
            idea({ position: 2, slug: 'second', will_run_next: false }),
        ]) });

        assertDeepEquals(section(built, 'ready').rows.map(r => r.marker), ['next', null]);
    });

    test('a queued row explains what it is behind', () => {
        const built = menu({ reading: reading({}, [
            idea({ slug: 'alpha', version: '0.2', state: 'queued', note: 'behind #1' }),
        ]) });

        assertEquals(section(built, 'other').rows[0].detail, 'v0.2 · behind #1');
    });

    test('an unknown state word is shown, not swallowed', () => {
        const built = menu({ reading: reading({}, [
            idea({ slug: 'odd', version: '0.1', state: 'hibernating', note: 'until Tuesday' }),
        ]) });

        assertEquals(section(built, 'other').rows[0].detail, 'v0.1 · hibernating · until Tuesday');
    });
});

suite('an empty queue', () => {
    test('says so in a sentence, and has no sections', () => {
        const built = menu({ reading: reading() });

        assertDeepEquals(built.sections, []);
        assertEquals(built.message.text, 'The queue is empty');
        assertEquals(built.message.detail, 'README.md has no entries under ## Ideas');
    });

    test('a queue with entries has no message', () => {
        assertEquals(menu({ reading: reading({}, [idea()]) }).message, null);
    });

    test('a capped queue says how much it is not showing', () => {
        const ideas = Array.from({ length: 205 }, (_, i) => idea({ position: i + 1, slug: `i${i}` }));

        assertEquals(menu({ reading: reading({}, ideas) }).footer, '5 further entries not shown');
    });

    test('one dropped entry is singular', () => {
        const ideas = Array.from({ length: 201 }, (_, i) => idea({ position: i + 1, slug: `i${i}` }));

        assertEquals(menu({ reading: reading({}, ideas) }).footer, '1 further entry not shown');
    });
});

suite('failures', () => {
    test('an unconfigured extension says what to do, and polls nothing', () => {
        const built = menu({ reading: unconfiguredReading() });

        assertEquals(built.message.text, 'Set the orchestrator address in preferences');
        assertEquals(built.header.text, 'No reading yet');
        assertDeepEquals(built.sections, []);
        assertEquals(built.stale, false);
    });

    test('unreachable names the host it tried and why it failed', () => {
        const built = menu({
            reading: unreachableReading('connection refused'),
            host: '10.8.0.1:8787',
        });

        assertEquals(built.message.text, 'Orchestrator unreachable');
        assertEquals(built.message.detail, '10.8.0.1:8787 · connection refused');
    });

    test('unreachable with no host still says why', () => {
        const built = menu({ reading: unreachableReading('timed out after 10 s') });

        assertEquals(built.message.detail, 'timed out after 10 s');
    });

    test('available:false shows the server\'s own reason, and is not called unreachable', () => {
        const built = menu({ reading: parseState({
            available: false, reason: 'IDEAS_REPO_PATH is not set',
        }) });

        assertEquals(built.message.text, 'The orchestrator cannot read its queue');
        assertEquals(built.message.detail, 'IDEAS_REPO_PATH is not set');
        assert(built.message.text !== 'Orchestrator unreachable',
            'a box refusing and a box that is silent mean opposite things');
    });
});

suite('the last good reading', () => {
    const good = reading(
        { running: true, agents: ['alpha'], cycle_started_at: NOW - 3600, lock_age_seconds: 20 },
        [
            idea({ position: 1, slug: 'alpha', state: 'running' }),
            idea({ position: 2, slug: 'asker', state: 'blocked', note: '1 unanswered question', open_questions: 1 }),
        ]);

    test('is shown beneath a failure rather than emptying the menu', () => {
        const built = menu({
            reading: unreachableReading('connection refused'),
            host: '10.8.0.1:8787',
            lastGood: { reading: good, fetchedAt: NOW - 300 },
        });

        assertEquals(built.stale, true);
        assertEquals(built.message.text, 'Orchestrator unreachable');
        assertDeepEquals(shape(built), ['running: alpha', 'blocked: asker']);
    });

    test('is dated, and says it is the last good one rather than a fresh reading', () => {
        const built = menu({
            reading: unreachableReading('connection refused'),
            lastGood: { reading: good, fetchedAt: NOW - 300 },
        });

        assertEquals(built.header.text, 'Cycle running for 1 h, 1 agent');
        assertEquals(built.header.detail, 'last good reading 5 min ago · lock renewed 20 s ago');
    });

    test('an unavailable box keeps the last good reading too', () => {
        const built = menu({
            reading: parseState({ available: false, reason: 'could not read the queue: boom' }),
            lastGood: { reading: good, fetchedAt: NOW - 30 },
        });

        assertEquals(built.stale, true);
        assertEquals(built.message.detail, 'could not read the queue: boom');
        assertDeepEquals(shape(built), ['running: alpha', 'blocked: asker']);
    });

    test('a last good reading that is not an ok reading is ignored', () => {
        for (const lastGood of [
            null,
            {},
            { reading: unreachableReading('refused'), fetchedAt: NOW - 10 },
            { reading: unconfiguredReading(), fetchedAt: NOW - 10 },
        ]) {
            const built = menu({ reading: unreachableReading('refused'), lastGood });
            assertEquals(built.stale, false, `for ${JSON.stringify(lastGood)}`);
            assertEquals(built.header.text, 'No reading yet');
        }
    });

    test('a fresh ok reading ignores the last good one entirely', () => {
        const built = menu({
            reading: reading({}, [idea({ slug: 'fresh' })]),
            lastGood: { reading: good, fetchedAt: NOW - 300 },
        });

        assertEquals(built.stale, false);
        assertDeepEquals(shape(built), ['ready: fresh']);
    });
});
