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
    TaskState,
} from '../lib/protocol.js';
import { serializeTask, summarizeTask } from '../lib/task.js';

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
    constructor(store) {
        this._store = store;
        this._captureEnabled = true;

        this._impl = Gio.DBusExportedObject.wrapJSObject(DAEMON_IFACE_XML, this);

        this._disconnectStore = store.connect((kind, uuid) => this._onStoreChanged(kind, uuid));
    }

    export(connection) {
        this._impl.export(connection, DAEMON_OBJECT_PATH);
    }

    destroy() {
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

        // M2 restores the task's applications here, and M3 their placement. For now activation
        // is bookkeeping only: it records which task the user is in, which is what the switcher
        // and every capture decision keys off.
        this._store.setCurrent(uuid);
        task.state = TaskState.ACTIVE;
        this._impl.emit_signal('TaskStateChanged',
            new GLib.Variant('(su)', [uuid, task.state]));
    }

    StopTask(uuid) {
        const task = this._task(uuid);

        task.state = TaskState.STOPPED;
        if (this._store.currentUuid === uuid)
            this._store.setCurrent('');
        this._impl.emit_signal('TaskStateChanged',
            new GLib.Variant('(su)', [uuid, task.state]));
    }

    CaptureNow(uuid) {
        this._task(uuid);
        throw notSupported(
            'session capture is not implemented yet; it needs org.gnome.Tasks.Shell (M3)');
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
