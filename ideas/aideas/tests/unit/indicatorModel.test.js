// The panel button. The rule under test comes from an answered open question in PLAN.md:
// visible only while a cycle is running, unless "always show" is on.

import { suite, test, assertEquals, assert } from '../harness.js';
import {
    buildIndicator, ICONS, DEFAULT_STALE_AFTER_SECONDS,
} from '../../src/lib/indicatorModel.js';
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

function indicator(args) {
    return buildIndicator({ now: NOW, ...args });
}

const running = reading({ running: true, agents: ['alpha'], cycle_started_at: NOW - 600 });
const idle = reading();
const blockedIdle = reading({}, [
    idea({ position: 1, slug: 'asker', state: 'blocked', note: '2 unanswered questions', open_questions: 2 }),
    idea({ position: 2, slug: 'fresh', state: 'ready' }),
]);

suite('visibility', () => {
    test('a running cycle puts the button in the top bar', () => {
        assertEquals(indicator({ reading: running }).visible, true);
    });

    test('an idle box takes it away — the answered question says running only', () => {
        assertEquals(indicator({ reading: idle }).visible, false);
    });

    test('blocked ideas alone do not summon it', () => {
        assertEquals(indicator({ reading: blockedIdle }).visible, false,
            'the entry asks for a button when a cycle is running, and that was the answer');
    });

    test('always show keeps it there in every state', () => {
        for (const value of [running, idle, blockedIdle, unconfiguredReading(),
            unreachableReading('refused'), parseState({ available: false, reason: 'no path' })])
            assertEquals(indicator({ reading: value, alwaysShow: true }).visible, true);
    });

    test('an unconfigured or unavailable box shows nothing without always show', () => {
        assertEquals(indicator({ reading: unconfiguredReading() }).visible, false);
        assertEquals(indicator({ reading: parseState({ available: false }) }).visible, false);
    });
});

suite('visibility when contact is lost', () => {
    test('a running cycle a moment ago keeps the button up — one dropped poll is not news', () => {
        const built = indicator({
            reading: unreachableReading('connection refused'),
            lastGood: { reading: running, fetchedAt: NOW - 40 },
        });

        assertEquals(built.visible, true);
        assertEquals(built.state, 'unreachable');
        assertEquals(built.icon, ICONS.unreachable);
    });

    test('an old reading is not evidence, and the button goes', () => {
        const built = indicator({
            reading: unreachableReading('connection refused'),
            lastGood: { reading: running, fetchedAt: NOW - DEFAULT_STALE_AFTER_SECONDS - 1 },
        });

        assertEquals(built.visible, false);
    });

    test('the window is exactly the boundary it says it is', () => {
        const at = indicator({
            reading: unreachableReading('refused'),
            lastGood: { reading: running, fetchedAt: NOW - DEFAULT_STALE_AFTER_SECONDS },
        });

        assertEquals(at.visible, true);
    });

    test('the window is configurable', () => {
        const built = indicator({
            reading: unreachableReading('refused'),
            lastGood: { reading: running, fetchedAt: NOW - 60 },
            staleAfterSeconds: 30,
        });

        assertEquals(built.visible, false);
    });

    test('an idle box a moment ago does not keep the button up', () => {
        const built = indicator({
            reading: unreachableReading('refused'),
            lastGood: { reading: blockedIdle, fetchedAt: NOW - 10 },
        });

        assertEquals(built.visible, false, 'nothing was running, so there is nothing to keep');
    });

    test('a box that answers available:false does not borrow from the past', () => {
        const built = indicator({
            reading: parseState({ available: false, reason: 'IDEAS_REPO_PATH is not set' }),
            lastGood: { reading: running, fetchedAt: NOW - 10 },
        });

        assertEquals(built.visible, false,
            'it is answering — and what it says is that it cannot read its queue');
        assertEquals(built.state, 'unavailable');
    });

    test('an unusable last-good timestamp is ignored rather than trusted', () => {
        for (const fetchedAt of [null, undefined, NaN, Infinity, '10']) {
            const built = indicator({
                reading: unreachableReading('refused'),
                lastGood: { reading: running, fetchedAt },
            });
            assertEquals(built.visible, false, `for ${String(fetchedAt)}`);
        }
    });
});

