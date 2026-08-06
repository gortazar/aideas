// The org.gnome.Tasks implementation.
//
// This is the only place that knows about D-Bus types; everything below it (task.js,
// taskStore.js) is plain JavaScript, and everything above it (the extension, the preferences
// window) is a client. Methods that need the compositor are wired to org.gnome.Tasks.Shell in
// M3; until then they say so with a D-Bus error rather than pretending to work.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    API_VERSION,
    DAEMON_IFACE_XML,
    DAEMON_OBJECT_PATH,
    DeactivatePolicy,
    TaskState,
} from '../lib/protocol.js';
import { serializeTask, summarizeTask } from '../lib/task.js';
import { layoutFromWindows, restorePlan, sameLayout } from '../lib/layout.js';
import { documentsFor } from '../lib/adapters/index.js';
import { commandsToStart } from '../lib/commands.js';
import { readProcessInfo } from './procReader.js';
import { SystemdRunner } from './systemdRunner.js';

/**
 * How long to wait after the compositor reports a change before saving. Window drags and workspace
 * switches arrive in bursts; the extension already coalesces its signals, and this stops a burst
 * from becoming a burst of writes.
 */
const CAPTURE_DEBOUNCE_MS = 2000;

/** D-Bus property/dict keys are kebab-case; the model is camelCase. */
const PROPERTY_KEYS = {
    'name': 'name',
    'icon': 'icon',
    'description': 'description',
    'deactivate-policy': 'deactivatePolicy',
    'apps': 'apps',
    'commands': 'commands',
};

function dbusError(code, message) {
    return new GLib.Error(Gio.DBusError, code, message);
}

function notSupported(message) {
    return dbusError(Gio.DBusError.NOT_SUPPORTED, message);
}

/** Wrap a plain value as the GLib.Variant an a{sv} entry needs. */
function toVariant(value) {
    if (value instanceof GLib.Variant)
        return value;
    switch (typeof value) {
        case 'string':
            return GLib.Variant.new_string(value);
        case 'boolean':
            return GLib.Variant.new_boolean(value);
        case 'number':
            return Number.isInteger(value) && value >= 0
                ? GLib.Variant.new_uint32(value)
                : GLib.Variant.new_double(value);
        default:
            throw new Error(`cannot put ${typeof value} on the bus`);
    }
}

function dictToVariants(object) {
    const out = {};
    for (const [key, value] of Object.entries(object))
        out[key] = toVariant(value);
    return out;
}

export class TasksService {
    constructor(store, shell = null, runner = new SystemdRunner()) {
        this._store = store;
        this._shell = shell;
        this._runner = runner;
        this._captureEnabled = true;
        this._captureTimeoutId = 0;
        // Set while restore is running, so the windows restore itself creates are not immediately
        // captured back into the task — which would fight with what the user actually had.
        this._restoring = false;

        this._impl = Gio.DBusExportedObject.wrapJSObject(DAEMON_IFACE_XML, this);

        this._disconnectStore = store.connect((kind, uuid) => this._onStoreChanged(kind, uuid));
    }

