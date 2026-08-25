// Asking for a cycle: every status and every malformed reply, without a socket.
//
// The point of this module is that a click always produces a sentence, so these tests are
// mostly about what that sentence is — and about the two answers that must never be confused: a
// box that *refused* (which is information) and a box that never heard (which is not).

import { suite, test, assert, assertEquals } from '../harness.js';
import {
    CycleClient, cycleUrl, interpretCycleReply,
} from '../../src/lib/cycleClient.js';

const BOX = { host: '10.8.0.1', port: 8787 };

/** A transport whose reply, or failure, a test dictates; records what it was asked to send. */
function fakeTransport(reply) {
    const calls = [];
    return {
        calls,
        post(url, body, timeoutSeconds) {
            calls.push({ url, body, timeoutSeconds });
            if (typeof reply === 'function')
                return reply();
            if (reply instanceof Error)
                return Promise.reject(reply);
            return Promise.resolve(reply);
        },
    };
}

function transportFailure(reason) {
    const error = new Error(`aideas: ${reason}`);
    error.reason = reason;
    return error;
}

function ok(body) {
    return { status: 200, body: JSON.stringify(body) };
}

suite('cycleUrl', () => {
    test('is /cycle on the same box /state is read from', () => {
        assertEquals(cycleUrl('10.8.0.1', 8787), 'http://10.8.0.1:8787/cycle');
    });

    test('normalises what someone typed, exactly as the reading side does', () => {
        assertEquals(cycleUrl('http://box:8787/heartbeat', 8787), 'http://box:8787/cycle');
        assertEquals(cycleUrl('fd00::1', 8787), 'http://[fd00::1]:8787/cycle');
    });

    test('is null when nothing is configured', () => {
        assertEquals(cycleUrl('', 8787), null);
        assertEquals(cycleUrl(null, 8787), null);
    });
});

suite('a request that gets through', () => {
    test('a launch is a launch', async () => {
        const client = new CycleClient({ transport: fakeTransport(ok({ started: true })) });

        const result = await client.requestCycle(BOX);

        assertEquals(result.started, true);
        assertEquals(result.gate, null);
        assertEquals(result.reason, null);
    });

    test('posts to /cycle with the timeout it was given', async () => {
        const transport = fakeTransport(ok({ started: true }));
        const client = new CycleClient({ transport, timeoutSeconds: 12 });

        await client.requestCycle(BOX);

        assertEquals(transport.calls.length, 1);
        assertEquals(transport.calls[0].url, 'http://10.8.0.1:8787/cycle');
        assertEquals(transport.calls[0].timeoutSeconds, 12);
    });

    test('sends no secret when there is none to send', async () => {
        const transport = fakeTransport(ok({ started: true }));

        await new CycleClient({ transport }).requestCycle(BOX);

        assertEquals(JSON.parse(transport.calls[0].body).secret, undefined,
            'an empty secret is not a secret');
    });

    test('sends the secret when there is one', async () => {
        const transport = fakeTransport(ok({ started: true }));

        await new CycleClient({ transport }).requestCycle({ ...BOX, secret: 's3cret' });

        assertEquals(JSON.parse(transport.calls[0].body).secret, 's3cret');
    });

    test('asks for an override only when told to', async () => {
        const plain = fakeTransport(ok({ started: true }));
        await new CycleClient({ transport: plain }).requestCycle(BOX);
        assertEquals(JSON.parse(plain.calls[0].body).override, undefined);

        const forced = fakeTransport(ok({ started: true }));
        await new CycleClient({ transport: forced }).requestCycle({ ...BOX, override: true });
        assertEquals(JSON.parse(forced.calls[0].body).override, true);
    });
});

suite('a request that is refused', () => {
    test('the gate and the box\'s own words come back', async () => {
        const client = new CycleClient({ transport: fakeTransport(ok({
            started: false, gate: 'stop-file', reason: 'Paused: .orchestrator/stop exists',
        })) });

        const result = await client.requestCycle(BOX);

        assertEquals(result.started, false);
        assertEquals(result.gate, 'stop-file');
        assertEquals(result.reason, 'Paused: .orchestrator/stop exists');
    });

    test('a gate this version has never heard of still shows its reason', () => {
        const result = interpretCycleReply(200, JSON.stringify({
            started: false, gate: 'solar-flare', reason: 'the sun is too bright today',
        }));

        assertEquals(result.gate, 'solar-flare');
        assertEquals(result.reason, 'the sun is too bright today',
            'the orchestrator knows why it will not run; we do not second-guess it');
    });

    test('a refusal with no reason still says something', () => {
        for (const body of [{ started: false }, { started: false, reason: '   ' },
            { started: false, reason: 42 }]) {
            const result = interpretCycleReply(200, JSON.stringify(body));
            assertEquals(result.started, false);
            assertEquals(result.reason, 'the orchestrator refused, without saying why');
            assertEquals(result.gate, 'refused');
        }
    });

    test('a multi-line reason is folded, because it goes in a menu row', () => {
        const result = interpretCycleReply(200, JSON.stringify({
            started: false, gate: 'budget', reason: 'Daily budget spent\n($12.40 of $10)',
        }));

        assertEquals(result.reason, 'Daily budget spent ($12.40 of $10)');
    });

    test('anything but a literal true is not a start', () => {
        for (const started of [false, 'true', 1, null, undefined, {}]) {
            const result = interpretCycleReply(200, JSON.stringify({ started, reason: 'no' }));
            assertEquals(result.started, false, `for ${JSON.stringify(started)}`);
        }
    });
});