suite('the icon', () => {
    test('one per state, all stock symbolic names', () => {
        assertEquals(indicator({ reading: running }).icon, ICONS.running);
        assertEquals(indicator({ reading: idle }).icon, ICONS.idle);
        assertEquals(indicator({ reading: blockedIdle }).icon, ICONS.blocked);
        assertEquals(indicator({ reading: unreachableReading('x') }).icon, ICONS.unreachable);
        assertEquals(indicator({ reading: parseState({ available: false }) }).icon, ICONS.unavailable);
        assertEquals(indicator({ reading: unconfiguredReading() }).icon, ICONS.unconfigured);

        for (const name of Object.values(ICONS))
            assert(name.endsWith('-symbolic'), `${name} should be a symbolic icon`);
    });

    test('a running cycle outranks blocked ideas — the cycle is the headline', () => {
        const both = reading({ running: true, agents: ['alpha'], cycle_started_at: NOW - 60 }, [
            idea({ position: 1, slug: 'alpha', state: 'running' }),
            idea({ position: 2, slug: 'asker', state: 'blocked', open_questions: 1 }),
        ]);

        assertEquals(indicator({ reading: both }).state, 'running');
        assertEquals(indicator({ reading: both }).icon, ICONS.running);
    });
});

suite('the badge', () => {
    test('counts the agents while a cycle runs', () => {
        const two = reading({ running: true, agents: ['alpha', 'beta'], cycle_started_at: NOW - 60 });

        assertEquals(indicator({ reading: two }).badge, '2');
        assertEquals(indicator({ reading: running }).badge, '1');
    });

    test('counts blocked ideas when idle', () => {
        assertEquals(indicator({ reading: blockedIdle, alwaysShow: true }).badge, '1');
    });

    test('is absent rather than zero', () => {
        // Idle with nothing blocked, and a running lock that listed no agents.
        assertEquals(indicator({ reading: idle, alwaysShow: true }).badge, null);
        assertEquals(indicator({
            reading: reading({ running: true, agents: [], cycle_started_at: NOW - 60 }),
        }).badge, null);
    });

    test('a lost connection keeps the count it last knew', () => {
        const built = indicator({
            reading: unreachableReading('refused'),
            lastGood: {
                reading: reading({ running: true, agents: ['a', 'b'], cycle_started_at: NOW - 60 }),
                fetchedAt: NOW - 30,
            },
        });

        assertEquals(built.badge, '2', 'the icon already says the reading is not fresh');
    });

    test('an unconfigured or unavailable box carries no count', () => {
        assertEquals(indicator({ reading: unconfiguredReading(), alwaysShow: true }).badge, null);
        assertEquals(indicator({
            reading: parseState({ available: false }), alwaysShow: true,
        }).badge, null);
    });
});

suite('the accessible name', () => {
    test('says the whole meaning of the panel in one line', () => {
        assertEquals(indicator({ reading: running }).accessibleName,
            'aideas: cycle running, 1 agent');
        assertEquals(indicator({
            reading: reading({ running: true, agents: ['a', 'b'], cycle_started_at: NOW }),
        }).accessibleName, 'aideas: cycle running, 2 agents');
        assertEquals(indicator({
            reading: reading({ running: true, agents: [], cycle_started_at: NOW }),
        }).accessibleName, 'aideas: cycle running');
        assertEquals(indicator({ reading: idle }).accessibleName, 'aideas: idle');
        assertEquals(indicator({ reading: blockedIdle }).accessibleName,
            'aideas: idle, 1 blocked idea');
        assertEquals(indicator({ reading: unconfiguredReading() }).accessibleName,
            'aideas: no orchestrator address set');
        assertEquals(indicator({ reading: parseState({ available: false }) }).accessibleName,
            'aideas: the orchestrator cannot read its queue');
    });

    test('distinguishes silence from silence-with-a-memory', () => {
        assertEquals(indicator({ reading: unreachableReading('refused') }).accessibleName,
            'aideas: orchestrator unreachable');
        assertEquals(indicator({
            reading: unreachableReading('refused'),
            lastGood: { reading: running, fetchedAt: NOW - 10 },
        }).accessibleName, 'aideas: orchestrator unreachable, showing the last reading');
    });
});
