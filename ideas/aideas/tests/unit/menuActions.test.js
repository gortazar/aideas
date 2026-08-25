// The two items that do something, and the third that appears when one of them is refused.
//
// Every assertion here is a menu somebody could be looking at, because the failure this entry
// exists to avoid is a click whose only visible effect is nothing at all.

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { buildMenu } from '../../src/lib/menuModel.js';
import { menuItems } from '../../src/lib/menuItems.js';
import { parseState, unreachableReading, unconfiguredReading } from '../../src/lib/state.js';

const NOW = 1755180000;

function reading(overrides = {}, ideas = []) {
    return parseState({
        available: true, running: false, agents: [], cycle_started_at: null,
        lock_age_seconds: null, ideas, ...overrides,
    });
}

function built(args) {
    return buildMenu({ now: NOW, fetchedAt: NOW, ...args });
}

/** The action items, keyed by what they do. */
function actions(args) {
    const map = {};
    for (const action of built(args).actions)
        map[action.action] = action;
    return map;
}

const idle = reading();
const running = reading({ running: true, agents: ['alpha'], cycle_started_at: NOW - 600 });

suite('Check now', () => {
    test('is offered on an idle box, and says what it is', () => {
        const { refresh } = actions({ reading: idle });

        assertEquals(refresh.label, 'Check now');
        assertEquals(refresh.sensitive, true);
        assertEquals(refresh.detail, null, 'the header answers this click, not a detail line');
    });

    test('says so while the request is in the air, and cannot be clicked again', () => {
        const { refresh } = actions({ reading: idle, actions: { refreshing: true } });

        assertEquals(refresh.label, 'Checking…');
        assertEquals(refresh.sensitive, false);
    });

    test('is offered while a cycle runs — resetting the backoff is the point', () => {
        assertEquals(actions({ reading: running }).refresh.sensitive, true);
    });

    test('is offered on a box that cannot be reached, because that is when you retry', () => {
        const { refresh } = actions({ reading: unreachableReading('connection refused') });

        assertEquals(refresh.sensitive, true);
    });

    test('is not offered when there is no address, and says why', () => {
        const { refresh } = actions({ reading: unconfiguredReading() });

        assertEquals(refresh.sensitive, false);
        assertEquals(refresh.detail, 'no orchestrator address is set');
    });
});

suite('Run a cycle', () => {
    test('is offered on an idle box', () => {
        const { cycle } = actions({ reading: idle });

        assertEquals(cycle.label, 'Run a cycle');
        assertEquals(cycle.sensitive, true);
        assertEquals(cycle.detail, null);
    });

    test('does not look like Check now', () => {
        const both = actions({ reading: idle });

        assert(both.cycle.label !== both.refresh.label, 'this one spends money');
    });

    test('says so while the post is out, and cannot be clicked twice', () => {
        const { cycle } = actions({ reading: idle, actions: { cycleInFlight: true } });

        assertEquals(cycle.label, 'Cycle starting…');
        assertEquals(cycle.sensitive, false);
    });

    test('is insensitive while a cycle is already running, and says which', () => {
        const { cycle } = actions({ reading: running });

        assertEquals(cycle.sensitive, false);
        assertEquals(cycle.detail, 'a cycle is already running');
    });

    test('is insensitive when there is nothing to post to', () => {
        const unreachable = actions({ reading: unreachableReading('connection refused') }).cycle;
        assertEquals(unreachable.sensitive, false);
        assertEquals(unreachable.detail, 'the box cannot be reached');

        const unconfigured = actions({ reading: unconfiguredReading() }).cycle;
        assertEquals(unconfigured.sensitive, false);
        assertEquals(unconfigured.detail, 'no orchestrator address is set');
    });

    test('stays live on a box that answers available:false', () => {
        // That box is *reachable*: it can be told to try, and the answer will be honest.
        const { cycle } = actions({
            reading: parseState({ available: false, reason: 'IDEAS_REPO_PATH is not set' }),
        });

        assertEquals(cycle.sensitive, true);
    });

    test('reports the gate that refused it, in the box\'s own words', () => {
        const { cycle } = actions({
            reading: idle,
            actions: { cycleOutcome: {
                started: false, gate: 'budget', reason: 'Daily budget spent ($12.40 of $10)',
            } },
        });

        assertEquals(cycle.detail, 'Daily budget spent ($12.40 of $10)');
        assertEquals(cycle.sensitive, true, 'and can be tried again');
    });

    test('says a launch was asked for, not that a cycle is running', () => {
        const { cycle } = actions({
            reading: idle,
            actions: { cycleOutcome: { started: true, gate: null, reason: null } },
        });

        assertEquals(cycle.detail, 'asked the box to start one',
            'started:true means launched; the header is what confirms it ran');
    });
});

