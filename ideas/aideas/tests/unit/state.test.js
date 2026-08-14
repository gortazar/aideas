// Parsing a /state body. The fixtures here are the bodies docs/state-contract.md specifies,
// plus every malformed shape worth surviving — this is the module that stands between an
// unexpected reply and a broken GNOME session, so "it must not throw" is itself the test.

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import {
    Status, KNOWN_STATES, parseState, unreachableReading, unconfiguredReading,
} from '../../src/lib/state.js';

/** The available body of docs/state-contract.md, with overrides applied. */
function body(overrides = {}) {
    return {
        available: true,
        running: false,
        agents: [],
        cycle_started_at: null,
        lock_age_seconds: null,
        ideas: [],
        ...overrides,
    };
}

function row(overrides = {}) {
    return {
        position: 1,
        slug: 'alpha',
        version: '0.1',
        state: 'ready',
        note: 'not started',
        will_run_next: true,
        target_version: '0.1',
        ...overrides,
    };
}

suite('parseState › the available body', () => {
    test('an idle box is ok, not running, with no rows', () => {
        const reading = parseState(body());

        assertEquals(reading.status, Status.OK);
        assertEquals(reading.running, false);
        assertDeepEquals(reading.agents, []);
        assertEquals(reading.cycleStartedAt, null);
        assertEquals(reading.lockAgeSeconds, null);
        assertDeepEquals(reading.rows, []);
        assertEquals(reading.droppedRows, 0);
    });

    test('a running cycle keeps its agents, start time and lock age', () => {
        const reading = parseState(body({
            running: true,
            agents: ['alpha', 'beta'],
            cycle_started_at: 1755180000,
            lock_age_seconds: 42,
        }));

        assertEquals(reading.running, true);
        assertDeepEquals(reading.agents, ['alpha', 'beta']);
        assertEquals(reading.cycleStartedAt, 1755180000);
        assertEquals(reading.lockAgeSeconds, 42);
    });

    test('running is the orchestrator\'s verdict, never re-derived from lock age', () => {
        // A stale lock: the age is far past any TTL, but the server already said false.
        const stale = parseState(body({ running: false, lock_age_seconds: 99999 }));
        assertEquals(stale.running, false);
        assertEquals(stale.lockAgeSeconds, 99999,
            'the age is still shown — it is the symptom of a box that stopped renewing');

        // And the reverse: a fresh-looking age does not make a stopped cycle run.
        const fresh = parseState(body({ running: false, lock_age_seconds: 1 }));
        assertEquals(fresh.running, false);
    });

    test('anything but a literal true is not running', () => {
        for (const value of [1, 'true', 'yes', {}, [], null, undefined])
            assertEquals(parseState(body({ running: value })).running, false, `for ${JSON.stringify(value)}`);
    });

    test('a negative lock age is clock skew, clamped and rounded', () => {
        assertEquals(parseState(body({ lock_age_seconds: -5 })).lockAgeSeconds, 0);
        assertEquals(parseState(body({ lock_age_seconds: 8.6 })).lockAgeSeconds, 9);
    });

    test('an unusable lock age or start time becomes null rather than a wrong number', () => {
        for (const value of ['42', NaN, Infinity, {}, true, null]) {
            const reading = parseState(body({ lock_age_seconds: value, cycle_started_at: value }));
            assertEquals(reading.lockAgeSeconds, null, `age for ${JSON.stringify(value)}`);
            assertEquals(reading.cycleStartedAt, null, `start for ${JSON.stringify(value)}`);
        }
    });

    test('junk in the agent list is dropped, not rendered', () => {
        const reading = parseState(body({ agents: ['alpha', '', '   ', null, 7, {}, ' beta '] }));

        assertDeepEquals(reading.agents, ['alpha', 'beta']);
    });

    test('a non-array agent list or idea list is empty, not a throw', () => {
        const reading = parseState(body({ agents: 'alpha', ideas: 'nope' }));

        assertDeepEquals(reading.agents, []);
        assertDeepEquals(reading.rows, []);
    });
});

