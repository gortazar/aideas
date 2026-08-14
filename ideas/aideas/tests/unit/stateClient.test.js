// The client, with the HTTP seam replaced by a function. Everything here is about what the
// client remembers and what it does when the box misbehaves — no sockets involved.

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { StateClient, MAX_BODY_BYTES } from '../../src/lib/stateClient.js';
import { Status } from '../../src/lib/state.js';

const BOX = { host: '10.8.0.1', port: 8787 };

const OK_BODY = JSON.stringify({
    available: true,
    running: true,
    agents: ['alpha'],
    cycle_started_at: 1755180000,
    lock_age_seconds: 12,
    ideas: [{
        position: 1, slug: 'alpha', version: '0.1', state: 'running',
        note: 'an agent is working on it now', will_run_next: false,
    }],
});

/** A transport whose replies and failures a test dictates, and which records its calls. */
function fakeTransport(...replies) {
    const queue = [...replies];
    const calls = [];
    return {
        calls,
        send(url, timeoutSeconds) {
            calls.push({ url, timeoutSeconds });
            const next = queue.length > 1 ? queue.shift() : queue[0];
            if (typeof next === 'function')
                return next();
            if (next instanceof Error)
                return Promise.reject(next);
            return Promise.resolve(next);
        },
    };
}

function failure(reason) {
    const error = new Error(`transport: ${reason}`);
    error.reason = reason;
    return error;
}

/** A clock a test advances by hand. */
function fakeClock(start = 1000) {
    let now = start;
    return { now: () => now, advance: seconds => { now += seconds; } };
}

function client(transport, clock = fakeClock()) {
    return new StateClient({ transport, clock: clock.now, timeoutSeconds: 7 });
}

suite('a successful read', () => {
    test('parses the body and timestamps the reading', async () => {
        const clock = fakeClock(5000);
        const subject = client(fakeTransport({ status: 200, body: OK_BODY }), clock);

        const snapshot = await subject.read(BOX);

        assertEquals(snapshot.reading.status, Status.OK);
        assertEquals(snapshot.reading.running, true);
        assertEquals(snapshot.reading.rows.length, 1);
        assertEquals(snapshot.fetchedAt, 5000);
        assertEquals(snapshot.failures, 0);
    });

    test('asks the right URL, with the configured timeout', async () => {
        const transport = fakeTransport({ status: 200, body: OK_BODY });

        await client(transport).read(BOX);

        assertDeepEquals(transport.calls, [{ url: 'http://10.8.0.1:8787/state', timeoutSeconds: 7 }]);
    });

    test('names the address in the snapshot, for the failure message to use later', async () => {
        const snapshot = await client(fakeTransport({ status: 200, body: OK_BODY })).read(BOX);

        assertEquals(snapshot.host, '10.8.0.1:8787');
    });

    test('becomes the last good reading', async () => {
        const clock = fakeClock(5000);
        const subject = client(fakeTransport({ status: 200, body: OK_BODY }), clock);

        const snapshot = await subject.read(BOX);

        assertEquals(snapshot.lastGood.fetchedAt, 5000);
        assertEquals(snapshot.lastGood.reading, snapshot.reading);
    });
});

suite('an unconfigured client', () => {
    test('attempts nothing at all', async () => {
        const transport = fakeTransport({ status: 200, body: OK_BODY });

        const snapshot = await client(transport).read({ host: '', port: 8787 });

        assertEquals(snapshot.reading.status, Status.UNCONFIGURED);
        assertDeepEquals(transport.calls, [], 'never hammer localhost when nothing is set');
        assertEquals(snapshot.fetchedAt, null);
    });

    test('is not a failure to back off from — there is nothing to retry', async () => {
        const subject = client(fakeTransport(failure('connection refused')));

        await subject.read(BOX);
        assertEquals(subject.failures, 1);

        await subject.read({ host: null, port: 8787 });
        assertEquals(subject.failures, 0, 'nothing was attempted, so nothing failed');
    });
});

