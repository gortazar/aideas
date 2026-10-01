// The third item: opening the queue where ideas are written.
//
// It is the only item in this menu that does something *local*, and the only one whose failure
// is silent if you let it be — an editor that opens the wrong checkout loses the idea you just
// typed. So the detail line names the path before the click, every time.

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { buildMenu } from '../../src/lib/menuModel.js';
import { menuItems } from '../../src/lib/menuItems.js';
import { parseState, unreachableReading } from '../../src/lib/state.js';

const NOW = 1755180000;
const READY = { path: '/home/p/aideas/README.md', problem: null };

function reading(overrides = {}) {
    return parseState({
        available: true, running: false, agents: [], cycle_started_at: null,
        lock_age_seconds: null, paused: false, ideas: [], ...overrides,
    });
}

function built(args) {
    return buildMenu({ now: NOW, fetchedAt: NOW, ...args });
}

function actions(args) {
    const map = {};
    for (const action of built(args).actions)
        map[action.action] = action;
    return map;
}

const idle = reading();

suite('Add an idea', () => {
    test('names the file it will open, before it is clicked', () => {
        const { open } = actions({ reading: idle, actions: { editor: READY } });

        assertEquals(open.label, 'Add an idea');
        assertEquals(open.sensitive, true);
        assertEquals(open.detail, '/home/p/aideas/README.md',
            'the one cheap guard against typing an idea into the wrong checkout');
    });

    test('is insensitive, and says which preference to set, when nothing is configured', () => {
        const { open } = actions({
            reading: idle,
            actions: { editor: { path: null, problem: 'set the repository path in preferences' } },
        });

        assertEquals(open.sensitive, false);
        assertEquals(open.detail, 'set the repository path in preferences');
    });

    test('a wrong path is named, not a silent no-op', () => {
        const { open } = actions({
            reading: idle,
            actions: {
                editor: {
                    path: '/home/p/typo/README.md',
                    problem: '/home/p/typo/README.md does not exist',
                },
            },
        });

        assertEquals(open.sensitive, false);
        assertEquals(open.detail, '/home/p/typo/README.md does not exist');
    });

    test('a missing editor names the preference that fixes it', () => {
        const { open } = actions({
            reading: idle,
            actions: {
                editor: {
                    path: '/home/p/aideas/README.md',
                    problem: 'no codium found — set the editor command in preferences',
                },
            },
        });

        assertEquals(open.sensitive, false);
        assert(open.detail.includes('preferences'), open.detail);
    });

    test('a failed launch replaces the path with what went wrong', () => {
        const { open } = actions({
            reading: idle,
            actions: { editor: READY, openOutcome: 'the editor command was not found' },
        });

        assertEquals(open.detail, 'the editor command was not found');
        assertEquals(open.sensitive, true, 'and it can be tried again');
    });

    test('it does not depend on the box at all', () => {
        // The queue is a file on this laptop. An orchestrator that is down, paused or
        // unreachable has nothing to do with whether an idea can be written down.
        for (const r of [
            idle,
            reading({ running: true, agents: ['a'], cycle_started_at: NOW - 60 }),
            reading({ paused: true }),
            unreachableReading('connection refused'),
        ]) {
            const { open } = actions({ reading: r, actions: { editor: READY } });
            assertEquals(open.sensitive, true, 'writing down an idea is always possible');
        }
    });

    test('with nothing known about the editor at all, it is insensitive rather than absent', () => {
        // A grey item that says what to set is a thing somebody can act on; a missing item is
        // a feature nobody discovers.
        const { open } = actions({ reading: idle });

        assertEquals(open.label, 'Add an idea');
        assertEquals(open.sensitive, false);
        assert(open.detail.includes('preferences'), open.detail);
    });
});

suite('the three things the menu does', () => {
    test('sit in one block, in the order start, stop, open', () => {
        const list = menuItems(built({ reading: idle, actions: { editor: READY } }));

        assertDeepEquals(list.filter(i => i.type === 'action').map(i => i.action),
            ['refresh', 'cycle', 'stop', 'open']);
    });

    test('with Run anyway between the cycle and the stop', () => {
        const list = menuItems(built({
            reading: idle,
            actions: {
                editor: READY,
                cycleOutcome: { started: false, gate: 'heartbeat', reason: 'busy' },
            },
        }));

        assertDeepEquals(list.filter(i => i.type === 'action').map(i => i.action),
            ['refresh', 'cycle', 'override', 'stop', 'open']);
    });

    test('and are still the last block before Preferences', () => {
        const list = menuItems(built({ reading: idle, actions: { editor: READY } }));
        const types = list.map(item => item.type);

        assertDeepEquals(types.slice(-6),
            ['action', 'action', 'action', 'action', 'separator', 'preferences']);
    });
});
