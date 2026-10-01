// Asking the box to pause the queue, or to let it go again.
//
// Like the cycle client, this is tested through an injected transport and through
// `interpretStopReply` directly, so every status and every malformed body is covered without a
// socket. What is particular here is that the two directions are *opposites*: a stop read as a
// resume, or a resume read as a stop, is the one mistake this module must not make quietly.

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { StopClient, interpretStopReply, stopUrl } from '../../src/lib/stopClient.js';

/** A transport that answers with whatever it is told, and remembers what it was given. */
class FakeTransport {
    constructor(reply) {
        this.reply = reply;
        this.posts = [];
    }

    async post(url, body, timeoutSeconds) {
        this.posts.push({ url, body: JSON.parse(body), timeoutSeconds });
        if (this.reply instanceof Error)
            throw this.reply;
        return this.reply;
    }
}

function ok(body) {
    return { status: 200, body: JSON.stringify(body) };
}

const PAUSED = ok({
    paused: true, changed: true, gate: null,
    reason: 'the queue is paused; a running cycle winds down at its next check',
});

const RESUMED = ok({
    paused: false, changed: true, gate: null, reason: 'the queue is no longer paused',
});

suite('stopUrl', () => {
    test('it is /stop on the same address /state is read from', () => {
        assertEquals(stopUrl('box.local', 8787), 'http://box.local:8787/stop');
    });

    test('an IPv6 literal is bracketed, as everywhere else', () => {
        assertEquals(stopUrl('::1', 8787), 'http://[::1]:8787/stop');
    });

    test('no host is no url, not a url with a hole in it', () => {
        assertEquals(stopUrl('', 8787), null);
        assertEquals(stopUrl('   ', 8787), null);
    });
});

suite('StopClient › what it sends', () => {
    test('a stop posts nothing but the secret', async () => {
        const transport = new FakeTransport(PAUSED);

        await new StopClient({ transport })
            .requestStop({ host: 'box', port: 8787, secret: 's3cret' });

        assertDeepEquals(transport.posts[0].body, { secret: 's3cret' });
        assertEquals(transport.posts[0].url, 'http://box:8787/stop');
    });

    test('a resume says resume, and says it as a literal true', async () => {
        const transport = new FakeTransport(RESUMED);

        await new StopClient({ transport })
            .requestStop({ host: 'box', port: 8787, resume: true });

        assertDeepEquals(transport.posts[0].body, { resume: true });
    });

    test('a box with no secret is sent no secret, rather than an empty one', async () => {
        const transport = new FakeTransport(PAUSED);

        await new StopClient({ transport }).requestStop({ host: 'box', port: 8787 });

        assertDeepEquals(transport.posts[0].body, {});
    });

    test('nothing goes out when no address is configured', async () => {
        const transport = new FakeTransport(PAUSED);

        const result = await new StopClient({ transport }).requestStop({ host: '', port: 8787 });

        assertEquals(transport.posts.length, 0);
        assertEquals(result.gate, 'unconfigured');
        assertEquals(result.paused, null, 'not knowing is not "not paused"');
    });
});

suite('StopClient › one at a time', () => {
    test('a second request while one is out is refused, not queued', async () => {
        let release;
        const transport = {
            posts: 0,
            async post() {
                this.posts += 1;
                await new Promise(resolve => {
                    release = resolve;
                });
                return PAUSED;
            },
        };
        const client = new StopClient({ transport });

        const first = client.requestStop({ host: 'box', port: 8787 });
        assert(client.busy, 'busy while a post is out');
        const second = await client.requestStop({ host: 'box', port: 8787 });

        assertEquals(second.gate, 'busy');
        assertEquals(transport.posts, 1, 'the second never went out');
        release();
        await first;
        assert(!client.busy, 'no longer busy once it has answered');
    });

    test('a failed request does not leave the client busy for ever', async () => {
        const client = new StopClient({ transport: new FakeTransport(new Error('boom')) });

        await client.requestStop({ host: 'box', port: 8787 });

        assert(!client.busy);
    });

    test('a transport failure is unreachable, in the transport\'s own English', async () => {
        const error = new Error('whatever GLib said');
        error.reason = 'connection refused';
        const client = new StopClient({ transport: new FakeTransport(error) });

        const result = await client.requestStop({ host: 'box', port: 8787 });

        assertEquals(result.gate, 'unreachable');
        assertEquals(result.reason, 'connection refused');
        assertEquals(result.paused, null);
        assertEquals(result.changed, false);
    });
});