suite('Run anyway', () => {
    const refusedAt = gate => ({
        reading: idle,
        actions: { cycleOutcome: { started: false, gate, reason: `refused by ${gate}` } },
    });

    test('is not there until something has been refused', () => {
        assertEquals(actions({ reading: idle }).override, undefined);
        assertEquals(actions({ reading: running }).override, undefined);
    });

    test('appears after a refusal about when it is convenient to build', () => {
        for (const gate of ['allowed-hours', 'heartbeat']) {
            const { override } = actions(refusedAt(gate));
            assert(override !== undefined, `${gate} should offer an override`);
            assertEquals(override.label, 'Run anyway');
            assertEquals(override.sensitive, true);
            assertEquals(override.detail, 'ignores the schedule and the laptop heartbeat');
        }
    });

    test('never appears for a refusal about whether it is safe to build', () => {
        for (const gate of ['stop-file', 'budget', 'lock', 'claude', 'spawn', 'server',
            'rate-limit', 'unsupported', 'unauthorised', 'unreachable', 'malformed']) {
            assertEquals(actions(refusedAt(gate)).override, undefined,
                `${gate} must not be clickable past`);
        }
    });

    test('goes away while a new post is in flight', () => {
        const { override } = actions({
            reading: idle,
            actions: {
                cycleInFlight: true,
                cycleOutcome: { started: false, gate: 'heartbeat', reason: 'busy' },
            },
        });

        assertEquals(override, undefined);
    });

    test('goes away once a cycle actually started', () => {
        assertEquals(actions({
            reading: idle,
            actions: { cycleOutcome: { started: true, gate: null, reason: null } },
        }).override, undefined);
    });
});

suite('where they sit', () => {
    test('in their own block, directly above Preferences', () => {
        const list = menuItems(built({ reading: idle }));
        const types = list.map(item => item.type);

        assertEquals(types[types.length - 1], 'preferences');
        assertEquals(types[types.length - 2], 'separator');
        assertEquals(types[types.length - 3], 'action');
        assertEquals(types[types.length - 4], 'action');
        assertEquals(types[types.length - 5], 'separator',
            'the actions are their own block, not an appendix to the queue');
    });

    test('three of them once an override is offered', () => {
        const list = menuItems(built({
            reading: idle,
            actions: { cycleOutcome: { started: false, gate: 'heartbeat', reason: 'busy' } },
        }));

        assertDeepEquals(list.filter(i => i.type === 'action').map(i => i.action),
            ['refresh', 'cycle', 'override']);
    });

    test('each carries what the widget layer needs and nothing more', () => {
        const list = menuItems(built({ reading: running }));

        for (const item of list.filter(i => i.type === 'action')) {
            assert(typeof item.action === 'string' && item.action !== '', 'an action name');
            assert(typeof item.text === 'string' && item.text !== '', 'a label');
            assert(typeof item.sensitive === 'boolean', 'a sensitivity');
            assert(typeof item.key === 'string', 'a key');
        }
    });
});
