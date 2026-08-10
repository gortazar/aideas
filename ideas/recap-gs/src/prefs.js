// The preferences window. Like extension.js this is a thin shell around lib/: it reads and
// writes GSettings keys and owns no rules of its own.

import Adw from 'gi://Adw';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class RecapPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        window.add(page);
    }
}
