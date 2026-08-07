import { suite, test, assertEquals, assertDeepEquals, assertMatch } from '../harness.js';
import {
    correlateBrowserWindows,
    frameMessage,
    parseBrowserState,
    readMessages,
    restoreRequestFor,
    summariseBrowserState,
} from '../../src/lib/browserState.js';

function browserWindow(id, tabs, extra = {}) {
    return { id, focused: false, incognito: false, tabs, ...extra };
}

function tab(url, title, extra = {}) {
    return { url, title, pinned: false, active: false, ...extra };
}

suite('parseBrowserState', () => {
    test('a report from the browser becomes a normalised state', () => {
        const state = parseBrowserState(JSON.stringify({
            adapter: 'firefox',
            windows: [browserWindow(11, [
                tab('https://example.com/', 'Example', { active: true }),
                tab('https://gnome.org/', 'GNOME', { pinned: true }),
            ])],
        }));

        assertEquals(state.adapter, 'firefox');
        assertEquals(state.windows.length, 1);
        assertEquals(state.windows[0].browserWindowId, 11);
        assertEquals(state.windows[0].tabs.length, 2);
        assertDeepEquals(state.windows[0].tabs[0],
            { url: 'https://example.com/', title: 'Example', pinned: false, active: true });
        assertEquals(state.windows[0].activeTitle, 'Example',
            'the active tab title is what a browser window shows in its title bar');
    });

    test('private windows are never recorded', () => {
        const state = parseBrowserState(JSON.stringify({
            adapter: 'firefox',
            windows: [
                browserWindow(1, [tab('https://a/', 'A')]),
                browserWindow(2, [tab('https://secret/', 'Secret')], { incognito: true }),
            ],
        }));

        assertEquals(state.windows.length, 1);
        assertEquals(state.windows[0].browserWindowId, 1);
    });

    test('internal browser pages are not worth restoring', () => {
        const state = parseBrowserState(JSON.stringify({
            adapter: 'chrome',
            windows: [browserWindow(1, [
                tab('about:newtab', 'New Tab'),
                tab('chrome://extensions/', 'Extensions'),
                tab('moz-extension://abc/options.html', 'Options'),
                tab('https://keep.me/', 'Keep me'),
            ])],
        }));

        assertDeepEquals(state.windows[0].tabs.map(t => t.url), ['https://keep.me/']);
    });

    test('a window left with no restorable tabs is dropped', () => {
        const state = parseBrowserState(JSON.stringify({
            adapter: 'chrome',
            windows: [browserWindow(1, [tab('about:blank', 'New Tab')])],
        }));

        assertEquals(state.windows.length, 0);
    });

    test('junk is rejected rather than half-parsed', () => {
        for (const junk of ['', 'not json', '[]', '{}', '{"adapter":"x"}'])
            assertEquals(parseBrowserState(junk), null, JSON.stringify(junk));
    });

    test('an unknown adapter id is rejected', () => {
        assertEquals(parseBrowserState(JSON.stringify({ adapter: 'netscape', windows: [] })), null);
    });
});

suite('correlateBrowserWindows', () => {
    // The hard part named in PLAN.md: a WebExtension window id and a Meta.Window have no shared
    // identifier. What they do share is the title — a browser window's title is its active tab's.
    test('a compositor window is matched to a browser window by its active tab title', () => {
        const state = parseBrowserState(JSON.stringify({
            adapter: 'firefox',
            windows: [
                browserWindow(11, [tab('https://example.com/', 'Example', { active: true })]),
                browserWindow(22, [tab('https://gnome.org/', 'GNOME Project', { active: true })]),
            ],
        }));

        const windows = [
            { id: 'w1', appId: 'firefox.desktop', title: 'Example — Mozilla Firefox' },
            { id: 'w2', appId: 'firefox.desktop', title: 'GNOME Project — Mozilla Firefox' },
        ];

        const matches = correlateBrowserWindows(state, windows);

        assertEquals(matches.get('w1'), 11);
        assertEquals(matches.get('w2'), 22);
    });

    test('a browser window is only claimed once', () => {
        const state = parseBrowserState(JSON.stringify({
            adapter: 'firefox',
            windows: [browserWindow(11, [tab('https://a/', 'Same', { active: true })])],
        }));

        const matches = correlateBrowserWindows(state, [
            { id: 'w1', appId: 'firefox.desktop', title: 'Same — Mozilla Firefox' },
            { id: 'w2', appId: 'firefox.desktop', title: 'Same — Mozilla Firefox' },
        ]);

        assertEquals(matches.size, 1);
        assertEquals(matches.get('w1'), 11);
    });

    test('windows of other applications are ignored', () => {
        const state = parseBrowserState(JSON.stringify({
            adapter: 'firefox',
            windows: [browserWindow(11, [tab('https://a/', 'Example', { active: true })])],
        }));

        const matches = correlateBrowserWindows(state, [
            { id: 'w1', appId: 'org.gnome.TextEditor.desktop', title: 'Example — Text Editor' },
        ]);

        assertEquals(matches.size, 0);
    });

    // The honest fallback from PLAN.md: when the titles do not line up, the per-window split is lost
    // and the caller restores everything into one window. Reporting no match is how that is signalled.
    test('a title that matches nothing yields no match rather than a guess', () => {
        const state = parseBrowserState(JSON.stringify({
            adapter: 'firefox',
            windows: [browserWindow(11, [tab('https://a/', 'Example', { active: true })])],
        }));

        const matches = correlateBrowserWindows(state, [
            { id: 'w1', appId: 'firefox.desktop', title: 'Something else entirely' },
        ]);

        assertEquals(matches.size, 0);
    });
});