suite('parseState › rows', () => {
    test('a full row keeps every field, renamed to camelCase', () => {
        const [parsed] = parseState(body({ ideas: [row({
            position: 3, slug: 'aideas', version: '0.2', state: 'ready',
            note: 'minor update -> v0.3', will_run_next: true, target_version: '0.3',
        })] })).rows;

        assertEquals(parsed.position, 3);
        assertEquals(parsed.slug, 'aideas');
        assertEquals(parsed.version, '0.2');
        assertEquals(parsed.state, 'ready');
        assertEquals(parsed.known, true);
        assertEquals(parsed.note, 'minor update -> v0.3');
        assertEquals(parsed.willRunNext, true);
        assertEquals(parsed.targetVersion, '0.3');
        assertEquals(parsed.openQuestions, null, 'absent on the wire means null here');
    });

    test('a blocked row keeps its question count', () => {
        const [parsed] = parseState(body({ ideas: [row({
            state: 'blocked', note: '2 unanswered questions', open_questions: 2,
            will_run_next: false, target_version: undefined,
        })] })).rows;

        assertEquals(parsed.state, 'blocked');
        assertEquals(parsed.openQuestions, 2);
        assertEquals(parsed.willRunNext, false);
        assertEquals(parsed.targetVersion, null);
    });

    test('every word of the documented vocabulary is known', () => {
        for (const state of KNOWN_STATES) {
            const [parsed] = parseState(body({ ideas: [row({ state })] })).rows;
            assertEquals(parsed.state, state);
            assertEquals(parsed.known, true, `${state} should be known`);
        }
    });

    test('an unknown state keeps its own name and is marked unknown', () => {
        const [parsed] = parseState(body({ ideas: [row({ state: 'hibernating' })] })).rows;

        assertEquals(parsed.state, 'hibernating',
            'a new orchestrator word must show up as itself, not be guessed at');
        assertEquals(parsed.known, false);
    });

    test('a missing position falls back to the queue index', () => {
        const { rows } = parseState(body({ ideas: [
            row({ position: undefined }),
            row({ position: 'two' }),
            row({ position: 0 }),
            row({ position: 2.5 }),
        ] }));

        assertDeepEquals(rows.map(r => r.position), [1, 2, 3, 4]);
    });

    test('a real position is kept, duplicates and all', () => {
        const { rows } = parseState(body({ ideas: [
            row({ position: 7 }), row({ position: 7 }),
        ] }));

        assertDeepEquals(rows.map(r => r.position), [7, 7]);
    });

    test('duplicate slugs are both kept — slug is not a key', () => {
        const { rows } = parseState(body({ ideas: [
            row({ position: 1, slug: 'alpha', state: 'ready' }),
            row({ position: 2, slug: 'alpha', state: 'queued', note: 'behind #1' }),
        ] }));

        assertEquals(rows.length, 2);
        assertDeepEquals(rows.map(r => r.slug), ['alpha', 'alpha']);
    });

    test('a slugless row is still a row', () => {
        const { rows } = parseState(body({ ideas: [row({ slug: null }), row({ slug: '  ' })] }));

        assertEquals(rows.length, 2, 'hiding it would make the menu shorter than the queue');
        assertDeepEquals(rows.map(r => r.slug), ['(unnamed)', '(unnamed)']);
    });

    test('a malformed version is null, so no wrong version is shown', () => {
        for (const version of ['', 'v0.1', '0', 'abc', 1.2, null, {}]) {
            const [parsed] = parseState(body({ ideas: [row({ version })] })).rows;
            assertEquals(parsed.version, null, `for ${JSON.stringify(version)}`);
        }
    });

    test('a malformed question count is null rather than zero', () => {
        for (const count of [0, -1, 1.5, '2', null, true]) {
            const [parsed] = parseState(body({ ideas: [row({ open_questions: count })] })).rows;
            assertEquals(parsed.openQuestions, null, `for ${JSON.stringify(count)}`);
        }
    });

    test('only a literal true means this row runs next', () => {
        for (const value of [1, 'true', {}, null, undefined]) {
            const [parsed] = parseState(body({ ideas: [row({ will_run_next: value })] })).rows;
            assertEquals(parsed.willRunNext, false, `for ${JSON.stringify(value)}`);
        }
    });

    test('rows that are not objects become placeholder rows', () => {
        const { rows } = parseState(body({ ideas: [null, 'alpha', 42, []] }));

        assertEquals(rows.length, 4);
        for (const parsed of rows) {
            assertEquals(parsed.slug, '(unnamed)');
            assertEquals(parsed.state, 'unknown');
            assertEquals(parsed.known, false);
            assertEquals(parsed.note, '');
        }
        assertDeepEquals(rows.map(r => r.position), [1, 2, 3, 4]);
    });

    test('an absurd queue is capped, and says how much it dropped', () => {
        const ideas = Array.from({ length: 250 }, (_, index) =>
            row({ position: index + 1, slug: `idea-${index}` }));

        const reading = parseState(body({ ideas }));

        assertEquals(reading.rows.length, 200, 'building 10 000 menu items would hang the Shell');
        assertEquals(reading.droppedRows, 50);
        assertEquals(reading.rows[199].slug, 'idea-199', 'the head of the queue is what is kept');
    });
});

