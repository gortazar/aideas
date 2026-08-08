// gnome-tasks, Shell side.
//
// Three responsibilities, and nothing else:
//   1. the top-bar switcher (indicator.js)
//   2. org.gnome.Tasks.Shell, so the daemon can ask about windows (shellService.js)
//   3. forwarding window events to the daemon, coalesced
//
// No state, no disk, no subprocesses. Everything that could block or crash lives in the daemon,
// because this code runs inside the compositor.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { DaemonClient } from './daemonClient.js';
import { MonitorConnectors } from './monitors.js';
import { ShellService } from './shellService.js';
import { TasksIndicator } from './indicator.js';

// A window has no app identity when it first appears (docs/gnome-internals.md), so a launch cannot
// be matched at window-created. Matching is therefore driven by the signals that mean "this window
// just learned what it is", with a few timers as a backstop for anything that changes without
// notifying.
const MATCH_ATTEMPT_DELAYS_MS = [0, 250, 1000, 3000];

// Signals after which a window may have become identifiable.
const IDENTITY_SIGNALS = [
    'notify::wm-class',
    'notify::title',
    'notify::gtk-window-object-path',
];

// Per-window signals that mean "the layout of this window changed". notify::title is here because
// the title is a document hint for tier-1 adapters, not for cosmetic reasons.
const WINDOW_SIGNALS = [
    'workspace-changed',
    'position-changed',
    'size-changed',
    'notify::title',
    'notify::maximized-horizontally',
    'notify::maximized-vertically',
    'notify::fullscreen',
    'notify::gtk-window-object-path',
];

export default class GnomeTasksExtension extends Extension {
    enable() {
        this._signals = [];
        this._windowSignals = new Map();
        this._matchTimeouts = new Set();
        this._matchedWindows = new WeakSet();
        // Accelerator action id -> task uuid, for the per-task shortcuts.
        this._taskAccelerators = new Map();

        this._monitors = new MonitorConnectors();
        this._monitors.refresh();

        this._shellService = new ShellService({ monitors: this._monitors });
        this._shellService.export();

        this._client = new DaemonClient(() => this._onDaemonChanged());
        this._indicator = new TasksIndicator(this._client, {
            onOpenPreferences: () => this.openPreferences(),
        });
        Main.panel.addToStatusArea('gnome-tasks', this._indicator, 0, 'right');

        this._connect(global.display, 'window-created', (display, window) => {
            this._watchWindow(window);
            this._scheduleLaunchMatch(window);
            this._shellService.queueWindowsChanged();
        });
        this._connect(Shell.AppSystem.get_default(), 'app-state-changed',
            () => this._shellService.queueWindowsChanged());
        this._connect(global.workspace_manager, 'workspace-switched',
            () => this._shellService.queueWindowsChanged());
        this._connect(Main.layoutManager, 'monitors-changed', () => {
            this._monitors.refresh();
            this._shellService.queueWindowsChanged();
        });

        for (const actor of global.get_window_actors())
            this._watchWindow(actor.meta_window);

        this._addKeybindings();
    }

    disable() {
        for (const name of ['cycle-tasks', 'cycle-tasks-backward'])
            Main.wm.removeKeybinding(name);

        for (const action of this._taskAccelerators.keys())
            global.display.ungrab_accelerator(action);
        this._taskAccelerators.clear();
        if (this._acceleratorSignal) {
            global.display.disconnect(this._acceleratorSignal);
            this._acceleratorSignal = 0;
        }

        for (const id of this._matchTimeouts)
            GLib.source_remove(id);
        this._matchTimeouts.clear();

        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];

        for (const [window, ids] of this._windowSignals) {
            for (const id of ids) {
                try {
                    window.disconnect(id);
                } catch {
                    // the window is already gone; its signals went with it
                }
            }
        }
        this._windowSignals.clear();

        this._indicator?.destroy();
        this._indicator = null;

        this._client?.destroy();
        this._client = null;

        this._shellService?.destroy();
        this._shellService = null;

