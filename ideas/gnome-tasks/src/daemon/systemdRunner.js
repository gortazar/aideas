// Running a task's commands as transient systemd user units.
//
// Why systemd rather than spawning children directly, as PLAN.md sets out: each command gets its own
// cgroup, its output lands in the journal, nothing is orphaned when the daemon or the Shell restarts,
// and stopping a task reliably stops everything the command spawned — a `docker compose up` that
// forks is still contained.
//
// A *scope* holds processes we started ourselves, so the daemon forks the process and then hands the
// pid to systemd to adopt. That keeps the failure modes simple: if systemd is unavailable the command
// still runs, and the daemon says so, rather than the feature silently doing nothing.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { parseCommandLine, unitNameFor } from '../lib/commands.js';

const SYSTEMD_NAME = 'org.freedesktop.systemd1';
const SYSTEMD_PATH = '/org/freedesktop/systemd1';
const SYSTEMD_MANAGER = 'org.freedesktop.systemd1.Manager';

function callAsync(name, path, iface, method, parameters, replyType, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            name, path, iface, method, parameters,
            replyType ? new GLib.VariantType(replyType) : null,
            Gio.DBusCallFlags.NONE, timeoutMs, null,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

export class SystemdRunner {
    constructor() {
        // Unit name -> { taskUuid, commandId, pid }, so a task's commands can be stopped again.
        this._running = new Map();
    }

    /** Units this runner started and has not stopped. */
    get running() {
        return [...this._running.entries()].map(([unit, info]) => ({ unit, ...info }));
    }

    unitsForTask(taskUuid) {
        return this.running.filter(entry => entry.taskUuid === taskUuid);
    }

    /**
     * Start one command for a task. Resolves to `{ unit, pid, adopted }` — `adopted` says whether
     * systemd took the process into a scope, which is false when systemd is not on the bus (the
     * command still runs).
     */
    async start(taskUuid, command) {
        const argv = parseCommandLine(command.commandLine);
        if (argv.length === 0)
            throw new Error('the command line is empty');

        const unit = unitNameFor(taskUuid, command.id);
        if (this._running.has(unit))
            return { unit, pid: this._running.get(unit).pid, adopted: true, alreadyRunning: true };

        const workingDirectory = command.workingDirectory || GLib.get_home_dir();

        // DO_NOT_REAP_CHILD so the pid stays valid long enough for systemd to adopt it, and so the
        // daemon can watch for the command exiting.
        const [, pid] = GLib.spawn_async(
            workingDirectory, argv, null,
            GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD, null);

        let adopted = false;
        try {
            await this._startTransientScope(unit, taskUuid, command, pid);
            adopted = true;
        } catch (error) {
            // Not fatal: the command is running, it just is not in a cgroup of its own.
            printerr(`gnome-tasks-daemon: could not put ${command.label} in a systemd scope: ` +
                `${error.message}`);
        }

        this._running.set(unit, { taskUuid, commandId: command.id, pid, adopted });
        GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, (watchedPid, status) => {
            GLib.spawn_close_pid(watchedPid);
            this._running.delete(unit);
            void status;
        });

        return { unit, pid, adopted };
    }

    /** Stop every command belonging to a task. Resolves to the units it stopped. */
    async stopTask(taskUuid) {
        const stopped = [];

        for (const entry of this.unitsForTask(taskUuid)) {
            try {
                await this.stopUnit(entry.unit);
                stopped.push(entry.unit);
            } catch (error) {
                printerr(`gnome-tasks-daemon: could not stop ${entry.unit}: ${error.message}`);
            }
        }

        return stopped;
    }

    async stopUnit(unit) {
        const entry = this._running.get(unit);
        this._running.delete(unit);

        try {
            await callAsync(SYSTEMD_NAME, SYSTEMD_PATH, SYSTEMD_MANAGER, 'StopUnit',
                new GLib.Variant('(ss)', [unit, 'replace']), '(o)');
            return;
        } catch (error) {
            // No systemd, or the scope is already gone. Fall back to signalling the process, which is
            // the only handle left.
            if (entry?.pid) {
                try {
                    // SIGTERM: the same politeness the window path uses.
                    GLib.spawn_command_line_async(`kill -TERM ${entry.pid}`);
                    return;
                } catch {
                    // nothing else to try
                }
            }
            throw error;
        }
    }

    /**
     * StartTransientUnit with a Scope that adopts an existing pid. The property names and the odd
     * nested-variant signature are systemd's, not ours.
     */
    async _startTransientScope(unit, taskUuid, command, pid) {
        // The a(sv) has to be a *plain array* here, not a ready-made GLib.Variant: handing the tuple
        // constructor a finished variant for a nested container silently produces an empty one, so
        // systemd would receive a scope with no properties at all — no pid to adopt, no description.
        // Only the `v` values themselves are variants.
        const properties = [
            ['Description', new GLib.Variant('s',
                `gnome-tasks: ${command.label} (task ${taskUuid})`)],
            ['PIDs', new GLib.Variant('au', [pid])],
            // Kill the whole cgroup when the scope stops, which is the entire point of using one.
            ['KillMode', new GLib.Variant('s', 'mixed')],
            ['Slice', new GLib.Variant('s', 'app.slice')],
            ['CollectMode', new GLib.Variant('s', 'inactive-or-failed')],
        ];

        await callAsync(
            SYSTEMD_NAME, SYSTEMD_PATH, SYSTEMD_MANAGER, 'StartTransientUnit',
            new GLib.Variant('(ssa(sv)a(sa(sv)))', [unit, 'fail', properties, []]),
            '(o)');
    }
}