    /** Called by the daemon when the compositor reports that windows changed. */
    onWindowsChanged() {
        if (!this._captureEnabled || this._restoring || this._store.currentUuid === '')
            return;

        if (this._captureTimeoutId)
            GLib.source_remove(this._captureTimeoutId);

        this._captureTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT_IDLE, CAPTURE_DEBOUNCE_MS, () => {
                this._captureTimeoutId = 0;
                this._captureCurrentTask().catch(
                    error => printerr(`gnome-tasks-daemon: capture failed: ${error.message}`));
                return GLib.SOURCE_REMOVE;
            });
    }

    export(connection) {
        this._impl.export(connection, DAEMON_OBJECT_PATH);
    }

    destroy() {
        if (this._captureTimeoutId) {
            GLib.source_remove(this._captureTimeoutId);
            this._captureTimeoutId = 0;
        }
        this._disconnectStore?.();
        this._impl.unexport();
    }

    // --- methods ---------------------------------------------------------------------------

    Ping(message) {
        return `gnome-tasks/${API_VERSION} ${message}`;
    }

    ListTasks() {
        return this._store.list().map(task => dictToVariants(summarizeTask(task)));
    }

    GetTask(uuid) {
        return serializeTask(this._task(uuid));
    }

    CreateTask(name, icon) {
        try {
            return this._store.create({ name, icon }).uuid;
        } catch (error) {
            throw dbusError(Gio.DBusError.INVALID_ARGS, error.message);
        }
    }

    SetTaskProperties(uuid, properties) {
        this._task(uuid);

        const changes = {};
        for (const [key, variant] of Object.entries(properties)) {
            const modelKey = PROPERTY_KEYS[key];
            if (!modelKey)
                throw dbusError(Gio.DBusError.INVALID_ARGS, `unknown task property: ${key}`);
            changes[modelKey] = variant.recursiveUnpack();
        }

        try {
            this._store.update(uuid, changes);
        } catch (error) {
            throw dbusError(Gio.DBusError.INVALID_ARGS, error.message);
        }
    }

    DeleteTask(uuid) {
        this._task(uuid);
        this._store.remove(uuid);
    }

    ActivateTask(uuid) {
        const task = this._task(uuid);
        const outgoingUuid = this._store.currentUuid;

        if (outgoingUuid === uuid)
            return;

        // Save what the outgoing task looks like *before* anything moves, or switching away loses
        // the arrangement the user just had.
        this._switchTasks(outgoingUuid, task).catch(
            error => printerr(`gnome-tasks-daemon: activation failed: ${error.message}`));
    }

    StopTask(uuid) {
        const task = this._task(uuid);

        this._runner.stopTask(uuid).catch(
            error => printerr(`gnome-tasks-daemon: ${error.message}`));

        task.state = TaskState.STOPPED;
        if (this._store.currentUuid === uuid)
            this._store.setCurrent('');
        this._impl.emit_signal('TaskStateChanged',
            new GLib.Variant('(su)', [uuid, task.state]));
    }

    CaptureNow(uuid) {
        const task = this._task(uuid);

        if (!this._shell?.available) {
            throw notSupported(
                'no compositor connection: capture needs the gnome-tasks Shell extension to be ' +
                'loaded and owning org.gnome.Tasks.Shell');
        }

        // Synchronous from the caller's point of view is not possible — reading the window list is a
        // D-Bus round trip — but errors are reported through the log rather than swallowed.
        this._capture(task).catch(
            error => printerr(`gnome-tasks-daemon: capture failed: ${error.message}`));
    }

    ConfirmCommand(taskUuid, commandId, confirmed) {
        const task = this._task(taskUuid);
        const commands = (task.commands ?? []).map(command =>
            command.id === commandId ? { ...command, confirmed } : command);

        if (!commands.some(command => command.id === commandId)) {
            throw dbusError(Gio.DBusError.INVALID_ARGS,
                `task ${taskUuid} has no command ${commandId}`);
        }

        this._store.update(taskUuid, { commands });

        // Confirming a command while its task is already current is the natural moment to start it.
        if (confirmed && this._store.currentUuid === taskUuid) {
            this._startCommands(this._store.get(taskUuid)).catch(
                error => printerr(`gnome-tasks-daemon: ${error.message}`));
        }
    }

    ListRunningCommands(taskUuid) {
        this._task(taskUuid);
        return JSON.stringify({ commands: this._runner.unitsForTask(taskUuid) });
    }

    ReportAppState(adapterId, json) {
        throw notSupported(
            `no adapter is registered for ${adapterId}; tier-2 app state lands in M6`);
    }

    // --- properties ------------------------------------------------------------------------

    get ApiVersion() {
        return API_VERSION;
    }

    get CurrentTask() {
        return this._store.currentUuid;
    }

    get CaptureEnabled() {
        return this._captureEnabled;
    }

    set CaptureEnabled(value) {
        if (this._captureEnabled === value)
            return;
        this._captureEnabled = value;
        this._impl.emit_property_changed('CaptureEnabled', GLib.Variant.new_boolean(value));
    }

    // --- capture and restore ---------------------------------------------------------------

    async _captureCurrentTask() {
        const uuid = this._store.currentUuid;
        if (uuid === '' || !this._store.has(uuid))
            return;
        await this._capture(this._store.get(uuid));
    }

    /** Record what the desktop looks like into `task`, if it changed. */
    async _capture(task) {
        if (!this._shell)
            return;

        const windows = await this._shell.listWindows();
        const layout = layoutFromWindows(windows, { documents: window => this._documentsFor(window) });

        if (sameLayout(layout, task.apps ?? []))
            return;

        this._store.update(task.uuid, { apps: layout });
    }

    /**
     * What document this window is showing, as far as anything outside the application can tell.
     * Reading /proc happens here, in the daemon, and never in the compositor.
     */
    _documentsFor(record) {
        const info = readProcessInfo(record.pid);
        if (!info)
            return [];

        // The adapters ask about paths they derive themselves (a terminal's title names a directory
        // that appears in no file descriptor), so they get a live check rather than a fixed list.
        return documentsFor(record, {
            ...info,
            exists: path => GLib.file_test(path, GLib.FileTest.EXISTS),
        });
    }

    async _switchTasks(outgoingUuid, incoming) {
        if (outgoingUuid !== '' && this._store.has(outgoingUuid)) {
            const outgoing = this._store.get(outgoingUuid);
            await this._capture(outgoing);
            await this._deactivate(outgoing);
        }

        this._store.setCurrent(incoming.uuid);
        incoming.state = TaskState.ACTIVE;
        this._impl.emit_signal('TaskStateChanged',
            new GLib.Variant('(su)', [incoming.uuid, incoming.state]));

        await this._restore(incoming);
        await this._startCommands(this._store.get(incoming.uuid));
    }

    /**
     * Start the task's confirmed commands, and ask about the rest. Nothing unconfirmed is ever run —
     * the request goes out as a signal and the answer comes back through ConfirmCommand.
     */
    async _startCommands(task) {
        const { start, needConfirmation, invalid } = commandsToStart(task.commands);

        for (const command of start) {
            try {
                const result = await this._runner.start(task.uuid, command);
                if (!result.alreadyRunning) {
                    print(`gnome-tasks-daemon: started "${command.label}" for ${task.name} ` +
                        `as ${result.unit}${result.adopted ? '' : ' (no systemd scope)'}`);
                }
            } catch (error) {
                printerr(`gnome-tasks-daemon: could not start "${command.label}": ${error.message}`);
            }
        }

        for (const command of invalid)
            printerr(`gnome-tasks-daemon: skipping "${command.label}": ${command.problem}`);

        if (needConfirmation.length > 0) {
            this._impl.emit_signal('CommandsAwaitingConfirmation', new GLib.Variant('(ss)', [
                task.uuid,
                JSON.stringify({ commands: needConfirmation.map(
                    ({ id, label, commandLine, workingDirectory }) =>
                        ({ id, label, commandLine, workingDirectory })) }),
            ]));
        }
    }

    /** Apply a task's deactivation policy to the windows it owns. */
    async _deactivate(task) {
        // Commands stop whenever the task stops being current, regardless of the window policy: a
        // task that is not current should not be holding a port open. A task meant to keep running
        // uses the 'leave' policy for its *windows*; its commands are still its own lifecycle.
        await this._runner.stopTask(task.uuid);

        if (!this._shell)
            return;

        switch (task.deactivatePolicy) {
            case DeactivatePolicy.LEAVE:
                return;

            case DeactivatePolicy.CLOSE: {
                const appIds = new Set((task.apps ?? []).map(entry => entry.appId));
                const windows = await this._shell.listWindows();
                for (const window of windows) {
                    if (appIds.has(window.appId))
                        await this._shell.closeWindow(window.id);
                }
                return;
            }

            case DeactivatePolicy.HIDE:
            default:
                // Parking windows out of sight needs a workspace policy that does not exist yet; see
                // docs/limitations.md. Saying so is better than quietly doing nothing that looks
                // like a bug.
                printerr('gnome-tasks-daemon: the \'hide\' deactivation policy is not implemented ' +
                    `yet; leaving ${task.name}'s windows where they are`);
        }
    }

    /** Launch and place whatever `task` remembers. */
    async _restore(task) {
        if (!this._shell || (task.apps ?? []).length === 0)
            return;

        this._restoring = true;
        try {
            const windows = await this._shell.listWindows();
            const plan = restorePlan(task.apps, windows);

            for (const place of plan.places)
                await this._shell.placeWindow(place.windowId, place.placement);

            for (const launch of plan.launches)
                await this._shell.launchApp(launch.appId, launch.uris, launch.placement);
        } finally {
            this._restoring = false;
        }
    }

    // --- internals -------------------------------------------------------------------------

    _task(uuid) {
        try {
            return this._store.get(uuid);
        } catch (error) {
            throw dbusError(Gio.DBusError.INVALID_ARGS, error.message);
        }
    }

    _onStoreChanged(kind, uuid) {
        switch (kind) {
            case 'added':
                this._impl.emit_signal('TaskAdded', new GLib.Variant('(s)', [uuid]));
                break;
            case 'changed':
                this._impl.emit_signal('TaskChanged', new GLib.Variant('(s)', [uuid]));
                break;
            case 'removed':
                this._impl.emit_signal('TaskRemoved', new GLib.Variant('(s)', [uuid]));
                break;
            case 'current':
                this._impl.emit_signal('CurrentTaskChanged', new GLib.Variant('(s)', [uuid]));
                this._impl.emit_property_changed('CurrentTask', GLib.Variant.new_string(uuid));
                break;
        }
    }
}
