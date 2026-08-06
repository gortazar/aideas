// The top-bar switcher.
//
// Deliberately dumb: it renders whatever the daemon says and turns clicks into D-Bus calls. No task
// state lives here, so a Shell restart loses nothing.

import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import { TaskState } from './lib/protocol.js';

export const TasksIndicator = GObject.registerClass(
class TasksIndicator extends PanelMenu.Button {
    _init(client) {
        super._init(0.5, 'gnome-tasks', false);

        this._client = client;

        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._icon = new St.Icon({
            icon_name: 'view-grid-symbolic',
            style_class: 'system-status-icon',
        });
        this._label = new St.Label({
            text: _('No task'),
            y_align: 2, // Clutter.ActorAlign.CENTER
            y_expand: true,
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        // The menu is kept populated at all times rather than built when it opens. Building on open
        // does not work: an empty PopupMenu declines to open at all, so a menu that is only filled
        // in by its own open handler stays empty for ever (observed: isOpen false, numMenuItems 0).
        this._rebuild();

        // Opening is still a good moment to ask the daemon for fresher data.
        this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (!isOpen)
                return;
            this._client.listTasks()
                .then(() => this._rebuild())
                .catch(error => console.warn(`gnome-tasks: ${error}`));
        });
    }

    /** Everything the indicator shows, from the client's cached task list. */
    refresh(tasks) {
        this.refreshLabel(tasks);
        this._rebuild();
    }

    /** Update just the top-bar label; cheap enough to call on every daemon signal. */
    refreshLabel(tasks) {
        const current = tasks.find(task => task.uuid === this._client.currentTask);
        this._label.text = current ? current.name : _('No task');
        if (current?.icon)
            this._icon.icon_name = current.icon;
        else
            this._icon.icon_name = 'view-grid-symbolic';
    }

    _rebuild() {
        // Rebuilding while the menu is open is fine — the items are recreated in place — but the
        // menu must never be left with nothing in it.
        this.menu.removeAll();

        if (!this._client.available) {
            const item = new PopupMenu.PopupMenuItem(_('gnome-tasks daemon is not running'));
            item.setSensitive(false);
            this.menu.addMenuItem(item);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const hint = new PopupMenu.PopupMenuItem(
                _('Start it with: systemctl --user start gnome-tasks-daemon'));
            hint.setSensitive(false);
            hint.label.clutter_text.line_wrap = true;
            this.menu.addMenuItem(hint);
            return;
        }

        const tasks = this._client.tasks;
        const currentUuid = this._client.currentTask;

        if (tasks.length === 0) {
            const empty = new PopupMenu.PopupMenuItem(_('No tasks yet'));
            empty.setSensitive(false);
            this.menu.addMenuItem(empty);
        }

        for (const task of tasks) {
            const item = new PopupMenu.PopupImageMenuItem(
                task.name, task.icon || 'view-grid-symbolic');
            if (task.uuid === currentUuid) {
                item.setOrnament(PopupMenu.Ornament.CHECK);
                item.connect('activate', () => {
                    // Clicking the current task stops it, which is KDE's distinction: stopping
                    // keeps the task and its layout, deleting is a separate, destructive act.
                    this._client.stop(task.uuid).catch(
                        error => console.warn(`gnome-tasks: ${error}`));
                });
            } else {
                if (task.state === TaskState.RUNNING)
                    item.setOrnament(PopupMenu.Ornament.DOT);
                item.connect('activate', () => {
                    this._client.activate(task.uuid).catch(
                        error => console.warn(`gnome-tasks: ${error}`));
                });
            }
            this.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const create = new PopupMenu.PopupMenuItem(_('New Task…'));
        create.connect('activate', () => this._promptForNewTask());
        this.menu.addMenuItem(create);
    }

    // An inline entry rather than a dialog: a modal dialog from an extension is a heavier thing to
    // get right, and this is enough to create a task and rename it later in the preferences (M7).
    _promptForNewTask() {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
        const entry = new St.Entry({
            hint_text: _('Task name'),
            can_focus: true,
            x_expand: true,
        });

        entry.clutter_text.connect('activate', () => {
            const name = entry.get_text().trim();
            this.menu.close();
            if (name.length === 0)
                return;
            this._client.create(name).catch(error => console.warn(`gnome-tasks: ${error}`));
        });

        item.add_child(entry);
        this.menu.addMenuItem(item);
        entry.grab_key_focus();
    }
});