suite('a request that never gets an answer', () => {
    test('a transport failure keeps the phrase the transport chose', async () => {
        const client = new CycleClient({
            transport: fakeTransport(transportFailure('connection refused')),
        });

        const result = await client.requestCycle(BOX);

        assertEquals(result.gate, 'unreachable');
        assertEquals(result.reason, 'connection refused',
            'mapped from a GError code, so it does not change with the locale');
    });

    test('a failure with no reason still produces one', async () => {
        const client = new CycleClient({ transport: fakeTransport(new Error('boom')) });

        assertEquals((await client.requestCycle(BOX)).reason, 'the request failed');
    });

    test('404 is an old box, and says so rather than blaming the click', () => {
        const result = interpretCycleReply(404, '');

        assertEquals(result.gate, 'unsupported');
        assertEquals(result.reason, 'this box does not support starting cycles');
    });

    test('401 is the secret, not the queue', () => {
        const result = interpretCycleReply(401, '');

        assertEquals(result.gate, 'unauthorised');
        assertEquals(result.reason, 'the box rejected the shared secret');
    });

    test('429 comes back as the rate limit the box reported', () => {
        const result = interpretCycleReply(429, JSON.stringify({
            started: false, gate: 'rate-limit', reason: 'a cycle was just launched, wait 24 s',
        }));

        assertEquals(result.gate, 'rate-limit');
        assertEquals(result.reason, 'a cycle was just launched, wait 24 s');
    });

    test('a 200 that is not an answer is not a start', () => {
        for (const body of ['', '<html>proxy</html>', 'null', '[]', '"started"']) {
            const result = interpretCycleReply(200, body);
            assertEquals(result.started, false, `for ${JSON.stringify(body)}`);
            assertEquals(result.gate, 'malformed');
            assertEquals(result.reason, 'the box answered, but not with an answer');
        }
    });

    test('another status with no usable body names the status', () => {
        const result = interpretCycleReply(500, 'boom');

        assertEquals(result.gate, 'unreachable');
        assertEquals(result.reason, 'the server answered HTTP 500');
    });

    test('an enormous reply is refused rather than parsed', () => {
        const result = interpretCycleReply(200, `{"started":true,"pad":"${'x'.repeat(70000)}"}`);

        assertEquals(result.started, false);
        assertEquals(result.gate, 'malformed');
    });

    test('every outcome carries a reason whenever it is not a start', () => {
        const replies = [
            [404, ''], [401, ''], [429, '{}'], [200, ''], [500, 'x'], [200, '{"started":false}'],
            [200, JSON.stringify({ started: false, gate: 'lock', reason: 'running' })],
        ];
        for (const [status, body] of replies) {
            const result = interpretCycleReply(status, body);
            if (!result.started) {
                assert(typeof result.reason === 'string' && result.reason.length > 0,
                    `${status} ${body} produced no reason`);
                assert(typeof result.gate === 'string' && result.gate.length > 0,
                    `${status} ${body} produced no gate`);
            }
        }
    });
});

suite('never two posts at once', () => {
    test('a second call while one is out is refused, not queued', async () => {
        let release;
        const slow = new Promise(resolve => { release = resolve; });
        const transport = fakeTransport(() => slow);
        const client = new CycleClient({ transport });

        const first = client.requestCycle(BOX);
        const second = await client.requestCycle(BOX);

        assertEquals(second.started, false);
        assertEquals(second.gate, 'busy');
        assertEquals(transport.calls.length, 1, 'one request, not two');
        assert(client.busy, 'and the client knows it is waiting');

        release(ok({ started: true }));
        assertEquals((await first).started, true);
        assertEquals(client.busy, false);
    });

    test('a failed post releases the slot', async () => {
        const client = new CycleClient({
            transport: fakeTransport(transportFailure('connection refused')),
        });

        await client.requestCycle(BOX);

        assertEquals(client.busy, false, 'or the button would never work again');
    });
});

suite('with nothing configured', () => {
    test('nothing is attempted', async () => {
        const transport = fakeTransport(ok({ started: true }));
        const client = new CycleClient({ transport });

        const result = await client.requestCycle({ host: '', port: 8787 });

        assertEquals(result.started, false);
        assertEquals(result.gate, 'unconfigured');
        assertEquals(transport.calls.length, 0);
    });
});
