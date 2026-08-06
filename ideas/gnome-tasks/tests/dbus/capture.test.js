// Capture and restore, end to end over D-Bus, against a scripted desktop (tests/dbus/fakeShell.js).
// The daemon is a real separate process; only the compositor is faked.

import GLib from 'gi://GLib';

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { DeactivatePolicy } from '../../src/lib/protocol.js';
import { call, setProperty, sleep, startDaemon, stopDaemon } from './helpers.js';
import { FakeShell, fakeWindow } from './fakeShell.js';

const shell = new FakeShell();
await shell.export();

// Started on first use rather than at import time: every dbus test file runs in one process on one
// bus, and two daemons cannot own org.gnome.Tasks at once. The fake Shell is on the bus first, which
// is also the ordering a real session has — extension loaded, daemon activated later.
let session = null;

async function daemon() {
    if (!session || session.exited)
        session = await startDaemon();
    return session;
}

async function createTask(name, properties = {}) {
    await daemon();
    const [uuid] = await call('CreateTask', new GLib.Variant('(ss)', [name, '']), '(s)');
    if (Object.keys(properties).length > 0) {
        const packed = {};
        for (const [key, value] of Object.entries(properties))
            packed[key] = GLib.Variant.new_string(value);
        await call('SetTaskProperties', new GLib.Variant('(sa{sv})', [uuid, packed]));
    }
    return uuid;
}

async function taskDocument(uuid) {
    const [json] = await call('GetTask', new GLib.Variant('(s)', [uuid]), '(s)');
    return JSON.parse(json);
}

