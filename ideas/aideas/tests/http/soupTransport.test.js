// The real libsoup transport, against a real HTTP server on loopback.
//
// This is the half of the client a fake transport cannot check: that the request actually goes
// out, that the deadline actually fires, and above all that a refused connection produces the
// phrase "connection refused" rather than whatever GLib says in the user's language. Runs
// under plain gjs — no compositor — because libsoup does not need one.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertEquals, assertMatch } from '../harness.js';

import { SoupTransport, reasonFor } from '../../src/lib/soupTransport.js';
import { StateClient } from '../../src/lib/stateClient.js';
import { Status } from '../../src/lib/state.js';
import { withServer } from './serverHarness.js';

/**
 * Every phrase soupTransport.js can produce.
 *
 * Written out here rather than imported: it is the contract the menu renders, and a test that
 * imported the list from the module under test could only ever agree with itself.
 */
const KNOWN_REASONS = [
    'connection refused',
    'host not found',
    'host unreachable',
    'network unreachable',
    'the connection timed out',
    'the connection was closed',
    'the proxy refused',
    'the address could not be used',
    'the name could not be resolved yet',
    'the resolver failed',
    'the TLS handshake failed',
    'the request failed',
];

/** A transport that is always destroyed, so no session outlives its test. */
async function withTransport(fn) {
    const transport = new SoupTransport();
    try {
        return await fn(transport);
    } finally {
        transport.destroy();
    }
}

/** The reason a rejected send gave, or null if it unexpectedly resolved. */
async function reasonOf(promise) {
    try {
        await promise;
        return null;
    } catch (error) {
        return error.reason;
    }
}

suite('a real request', () => {
    test('fetches /state and returns its status and body', async () => {
        await withServer({}, server => withTransport(async transport => {
            const { status, body } = await transport.send(server.url('/state'), 10);

            assertEquals(status, 200);
            const parsed = JSON.parse(body);
            assertEquals(parsed.available, true);
            assertEquals(parsed.running, true);
            assertEquals(parsed.ideas.length, 4);
        }));
    });

    test('reports a server error as its status, not as a failure', async () => {
        await withServer({}, server => withTransport(async transport => {
            const { status } = await transport.send(server.url('/state-500'), 10);

            assertEquals(status, 500, 'a 500 is a reply; the client decides what it means');
        }));
    });

    test('a status outside libsoup\'s enumeration is a number, not a hang', async () => {
        // 429 is not in Soup.Status. get_status() throws on it, inside the async callback,
        // where the throw settles no promise at all and the request never returns.
        await withServer({}, server => withTransport(async transport => {
            const { status } = await transport.send(server.url('/state-429'), 10);

            assertEquals(status, 429);
        }));
    });

    test('two requests in a row both work — the session is reusable', async () => {
        await withServer({}, server => withTransport(async transport => {
            const first = await transport.send(server.url('/state'), 10);
            const second = await transport.send(server.url('/state-idle'), 10);

            assertEquals(first.status, 200);
            assertEquals(JSON.parse(second.body).running, false);
        }));
    });

    test('concurrent requests do not interfere', async () => {
        await withServer({}, server => withTransport(async transport => {
            const [a, b, c] = await Promise.all([
                transport.send(server.url('/state'), 10),
                transport.send(server.url('/state-idle'), 10),
                transport.send(server.url('/other'), 10),
            ]);

            assertEquals(JSON.parse(a.body).running, true);
            assertEquals(JSON.parse(b.body).running, false);
            assertEquals(JSON.parse(c.body).stale_seconds, 12);
        }));
    });
});

