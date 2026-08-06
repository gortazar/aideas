// Per-task commands, end to end over D-Bus, against a fake systemd on the test's private bus.
//
// The commands really are spawned — they are `sleep`s and `touch`es, so the test can see that they
// ran — but the systemd calls go to a stand-in, so nothing lands in the developer's real user
// manager and the assertions can be exact.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertEquals, assertMatch } from '../harness.js';
import { call, recordSignals, sleep, startDaemon, stopDaemon } from './helpers.js';
import { FakeSystemd } from './fakeSystemd.js';

const systemd = new FakeSystemd();
await systemd.export();

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

/** Commands cross the bus as part of the task document, so they are set as an a{sv} of variants. */
async function setCommands(uuid, commands) {
    await call('SetTaskProperties', new GLib.Variant('(sa{sv})', [
        uuid,
        {
            commands: new GLib.Variant('aa{sv}', commands.map(command => ({
                id: GLib.Variant.new_string(command.id),
                commandLine: GLib.Variant.new_string(command.commandLine),
                label: GLib.Variant.new_string(command.label ?? command.commandLine),
                workingDirectory: GLib.Variant.new_string(command.workingDirectory ?? ''),
                enabled: GLib.Variant.new_boolean(command.enabled ?? true),
                confirmed: GLib.Variant.new_boolean(command.confirmed ?? false),
            }))),
        },
    ]));
}

async function taskDocument(uuid) {
    const [json] = await call('GetTask', new GLib.Variant('(s)', [uuid]), '(s)');
    return JSON.parse(json);
}

async function runningCommands(uuid) {
    const [json] = await call('ListRunningCommands', new GLib.Variant('(s)', [uuid]), '(s)');
    return JSON.parse(json).commands;
}

function scratchFile(name) {
    return GLib.build_filenamev([GLib.get_tmp_dir(), `gnome-tasks-test-${name}`]);
}

suite('commands', () => {
    // The rule from PLAN.md: a stored command is shown before it is ever run.
    test('an unconfirmed command is not run, and the daemon asks about it', async () => {
        const uuid = await createTask('Unconfirmed');
        const marker = scratchFile('must-not-run');
        GLib.unlink(marker);

        await setCommands(uuid, [{
            id: 'cmd-1',
            commandLine: `touch ${marker}`,
            label: 'should not run',
            confirmed: false,
        }]);

        const signals = await recordSignals(
            () => call('ActivateTask', new GLib.Variant('(s)', [uuid])),
            { settleMs: 1500 });

        assert(!GLib.file_test(marker, GLib.FileTest.EXISTS),
            'an unconfirmed command must not have been executed');

        const asked = signals.find(([name]) => name === 'CommandsAwaitingConfirmation');
        assert(asked, `expected CommandsAwaitingConfirmation, got ${signals.map(s => s[0])}`);
        assertEquals(asked[1][0], uuid);
        const payload = JSON.parse(asked[1][1]);
        assertEquals(payload.commands.length, 1);
        assertEquals(payload.commands[0].label, 'should not run');

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('confirming a command starts it, in a transient scope', async () => {
        const uuid = await createTask('Confirmed');
        const marker = scratchFile('did-run');
        GLib.unlink(marker);
        systemd.reset();

        await setCommands(uuid, [{
            id: 'cmd-2',
            commandLine: `touch ${marker}`,
            label: 'a marker',
            confirmed: true,
        }]);

        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(1500);

        assert(GLib.file_test(marker, GLib.FileTest.EXISTS),
            'a confirmed command should have run');

        const started = systemd.callsTo('StartTransientUnit');
        assertEquals(started.length, 1);
        assertMatch(started[0].unit, /^gnome-tasks-.*\.scope$/);
        assert(started[0].properties.includes('PIDs'),
            'the scope should adopt the process we spawned');
        assert(started[0].properties.includes('Description'),
            'the journal needs a description');

        GLib.unlink(marker);
        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('ConfirmCommand persists the answer and starts the command', async () => {
        const uuid = await createTask('Confirm later');
        const marker = scratchFile('confirmed-later');
        GLib.unlink(marker);
        systemd.reset();

        await setCommands(uuid, [{
            id: 'cmd-3', commandLine: `touch ${marker}`, label: 'later', confirmed: false,
        }]);
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(800);
        assert(!GLib.file_test(marker, GLib.FileTest.EXISTS), 'not yet');

        await call('ConfirmCommand',
            new GLib.Variant('(ssb)', [uuid, 'cmd-3', true]));
        await sleep(1500);

        assert(GLib.file_test(marker, GLib.FileTest.EXISTS),
            'confirming while the task is current should start it');
        assertEquals((await taskDocument(uuid)).commands[0].confirmed, true,
            'the confirmation is remembered, so it is not asked again');

        GLib.unlink(marker);
        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('switching away stops the task\'s commands', async () => {
        const uuid = await createTask('Long running');
        const other = await createTask('Somewhere else');
        systemd.reset();

        await setCommands(uuid, [{
            id: 'cmd-4', commandLine: 'sleep 120', label: 'a long sleep', confirmed: true,
        }]);

        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(1500);
        assertEquals((await runningCommands(uuid)).length, 1);

        await call('ActivateTask', new GLib.Variant('(s)', [other]));
        await sleep(1500);

        assertEquals((await runningCommands(uuid)).length, 0,
            'the command should no longer be tracked');
        const stopped = systemd.callsTo('StopUnit');
        assertEquals(stopped.length, 1);
        assertMatch(stopped[0].unit, /^gnome-tasks-.*\.scope$/);

        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [other]));
    });

    test('a command with an unrunnable command line is skipped, not fatal', async () => {
        const uuid = await createTask('Broken command');
        systemd.reset();

        await setCommands(uuid, [
            { id: 'cmd-5', commandLine: 'ssh -L "unbalanced', label: 'broken', confirmed: true },
            { id: 'cmd-6', commandLine: 'sleep 60', label: 'fine', confirmed: true },
        ]);

        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(1500);

        assertEquals((await runningCommands(uuid)).length, 1,
            'the good command should still have started');

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('a disabled command is neither run nor asked about', async () => {
        const uuid = await createTask('Disabled command');
        const marker = scratchFile('disabled');
        GLib.unlink(marker);

        await setCommands(uuid, [{
            id: 'cmd-7', commandLine: `touch ${marker}`, label: 'off',
            confirmed: true, enabled: false,
        }]);

        const signals = await recordSignals(
            () => call('ActivateTask', new GLib.Variant('(s)', [uuid])), { settleMs: 1200 });

        assert(!GLib.file_test(marker, GLib.FileTest.EXISTS));
        assert(!signals.some(([name]) => name === 'CommandsAwaitingConfirmation'));

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('ConfirmCommand rejects an unknown command', async () => {
        const uuid = await createTask('No such command');
        let error = null;
        try {
            await call('ConfirmCommand', new GLib.Variant('(ssb)', [uuid, 'nope', true]));
        } catch (thrown) {
            error = thrown;
        }

        assert(error !== null, 'expected an error');
        Gio.DBusError.strip_remote_error(error);
        assertMatch(error.message, /no command/);

        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });
});

suite('commands teardown', () => {
    test('the daemon and the fake systemd shut down cleanly', async () => {
        await stopDaemon(await daemon());
        assert(session.exited, 'the daemon should have exited');
        systemd.destroy();
    });
});