suite('interpretStopReply', () => {
    test('a pause that took', () => {
        const result = interpretStopReply(200, JSON.stringify({
            paused: true, changed: true, gate: null, reason: 'the queue is paused',
        }));

        assertDeepEquals(result, {
            paused: true, changed: true, gate: null, reason: 'the queue is paused',
        });
    });

    test('a queue that was already paused is an answer, not a failure', () => {
        const result = interpretStopReply(200, JSON.stringify({
            paused: true, changed: false, gate: null, reason: 'the queue was already paused',
        }));

        assertEquals(result.gate, null, 'no gate: the request was carried out');
        assertEquals(result.paused, true);
        assertEquals(result.changed, false);
    });

    test('a resume that took', () => {
        const result = interpretStopReply(200, RESUMED.body);

        assertEquals(result.paused, false);
        assertEquals(result.changed, true);
        assertEquals(result.gate, null);
    });

    test('a box that predates the endpoint says so, in its own words', () => {
        const result = interpretStopReply(404, '');

        assertEquals(result.gate, 'unsupported');
        assertEquals(result.reason, 'this box does not support stopping cycles');
        assertEquals(result.paused, null);
    });

    test('a rejected secret is told apart from a refusal', () => {
        const result = interpretStopReply(401, '');

        assertEquals(result.gate, 'unauthorised');
        assertEquals(result.reason, 'the box rejected the shared secret');
        assertEquals(result.changed, false);
    });

    test('the server gate comes through with its null paused intact', () => {
        const result = interpretStopReply(200, JSON.stringify({
            paused: null, changed: false, gate: 'server',
            reason: 'IDEAS_REPO_PATH is not set',
        }));

        assertEquals(result.gate, 'server');
        assertEquals(result.paused, null, 'a box that cannot look must not be read as "running"');
        assertEquals(result.reason, 'IDEAS_REPO_PATH is not set');
    });

    test('a write that failed keeps the state the box reported with it', () => {
        const result = interpretStopReply(200, JSON.stringify({
            paused: true, changed: false, gate: 'write',
            reason: 'could not remove /repo/.orchestrator/stop: Is a directory',
        }));

        assertEquals(result.gate, 'write');
        assertEquals(result.paused, true);
        assert(result.reason.includes('Is a directory'));
    });

    test('an unknown gate is passed through with its sentence', () => {
        const result = interpretStopReply(200, JSON.stringify({
            paused: null, changed: false, gate: 'something-new', reason: 'a newer box said no',
        }));

        assertEquals(result.gate, 'something-new');
        assertEquals(result.reason, 'a newer box said no');
    });

    test('a gate with no sentence still says something', () => {
        const result = interpretStopReply(200, JSON.stringify({ gate: 'write' }));

        assertEquals(result.gate, 'write');
        assert(result.reason.length > 0);
    });

    test('a 200 that is not JSON is malformed, never a success', () => {
        const result = interpretStopReply(200, '<html>502 Bad Gateway</html>');

        assertEquals(result.gate, 'malformed');
        assertEquals(result.paused, null);
        assertEquals(result.changed, false);
    });

    test('a 200 carrying no usable state is malformed', () => {
        // Neither a gate nor a paused flag: this body says nothing at all, and reporting
        // "paused" from it would put a word on screen the box never said.
        const result = interpretStopReply(200, JSON.stringify({ changed: true }));

        assertEquals(result.gate, 'malformed');
        assertEquals(result.paused, null);
    });

    test('an enormous body is refused rather than parsed', () => {
        const result = interpretStopReply(200, `{"pad":"${'x'.repeat(100 * 1024)}"}`);

        assertEquals(result.gate, 'malformed');
        assert(result.reason.includes('too large'));
    });

    test('a JSON array is not an answer', () => {
        assertEquals(interpretStopReply(200, '[]').gate, 'malformed');
    });

    test('another status entirely is reported as that status', () => {
        const result = interpretStopReply(500, 'boom');

        assertEquals(result.gate, 'unreachable');
        assert(result.reason.includes('500'), result.reason);
    });

    test('only a literal true is paused, and only a literal false is not', () => {
        for (const value of [1, 'true', 'yes', {}, []]) {
            const result = interpretStopReply(200, JSON.stringify({
                paused: value, changed: true, gate: null, reason: 'done',
            }));
            assertEquals(result.gate, 'malformed', `for ${JSON.stringify(value)}`);
        }
    });

    test('changed is a literal true or it is false', () => {
        for (const value of [1, 'yes', null, undefined]) {
            const result = interpretStopReply(200, JSON.stringify({
                paused: true, changed: value, gate: null, reason: 'done',
            }));
            assertEquals(result.changed, false, `for ${JSON.stringify(value)}`);
        }
    });

    test('a reason spread over several lines is folded into one', () => {
        const result = interpretStopReply(200, JSON.stringify({
            paused: true, changed: true, gate: null, reason: 'the queue\n  is   paused',
        }));

        assertEquals(result.reason, 'the queue is paused');
    });

    test('every outcome carries the same four keys', () => {
        const replies = [
            interpretStopReply(200, PAUSED.body),
            interpretStopReply(404, ''),
            interpretStopReply(401, ''),
            interpretStopReply(500, 'boom'),
            interpretStopReply(200, 'nonsense'),
        ];

        for (const reply of replies) {
            assertDeepEquals(Object.keys(reply).sort(),
                ['changed', 'gate', 'paused', 'reason']);
            assert(typeof reply.reason === 'string' && reply.reason !== '',
                'every outcome is sayable');
        }
    });
});