suite('failures, in the words the menu will use', () => {
    test('a closed port is "connection refused", not a localised GLib message', async () => {
        await withServer({}, async server => {
            // Take the server away, then ask for the port it had: guaranteed refusal.
            const url = server.url('/state');
            server.destroy();

            const reason = await withTransport(transport => reasonOf(transport.send(url, 5)));

            assertEquals(reason, 'connection refused',
                'a reason that changes with the locale cannot be tested or shared');
        });
    });

    test('a name that does not resolve gives a fixed English phrase, not a GLib message', async () => {
        const reason = await withTransport(transport =>
            reasonOf(transport.send('http://aideas-no-such-host.invalid:8787/state', 10)));

        // Which resolver error arrives depends on the machine: a laptop with a resolver says
        // NOT_FOUND, and a build sandbox with no /etc/resolv.conf at all says something else —
        // which is why demanding "host not found" here failed every CI run on a runner while
        // passing locally. What matters is the property this module exists for: the phrase is
        // one of ours, in English, whatever the locale and whatever the resolver did. The exact
        // code-to-phrase mapping is pinned hermetically in the suite below.
        assert(KNOWN_REASONS.includes(reason), `"${reason}" is not one of the mapped phrases`);
        assertMatch(reason, /^[\x20-\x7e]+$/, 'a reason must be plain ASCII English');
    });

    test('a server that never answers is abandoned at the deadline', async () => {
        await withServer({ slow: 30 }, server => withTransport(async transport => {
            const started = GLib.get_monotonic_time();

            const reason = await reasonOf(transport.send(server.url('/state-slow'), 1));

            assertEquals(reason, 'timed out after 1 s');
            const elapsed = (GLib.get_monotonic_time() - started) / 1e6;
            assert(elapsed < 10, `gave up after ${elapsed.toFixed(1)} s, not the server's 30`);
        }));
    });

    test('an unparseable address is refused before any socket is opened', async () => {
        const reason = await withTransport(transport =>
            reasonOf(transport.send('not a url at all', 5)));

        assertEquals(reason, 'the address could not be used');
    });

    test('a reply too large to be a queue is refused', async () => {
        await withServer({}, server => withTransport(async transport => {
            const reason = await reasonOf(transport.send(server.url('/state-huge'), 20));

            assertEquals(reason, 'the reply was too large to be a queue');
        }));
    });

    test('a destroyed transport refuses politely rather than crashing', async () => {
        const transport = new SoupTransport();
        transport.destroy();

        assertEquals(await reasonOf(transport.send('http://127.0.0.1:1/state', 5)),
            'the extension is shutting down');
    });

    test('reasonFor never returns an empty phrase', () => {
        for (const error of [null, undefined, {}, new Error('x'), { domain: 'nope', code: 999 }])
            assertMatch(reasonFor(error), /\S/, `for ${JSON.stringify(error)}`);
    });
});

// The mapping itself, without needing the network to produce each failure. This is what makes
// the live cases above able to be tolerant: every code that matters is pinned exactly here,
// against a GError constructed by hand.
suite('reasonFor, code by code', () => {
    const cases = [
        [Gio.IOErrorEnum, Gio.IOErrorEnum.CONNECTION_REFUSED, 'connection refused'],
        [Gio.IOErrorEnum, Gio.IOErrorEnum.HOST_NOT_FOUND, 'host not found'],
        [Gio.IOErrorEnum, Gio.IOErrorEnum.HOST_UNREACHABLE, 'host unreachable'],
        [Gio.IOErrorEnum, Gio.IOErrorEnum.NETWORK_UNREACHABLE, 'network unreachable'],
        [Gio.IOErrorEnum, Gio.IOErrorEnum.TIMED_OUT, 'the connection timed out'],
        [Gio.IOErrorEnum, Gio.IOErrorEnum.CONNECTION_CLOSED, 'the connection was closed'],
        [Gio.IOErrorEnum, Gio.IOErrorEnum.PROXY_FAILED, 'the proxy refused'],
        [Gio.IOErrorEnum, Gio.IOErrorEnum.INVALID_ARGUMENT, 'the address could not be used'],
        [Gio.ResolverError, Gio.ResolverError.NOT_FOUND, 'host not found'],
        [Gio.ResolverError, Gio.ResolverError.TEMPORARY_FAILURE,
            'the name could not be resolved yet'],
        [Gio.ResolverError, Gio.ResolverError.INTERNAL, 'the resolver failed'],
    ];

    for (const [domain, code, expected] of cases) {
        test(`code ${code} of that domain reads "${expected}"`, () => {
            // The message is deliberately something no mapping could be reading.
            const error = new GLib.Error(domain, code, 'Conexión rehusada');
            assertEquals(reasonFor(error), expected);
        });
    }

    test('an unmapped error is named, not guessed at', () => {
        const error = new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.PERMISSION_DENIED, 'x');

        assertEquals(reasonFor(error), 'the request failed');
    });

    test('every mapped phrase is one the menu can show', () => {
        for (const [domain, code] of cases) {
            const reason = reasonFor(new GLib.Error(domain, code, 'x'));
            assert(KNOWN_REASONS.includes(reason), `"${reason}" is not in KNOWN_REASONS`);
        }
    });
});

