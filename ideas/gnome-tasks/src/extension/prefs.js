// The extension's preferences entry point.
//
// Thin on purpose: GNOME calls fillPreferencesWindow(), and everything else lives in src/prefs/,
// which imports only Gtk/Adw/Gio. That split is what lets tools/prefs-preview.js build the same
// window under plain gjs inside the nested test session — the preferences process is otherwise
// impossible to exercise outside a real desktop.

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { PrefsClient } from './prefs/client.js';
import { buildCapturePage, buildTasksPage } from './prefs/pages.js';

export default class GnomeTasksPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const client = new PrefsClient();

        // The window is a view over the daemon, so a change means rebuild rather than reconcile:
        // there is no local state that could drift out of step with what the daemon holds.
        const rebuild = () => {
            client.refresh();
            for (const page of [...window.get_pages?.() ?? []])
                window.remove(page);
            window.add(buildTasksPage(client, { onChanged: rebuild }));
            window.add(buildCapturePage(client, { onChanged: rebuild }));
        };

        window.add(buildTasksPage(client, { onChanged: rebuild }));
        window.add(buildCapturePage(client, { onChanged: rebuild }));

        window.set_default_size(720, 640);
    }
}
