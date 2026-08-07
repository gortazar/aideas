// The daemon's public D-Bus surface, exercised the way a real client sees it: over a bus, with
// variants, from another process. Runs under dbus-run-session (`make test-dbus`).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertEquals, assertMatch } from '../harness.js';
import { API_VERSION, TaskState } from '../../src/lib/protocol.js';
import {
    call, getProperty, recordSignals, setProperty, startDaemon, stopDaemon,
} from './helpers.js';

// One daemon for the whole file: starting a process per test would triple the runtime for no extra
// coverage, and the tests below clean up the tasks they create. Started on first use, not at import
// time, because every dbus test file shares one process and one bus — two daemons cannot own
// org.gnome.Tasks at once.
//
// Reassigned (not mutated) when a test restarts the daemon: the session object carries a getter for
// the exit state, and Object.assign would flatten it into a stale boolean.
let session = null;

async function daemon() {
    if (!session || session.exited)
        session = await startDaemon();
    return session;
}

suite('org.gnome.Tasks', () => {
    test('the daemon owns its name and answers Ping', async () => {
        await daemon();
        const [reply] = await call('Ping', new GLib.Variant('(s)', ['hello']), '(s)');

        assertEquals(reply, `gnome-tasks/${API_VERSION} hello`);
    });

    test('ApiVersion matches the protocol module the client compiled against', async () => {
        await daemon();
        assertEquals(await getProperty('ApiVersion'), API_VERSION);
    });

    test('a fresh daemon has no current task and no tasks', async () => {
        await daemon();
        assertEquals(await getProperty('CurrentTask'), '');
        const [tasks] = await call('ListTasks', null, '(aa{sv})');
        assertEquals(tasks.length, 0);
    });

    test('CaptureEnabled defaults to on and is writable', async () => {
        await daemon();
        assertEquals(await getProperty('CaptureEnabled'), true);

        await setProperty('CaptureEnabled', GLib.Variant.new_boolean(false));
        assertEquals(await getProperty('CaptureEnabled'), false);

        await setProperty('CaptureEnabled', GLib.Variant.new_boolean(true));
        assertEquals(await getProperty('CaptureEnabled'), true);
    });

    test('create, list, rename, delete round trip over the bus', async () => {
        await daemon();
        const [uuid] = await call('CreateTask', new GLib.Variant('(ss)', ['Writing', 'folder']), '(s)');
        assertMatch(uuid, /^[0-9a-f-]{36}$/);

        let [tasks] = await call('ListTasks', null, '(aa{sv})');
        assertEquals(tasks.length, 1);
        assertEquals(tasks[0].uuid.deepUnpack(), uuid);
        assertEquals(tasks[0].name.deepUnpack(), 'Writing');
        assertEquals(tasks[0].icon.deepUnpack(), 'folder');
        assertEquals(tasks[0].state.deepUnpack(), TaskState.STOPPED);

        await call('SetTaskProperties', new GLib.Variant('(sa{sv})', [
            uuid, { name: GLib.Variant.new_string('Reading') },
        ]));

        const [json] = await call('GetTask', new GLib.Variant('(s)', [uuid]), '(s)');
        const document = JSON.parse(json);
        assertEquals(document.name, 'Reading');
        assertEquals(document.uuid, uuid);
        assert(document.version >= 1, 'the document carries a schema version');

        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
        [tasks] = await call('ListTasks', null, '(aa{sv})');
        assertEquals(tasks.length, 0);
    });

    test('activating a task makes it current and announces it', async () => {
        await daemon();
        const [uuid] = await call('CreateTask', new GLib.Variant('(ss)', ['Client work', '']), '(s)');

        const signals = await recordSignals(
            () => call('ActivateTask', new GLib.Variant('(s)', [uuid])));

        assertEquals(await getProperty('CurrentTask'), uuid);
        const names = signals.map(([name]) => name);
        assert(names.includes('CurrentTaskChanged'),
            `expected CurrentTaskChanged, got ${names.join(', ')}`);
        assert(names.includes('TaskStateChanged'),
            `expected TaskStateChanged, got ${names.join(', ')}`);

        const [, stateArgs] = signals.find(([name]) => name === 'TaskStateChanged');
        assertEquals(stateArgs[0], uuid);
        assertEquals(stateArgs[1], TaskState.ACTIVE);

        // Stopping it gives the current task back up.
        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        assertEquals(await getProperty('CurrentTask'), '');

        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('TaskAdded, TaskChanged and TaskRemoved are emitted with the uuid', async () => {
        await daemon();
        let uuid;
        const signals = await recordSignals(async () => {
            [uuid] = await call('CreateTask', new GLib.Variant('(ss)', ['Temp', '']), '(s)');
            await call('SetTaskProperties', new GLib.Variant('(sa{sv})', [
                uuid, { icon: GLib.Variant.new_string('folder-symbolic') },
            ]));
            await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
        });

        const relevant = signals
            .filter(([name]) => name.startsWith('Task'))
            .map(([name, args]) => `${name}(${args[0]})`);

        assertEquals(relevant.join(' '), [
            `TaskAdded(${uuid})`, `TaskChanged(${uuid})`, `TaskRemoved(${uuid})`,
        ].join(' '));
    });

    test('an unknown uuid comes back as an error, not a crash', async () => {
        await daemon();
        let error = null;
        try {
            await call('GetTask', new GLib.Variant('(s)', ['no-such-task']), '(s)');
        } catch (thrown) {
            error = thrown;
        }

        assert(error !== null, 'expected an error');
        Gio.DBusError.strip_remote_error(error); // rewrites error.message in place
        assertMatch(error.message, /no such task/);

        // ...and the daemon is still alive afterwards.
        const [reply] = await call('Ping', new GLib.Variant('(s)', ['still here']), '(s)');
        assertEquals(reply, `gnome-tasks/${API_VERSION} still here`);
    });

    test('an empty task name is rejected', async () => {
        await daemon();
        let error = null;
        try {
            await call('CreateTask', new GLib.Variant('(ss)', ['   ', '']), '(s)');
        } catch (thrown) {
            error = thrown;
        }

        assert(error !== null, 'expected an error');
        Gio.DBusError.strip_remote_error(error);
        assertMatch(error.message, /needs a name/);
    });

    // Anything unavailable must fail loudly rather than as a silent no-op: this suite runs with no
    // Shell extension on the bus, so capture cannot work and must say why.
    test('capture without the Shell extension raises NotSupported and explains itself', async () => {
        await daemon();
        const [uuid] = await call('CreateTask', new GLib.Variant('(ss)', ['Capture', '']), '(s)');

        let error = null;
        try {
            await call('CaptureNow', new GLib.Variant('(s)', [uuid]));
        } catch (thrown) {
            error = thrown;
        }

        assert(error !== null, 'CaptureNow should have raised');
        assert(error.matches(Gio.DBusError, Gio.DBusError.NOT_SUPPORTED),
            `expected NotSupported, raised ${error}`);
        assertMatch(error.message, /Shell extension/, 'it should say what is missing');

        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    // Tier-2 reports are untrusted input arriving from a browser through a pipe, so a bad one is
    // rejected rather than stored half-understood. (What a *good* one does is in browser.test.js.)
    test('a malformed tier-2 report is rejected with InvalidArgs', async () => {
        await daemon();
        let error = null;
        try {
            await call('ReportAppState', new GLib.Variant('(ss)', ['firefox', '{}']));
        } catch (thrown) {
            error = thrown;
        }

        assert(error !== null, 'ReportAppState should have raised');
        assert(error.matches(Gio.DBusError, Gio.DBusError.INVALID_ARGS),
            `expected InvalidArgs, raised ${error}`);
    });

    test('tasks are still there after the daemon is restarted', async () => {
        await daemon();
        const [uuid] = await call('CreateTask', new GLib.Variant('(ss)', ['Persistent', '']), '(s)');
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));

        await stopDaemon(session);
        session = await startDaemon({ dataDir: session.dataDir });

        const [tasks] = await call('ListTasks', null, '(aa{sv})');
        assertEquals(tasks.length, 1);
        assertEquals(tasks[0].name.deepUnpack(), 'Persistent');
        assertEquals(await getProperty('CurrentTask'), uuid,
            'the current task survives a daemon restart');

        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });
});

// The harness runs every registered test before this module's remaining top-level code would
// continue, so shutdown is registered as the last "test" instead.
suite('teardown', () => {
    test('the daemon shuts down on SIGTERM', async () => {
        await stopDaemon(await daemon());
        assert(session.exited, 'the daemon should have exited');
        assert(session.daemon.get_if_exited() && session.daemon.get_exit_status() === 0,
            `expected a clean exit, got status ${session.daemon.get_exit_status()}`);
    });
});