suite('the client over real HTTP', () => {
    const clock = () => 1000;

    test('a live server produces an ok reading with rows', async () => {
        await withServer({}, server => withTransport(async transport => {
            const client = new StateClient({ transport, clock });

            const snapshot = await client.read(server.address());

            assertEquals(snapshot.reading.status, Status.OK);
            assertEquals(snapshot.reading.rows.length, 4);
            assertEquals(snapshot.reading.rows[1].state, 'blocked');
            assertEquals(snapshot.reading.rows[1].openQuestions, 2);
            assertEquals(snapshot.host, `127.0.0.1:${server.port}`);
        }));
    });

    test('available:false comes through as unavailable, with the box\'s reason', async () => {
        const body = JSON.stringify({ available: false, reason: 'IDEAS_REPO_PATH is not set' });

        await withServer({ body }, server => withTransport(async transport => {
            const client = new StateClient({ transport, clock });

            const snapshot = await client.read(server.address());

            assertEquals(snapshot.reading.status, Status.UNAVAILABLE);
            assertEquals(snapshot.reading.reason, 'IDEAS_REPO_PATH is not set');
        }));
    });

    test('a proxy error page in place of the body is unreachable, not a crash', async () => {
        const body = '<html><body>502 Bad Gateway</body></html>';

        await withServer({ body }, server => withTransport(async transport => {
            const client = new StateClient({ transport, clock });

            const snapshot = await client.read(server.address());

            assertEquals(snapshot.reading.status, Status.UNREACHABLE);
            assertEquals(snapshot.reading.reason, 'the reply was not JSON');
        }));
    });

    test('a wrong port answering JSON is told apart from the orchestrator', async () => {
        // The shape of a mistyped port: something is there, and it is not this.
        const body = JSON.stringify({ last_ts: 0, last_event: null, stale_seconds: 12 });

        await withServer({ body }, server => withTransport(async transport => {
            const client = new StateClient({ transport, clock });

            const snapshot = await client.read(server.address());

            assertEquals(snapshot.reading.status, Status.UNREACHABLE);
            assertEquals(snapshot.reading.reason, 'that address answered, but not with /state');
        }));
    });

    test('the last good reading survives the box going away', async () => {
        await withServer({}, async server => {
            await withTransport(async transport => {
                const client = new StateClient({ transport, clock });

                await client.read(server.address());
                assertEquals(client.snapshot().reading.status, Status.OK);

                server.destroy();
                const afterwards = await client.read(server.address());

                assertEquals(afterwards.reading.status, Status.UNREACHABLE);
                assertEquals(afterwards.reading.reason, 'connection refused');
                assertEquals(afterwards.lastGood.reading.status, Status.OK,
                    'the menu can still show what was true a moment ago');
                assertEquals(client.failures, 1);
            });
        });
    });
});
