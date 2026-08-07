// The preferences window's widgets.
//
// Deliberately separate from prefs.js: this module imports only Gtk/Adw/Gio, never the Shell's
// extension machinery, so the whole window can be built — and screenshotted — by a plain gjs script
// inside the nested test session (see tools/prefs-preview.js). prefs.js is the thin adapter that
// hands these pages to GNOME.
//
// Everything is a view over the daemon: the window holds no state of its own, so it cannot disagree
// with what the daemon believes. `client` is src/prefs/client.js.

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

const POLICY_LABELS = [
    ['leave', 'Leave the windows alone'],
    ['close', 'Close the windows politely'],
    ['hide', 'Hide the windows (not implemented yet)'],
];

/** The task list: one expandable row per task, with its settings and commands inside. */
export function buildTasksPage(client, { onChanged = () => {} } = {}) {
    const page = new Adw.PreferencesPage({
        title: 'Tasks',
        icon_name: 'view-grid-symbolic',
    });

    const group = new Adw.PreferencesGroup({
        title: 'Tasks',
        description: 'Each task remembers the applications and documents you had open.',
    });
    page.add(group);

    if (!client.available) {
        group.add(daemonMissingRow());
        return page;
    }

    for (const task of client.tasks)
        group.add(buildTaskRow(client, task, onChanged));

    group.add(buildCreateRow(client, onChanged));
    return page;
}

function daemonMissingRow() {
    const row = new Adw.ActionRow({
        title: 'The gnome-tasks daemon is not running',
        subtitle: 'Start it with: systemctl --user start gnome-tasks-daemon',
    });
    row.add_prefix(new Gtk.Image({ icon_name: 'dialog-warning-symbolic' }));
    return row;
}

function buildTaskRow(client, task, onChanged) {
    const row = new Adw.ExpanderRow({
        title: task.name || 'Unnamed task',
        subtitle: describeTask(task),
    });
    row.add_prefix(new Gtk.Image({ icon_name: task.icon || 'view-grid-symbolic' }));

    const name = new Adw.EntryRow({ title: 'Name', text: task.name });
    name.connect('apply', () => {
        client.setTaskProperties(task.uuid, { name: name.get_text() });
        onChanged();
    });
    name.set_show_apply_button(true);
    row.add_row(name);

    const icon = new Adw.EntryRow({ title: 'Icon name', text: task.icon });
    icon.set_show_apply_button(true);
    icon.connect('apply', () => {
        client.setTaskProperties(task.uuid, { icon: icon.get_text() });
        onChanged();
    });
    row.add_row(icon);

    const policy = new Adw.ComboRow({
        title: 'When switching away',
        subtitle: 'What happens to this task\'s windows',
        model: Gtk.StringList.new(POLICY_LABELS.map(([, label]) => label)),
        selected: Math.max(0, POLICY_LABELS.findIndex(
            ([value]) => value === (task.deactivatePolicy ?? 'leave'))),
    });
    policy.connect('notify::selected', () => {
        const [value] = POLICY_LABELS[policy.get_selected()] ?? POLICY_LABELS[0];
        client.setTaskProperties(task.uuid, { 'deactivate-policy': value });
        onChanged();
    });
    row.add_row(policy);

    for (const command of task.commands ?? [])
        row.add_row(buildCommandRow(client, task, command, onChanged));

    row.add_row(buildAddCommandRow(client, task, onChanged));
    row.add_row(buildDeleteRow(client, task, onChanged));

    return row;
}

/**
 * A command, with the confirmation switch that governs whether it may ever run. The switch is the UI
 * half of the rule in src/lib/commands.js: nothing unconfirmed is executed.
 */
function buildCommandRow(client, task, command, onChanged) {
    const row = new Adw.ActionRow({
        title: command.label || command.commandLine,
        subtitle: command.commandLine,
    });
    row.add_prefix(new Gtk.Image({ icon_name: 'utilities-terminal-symbolic' }));

    const allowed = new Gtk.Switch({
        active: Boolean(command.confirmed),
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Allow this command to run when the task is activated',
    });
    allowed.connect('notify::active', () => {
        client.confirmCommand(task.uuid, command.id, allowed.get_active());
        onChanged();
    });
    row.add_suffix(allowed);

    const remove = new Gtk.Button({
        icon_name: 'user-trash-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        tooltip_text: 'Remove this command',
    });
    remove.connect('clicked', () => {
        client.setTaskProperties(task.uuid, {
            commands: (task.commands ?? []).filter(other => other.id !== command.id),
        });
        onChanged();
    });
    row.add_suffix(remove);

    return row;
}

