#!/usr/bin/env -S gjs -m
// gnome-tasks-daemon: owns org.gnome.Tasks and all task state.
//
// Everything expensive or risky lives here rather than in the Shell extension — spawning
// processes, reading /proc, writing state files, talking to browsers — because the extension runs
// inside the compositor, where a hang is a frozen desktop and a crash is a lost session.
//
// Run it directly for development:
//
//   gjs -m src/daemon/main.js
//   GNOME_TASKS_DATA_DIR=/tmp/gt gjs -m src/daemon/main.js   # isolated state
//
// or as the installed user service (`make install-daemon`; see data/gnome-tasks-daemon.service.in).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { DAEMON_NAME } from '../lib/protocol.js';
import { TaskStore } from '../lib/taskStore.js';
import { TasksService } from './service.js';

const loop = new GLib.MainLoop(null, false);

// Overridable so tests (and a second developer instance) never touch the real task collection.
const dataDir = GLib.getenv('GNOME_TASKS_DATA_DIR');
const store = new TaskStore(dataDir ? { directory: dataDir } : {});

for (const problem of store.load())
    printerr(`gnome-tasks-daemon: ${problem}`);

const service = new TasksService(store);
let exitCode = 0;

const ownerId = Gio.bus_own_name(
    Gio.BusType.SESSION,
    DAEMON_NAME,
    Gio.BusNameOwnerFlags.NONE,
    connection => service.export(connection),
    () => print(`gnome-tasks-daemon: owning ${DAEMON_NAME}, ${store.list().length} task(s)`),
    () => {
        // Either another daemon already owns the name, or ours was taken away. Either way this
        // process has nothing left to do, and exiting beats two daemons writing the same files.
        printerr(`gnome-tasks-daemon: could not own ${DAEMON_NAME}; is another instance running?`);
        exitCode = 1;
        loop.quit();
    });

function quit() {
    loop.quit();
    return GLib.SOURCE_REMOVE;
}

// glib 2.80 moved the unix helpers into their own typelib and warns (with a stack trace) when the
// old entry point is used. Prefer the new one where it exists so the journal stays readable.
const SIGINT = 2;
const SIGTERM = 15;
let addSignalHandler = (signal, handler) =>
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal, handler);
try {
    // The typelib exists from glib 2.80 but does not always expose signal_add, so check for the
    // function rather than for the import.
    const GLibUnix = (await import('gi://GLibUnix')).default;
    if (typeof GLibUnix?.signal_add === 'function') {
        addSignalHandler = (signal, handler) =>
            GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signal, handler);
    }
} catch {
    // older glib: the GLib entry point is the only one there is
}

addSignalHandler(SIGTERM, quit);
addSignalHandler(SIGINT, quit);

loop.run();

service.destroy();
Gio.bus_unown_name(ownerId);
imports.system.exit(exitCode);