        this._monitors?.destroy();
        this._monitors = null;
    }

    /**
     * Try to match a new window to a launch we requested, repeatedly, until it is identified. A
     * window that already matched is never reconsidered — otherwise it could later claim a
     * different pending launch by app id.
     */
    _scheduleLaunchMatch(window) {
        for (const delay of MATCH_ATTEMPT_DELAYS_MS) {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._matchTimeouts.delete(id);
                this._tryLaunchMatch(window);
                return GLib.SOURCE_REMOVE;
            });
            this._matchTimeouts.add(id);
        }
    }

    /**
     * One matching attempt. A window that already matched is never reconsidered — otherwise it
     * could later claim a different pending launch by app id.
     */
    _tryLaunchMatch(window) {
        if (!this._shellService || !this._windowSignals.has(window) ||
            this._matchedWindows.has(window))
            return;

        try {
            if (this._shellService.considerWindow(window))
                this._matchedWindows.add(window);
        } catch (error) {
            console.warn(`gnome-tasks: launch matching failed: ${error}`);
        }
    }

    /**
     * Cycling through tasks from the keyboard. The binding lives in the extension's GSettings because
     * that is the only place Mutter will read one from; what it *does* is a D-Bus call like every
     * other action here.
     */
    _addKeybindings() {
        const settings = this.getSettings();

        for (const [name, step] of [['cycle-tasks', 1], ['cycle-tasks-backward', -1]]) {
            Main.wm.addKeybinding(
                name, settings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this._cycleTask(step));
        }

        // Per-task shortcuts cannot use addKeybinding: that needs a GSettings key per binding, and
        // tasks are created at runtime. grab_accelerator is the dynamic equivalent, and is what the
        // Shell itself uses for D-Bus-registered shortcuts.
        this._acceleratorSignal = global.display.connect('accelerator-activated',
            (display, action) => {
                const uuid = this._taskAccelerators.get(action);
                if (uuid)
                    this._client?.activate(uuid).catch(error => console.warn(`gnome-tasks: ${error}`));
            });
    }

    /**
     * Re-grab the per-task accelerators after any change to the task list. Every change re-grabs
     * everything, which is simpler than diffing and cheap; only *newly* grabbed shortcuts are logged,
     * so a task rename does not put a line in the journal per shortcut.
     */
    _refreshTaskAccelerators(tasks) {
        const previous = new Set(this._taskAccelerators.values());

        for (const action of this._taskAccelerators.keys())
            global.display.ungrab_accelerator(action);
        this._taskAccelerators.clear();

        for (const task of tasks) {
            if (!task.shortcut)
                continue;

            const action = global.display.grab_accelerator(task.shortcut,
                Meta.KeyBindingFlags.NONE);
            if (action === Meta.KeyBindingAction.NONE) {
                // Almost always because something else already owns the combination.
                console.warn(`gnome-tasks: could not grab ${task.shortcut} for "${task.name}"`);
                continue;
            }

            // The Shell only routes an accelerator to us once its name is in the keybinding action
            // list for our action mode.
            Main.wm.allowKeybinding(Meta.external_binding_name_for_action(action),
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
            this._taskAccelerators.set(action, task.uuid);
            if (!previous.has(task.uuid))
                console.log(`gnome-tasks: grabbed ${task.shortcut} for "${task.name}"`);
        }
    }

    _cycleTask(step) {
        const tasks = this._client?.tasks ?? [];
        if (tasks.length === 0)
            return;

        const current = tasks.findIndex(task => task.uuid === this._client.currentTask);
        // No current task means "start at the beginning", in whichever direction was asked for.
        const next = current < 0
            ? (step > 0 ? 0 : tasks.length - 1)
            : (current + step + tasks.length) % tasks.length;

        this._client.activate(tasks[next].uuid)
            .catch(error => console.warn(`gnome-tasks: ${error}`));
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _watchWindow(window) {
        if (!window || this._windowSignals.has(window))
            return;

        const ids = WINDOW_SIGNALS.map(signal =>
            window.connect(signal, () => this._shellService.queueWindowsChanged()));

        // Identification is what unblocks launch matching, and it arrives as a property change
        // rather than at a predictable time.
        for (const signal of IDENTITY_SIGNALS)
            ids.push(window.connect(signal, () => this._tryLaunchMatch(window)));

        ids.push(window.connect('unmanaged', () => {
            this._windowSignals.delete(window);
            this._shellService.queueWindowsChanged();
        }));

        this._windowSignals.set(window, ids);
    }

    _onDaemonChanged() {
        if (!this._indicator)
            return;

        // Keeps the cache and the top-bar label current; the menu builds from that cache the moment
        // it opens.
        this._client.listTasks()
            .then(tasks => {
                this._indicator?.refresh(tasks);
                this._refreshTaskAccelerators(tasks);
            })
            .catch(error => console.warn(`gnome-tasks: ${error}`));
    }
}