function buildAddCommandRow(client, task, onChanged) {
    const row = new Adw.EntryRow({ title: 'Add a command' });
    row.set_show_apply_button(true);
    row.connect('apply', () => {
        const commandLine = row.get_text().trim();
        if (commandLine.length === 0)
            return;
        client.addCommand(task.uuid, commandLine);
        row.set_text('');
        onChanged();
    });
    return row;
}

function buildDeleteRow(client, task, onChanged) {
    const row = new Adw.ActionRow({
        title: 'Delete this task',
        subtitle: 'Forgets its name, its layout and its commands',
    });
    const button = new Gtk.Button({
        label: 'Delete',
        valign: Gtk.Align.CENTER,
        css_classes: ['destructive-action'],
    });
    button.connect('clicked', () => {
        client.deleteTask(task.uuid);
        onChanged();
    });
    row.add_suffix(button);
    return row;
}

function buildCreateRow(client, onChanged) {
    const row = new Adw.EntryRow({ title: 'New task name' });
    row.set_show_apply_button(true);
    row.connect('apply', () => {
        const name = row.get_text().trim();
        if (name.length === 0)
            return;
        client.createTask(name);
        row.set_text('');
        onChanged();
    });
    return row;
}

/** Capture behaviour and the privacy controls. */
export function buildCapturePage(client, { onChanged = () => {} } = {}) {
    const page = new Adw.PreferencesPage({
        title: 'Capture',
        icon_name: 'camera-photo-symbolic',
    });

    const group = new Adw.PreferencesGroup({
        title: 'Session capture',
        description: 'gnome-tasks records which applications and documents a task has open, ' +
            'continuously, while that task is current. Everything stays on this machine.',
    });
    page.add(group);

    if (!client.available) {
        group.add(daemonMissingRow());
        return page;
    }

    const enabled = new Adw.SwitchRow({
        title: 'Record what my tasks have open',
        subtitle: 'Turning this off stops all recording; nothing is captured while it is off',
        active: client.captureEnabled,
    });
    enabled.connect('notify::active', () => {
        client.setCaptureEnabled(enabled.get_active());
        onChanged();
    });
    group.add(enabled);

    const exclusions = new Adw.PreferencesGroup({
        title: 'Never record these applications',
        description: 'Desktop file ids, for example org.keepassxc.KeePassXC.desktop',
    });
    page.add(exclusions);

    for (const appId of client.excludedApps)
        exclusions.add(buildExclusionRow(client, appId, onChanged));

    const add = new Adw.EntryRow({ title: 'Add a desktop file id' });
    add.set_show_apply_button(true);
    add.connect('apply', () => {
        const appId = add.get_text().trim();
        if (appId.length === 0)
            return;
        client.setExcludedApps([...client.excludedApps, appId]);
        add.set_text('');
        onChanged();
    });
    exclusions.add(add);

    return page;
}

function buildExclusionRow(client, appId, onChanged) {
    const row = new Adw.ActionRow({ title: appId });
    const remove = new Gtk.Button({
        icon_name: 'list-remove-symbolic',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    remove.connect('clicked', () => {
        client.setExcludedApps(client.excludedApps.filter(other => other !== appId));
        onChanged();
    });
    row.add_suffix(remove);
    return row;
}

/** What a task's subtitle says at a glance. */
export function describeTask(task) {
    const apps = task.apps?.length ?? 0;
    const commands = task.commands?.length ?? 0;
    const parts = [
        apps === 1 ? '1 window' : `${apps} windows`,
    ];
    if (commands > 0)
        parts.push(commands === 1 ? '1 command' : `${commands} commands`);
    if (task.deactivatePolicy && task.deactivatePolicy !== 'leave')
        parts.push(`${task.deactivatePolicy} on switch-away`);
    return parts.join(' · ');
}