suite('capture', () => {
    test('CaptureNow records the windows on the desktop into the task', async () => {
        const uuid = await createTask('Capturing');
        shell.windows = [
            fakeWindow('org.gnome.TextEditor.desktop', { x: 10, y: 20, width: 700, height: 500, workspace: 1 }),
            fakeWindow('org.gnome.Calculator.desktop', { x: 0, y: 0, width: 360, height: 500 }),
        ];

        await call('CaptureNow', new GLib.Variant('(s)', [uuid]));
        await sleep(600);

        const document = await taskDocument(uuid);
        assertEquals(document.apps.length, 2);
        assertDeepEquals(document.apps.map(app => app.appId).sort(),
            ['org.gnome.Calculator.desktop', 'org.gnome.TextEditor.desktop']);

        const editor = document.apps.find(a => a.appId === 'org.gnome.TextEditor.desktop');
        assertDeepEquals(editor.placement.geometry, { x: 10, y: 20, width: 700, height: 500 });
        assertEquals(editor.placement.workspace, 1);

        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('windows that are not capturable are not recorded', async () => {
        const uuid = await createTask('Partial');
        shell.windows = [
            fakeWindow('org.gnome.Calculator.desktop'),
            { ...fakeWindow('window:9'), identified: false },
            { ...fakeWindow('org.gnome.Nautilus.desktop'), geometry: null },
        ];

        await call('CaptureNow', new GLib.Variant('(s)', [uuid]));
        await sleep(600);

        const document = await taskDocument(uuid);
        assertEquals(document.apps.length, 1);
        assertEquals(document.apps[0].appId, 'org.gnome.Calculator.desktop');

        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    // Capture is continuous: the daemon must react to the compositor's WindowsChanged on its own,
    // not only when asked.
    test('a window change is captured automatically for the current task', async () => {
        const uuid = await createTask('Automatic');
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(500);

        shell.setWindows([fakeWindow('org.gnome.Terminal.desktop', { x: 5, y: 5 })]);
        // The daemon debounces for 2s before writing.
        await sleep(3500);

        const document = await taskDocument(uuid);
        assertEquals(document.apps.length, 1);
        assertEquals(document.apps[0].appId, 'org.gnome.Terminal.desktop');

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });
});

suite('restore', () => {
    test('activating a task launches the applications it remembers, with their placement', async () => {
        const uuid = await createTask('Restorable');
        shell.windows = [
            fakeWindow('org.gnome.TextEditor.desktop', { x: 10, y: 20, width: 700, height: 500, workspace: 1 }),
        ];
        await call('CaptureNow', new GLib.Variant('(s)', [uuid]));
        await sleep(600);

        // The desktop is now empty, so restore has to launch rather than move.
        shell.windows = [];
        shell.reset();

        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(1200);

        const launches = shell.callsTo('LaunchApp');
        assertEquals(launches.length, 1);
        assertEquals(launches[0].desktopId, 'org.gnome.TextEditor.desktop');
        assertDeepEquals(launches[0].placement.geometry, { x: 10, y: 20, width: 700, height: 500 });
        assertEquals(launches[0].placement.workspace, 1);

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('a window that is already open is moved, not launched a second time', async () => {
        const uuid = await createTask('Already open');
        shell.windows = [fakeWindow('org.gnome.Calculator.desktop', { x: 10, y: 10 })];
        await call('CaptureNow', new GLib.Variant('(s)', [uuid]));
        await sleep(600);

        // Same app still running, in the wrong place.
        shell.windows = [fakeWindow('org.gnome.Calculator.desktop', { id: 'existing', x: 900, y: 900 })];
        shell.reset();

        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(1200);

        assertEquals(shell.callsTo('LaunchApp').length, 0, 'nothing should be launched again');
        const places = shell.callsTo('PlaceWindow');
        assertEquals(places.length, 1);
        assertEquals(places[0].windowId, 'existing');
        assertDeepEquals(places[0].placement.geometry, { x: 10, y: 10, width: 800, height: 600 });

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });
});

suite('switching', () => {
    test('switching away saves the outgoing task before restoring the incoming one', async () => {
        const first = await createTask('First');
        const second = await createTask('Second');

        await call('ActivateTask', new GLib.Variant('(s)', [first]));
        await sleep(400);

        // The user arranges the desktop while First is current, then switches.
        shell.windows = [fakeWindow('org.gnome.Nautilus.desktop', { x: 33, y: 44 })];
        shell.reset();
        await call('ActivateTask', new GLib.Variant('(s)', [second]));
        await sleep(1500);

        const document = await taskDocument(first);
        assertEquals(document.apps.length, 1,
            'the outgoing task should have been captured on the way out');
        assertEquals(document.apps[0].placement.geometry.x, 33);

        await call('DeleteTask', new GLib.Variant('(s)', [first]));
        await call('DeleteTask', new GLib.Variant('(s)', [second]));
    });

    test('the close policy closes the outgoing task\'s windows politely', async () => {
        const closing = await createTask('Closes', { 'deactivate-policy': DeactivatePolicy.CLOSE });
        const other = await createTask('Other');

        await call('ActivateTask', new GLib.Variant('(s)', [closing]));
        await sleep(400);
        shell.windows = [
            fakeWindow('org.gnome.Calculator.desktop', { id: 'calc' }),
            fakeWindow('org.gnome.Terminal.desktop', { id: 'term', x: 100 }),
        ];
        await call('CaptureNow', new GLib.Variant('(s)', [closing]));
        await sleep(700);
        shell.reset();

        await call('ActivateTask', new GLib.Variant('(s)', [other]));
        await sleep(1500);

        const closes = shell.callsTo('CloseWindow').map(c => c.windowId).sort();
        assertDeepEquals(closes, ['calc', 'term']);

        await call('DeleteTask', new GLib.Variant('(s)', [closing]));
        await call('DeleteTask', new GLib.Variant('(s)', [other]));
    });

    test('the leave policy leaves the windows alone', async () => {
        const leaving = await createTask('Leaves', { 'deactivate-policy': DeactivatePolicy.LEAVE });
        const other = await createTask('Other again');

        await call('ActivateTask', new GLib.Variant('(s)', [leaving]));
        await sleep(400);
        shell.windows = [fakeWindow('org.gnome.Calculator.desktop', { id: 'calc' })];
        await call('CaptureNow', new GLib.Variant('(s)', [leaving]));
        await sleep(700);
        shell.reset();

        await call('ActivateTask', new GLib.Variant('(s)', [other]));
        await sleep(1200);

        assertEquals(shell.callsTo('CloseWindow').length, 0);

        await call('DeleteTask', new GLib.Variant('(s)', [leaving]));
        await call('DeleteTask', new GLib.Variant('(s)', [other]));
    });

    // Privacy switch: nothing may be recorded while capture is paused.
    test('nothing is captured while CaptureEnabled is false', async () => {
        const uuid = await createTask('Paused');
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(400);

        await setProperty('CaptureEnabled', GLib.Variant.new_boolean(false));
        shell.setWindows([fakeWindow('org.gnome.Calculator.desktop')]);
        await sleep(3500);

        assertEquals((await taskDocument(uuid)).apps.length, 0,
            'a paused daemon must not record windows');

        // ...and it starts again when unpaused.
        await setProperty('CaptureEnabled', GLib.Variant.new_boolean(true));
        shell.setWindows([fakeWindow('org.gnome.Terminal.desktop')]);
        await sleep(3500);

        assertEquals((await taskDocument(uuid)).apps.length, 1);

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });
});

suite('capture teardown', () => {
    test('the daemon and the fake Shell shut down cleanly', async () => {
        await stopDaemon(await daemon());
        assert(session.exited, 'the daemon should have exited');
        // Unexported here so the next test file starts against a bare bus, with no compositor.
        shell.destroy();
    });
});
