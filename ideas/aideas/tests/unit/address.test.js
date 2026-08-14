import { suite, test, assertEquals } from '../harness.js';
import { normaliseHost, stateUrl, describeAddress, usablePort } from '../../src/lib/address.js';

suite('normaliseHost', () => {
    test('a plain host or IP is itself', () => {
        assertEquals(normaliseHost('box'), 'box');
        assertEquals(normaliseHost('10.8.0.1'), '10.8.0.1');
        assertEquals(normaliseHost('box.vpn.example'), 'box.vpn.example');
    });

    test('surrounding whitespace goes', () => {
        assertEquals(normaliseHost('  10.8.0.1\n'), '10.8.0.1');
    });

    test('a pasted URL keeps only its host — this is what people actually paste', () => {
        assertEquals(normaliseHost('http://10.8.0.1:8787/heartbeat'), '10.8.0.1');
        assertEquals(normaliseHost('https://box/'), 'box');
        assertEquals(normaliseHost('http://box'), 'box');
    });

    test('a port typed into the host field loses — the port setting is the visible one', () => {
        assertEquals(normaliseHost('box:9999'), 'box');
    });

    test('an IPv6 literal survives, brackets or not', () => {
        assertEquals(normaliseHost('[fd00::1]:8787'), 'fd00::1');
        assertEquals(normaliseHost('http://[fd00::1]:8787/state'), 'fd00::1');
        assertEquals(normaliseHost('fd00::1'), 'fd00::1');
    });

    test('nothing usable is null, not an empty string', () => {
        for (const value of ['', '   ', null, undefined, 42, {}, 'two words', 'a\tb'])
            assertEquals(normaliseHost(value), null, `for ${JSON.stringify(value)}`);
    });
});

suite('usablePort', () => {
    test('a real port is kept', () => {
        assertEquals(usablePort(8787), 8787);
        assertEquals(usablePort(1), 1);
        assertEquals(usablePort(65535), 65535);
    });

    test('anything else falls back to the heartbeat server\'s own default', () => {
        for (const value of [0, -1, 65536, 1.5, '8787', null, undefined, NaN])
            assertEquals(usablePort(value), 8787, `for ${JSON.stringify(value)}`);
    });
});

suite('describeAddress', () => {
    test('is what the failure message names', () => {
        assertEquals(describeAddress('10.8.0.1', 8787), '10.8.0.1:8787');
        assertEquals(describeAddress('box', 9000), 'box:9000');
    });

    test('brackets IPv6, because a URL requires it', () => {
        assertEquals(describeAddress('fd00::1', 8787), '[fd00::1]:8787');
    });

    test('is null with no host', () => {
        assertEquals(describeAddress('', 8787), null);
    });
});

suite('stateUrl', () => {
    test('is plain HTTP to /state — there is no TLS on the box and no secret to protect', () => {
        assertEquals(stateUrl('10.8.0.1', 8787), 'http://10.8.0.1:8787/state');
    });

    test('brackets IPv6', () => {
        assertEquals(stateUrl('fd00::1', 8787), 'http://[fd00::1]:8787/state');
    });

    test('is null when nothing is configured, so nothing is polled', () => {
        assertEquals(stateUrl('', 8787), null);
        assertEquals(stateUrl(null, 8787), null);
    });

    test('a pasted heartbeat URL still lands on /state', () => {
        // ORCHESTRATOR_HEARTBEAT_URL is the value the installer can pre-set from.
        assertEquals(stateUrl('http://10.8.0.1:8787/heartbeat', 8787),
            'http://10.8.0.1:8787/state');
    });
});