suite('failures', () => {
    test('a transport error becomes an unreachable reading carrying its reason', async () => {
        const snapshot = await client(fakeTransport(failure('connection refused'))).read(BOX);

        assertEquals(snapshot.reading.status, Status.UNREACHABLE);
        assertEquals(snapshot.reading.reason, 'connection refused');
    });

    test('an error with no reason still produces a reading', async () => {
        const snapshot = await client(fakeTransport(new Error('boom'))).read(BOX);

        assertEquals(snapshot.reading.status, Status.UNREACHABLE);
        assertEquals(snapshot.reading.reason, 'the request failed');
    });

    test('read() never rejects — every caller is a timer or a menu handler', async () => {
        const exploding = { send: () => { throw new Error('synchronous explosion'); } };

        const snapshot = await client(exploding).read(BOX);

        assert(snapshot !== undefined, 'a snapshot came back rather than a rejection');
    });

    test('a non-200 says which code', async () => {
        for (const status of [404, 500, 502]) {
            const snapshot = await client(fakeTransport({ status, body: 'nope' })).read(BOX);
            assertEquals(snapshot.reading.reason, `the server answered HTTP ${status}`);
        }
    });

    test('a body that is not JSON is unreachable, not a crash', async () => {
        const snapshot = await client(fakeTransport({
            status: 200, body: '<html>proxy error</html>',
        })).read(BOX);

        assertEquals(snapshot.reading.status, Status.UNREACHABLE);
        assertEquals(snapshot.reading.reason, 'the reply was not JSON');
    });

    test('a body with no body at all is unreachable', async () => {
        const snapshot = await client(fakeTransport({ status: 200, body: null })).read(BOX);

        assertEquals(snapshot.reading.reason, 'the reply had no body');
    });

    test('an enormous body is refused before it is parsed', async () => {
        const body = `{"available":true,"ideas":[],"padding":"${'x'.repeat(MAX_BODY_BYTES)}"}`;

        const snapshot = await client(fakeTransport({ status: 200, body })).read(BOX);

        assertEquals(snapshot.reading.reason, 'the reply was too large to be a queue');
    });

    test('available:false is an unavailable reading, with the box\'s own words', async () => {
        const snapshot = await client(fakeTransport({
            status: 200, body: JSON.stringify({ available: false, reason: 'IDEAS_REPO_PATH is not set' }),
        })).read(BOX);

        assertEquals(snapshot.reading.status, Status.UNAVAILABLE);
        assertEquals(snapshot.reading.reason, 'IDEAS_REPO_PATH is not set');
    });

    test('failures accumulate, and one success clears them', async () => {
        const subject = client(fakeTransport(
            failure('connection refused'),
            failure('connection refused'),
            { status: 500, body: '' },
            { status: 200, body: OK_BODY },
            failure('timed out'),
        ));

        await subject.read(BOX);
        assertEquals(subject.failures, 1);
        await subject.read(BOX);
        assertEquals(subject.failures, 2);
        await subject.read(BOX);
        assertEquals(subject.failures, 3);
        await subject.read(BOX);
        assertEquals(subject.failures, 0, 'a success resets the backoff');
        await subject.read(BOX);
        assertEquals(subject.failures, 1);
    });

    test('an unavailable box counts as a failure — asking faster will not fix its environment',
        async () => {
            const subject = client(fakeTransport({
                status: 200, body: JSON.stringify({ available: false, reason: 'no path' }),
            }));

            await subject.read(BOX);

            assertEquals(subject.failures, 1);
        });
});

suite('the last good reading', () => {
    test('survives later failures, with the time it was taken', async () => {
        const clock = fakeClock(1000);
        const subject = client(fakeTransport(
            { status: 200, body: OK_BODY },
            failure('connection refused'),
        ), clock);

        await subject.read(BOX);
        clock.advance(300);
        const snapshot = await subject.read(BOX);

        assertEquals(snapshot.reading.status, Status.UNREACHABLE);
        assertEquals(snapshot.lastGood.fetchedAt, 1000, 'taken then, not now');
        assertEquals(snapshot.lastGood.reading.status, Status.OK);
        assertEquals(snapshot.fetchedAt, 1300);
    });

    test('is replaced by each new success', async () => {
        const clock = fakeClock(1000);
        const idle = JSON.stringify({ available: true, running: false, agents: [], ideas: [] });
        const subject = client(fakeTransport(
            { status: 200, body: OK_BODY },
            { status: 200, body: idle },
        ), clock);

        await subject.read(BOX);
        clock.advance(60);
        const snapshot = await subject.read(BOX);

        assertEquals(snapshot.lastGood.fetchedAt, 1060);
        assertEquals(snapshot.lastGood.reading.running, false);
    });

    test('is absent until there has been one', async () => {
        const subject = client(fakeTransport(failure('refused')));

        assertEquals(subject.snapshot().lastGood, null);
        assertEquals((await subject.read(BOX)).lastGood, null);
    });
});

suite('single-flight', () => {
    test('a second read while one is in the air joins it instead of stacking a request', async () => {
        let release;
        const slow = new Promise(resolve => { release = resolve; });
        const transport = fakeTransport(() => slow);
        const subject = client(transport);

        const first = subject.read(BOX);
        const second = subject.read(BOX);

        assertEquals(transport.calls.length, 1, 'one request, not two');
        assert(subject.busy, 'the client knows it is waiting');

        release({ status: 200, body: OK_BODY });
        const [a, b] = await Promise.all([first, second]);

        assertEquals(a.reading.status, Status.OK);
        assertEquals(b, a, 'both callers got the same answer');
        assertEquals(subject.busy, false);
    });

    test('the next read after one completes does go out', async () => {
        const transport = fakeTransport({ status: 200, body: OK_BODY });
        const subject = client(transport);

        await subject.read(BOX);
        await subject.read(BOX);

        assertEquals(transport.calls.length, 2);
    });

    test('a failed request does not wedge the client for good', async () => {
        const transport = fakeTransport(failure('refused'), { status: 200, body: OK_BODY });
        const subject = client(transport);

        await subject.read(BOX);
        assertEquals(subject.busy, false, 'the in-flight slot was released');

        const snapshot = await subject.read(BOX);
        assertEquals(snapshot.reading.status, Status.OK);
    });
});

suite('snapshot()', () => {
    test('says unconfigured before anything has been read', () => {
        const snapshot = client(fakeTransport({ status: 200, body: OK_BODY })).snapshot();

        assertEquals(snapshot.reading.status, Status.UNCONFIGURED);
        assertEquals(snapshot.fetchedAt, null);
        assertEquals(snapshot.lastGood, null);
        assertEquals(snapshot.failures, 0);
    });

    test('is the same shape the indicator renders from', async () => {
        const subject = client(fakeTransport({ status: 200, body: OK_BODY }));
        await subject.read(BOX);

        const snapshot = subject.snapshot();

        for (const key of ['reading', 'fetchedAt', 'lastGood', 'host', 'failures'])
            assert(key in snapshot, `snapshot should carry ${key}`);
    });
});
