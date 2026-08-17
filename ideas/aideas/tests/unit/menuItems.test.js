// The exact sequence of items in the open menu. indicator.js creates one widget per item, in
// this order, with no decisions of its own — so this is where menu layout is actually pinned.

import { suite, test, assertEquals, assertDeepEquals, assert } from '../harness.js';
import { menuItems } from '../../src/lib/menuItems.js';
import { buildMenu } from '../../src/lib/menuModel.js';
import { parseState, unreachableReading, unconfiguredReading } from '../../src/lib/state.js';

const NOW = 1755180000;

function reading(overrides = {}, ideas = []) {
    return parseState({
        available: true, running: false, agents: [], cycle_started_at: null,
        lock_age_seconds: null, ideas, ...overrides,
    });
}

function idea(overrides = {}) {
    return { position: 1, slug: 'alpha', version: '0.1', state: 'ready', note: '', ...overrides };
}

function items(args) {
    return menuItems(buildMenu({ now: NOW, fetchedAt: NOW, ...args }));
}

/** The item types in order, which is the menu's skeleton. */
function types(list) {
    return list.map(item => item.type);
}

const busy = reading(
    { running: true, agents: ['alpha'], cycle_started_at: NOW - 720 },
    [
        idea({ position: 1, slug: 'alpha', state: 'running' }),
        idea({ position: 2, slug: 'asker', state: 'blocked', note: '2 unanswered questions', open_questions: 2 }),
        idea({ position: 3, slug: 'fresh', state: 'ready', note: 'not started' }),
    ]);

suite('a healthy menu', () => {
    const list = items({ reading: busy });

    test('leads with the cycle line', () => {
        assertEquals(list[0].type, 'header');
        assertEquals(list[0].text, 'Cycle running for 12 min, 1 agent');
        assertEquals(list[0].detail, 'updated just now');
    });

    test('then a titled block per section, in glance order', () => {
        assertDeepEquals(types(list), [
            'header', 'separator',
            'title', 'row', 'separator',
            'title', 'row', 'separator',
            'title', 'row', 'separator',
            'preferences',
        ]);
        assertDeepEquals(list.filter(i => i.type === 'title').map(i => i.text),
            ['Running', 'Blocked', 'Ready']);
    });

    test('rows carry the text the model decided, and a stable key', () => {
        const rows = list.filter(item => item.type === 'row');

        assertDeepEquals(rows.map(r => r.label), ['alpha', 'asker', 'fresh']);
        assertDeepEquals(rows.map(r => r.key), ['1:alpha', '2:asker', '3:fresh']);
        assertEquals(rows[1].detail, '2 unanswered questions');
        assertDeepEquals(rows.map(r => r.stale), [false, false, false]);
    });

    test('ends with the only item that does anything when clicked', () => {
        assertEquals(list[list.length - 1].type, 'preferences');
        assertEquals(list[list.length - 1].text, 'Preferences');
    });

    test('has no leading, trailing or doubled separator', () => {
        assert(list[0].type !== 'separator', 'no leading separator');
        assertEquals(list[list.length - 1].type, 'preferences');
        for (let i = 1; i < list.length; i++)
            assert(!(list[i].type === 'separator' && list[i - 1].type === 'separator'), 'no doubled separator');
    });
});

suite('an empty queue', () => {
    const list = items({ reading: reading() });

    test('says so beneath the cycle line, not above it', () => {
        assertDeepEquals(types(list), ['header', 'separator', 'message', 'separator', 'preferences']);
        assertEquals(list[0].text, 'Idle');
        assertEquals(list[2].text, 'The queue is empty');
        assertEquals(list[2].kind, 'empty');
    });
});

suite('a failure', () => {
    test('leads with the message, because that is the headline', () => {
        const list = items({
            reading: unreachableReading('connection refused'),
            host: '10.8.0.1:8787',
        });

        assertDeepEquals(types(list), ['message', 'separator', 'header', 'separator', 'preferences']);
        assertEquals(list[0].text, 'Orchestrator unreachable');
        assertEquals(list[0].detail, '10.8.0.1:8787 · connection refused');
        assertEquals(list[0].kind, 'failure');
        assertEquals(list[2].text, 'No reading yet');
    });

    test('an unconfigured extension is a two-line menu plus the way to fix it', () => {
        const list = items({ reading: unconfiguredReading() });

        assertDeepEquals(types(list), ['message', 'separator', 'header', 'separator', 'preferences']);
        assertEquals(list[0].text, 'Set the orchestrator address in preferences');
        assertEquals(list[list.length - 1].type, 'preferences');
    });

    test('with a last good reading, the stale sections sit beneath the failure', () => {
        const list = items({
            reading: unreachableReading('connection refused'),
            host: 'box:8787',
            lastGood: { reading: busy, fetchedAt: NOW - 300 },
        });

        assertDeepEquals(types(list), [
            'message', 'separator',
            'header', 'separator',
            'title', 'row', 'separator',
            'title', 'row', 'separator',
            'title', 'row', 'separator',
            'preferences',
        ]);
        assertEquals(list[0].text, 'Orchestrator unreachable');
        assertEquals(list[2].detail, 'last good reading 5 min ago');
    });

    test('every stale row is marked, so the widget can dim it', () => {
        const list = items({
            reading: unreachableReading('refused'),
            lastGood: { reading: busy, fetchedAt: NOW - 60 },
        });

        const rows = list.filter(item => item.type === 'row');
        assertEquals(rows.length, 3);
        for (const row of rows)
            assertEquals(row.stale, true);
    });
});

