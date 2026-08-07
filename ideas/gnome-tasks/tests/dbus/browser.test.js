// Tier 2 over D-Bus: a browser reporting its tabs, and getting them back on activation.
//
// The browser itself is not involved — what the daemon sees is a JSON document arriving through
// ReportAppState, which is exactly what the native-messaging host sends. That makes the whole
// contract testable without a browser, which matters here because browsers on this platform are
// snap-confined and cannot be driven from a test at all (see docs/limitations.md).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertEquals, assertDeepEquals, assertMatch } from '../harness.js';
import { call, recordSignals, sleep, startDaemon, stopDaemon } from './helpers.js';

let session = null;

async function daemon() {
    if (!session || session.exited)
        session = await startDaemon();
    return session;
}

async function createTask(name) {
    await daemon();
    const [uuid] = await call('CreateTask', new GLib.Variant('(ss)', [name, '']), '(s)');
    return uuid;
}

function report(adapter, windows) {
    return JSON.stringify({ adapter, windows });
}

async function appState(uuid, adapter) {
    const [json] = await call('GetAppState',
        new GLib.Variant('(ss)', [uuid, adapter]), '(s)');
    return JSON.parse(json);
}

const TWO_WINDOWS = [
    {
        id: 11,
        focused: true,
        tabs: [
            { url: 'https://example.com/', title: 'Example', active: true },
            { url: 'https://gnome.org/', title: 'GNOME', pinned: true },
        ],
    },
    {
        id: 22,
        tabs: [{ url: 'https://news.example/', title: 'News', active: true }],
    },
];

suite('tier 2: browser state', () => {
    test('a report is recorded against the current task', async () => {
        const uuid = await createTask('Browsing');
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(400);

        await call('ReportAppState',
            new GLib.Variant('(ss)', ['firefox', report('firefox', TWO_WINDOWS)]));
        await sleep(400);

        const state = await appState(uuid, 'firefox');
        assertEquals(state.adapter, 'firefox');
        assertEquals(state.windows.length, 2);
        assertDeepEquals(state.windows[0].tabs.map(tab => tab.url),
            ['https://example.com/', 'https://gnome.org/']);
        assertEquals(state.windows[0].activeTitle, 'Example');

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('the report survives a daemon restart', async () => {
        const uuid = await createTask('Persistent tabs');
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(400);
        await call('ReportAppState',
            new GLib.Variant('(ss)', ['firefox', report('firefox', TWO_WINDOWS)]));
        await sleep(400);

        await stopDaemon(session);
        session = await startDaemon({ dataDir: session.dataDir });

        const state = await appState(uuid, 'firefox');
        assertEquals(state.windows.length, 2, 'tabs are the one thing a browser never wrote to disk');

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('activating a task asks the adapter to restore what it reported', async () => {
        const uuid = await createTask('Restores tabs');
        const other = await createTask('Elsewhere');
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(400);
        await call('ReportAppState',
            new GLib.Variant('(ss)', ['firefox', report('firefox', TWO_WINDOWS)]));
        await sleep(400);
        await call('ActivateTask', new GLib.Variant('(s)', [other]));
        await sleep(800);

        const signals = await recordSignals(
            () => call('ActivateTask', new GLib.Variant('(s)', [uuid])),
            { settleMs: 1200 });

        const restore = signals.find(([name]) => name === 'RestoreAppState');
        assert(restore, `expected RestoreAppState, got ${signals.map(s => s[0])}`);
        assertEquals(restore[1][0], 'firefox');

        const request = JSON.parse(restore[1][1]);
        assertEquals(request.adapter, 'firefox');
        assertEquals(request.windows.length, 2, 'the per-window split is preserved');
        assertDeepEquals(request.windows[0].urls,
            ['https://example.com/', 'https://gnome.org/']);
        assertDeepEquals(request.windows[0].pinned, [false, true]);

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [other]));
    });

    // Privacy: the same rules as everywhere else in the daemon, on data that is more sensitive than
    // most.
    test('private windows are not recorded', async () => {
        const uuid = await createTask('Private');
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(400);

        await call('ReportAppState', new GLib.Variant('(ss)', ['firefox', report('firefox', [
            { id: 1, incognito: true, tabs: [{ url: 'https://secret/', title: 'Secret', active: true }] },
            { id: 2, tabs: [{ url: 'https://public/', title: 'Public', active: true }] },
        ])]));
        await sleep(400);

        const state = await appState(uuid, 'firefox');
        assertEquals(state.windows.length, 1);
        assertEquals(state.windows[0].tabs[0].url, 'https://public/');

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('nothing is recorded while capture is paused', async () => {
        const uuid = await createTask('Paused browsing');
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(400);

        await setCaptureEnabled(false);
        await call('ReportAppState',
            new GLib.Variant('(ss)', ['firefox', report('firefox', TWO_WINDOWS)]));
        await sleep(400);

        assertDeepEquals(await appState(uuid, 'firefox'), {});

        await setCaptureEnabled(true);
        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('an unknown adapter is refused', async () => {
        await daemon();
        let error = null;
        try {
            await call('ReportAppState',
                new GLib.Variant('(ss)', ['netscape', report('netscape', [])]));
        } catch (thrown) {
            error = thrown;
        }

        assert(error !== null, 'expected an error');
        Gio.DBusError.strip_remote_error(error);
        assertMatch(error.message, /unknown adapter/);
    });

    test('a malformed report is refused rather than half-stored', async () => {
        await daemon();
        for (const json of ['not json', '{}', '[]']) {
            let error = null;
            try {
                await call('ReportAppState', new GLib.Variant('(ss)', ['firefox', json]));
            } catch (thrown) {
                error = thrown;
            }
            assert(error !== null, `expected ${JSON.stringify(json)} to be refused`);
        }
    });

    test('a report with no task current is ignored, not an error', async () => {
        await daemon();
        // Nothing is current here: previous tests stopped their tasks.
        await call('ReportAppState',
            new GLib.Variant('(ss)', ['firefox', report('firefox', TWO_WINDOWS)]));
    });
});

async function setCaptureEnabled(enabled) {
    await Gio.DBus.session.call(
        'org.gnome.Tasks', '/org/gnome/Tasks', 'org.freedesktop.DBus.Properties', 'Set',
        new GLib.Variant('(ssv)', [
            'org.gnome.Tasks', 'CaptureEnabled', GLib.Variant.new_boolean(enabled),
        ]), null, Gio.DBusCallFlags.NONE, 5000, null);
}

suite('browser teardown', () => {
    test('the daemon shuts down cleanly', async () => {
        await stopDaemon(await daemon());
        assert(session.exited);
    });
});
