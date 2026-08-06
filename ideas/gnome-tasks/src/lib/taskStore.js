// Persistence for tasks: one JSON document per task, plus a small state file for which task is
// current.
//
//   ~/.local/share/gnome-tasks/tasks/<uuid>.json
//   ~/.local/share/gnome-tasks/state.json
//
// Uses Gio but not Shell/Meta, so it runs — and is tested — under plain gjs. Only the daemon
// instantiates this; the extension never touches disk.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { createTask, parseTask, serializeTask, updateTask } from './task.js';

const STATE_FILE = 'state.json';
const TASKS_DIR = 'tasks';

function defaultDirectory() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-tasks']);
}

function writeAtomically(file, text) {
    // replace_contents with make_backup=false still goes through a temporary file and a rename,
    // which is what keeps a crash from leaving a half-written task on disk. Doing it by hand with
    // create+write+rename would only reimplement it worse.
    file.replace_contents(
        new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.NONE, null);
}

export class TaskStore {
    constructor({ directory = defaultDirectory() } = {}) {
        this._directory = directory;
        this._tasks = new Map();
        this._currentUuid = '';
        this._listeners = new Set();
        this._loaded = false;
    }

    get directory() {
        return this._directory;
    }

    get currentUuid() {
        return this._currentUuid;
    }

    /**
     * Read everything from disk. Returns an array of human-readable problems (a corrupt or
     * unreadable task file), because one bad document must not cost the user every other task —
     * but it must not be silent either.
     */
    load() {
        const problems = [];
        this._tasks.clear();
        this._currentUuid = '';

        const tasksDir = Gio.File.new_for_path(
            GLib.build_filenamev([this._directory, TASKS_DIR]));

        if (tasksDir.query_exists(null)) {
            let enumerator;
            try {
                enumerator = tasksDir.enumerate_children(
                    'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
            } catch (error) {
                problems.push(`cannot read ${tasksDir.get_path()}: ${error.message}`);
                enumerator = null;
            }

            let info;
            while (enumerator && (info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (!name.endsWith('.json'))
                    continue;

                const file = tasksDir.get_child(name);
                try {
                    const [, bytes] = file.load_contents(null);
                    const task = parseTask(new TextDecoder().decode(bytes));
                    this._tasks.set(task.uuid, task);
                } catch (error) {
                    problems.push(`ignoring ${file.get_path()}: ${error.message}`);
                }
            }
        }

        const stateFile = Gio.File.new_for_path(
            GLib.build_filenamev([this._directory, STATE_FILE]));
        if (stateFile.query_exists(null)) {
            try {
                const [, bytes] = stateFile.load_contents(null);
                const state = JSON.parse(new TextDecoder().decode(bytes));
                if (typeof state.current === 'string' && this._tasks.has(state.current))
                    this._currentUuid = state.current;
            } catch (error) {
                problems.push(`ignoring ${stateFile.get_path()}: ${error.message}`);
            }
        }

        this._loaded = true;
        return problems;
    }

    /** Tasks ordered by name, case-insensitively, so menus do not reshuffle between reads. */
    list() {
        this._ensureLoaded();
        return [...this._tasks.values()].sort(
            (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }

    get(uuid) {
        this._ensureLoaded();
        const task = this._tasks.get(uuid);
        if (!task)
            throw new Error(`no such task: ${uuid}`);
        return task;
    }

    has(uuid) {
        this._ensureLoaded();
        return this._tasks.has(uuid);
    }

    create(properties) {
        this._ensureLoaded();
        const task = createTask(properties);
        this._tasks.set(task.uuid, task);
        this._persist(task);
        this._notify('added', task.uuid);
        return task;
    }

    update(uuid, properties) {
        const updated = updateTask(this.get(uuid), properties);
        this._tasks.set(uuid, updated);
        this._persist(updated);
        this._notify('changed', uuid);
        return updated;
    }

    remove(uuid) {
        this.get(uuid); // throws if unknown
        this._tasks.delete(uuid);

        const file = this._fileFor(uuid);
        try {
            file.delete(null);
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                throw error;
        }
        this._notify('removed', uuid);

        if (this._currentUuid === uuid)
            this.setCurrent('');
    }

    /** '' means "no task is current". */
    setCurrent(uuid) {
        this._ensureLoaded();
        if (uuid !== '' && !this._tasks.has(uuid))
            throw new Error(`no such task: ${uuid}`);
        if (this._currentUuid === uuid)
            return;

        this._currentUuid = uuid;
        this._persistState();
        this._notify('current', uuid);
    }

    /**
     * Listen for changes. The callback gets (kind, uuid) where kind is one of
     * 'added' | 'changed' | 'removed' | 'current'. Returns a function that unsubscribes.
     */
    connect(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    _ensureLoaded() {
        if (!this._loaded)
            this.load();
    }

    _fileFor(uuid) {
        return Gio.File.new_for_path(
            GLib.build_filenamev([this._directory, TASKS_DIR, `${uuid}.json`]));
    }

    _persist(task) {
        const file = this._fileFor(task.uuid);
        GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700);
        writeAtomically(file, serializeTask(task));
    }

    _persistState() {
        GLib.mkdir_with_parents(this._directory, 0o700);
        writeAtomically(
            Gio.File.new_for_path(GLib.build_filenamev([this._directory, STATE_FILE])),
            `${JSON.stringify({ current: this._currentUuid }, null, 2)}\n`);
    }

    _notify(kind, uuid) {
        for (const listener of [...this._listeners]) {
            try {
                listener(kind, uuid);
            } catch (error) {
                // A broken listener must not break the store.
                logError?.(error) ?? printerr(`task store listener failed: ${error}`);
            }
        }
    }
}