suite('the questions under a blocked idea', () => {
    const withQuestions = reading({}, [
        idea({ position: 1, slug: 'asker', state: 'blocked', note: '2 unanswered questions',
            open_questions: 2,
            open_question_texts: ['Should the bulb be grey?', 'Which port does the box use?'] }),
        idea({ position: 2, slug: 'fresh', state: 'ready', note: 'not started' }),
    ]);

    test('follow their row, inside its own block, before the next section', () => {
        const list = items({ reading: withQuestions });

        assertDeepEquals(types(list), [
            'header', 'separator',
            'title', 'row', 'question', 'question', 'separator',
            'title', 'row', 'separator',
            'preferences',
        ]);
    });

    test('carry the question text and a key of their own', () => {
        const list = items({ reading: withQuestions });
        const questions = list.filter(item => item.type === 'question');

        assertDeepEquals(questions.map(q => q.text),
            ['Should the bulb be grey?', 'Which port does the box use?']);
        assertDeepEquals(questions.map(q => q.key), ['1:asker:q0', '1:asker:q1']);
    });

    test('are never separated from the idea they belong to', () => {
        const list = items({ reading: withQuestions });
        const rowAt = list.findIndex(item => item.type === 'row');

        assertEquals(list[rowAt + 1].type, 'question',
            'a separator between a row and its questions would orphan them');
    });

    test('end with "+n more" when there are more than are shown', () => {
        const list = items({ reading: reading({}, [
            idea({ slug: 'asker', state: 'blocked', note: '7 unanswered questions',
                open_questions: 7,
                open_question_texts: ['one', 'two', 'three', 'four', 'five'] }),
        ]) });

        assertDeepEquals(types(list), [
            'header', 'separator',
            'title', 'row', 'question', 'question', 'question', 'question-more', 'separator',
            'preferences',
        ]);
        assertEquals(list.find(item => item.type === 'question-more').text, '+4 more');
    });

    test('a blocked row with no questions renders exactly as it always did', () => {
        const list = items({ reading: reading({}, [
            idea({ slug: 'asker', state: 'blocked', note: 'STATUS.md says blocked' }),
        ]) });

        assertDeepEquals(types(list),
            ['header', 'separator', 'title', 'row', 'separator', 'preferences']);
    });

    test('a blocked row from a box that never sent texts renders as it always did', () => {
        const list = items({ reading: reading({}, [
            idea({ slug: 'asker', state: 'blocked', note: '3 unanswered questions',
                open_questions: 3 }),
        ]) });

        assertDeepEquals(types(list),
            ['header', 'separator', 'title', 'row', 'separator', 'preferences']);
    });

    test('are dimmed with everything else in a stale reading', () => {
        const list = items({
            reading: unreachableReading('connection refused'),
            lastGood: { reading: withQuestions, fetchedAt: NOW - 120 },
        });

        const questions = list.filter(item => item.type === 'question');
        assertEquals(questions.length, 2);
        for (const question of questions)
            assertEquals(question.stale, true);
    });

    test('and are there behind a running cycle', () => {
        const list = items({ reading: reading(
            { running: true, agents: ['alpha'], cycle_started_at: NOW - 300 },
            [
                idea({ position: 1, slug: 'alpha', state: 'running' }),
                idea({ position: 2, slug: 'asker', state: 'blocked', open_questions: 1,
                    open_question_texts: ['Still waiting?'] }),
            ]) });

        assertDeepEquals(types(list), [
            'header', 'separator',
            'title', 'row', 'separator',
            'title', 'row', 'question', 'separator',
            'preferences',
        ]);
    });

    test('two blocked ideas keep their own questions', () => {
        const list = items({ reading: reading({}, [
            idea({ position: 1, slug: 'first', state: 'blocked', open_questions: 1,
                open_question_texts: ['first question'] }),
            idea({ position: 2, slug: 'second', state: 'blocked', open_questions: 1,
                open_question_texts: ['second question'] }),
        ]) });

        assertDeepEquals(types(list), [
            'header', 'separator',
            'title', 'row', 'question', 'row', 'question', 'separator',
            'preferences',
        ]);
        assertDeepEquals(list.filter(i => i.type === 'question').map(i => i.text),
            ['first question', 'second question']);
    });
});

suite('the footer', () => {
    test('a capped queue says what it is not showing, just above Preferences', () => {
        const ideas = Array.from({ length: 203 }, (_, i) =>
            idea({ position: i + 1, slug: `i${i}`, state: 'ready' }));

        const list = items({ reading: reading({}, ideas) });

        assertDeepEquals(types(list.slice(-4)), ['separator', 'footer', 'separator', 'preferences']);
        assertEquals(list[list.length - 3].text, '3 further entries not shown');
    });
});

suite('every item', () => {
    test('has a type the widget layer knows how to build', () => {
        const known = ['header', 'message', 'title', 'row', 'question', 'question-more',
            'footer', 'separator', 'preferences'];
        const asking = reading({}, [
            idea({ slug: 'asker', state: 'blocked', open_questions: 9,
                open_question_texts: ['one', 'two', 'three', 'four'] }),
        ]);
        const menus = [
            items({ reading: busy }),
            items({ reading: reading() }),
            items({ reading: unconfiguredReading() }),
            items({ reading: unreachableReading('x'), lastGood: { reading: busy, fetchedAt: NOW } }),
            items({ reading: parseState({ available: false, reason: 'no path' }) }),
            items({ reading: asking }),
        ];

        for (const list of menus) {
            for (const item of list)
                assert(known.includes(item.type), `unknown item type ${item.type}`);
        }
    });

    test('rows are the only repeated kind, and nothing else claims a key', () => {
        const list = items({ reading: busy });

        for (const item of list) {
            if (item.type !== 'row')
                assertEquals(item.key, undefined, `${item.type} should not carry a key`);
        }
    });
});
