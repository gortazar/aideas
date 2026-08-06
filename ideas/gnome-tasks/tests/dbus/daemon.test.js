// The daemon's public D-Bus surface, exercised the way a real client sees it: over a bus, with
// variants, from another process. Runs under dbus-run-session (`make test-dbus`).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertEquals, assertMatch } from '../harness.js';
import { API_VERSION, TaskState } from '../../src/lib/protocol.js';
import {
    call, getProperty, recordSignals, setProperty, startDaemon, stopDaemon,
} from './helpers.js';

// One daemon for the whole file: starting a process per test would triple the runtime for no
// extra coverage, and the tests below clean up the tasks they create.
// Reassigned (not mutated) when a test restarts the daemon: the session object carries a getter
// for the exit state, and Object.assign would flatten it into a stale boolean.
let session = await startDaemon();

suite('org.gnome.Tasks', () => {
    test('the daemon owns its name and answers Ping', async () => {
        const [reply] = await call('Ping', new GLib.Variant('(s)', ['hello']), '(s)');

        assertEquals(reply, `gnome-tasks/${API_VERSION} hello`);
    });

    test('ApiVersion matches the protocol module the client compiled against', async () => {
        assertEquals(await getProperty('ApiVersion'), API_VERSION);
    });

    test('a fresh daemon has no current task and no tasks', async () => {
        assertEquals(await getProperty('CurrentTask'), '');
        const [tasks] = await call('ListTasks', null, '(aa{sv})');
        assertEquals(tasks.length, 0);
    });

    test('CaptureEnabled defaults to on and is writable', async () => {
        assertEquals(await getProperty('CaptureEnabled'), true);

        await setProperty('CaptureEnabled', GLib.Variant.new_boolean(false));
        assertEquals(await getProperty('CaptureEnabled'), false);

        await setProperty('CaptureEnabled', GLib.Variant.new_boolean(true));
        assertEquals(await getProperty('CaptureEnabled'), true);
    });

    test('create, list, rename, delete round trip over the bus', async () => {
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

    // Methods that need the compositor must fail loudly while they are unimplemented, so nobody
    // builds on a silent no-op.
    test('not-yet-implemented methods raise NotSupported and name the milestone', async () => {
        const [uuid] = await call('CreateTask', new GLib.Variant('(ss)', ['Capture', '']), '(s)');

        for (const [method, parameters] of [
            ['CaptureNow', new GLib.Variant('(s)', [uuid])],
            ['ReportAppState', new GLib.Variant('(ss)', ['firefox', '{}'])],
        ]) {
            let error = null;
            try {
                await call(method, parameters);
            } catch (thrown) {
                error = thrown;
            }
            assert(error !== null, `${method} should have raised`);
            assert(error.matches(Gio.DBusError, Gio.DBusError.NOT_SUPPORTED),
                `${method} should raise NotSupported, raised ${error}`);
            assertMatch(error.message, /M\d/, `${method} should say which milestone implements it`);
        }

        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('tasks are still there after the daemon is restarted', async () => {
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
        await stopDaemon(session);
        assert(session.exited, 'the daemon should have exited');
        assert(session.daemon.get_if_exited() && session.daemon.get_exit_status() === 0,
            `expected a clean exit, got status ${session.daemon.get_exit_status()}`);
    });
});
