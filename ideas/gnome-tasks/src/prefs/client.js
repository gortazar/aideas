// The preferences window's view of the daemon.
//
// Synchronous on purpose, unlike the extension's client. This runs in the preferences process, where
// a blocking call costs nobody a frame of the desktop, and building GTK rows from `await`ed data
// would mean either a two-phase window or a lot of ceremony. The daemon is a local process answering
// from memory.
//
// If the daemon is not running, `available` is false and every accessor returns something empty
// rather than throwing — the window then shows how to start it.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { DAEMON_NAME, DAEMON_OBJECT_PATH } from '../lib/protocol.js';
import { createCommand } from '../lib/commands.js';

const TIMEOUT_MS = 3000;

export class PrefsClient {
    constructor() {
        this._connection = Gio.DBus.session;
        this.refresh();
    }

    get available() {
        return this._available;
    }

    get tasks() {
        return this._tasks;
    }

    get captureEnabled() {
        return this._captureEnabled;
    }

    get excludedApps() {
        return this._excludedApps;
    }

    /** Re-read everything from the daemon. Cheap: a handful of local D-Bus calls. */
    refresh() {
        this._tasks = [];
        this._captureEnabled = true;
        this._excludedApps = [];
        this._available = false;

        const summaries = this._call('ListTasks', null, '(aa{sv})');
        if (!summaries)
            return;

        this._available = true;
        for (const summary of summaries[0]) {
            const uuid = summary.uuid.deepUnpack();
            // The full document, because the window shows commands and window counts too.
            const document = this._call('GetTask', new GLib.Variant('(s)', [uuid]), '(s)');
            if (!document)
                continue;
            try {
                this._tasks.push(JSON.parse(document[0]));
            } catch {
                // A task the daemon cannot serialise is the daemon's problem to report, not ours.
            }
        }

        this._captureEnabled = this._getProperty('CaptureEnabled') ?? true;
        this._excludedApps = this._getProperty('ExcludedApps') ?? [];
    }

    createTask(name, icon = '') {
        this._call('CreateTask', new GLib.Variant('(ss)', [name, icon]), '(s)');
    }

    deleteTask(uuid) {
        this._call('DeleteTask', new GLib.Variant('(s)', [uuid]), null);
    }

    /**
     * `properties` is a plain object; values are packed by type. `commands` is the one structured
     * property, and it goes as an array of dictionaries.
     */
    setTaskProperties(uuid, properties) {
        const packed = {};

        for (const [key, value] of Object.entries(properties)) {
            if (key === 'commands') {
                packed.commands = new GLib.Variant('aa{sv}', value.map(packCommand));
            } else if (typeof value === 'boolean') {
                packed[key] = GLib.Variant.new_boolean(value);
            } else {
                packed[key] = GLib.Variant.new_string(String(value));
            }
        }

        this._call('SetTaskProperties',
            new GLib.Variant('(sa{sv})', [uuid, packed]), null);
    }

    /** Add a command to a task. It starts unconfirmed, so it cannot run until the user allows it. */
    addCommand(uuid, commandLine, label = '') {
        const task = this._tasks.find(candidate => candidate.uuid === uuid);
        const existing = task?.commands ?? [];
        const command = createCommand({ commandLine, label });
        this.setTaskProperties(uuid, { commands: [...existing, command] });
    }

    /**
     * Drop one remembered window from a task's layout.
     *
     * A dedicated call rather than writing the whole `apps` array back: a layout entry is a nested
     * structure that has already grown twice, and handing the client the job of reassembling it
     * correctly is a good way to lose a field.
     */
    forgetWindow(uuid, index) {
        this._call('ForgetWindow', new GLib.Variant('(su)', [uuid, index]), null);
    }

    /** Capture the desktop into a task now. Silently does nothing without the Shell extension. */
    captureNow(uuid) {
        this._call('CaptureNow', new GLib.Variant('(s)', [uuid]), null);
    }

    confirmCommand(taskUuid, commandId, confirmed) {
        this._call('ConfirmCommand',
            new GLib.Variant('(ssb)', [taskUuid, commandId, confirmed]), null);
    }

    setCaptureEnabled(enabled) {
        this._setProperty('CaptureEnabled', GLib.Variant.new_boolean(enabled));
        this._captureEnabled = enabled;
    }

    setExcludedApps(appIds) {
        this._setProperty('ExcludedApps', new GLib.Variant('as', appIds));
        this._excludedApps = [...appIds];
    }

    // --- internals -------------------------------------------------------------------------

    _call(method, parameters, replyType) {
        try {
            return this._connection.call_sync(
                DAEMON_NAME, DAEMON_OBJECT_PATH, DAEMON_NAME, method, parameters,
                replyType ? new GLib.VariantType(replyType) : null,
                Gio.DBusCallFlags.NONE, TIMEOUT_MS, null)?.deepUnpack();
        } catch (error) {
            // An absent daemon is an expected state, not an exception to propagate into GTK.
            console.warn(`gnome-tasks prefs: ${method} failed: ${error.message}`);
            return null;
        }
    }

    _getProperty(name) {
        const reply = this._callOn('org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [DAEMON_NAME, name]), '(v)');
        return reply ? reply[0].recursiveUnpack() : null;
    }

    _setProperty(name, value) {
        this._callOn('org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', [DAEMON_NAME, name, value]), null);
    }

    /** Like _call, but on another interface of the same object — the properties interface. */
    _callOn(iface, method, parameters, replyType) {
        try {
            return this._connection.call_sync(
                DAEMON_NAME, DAEMON_OBJECT_PATH, iface, method, parameters,
                replyType ? new GLib.VariantType(replyType) : null,
                Gio.DBusCallFlags.NONE, TIMEOUT_MS, null)?.deepUnpack();
        } catch (error) {
            console.warn(`gnome-tasks prefs: ${iface}.${method} failed: ${error.message}`);
            return null;
        }
    }
}

function packCommand(command) {
    return {
        id: GLib.Variant.new_string(command.id),
        commandLine: GLib.Variant.new_string(command.commandLine),
        label: GLib.Variant.new_string(command.label ?? command.commandLine),
        workingDirectory: GLib.Variant.new_string(command.workingDirectory ?? ''),
        enabled: GLib.Variant.new_boolean(command.enabled !== false),
        confirmed: GLib.Variant.new_boolean(Boolean(command.confirmed)),
    };
}