suite('parseState › the unavailable body', () => {
    test('available: false is unavailable, with the server\'s own reason', () => {
        const reading = parseState({ available: false, reason: 'IDEAS_REPO_PATH is not set' });

        assertEquals(reading.status, Status.UNAVAILABLE);
        assertEquals(reading.reason, 'IDEAS_REPO_PATH is not set');
        assertEquals(reading.rows, undefined, 'an unavailable body promises nothing else');
    });

    test('a reason-less refusal still says something', () => {
        for (const reason of [undefined, null, '', '   ', 42]) {
            const reading = parseState({ available: false, reason });
            assertEquals(reading.status, Status.UNAVAILABLE);
            assertEquals(reading.reason, 'the orchestrator did not say why');
        }
    });

    test('unavailable is distinct from unreachable — they mean opposite things', () => {
        assert(parseState({ available: false }).status !== parseState('').status,
            'a configured box refusing is not silence');
    });
});

suite('parseState › bodies that are not /state at all', () => {
    test('a JSON value that is not an object is unreachable', () => {
        for (const value of [null, undefined, 42, 'ok', true, [], [{ available: true }]]) {
            const reading = parseState(value);
            assertEquals(reading.status, Status.UNREACHABLE, `for ${JSON.stringify(value)}`);
            assertEquals(reading.reason, 'the reply was not a JSON object');
        }
    });

    test('an object without `available` is some other server', () => {
        // The likely cause: a port pointing at something else, or /status by mistake.
        const reading = parseState({ last_ts: 0, last_event: null, stale_seconds: 12 });

        assertEquals(reading.status, Status.UNREACHABLE);
        assertEquals(reading.reason, 'that address answered, but not with /state');
    });

    test('a non-boolean `available` is not trusted either', () => {
        for (const value of ['true', 1, {}, null])
            assertEquals(parseState({ available: value }).status, Status.UNREACHABLE);
    });
});

suite('the readings the client builds', () => {
    test('unreachable carries the reason it will be shown with', () => {
        assertEquals(unreachableReading('connection refused').status, Status.UNREACHABLE);
        assertEquals(unreachableReading('connection refused').reason, 'connection refused');
    });

    test('an unreachable reading always has some reason', () => {
        for (const reason of [undefined, null, '', 42])
            assertEquals(unreachableReading(reason).reason, 'no reason given');
    });

    test('unconfigured is its own status, distinct from unreachable', () => {
        assertEquals(unconfiguredReading().status, Status.UNCONFIGURED);
    });
});

suite('parseState › never throws', () => {
    test('not for any of these', () => {
        // Its input is always JSON.parse output, so there are no getters to trap and no
        // prototypes to trip over — a body that is not JSON at all never reaches here,
        // because JSON.parse throws in the client and the client reports it as unreachable.
        const nasty = [
            undefined, null, 0, '', 'null', [], {},
            { available: true, ideas: [undefined] },
            { available: true, agents: [Symbol.iterator] },
            { available: true, running: 'yes', ideas: {} },
            { available: true, ideas: [{ position: {}, slug: [], state: 0, note: false }] },
        ];

        for (const value of nasty) {
            try {
                const reading = parseState(value);
                assert(typeof reading.status === 'string', 'every reading has a status');
            } catch (error) {
                assert(false, `parseState threw on ${String(value)}: ${error.message}`);
            }
        }
    });
});
