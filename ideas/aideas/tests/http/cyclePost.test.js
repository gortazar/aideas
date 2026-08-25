// The real POST, over real libsoup, against a real server.
//
// The half a fake transport cannot check: that a body actually goes out, that the box receives
// the JSON the client meant to send, and that each status the contract names comes back as the
// sentence the menu will show.

import { suite, test, assert, assertEquals } from '../harness.js';
import { SoupTransport } from '../../src/lib/soupTransport.js';
import { CycleClient } from '../../src/lib/cycleClient.js';
import { withServer } from './serverHarness.js';

async function withTransport(fn) {
    const transport = new SoupTransport();
    try {
        return await fn(transport);
    } finally {
        transport.destroy();
    }
}

/** What the stub recorded receiving. */
async function postsTo(server, transport) {
    const { body } = await transport.send(server.url('/cycles'), 10);
    return JSON.parse(body);
}

suite('a real POST /cycle', () => {
    test('the box receives the request, as JSON', async () => {
        await withServer({ cycleMode: 'started' }, server => withTransport(async transport => {
            const client = new CycleClient({ transport });

            const result = await client.requestCycle({ ...server.address(), secret: 's3cret' });

            assertEquals(result.started, true);
            const posts = await postsTo(server, transport);
            assertEquals(posts.length, 1);
            assertEquals(posts[0].body.secret, 's3cret');
            assert(posts[0].content_type.startsWith('application/json'),
                `content type was ${posts[0].content_type}`);
        }));
    });

    test('an override travels as an override', async () => {
        await withServer({ cycleMode: 'started' }, server => withTransport(async transport => {
            const client = new CycleClient({ transport });

            await client.requestCycle({ ...server.address(), override: true });

            const posts = await postsTo(server, transport);
            assertEquals(posts[0].body.override, true);
        }));
    });

    test('a refusal arrives as the gate and the sentence', async () => {
        await withServer({ cycleMode: 'refused' }, server => withTransport(async transport => {
            const result = await new CycleClient({ transport })
                .requestCycle(server.address());

            assertEquals(result.started, false);
            assertEquals(result.gate, 'heartbeat');
            assertEquals(result.reason, 'A Claude Code session is active on this laptop');
        }));
    });

    test('a box that predates the endpoint says so', async () => {
        await withServer({ cycleMode: 'unsupported' },
            server => withTransport(async transport => {
                const result = await new CycleClient({ transport })
                    .requestCycle(server.address());

                assertEquals(result.gate, 'unsupported');
                assertEquals(result.reason, 'this box does not support starting cycles');
            }));
    });

    test('a rejected secret is told apart from a refused cycle', async () => {
        await withServer({ cycleMode: 'unauthorised' },
            server => withTransport(async transport => {
                const result = await new CycleClient({ transport })
                    .requestCycle({ ...server.address(), secret: 'wrong' });

                assertEquals(result.gate, 'unauthorised');
            }));
    });

    test('a rate limit comes back with the box\'s own wait', async () => {
        await withServer({ cycleMode: 'rate-limited' },
            server => withTransport(async transport => {
                const result = await new CycleClient({ transport })
                    .requestCycle(server.address());

                assertEquals(result.gate, 'rate-limit');
                assert(result.reason.includes('wait'), result.reason);
            }));
    });

    test('a 200 that is not an answer is not a start', async () => {
        await withServer({ cycleMode: 'garbage' }, server => withTransport(async transport => {
            const result = await new CycleClient({ transport }).requestCycle(server.address());

            assertEquals(result.started, false);
            assertEquals(result.gate, 'malformed');
        }));
    });

    test('a box that is not there is unreachable, in English', async () => {
        await withServer({ cycleMode: 'started' }, async server => {
            const address = server.address();
            server.destroy();

            const result = await withTransport(transport =>
                new CycleClient({ transport }).requestCycle(address));

            assertEquals(result.gate, 'unreachable');
            assertEquals(result.reason, 'connection refused');
        });
    });

    test('a POST does not disturb the GETs that share the session', async () => {
        await withServer({ cycleMode: 'started' }, server => withTransport(async transport => {
            const before = await transport.send(server.url('/state'), 10);
            await new CycleClient({ transport }).requestCycle(server.address());
            const after = await transport.send(server.url('/state'), 10);

            assertEquals(before.status, 200);
            assertEquals(after.status, 200);
            assertEquals(JSON.parse(after.body).available, true);
        }));
    });
});
