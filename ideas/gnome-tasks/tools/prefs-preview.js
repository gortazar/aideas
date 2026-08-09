#!/usr/bin/env -S gjs -m
// Build the real preferences window under plain gjs, outside the Shell.
//
//   tools/nested-shell.sh start --extension build/gnome-tasks@patxi.gortazar --state /tmp/gtp
//   source /tmp/gtp/env
//   gjs -m tools/prefs-preview.js
//
// The preferences process normally only exists inside a GNOME session, which makes the window
// impossible to exercise in a test. src/prefs/ imports nothing but Gtk/Adw/Gio precisely so this
// script can build the same pages the extension does — which both smoke-tests that the window
// constructs against a live daemon and gives docs a screenshot to use.
//
// Needs a display: run it inside the nested session, not on the developer's desktop.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { PrefsClient } from '../src/prefs/client.js';
import { buildCapturePage, buildTasksPage } from '../src/prefs/pages.js';

const quitAfter = Number(GLib.getenv('GNOME_TASKS_PREVIEW_SECONDS') ?? '0');

Adw.init();

const client = new PrefsClient();
print(`daemon available: ${client.available}, ${client.tasks.length} task(s)`);

const window = new Adw.PreferencesWindow({
    title: 'Tasks — Preferences',
    default_width: 720,
    default_height: 640,
});
const tasksPage = buildTasksPage(client);
const capturePage = buildCapturePage(client);
window.add(tasksPage);
window.add(capturePage);
window.present();

// So a screenshot can show either page: GNOME_TASKS_PREVIEW_PAGE=capture
if (GLib.getenv('GNOME_TASKS_PREVIEW_PAGE') === 'capture')
    window.set_visible_page(capturePage);

// ...and the detail of a task: GNOME_TASKS_PREVIEW_EXPAND=1 opens the first task row, which is what
// a screenshot of "what a task actually holds" needs.
if (GLib.getenv('GNOME_TASKS_PREVIEW_EXPAND')) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        expandFirstRow(tasksPage);
        return GLib.SOURCE_REMOVE;
    });
}

function expandFirstRow(page) {
    // Adw does not expose its rows directly; walk the widget tree for the first ExpanderRow.
    const queue = [page];
    while (queue.length > 0) {
        const widget = queue.shift();
        if (widget instanceof Adw.ExpanderRow) {
            widget.set_expanded(true);
            return;
        }
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
            queue.push(child);
    }
}

print('preferences window built and presented');

if (quitAfter > 0) {
    GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, quitAfter, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
}

const loop = new GLib.MainLoop(null, false);
window.connect('close-request', () => {
    loop.quit();
    return false;
});
loop.run();
void Gtk;
