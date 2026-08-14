import { suite, test, assertEquals } from '../harness.js';
import { describeTestResult } from '../../src/lib/testConnection.js';
import { parseState, unreachableReading, unconfiguredReading } from '../../src/lib/state.js';

function reading(overrides = {}, ideas = []) {
    return parseState({
        available: true, running: false, agents: [], cycle_started_at: null,
        lock_age_seconds: null, ideas, ...overrides,
    });
}

function idea(overrides = {}) {
    return { position: 1, slug: 'alpha', version: '0.1', state: 'ready', note: '', ...overrides };
}

suite('describeTestResult › success', () => {
    test('a running cycle proves it is the right box, not just a box', () => {
        const result = describeTestResult(reading(
            { running: true, agents: ['alpha', 'beta'] },
            [idea({ position: 1, state: 'running' }), idea({ position: 2, state: 'ready' })],
        ), '10.8.0.1:8787');

        assertEquals(result.severity, 'ok');
        assertEquals(result.text, 'Connected to 10.8.0.1:8787');
        assertEquals(result.detail, 'cycle running, 2 agents · 2 ideas queued');
    });

    test('an idle box says idle', () => {
        const result = describeTestResult(reading({}, [idea()]), 'box:8787');

        assertEquals(result.severity, 'ok');
        assertEquals(result.detail, 'idle · 1 idea queued');
    });

    test('blocked ideas are worth mentioning here too', () => {
        const result = describeTestResult(reading({}, [
            idea({ position: 1, state: 'blocked', open_questions: 2 }),
            idea({ position: 2, state: 'blocked', open_questions: 1 }),
            idea({ position: 3, state: 'ready' }),
        ]), 'box:8787');

        assertEquals(result.detail, 'idle · 3 ideas queued · 2 ideas blocked');
    });

    test('an empty queue is stated, not left as a zero', () => {
        assertEquals(describeTestResult(reading(), 'box:8787').detail,
            'idle · nothing in the queue');
    });

    test('a running lock with no agents listed still reads correctly', () => {
        assertEquals(describeTestResult(reading({ running: true }), 'box:8787').detail,
            'cycle running · nothing in the queue');
    });
});

suite('describeTestResult › the three failures worth telling apart', () => {
    test('nothing answered — the wrong address', () => {
        const result = describeTestResult(unreachableReading('connection refused'), '10.8.0.1:8787');

        assertEquals(result.severity, 'error');
        assertEquals(result.text, 'Could not reach 10.8.0.1:8787');
        assertEquals(result.detail, 'connection refused');
    });

    test('something answered, but not /state — the wrong port', () => {
        const result = describeTestResult(
            parseState({ last_ts: 0, stale_seconds: 3 }), '10.8.0.1:22');

        assertEquals(result.severity, 'error');
        assertEquals(result.detail, 'that address answered, but not with /state');
    });

    test('the box answered and cannot read its queue — a warning, not an error', () => {
        const result = describeTestResult(
            parseState({ available: false, reason: 'IDEAS_REPO_PATH is not set' }), 'box:8787');

        assertEquals(result.severity, 'warning',
            'the address is right, and this is the box itself talking');
        assertEquals(result.text, 'box:8787 answered, but cannot read its queue');
        assertEquals(result.detail, 'IDEAS_REPO_PATH is not set');
    });
});

suite('describeTestResult › edges', () => {
    test('nothing configured says what to do instead of testing nothing', () => {
        const result = describeTestResult(unconfiguredReading(), null);

        assertEquals(result.severity, 'error');
        assertEquals(result.text, 'No address to test');
        assertEquals(result.detail,
            'Enter the host name or IP of the orchestrator box first');
    });

    test('a missing host is described without a hole in the sentence', () => {
        assertEquals(describeTestResult(unreachableReading('timed out'), null).text,
            'Could not reach the orchestrator');
    });

    test('a missing or unknown reading is an error, not a crash', () => {
        for (const value of [null, undefined, {}, { status: 'something-new' }]) {
            const result = describeTestResult(value, 'box:8787');
            assertEquals(result.severity, 'error', `for ${JSON.stringify(value)}`);
            assertEquals(result.detail, 'no reason given');
        }
    });
});