suite('restoreRequestFor', () => {
    const state = parseBrowserState(JSON.stringify({
        adapter: 'firefox',
        windows: [
            browserWindow(11, [
                tab('https://a/', 'A', { active: true }),
                tab('https://b/', 'B', { pinned: true }),
            ]),
            browserWindow(22, [tab('https://c/', 'C', { active: true })]),
        ],
    }));

    test('a restore request carries the tabs, grouped per window', () => {
        const request = restoreRequestFor(state);

        assertEquals(request.adapter, 'firefox');
        assertEquals(request.windows.length, 2);
        assertDeepEquals(request.windows[0].urls, ['https://a/', 'https://b/']);
        assertDeepEquals(request.windows[1].urls, ['https://c/']);
        assertDeepEquals(request.windows[0].pinned, [false, true]);
    });

    test('nothing to restore is nothing to send', () => {
        assertEquals(restoreRequestFor(null), null);
        assertEquals(restoreRequestFor({ adapter: 'firefox', windows: [] }), null);
    });
});

suite('summariseBrowserState', () => {
    test('a summary says how much there is, for the preferences window', () => {
        const state = parseBrowserState(JSON.stringify({
            adapter: 'chrome',
            windows: [
                browserWindow(1, [tab('https://a/', 'A'), tab('https://b/', 'B')]),
                browserWindow(2, [tab('https://c/', 'C')]),
            ],
        }));

        assertMatch(summariseBrowserState(state), /2 windows.*3 tabs/);
    });
});

// Native messaging: the browser speaks 4-byte-little-endian length prefixes followed by JSON, on
// stdin and stdout. Getting the framing wrong deadlocks the host, so it is tested directly.
suite('native messaging framing', () => {
    test('a message is framed with its little-endian length', () => {
        const framed = frameMessage({ hello: 'world' });
        const payload = JSON.stringify({ hello: 'world' });

        assertEquals(framed.length, 4 + payload.length);
        const length = framed[0] | (framed[1] << 8) | (framed[2] << 16) | (framed[3] << 24);
        assertEquals(length, payload.length);
        assertEquals(new TextDecoder().decode(framed.slice(4)), payload);
    });

    test('framed messages round trip, several at a time', () => {
        const first = frameMessage({ a: 1 });
        const second = frameMessage({ b: 'two' });
        const buffer = new Uint8Array(first.length + second.length);
        buffer.set(first, 0);
        buffer.set(second, first.length);

        const { messages, rest } = readMessages(buffer);

        assertDeepEquals(messages, [{ a: 1 }, { b: 'two' }]);
        assertEquals(rest.length, 0);
    });

    test('a partial message is kept for the next read rather than dropped', () => {
        const framed = frameMessage({ a: 'a longer message' });
        const truncated = framed.slice(0, framed.length - 5);

        const { messages, rest } = readMessages(truncated);

        assertEquals(messages.length, 0);
        assertEquals(rest.length, truncated.length, 'the incomplete bytes are handed back');
    });

    test('a message with a multi-byte character is measured in bytes, not characters', () => {
        const framed = frameMessage({ title: 'Cañón — GNOME' });
        const { messages, rest } = readMessages(framed);

        assertEquals(messages[0].title, 'Cañón — GNOME');
        assertEquals(rest.length, 0);
    });

    test('an unparseable payload is skipped without losing the rest', () => {
        const bad = new TextEncoder().encode('{not json}');
        const header = new Uint8Array(4);
        header[0] = bad.length;
        const good = frameMessage({ ok: true });

        const buffer = new Uint8Array(4 + bad.length + good.length);
        buffer.set(header, 0);
        buffer.set(bad, 4);
        buffer.set(good, 4 + bad.length);

        const { messages } = readMessages(buffer);

        assertDeepEquals(messages, [{ ok: true }]);
    });
});
