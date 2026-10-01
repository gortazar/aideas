// The stop item, and the resume item it turns into.
//
// This is the entry's one genuinely new *state*: the stop file is a pause switch nothing in the
// orchestrator ever clears, so a panel that could create one and then say nothing would pause
// the fleet for ever and look like a broken orchestrator. Every assertion here is therefore
// about what somebody can see without clicking anything.

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { buildMenu } from '../../src/lib/menuModel.js';
import { menuItems } from '../../src/lib/menuItems.js';
import { parseState, unreachableReading, unconfiguredReading } from '../../src/lib/state.js';

const NOW = 1755180000;

function reading(overrides = {}, ideas = []) {
    return parseState({
        available: true, running: false, agents: [], cycle_started_at: null,
        lock_age_seconds: null, paused: false, ideas, ...overrides,
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
const running = reading({ running: true, agents: ['alpha'], cycle_started_at: NOW - 720 });
const pausedIdle = reading({ paused: true });
const stopping = reading({
    running: true, agents: ['alpha'], cycle_started_at: NOW - 720, paused: true,
});

suite('the stop item › what it is called', () => {
    test('a running cycle is a thing to stop', () => {
        const { stop } = actions({ reading: running });

        assertEquals(stop.label, 'Stop the cycle');
        assertEquals(stop.sensitive, true);
    });

    test('with nothing running, the same file pauses the queue instead', () => {
        // The file does the same thing either way; what it stops is the *next* cycle, and the
        // label should say which of the two just happened.
        const { stop } = actions({ reading: idle });

        assertEquals(stop.label, 'Pause the queue');
        assertEquals(stop.sensitive, true);
    });

    test('a paused queue offers the way out instead', () => {
        const { stop } = actions({ reading: pausedIdle });

        assertEquals(stop.label, 'Resume the queue');
        assertEquals(stop.sensitive, true);
    });

    test('a paused queue with a cycle still winding down still offers resume', () => {
        // Paused is paused: the file exists, and removing it is the only way out whatever the
        // cycle is doing. Offering "Stop the cycle" again here would be offering a no-op.
        const { stop } = actions({ reading: stopping });

        assertEquals(stop.label, 'Resume the queue');
    });

    test('a box whose state is unknown offers the honest general action', () => {
        for (const unknown of [unreachableReading('connection refused'), unconfiguredReading()]) {
            const { stop } = actions({ reading: unknown });
            assertEquals(stop.label, 'Pause the queue',
                'with nothing known, "stop the cycle" would claim there is one');
        }
    });
});

suite('the stop item › while a request is out', () => {
    test('stopping a running cycle says stopping', () => {
        const { stop } = actions({
            reading: running, actions: { stopInFlight: 'stop' },
        });

        assertEquals(stop.label, 'Stopping…');
        assertEquals(stop.sensitive, false);
        assertEquals(stop.detail, null, 'the label already says it');
    });

    test('pausing an idle queue says pausing', () => {
        const { stop } = actions({ reading: idle, actions: { stopInFlight: 'stop' } });

        assertEquals(stop.label, 'Pausing…');
        assertEquals(stop.sensitive, false);
    });

    test('resuming says resuming', () => {
        const { stop } = actions({ reading: pausedIdle, actions: { stopInFlight: 'resume' } });

        assertEquals(stop.label, 'Resuming…');
        assertEquals(stop.sensitive, false);
    });
});

suite('the stop item › what it says afterwards', () => {
    test('the box\'s own sentence is what stays on screen', () => {
        const { stop } = actions({
            reading: stopping,
            actions: {
                stopOutcome: {
                    paused: true, changed: true, gate: null,
                    reason: 'the queue is paused; a running cycle winds down at its next check',
                },
            },
        });

        assertEquals(stop.detail,
            'the queue is paused; a running cycle winds down at its next check');
    });

    test('"already paused" is an outcome worth showing, not a failure', () => {
        const { stop } = actions({
            reading: pausedIdle,
            actions: {
                stopOutcome: {
                    paused: true, changed: false, gate: null,
                    reason: 'the queue was already paused',
                },
            },
        });

        assertEquals(stop.detail, 'the queue was already paused');
        assertEquals(stop.sensitive, true, 'and it can still be resumed');
    });

    test('a box that does not support stopping says so under the item', () => {
        const { stop } = actions({
            reading: running,
            actions: {
                stopOutcome: {
                    paused: null, changed: false, gate: 'unsupported',
                    reason: 'this box does not support stopping cycles',
                },
            },
        });

        assertEquals(stop.detail, 'this box does not support stopping cycles');
    });

    test('a cycle still running after a stop is said out loud, not left blank', () => {
        // Nothing has gone wrong: an agent is checked between phases, so a wind-down takes as
        // long as the agents take. Silence here would read as a button that did nothing.
        const { stop } = actions({ reading: stopping });

        assertEquals(stop.detail, 'a cycle is still winding down');
    });

    test('an outcome outranks the standing wind-down line', () => {
        const { stop } = actions({
            reading: stopping,
            actions: {
                stopOutcome: {
                    paused: false, changed: true, gate: null,
                    reason: 'the queue is no longer paused',
                },
            },
        });

        assertEquals(stop.detail, 'the queue is no longer paused');
    });

    test('an in-flight request outranks both', () => {
        const { stop } = actions({
            reading: stopping,
            actions: {
                stopInFlight: 'resume',
                stopOutcome: { paused: true, changed: true, gate: null, reason: 'paused' },
            },
        });

        assertEquals(stop.detail, null);
    });
});

suite('the stop item › when clicking could not work', () => {
    test('nothing configured, nothing to post to', () => {
        const { stop } = actions({ reading: unconfiguredReading() });

        assertEquals(stop.sensitive, false);
        assertEquals(stop.detail, 'no orchestrator address is set');
    });

    test('a box that cannot be reached cannot be told to stop', () => {
        const { stop } = actions({ reading: unreachableReading('connection refused') });

        assertEquals(stop.sensitive, false);
        assertEquals(stop.detail, 'the box cannot be reached');
    });

    test('a box that cannot read its queue can still be paused', () => {
        // Unlike the queue, the stop file does not depend on the README parsing: the box is
        // talking to us, and pausing it is exactly what you might want when it is unhappy.
        const { stop } = actions({
            reading: parseState({ available: false, reason: 'could not read the queue: boom' }),
        });

        assertEquals(stop.sensitive, true);
    });
});

suite('a paused queue and the cycle button', () => {
    test('Run a cycle goes insensitive, saying why, before it is clicked', () => {
        const { cycle } = actions({ reading: pausedIdle });

        assertEquals(cycle.sensitive, false);
        assertEquals(cycle.detail, 'the queue is paused');
    });

    test('and is live again the moment the queue is not paused', () => {
        assertEquals(actions({ reading: idle }).cycle.sensitive, true);
    });

    test('a refusal at the stop-file gate is never overridable', () => {
        // The way to run a cycle while paused is to resume, visibly. This is the answered
        // question from 0.4 holding under a state that can now be reached from the panel.
        const map = actions({
            reading: pausedIdle,
            actions: {
                cycleOutcome: {
                    started: false, gate: 'stop-file',
                    reason: 'Paused: .orchestrator/stop exists',
                },
            },
        });

        assertEquals(map.override, undefined);
        assertEquals(map.cycle.detail, 'the queue is paused',
            'the standing reason outranks the refusal that repeats it');
    });
});

suite('the header says paused without being clicked', () => {
    test('an idle paused box', () => {
        const menu = built({ reading: pausedIdle });

        assertEquals(menu.header.text, 'Idle — paused');
        assert(menu.header.detail.includes('.orchestrator/stop exists'),
            `the way out is named: ${menu.header.detail}`);
    });

    test('a cycle winding down', () => {
        const menu = built({ reading: stopping });

        assertEquals(menu.header.text, 'Cycle running for 12 min, 1 agent — stopping');
    });

    test('an unpaused box says exactly what it said before', () => {
        assertEquals(built({ reading: idle }).header.text, 'Idle');
        assertEquals(built({ reading: running }).header.text,
            'Cycle running for 12 min, 1 agent');
        assert(!built({ reading: idle }).header.detail.includes('stop'));
    });

    test('a stale last-good reading keeps saying what it knew, paused and all', () => {
        const menu = built({
            reading: unreachableReading('connection refused'),
            lastGood: { reading: pausedIdle, fetchedAt: NOW - 120 },
        });

        assertEquals(menu.header.text, 'Idle — paused');
        assertEquals(menu.stale, true);
    });
});

suite('where the stop item sits', () => {
    test('after Run a cycle, in the same block', () => {
        const list = menuItems(built({ reading: running }));

        assertDeepEquals(list.filter(i => i.type === 'action').map(i => i.action),
            ['refresh', 'cycle', 'stop']);
    });

    test('after Run anyway, when there is one', () => {
        const list = menuItems(built({
            reading: idle,
            actions: { cycleOutcome: { started: false, gate: 'heartbeat', reason: 'busy' } },
        }));

        assertDeepEquals(list.filter(i => i.type === 'action').map(i => i.action),
            ['refresh', 'cycle', 'override', 'stop']);
    });

    test('it is one item whichever way it reads — never a stop and a resume at once', () => {
        for (const r of [idle, running, pausedIdle, stopping]) {
            const stops = built({ reading: r }).actions.filter(a => a.action === 'stop');
            assertEquals(stops.length, 1, 'exactly one');
        }
    });
});
