// The real POST /stop, over real libsoup, against a real server.
//
// The half a fake transport cannot check: that the body goes out as JSON the box can read, that
// each status in the contract becomes the sentence the menu will show — and, because the stub's
// `/stop` really moves the flag its `/state` reports, that the write and the read agree. That
// last one is the behaviour of the pair, and it is the one a mocked transport cannot have.

import { suite, test, assert, assertEquals } from '../harness.js';
import { SoupTransport } from '../../src/lib/soupTransport.js';
import { StopClient } from '../../src/lib/stopClient.js';
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
    const { body } = await transport.send(server.url('/stops'), 10);
    return JSON.parse(body);
}

/** The stub's own `/state`, read the way the panel reads it. */
async function stateOf(server, transport) {
    const { body } = await transport.send(server.url('/state'), 10);
    return JSON.parse(body);
}

suite('a real POST /stop', () => {
    test('the box receives the request, as JSON', async () => {
        await withServer({}, server => withTransport(async transport => {
            const client = new StopClient({ transport });

            const result = await client.requestStop({ ...server.address(), secret: 's3cret' });

            assertEquals(result.paused, true);
            assertEquals(result.changed, true);
            assertEquals(result.gate, null);
            const posts = await postsTo(server, transport);
            assertEquals(posts.length, 1);
            assertEquals(posts[0].body.secret, 's3cret');
            assertEquals(posts[0].body.resume, undefined, 'a stop carries no resume at all');
            assert(posts[0].content_type.startsWith('application/json'),
                `content type was ${posts[0].content_type}`);
        }));
    });

    test('the pause it asked for is the pause /state then reports', async () => {
        await withServer({}, server => withTransport(async transport => {
            assertEquals((await stateOf(server, transport)).paused, false);

            await new StopClient({ transport }).requestStop(server.address());

            assertEquals((await stateOf(server, transport)).paused, true,
                'the write and the read agree');
        }));
    });

    test('a resume travels as a resume, and un-pauses the box', async () => {
        await withServer({ paused: true }, server => withTransport(async transport => {
            const client = new StopClient({ transport });

            const result = await client.requestStop({ ...server.address(), resume: true });

            assertEquals(result.paused, false);
            assertEquals(result.changed, true);
            assertEquals((await postsTo(server, transport))[0].body.resume, true);
            assertEquals((await stateOf(server, transport)).paused, false);
        }));
    });

    test('stopping an already-paused queue changes nothing and is not an error', async () => {
        await withServer({ paused: true }, server => withTransport(async transport => {
            const result = await new StopClient({ transport }).requestStop(server.address());

            assertEquals(result.paused, true);
            assertEquals(result.changed, false);
            assertEquals(result.gate, null, 'nothing to do is not a refusal');
            assert(result.reason.includes('already'), result.reason);
        }));
    });

    test('a box that predates the endpoint says so', async () => {
        await withServer({ stopMode: 'unsupported' },
            server => withTransport(async transport => {
                const result = await new StopClient({ transport }).requestStop(server.address());

                assertEquals(result.gate, 'unsupported');
                assertEquals(result.reason, 'this box does not support stopping cycles');
                assertEquals(result.paused, null);
            }));
    });

    test('a rejected secret is told apart from a refusal', async () => {
        await withServer({ stopMode: 'unauthorised' },
            server => withTransport(async transport => {
                const result = await new StopClient({ transport })
                    .requestStop({ ...server.address(), secret: 'wrong' });

                assertEquals(result.gate, 'unauthorised');
            }));
    });

    test('a box that cannot find its repository says so, without claiming a state', async () => {
        await withServer({ stopMode: 'server-gate' },
            server => withTransport(async transport => {
                const result = await new StopClient({ transport }).requestStop(server.address());

                assertEquals(result.gate, 'server');
                assertEquals(result.paused, null);
                assert(result.reason.includes('IDEAS_REPO_PATH'), result.reason);
            }));
    });

    test('a write that failed keeps the state the box reported with it', async () => {
        await withServer({ stopMode: 'write-gate' },
            server => withTransport(async transport => {
                const result = await new StopClient({ transport })
                    .requestStop({ ...server.address(), resume: true });

                assertEquals(result.gate, 'write');
                assertEquals(result.paused, true, 'it is still paused, and said so');
            }));
    });

    test('a 200 that is not an answer is not a pause', async () => {
        await withServer({ stopMode: 'garbage' }, server => withTransport(async transport => {
            const result = await new StopClient({ transport }).requestStop(server.address());

            assertEquals(result.gate, 'malformed');
            assertEquals(result.paused, null);
        }));
    });

    test('a box that is not there is unreachable, in English', async () => {
        await withServer({}, async server => {
            const address = server.address();
            server.destroy();

            const result = await withTransport(transport =>
                new StopClient({ transport }).requestStop(address));

            assertEquals(result.gate, 'unreachable');
            assertEquals(result.reason, 'connection refused');
        });
    });

    test('stop then resume leaves the box exactly as it was found', async () => {
        await withServer({}, server => withTransport(async transport => {
            const client = new StopClient({ transport });

            await client.requestStop(server.address());
            const resumed = await client.requestStop({ ...server.address(), resume: true });

            assertEquals(resumed.paused, false);
            assertEquals((await stateOf(server, transport)).paused, false);
            assertEquals((await postsTo(server, transport)).length, 2);
        }));
    });
});
