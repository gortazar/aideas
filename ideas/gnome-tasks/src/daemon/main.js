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
import { ShellClient } from './shellClient.js';
import { TasksService } from './service.js';

const loop = new GLib.MainLoop(null, false);

// Overridable so tests (and a second developer instance) never touch the real task collection.
const dataDir = GLib.getenv('GNOME_TASKS_DATA_DIR');
const store = new TaskStore(dataDir ? { directory: dataDir } : {});

for (const problem of store.load())
    printerr(`gnome-tasks-daemon: ${problem}`);

// The compositor connection is optional on purpose: the daemon must start, hold state and answer
// clients whether or not the Shell extension is loaded.
const shell = new ShellClient(() => service.onWindowsChanged());
const service = new TasksService(store, shell);
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

// Signal handling uses GLib.unix_signal_add even though glib 2.80 deprecated it in favour of
// GLibUnix.signal_add, which warns once at startup. The obvious fix — a dynamic import to prefer the
// new entry point where it exists — introduces a *top-level await*, and that quietly breaks the whole
// daemon: with a top-level await, module evaluation becomes a promise job, loop.run() then runs
// inside that job, and no queued microtask ever gets drained. The symptom is spectacular and
// mystifying: D-Bus calls go out, replies arrive, callbacks fire, and every `await` in the process
// hangs for ever. One warning line is a much better trade.
const SIGINT = 2;
const SIGTERM = 15;

function quit() {
    loop.quit();
    return GLib.SOURCE_REMOVE;
}

const addSignalHandler = (signal, handler) =>
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal, handler);

addSignalHandler(SIGTERM, quit);
addSignalHandler(SIGINT, quit);

loop.run();

service.destroy();
shell.destroy();
Gio.bus_unown_name(ownerId);
imports.system.exit(exitCode);
