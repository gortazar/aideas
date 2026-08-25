// The preferences window: five settings and a button that tells you whether they work.
//
// It runs in its own process, not in the Shell, so it may use Gtk and Adw freely — and it uses
// the same transport, client and wording modules the extension does, which is the point: "Test
// connection" fails in exactly the ways the panel will, and says so in the same words.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { SoupTransport } from './lib/soupTransport.js';
import { StateClient } from './lib/stateClient.js';
import { describeTestResult } from './lib/testConnection.js';
import { describeAddress } from './lib/address.js';

const ICONS = {
    ok: 'emblem-ok-symbolic',
    warning: 'dialog-warning-symbolic',
    error: 'dialog-error-symbolic',
};

export default class AideasPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        page.add(this._orchestratorGroup(settings));
        page.add(this._pollingGroup(settings));
        window.add(page);

        // One transport for the window's lifetime, torn down with it: a test left in flight
        // when the window closes must not come back to a destroyed row.
        const transport = new SoupTransport();
        window.connect('close-request', () => {
            transport.destroy();
            return false;
        });
        this._transport = transport;
    }

    _orchestratorGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Orchestrator',
            description: 'The box running the idea-builder, reachable over the VPN. Reading ' +
                'the queue needs no secret; starting a cycle needs the box\'s ' +
                'HEARTBEAT_SHARED_SECRET, if it has one. The secret is kept in GSettings, ' +
                'where anything in your session can read it — the same secret the heartbeat ' +
                'hook already holds in its environment.',
        });

        const host = new Adw.EntryRow({
            title: 'Host or IP',
            text: settings.get_string('orchestrator-host'),
        });
        // Pasting the whole heartbeat URL is the obvious thing to do, and it works: the value
        // is normalised when it is used, so `http://10.8.0.1:8787/heartbeat` finds /state.
        host.connect('changed', () =>
            settings.set_string('orchestrator-host', host.get_text()));
        group.add(host);

        const port = new Adw.SpinRow({
            title: 'Port',
            subtitle: 'The heartbeat server\'s port; 8787 unless HEARTBEAT_PORT says otherwise',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 65535, step_increment: 1, page_increment: 100,
                value: settings.get_int('orchestrator-port'),
            }),
        });
        port.connect('notify::value', () =>
            settings.set_int('orchestrator-port', port.get_value()));
        group.add(port);

        const secret = new Adw.PasswordEntryRow({
            title: 'Shared secret',
            text: settings.get_string('orchestrator-secret'),
        });
        secret.connect('changed', () =>
            settings.set_string('orchestrator-secret', secret.get_text()));
        group.add(secret);

        group.add(this._testRow(settings));
        return group;
    }

    /** The button, and the line beneath it that reports what happened. */
    _testRow(settings) {
        const row = new Adw.ActionRow({
            title: 'Test connection',
            subtitle: 'Reads /state once and reports what came back',
        });

        const icon = new Gtk.Image({ visible: false });
        const button = new Gtk.Button({
            label: 'Test',
            valign: Gtk.Align.CENTER,
        });

        row.add_suffix(icon);
        row.add_suffix(button);
        row.activatable_widget = button;

        button.connect('clicked', () => {
            button.sensitive = false;
            row.subtitle = 'Testing…';
            icon.visible = false;

            const client = new StateClient({
                transport: this._transport,
                clock: () => GLib.get_real_time() / 1e6,
                timeoutSeconds: 10,
            });

            const host = settings.get_string('orchestrator-host');
            const port = settings.get_int('orchestrator-port');

            client.read({ host, port }).then(snapshot => {
                const result = describeTestResult(snapshot.reading,
                    describeAddress(host, port));

                // The title stays put; the result lives in the subtitle, so the row never
                // stops saying what its button does.
                row.subtitle = result.detail === null
                    ? result.text
                    : `${result.text} — ${result.detail}`;
                icon.icon_name = ICONS[result.severity];
                icon.visible = true;
                button.sensitive = true;
            }).catch(error => {
                // read() is written not to reject; if it ever does, say so rather than
                // leaving the button dead.
                logError(error, 'aideas: the connection test failed unexpectedly');
                row.subtitle = 'The test itself failed — see the journal';
                icon.icon_name = ICONS.error;
                icon.visible = true;
                button.sensitive = true;
            });
        });

        return row;
    }

    _pollingGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Polling',
            description: 'Reading pauses entirely while the session is locked or idle.',
        });

        const interval = new Adw.SpinRow({
            title: 'Seconds between readings',
            subtitle: 'The menu reads faster than this while it is open, ' +
                'and backs off while the box is unreachable',
            adjustment: new Gtk.Adjustment({
                lower: 10, upper: 300, step_increment: 5, page_increment: 30,
                value: settings.get_int('poll-interval-seconds'),
            }),
        });
        interval.connect('notify::value', () =>
            settings.set_int('poll-interval-seconds', interval.get_value()));
        group.add(interval);

        const alwaysShow = new Adw.SwitchRow({
            title: 'Always show the button',
            subtitle: 'Off: the button appears only while a cycle is running',
            active: settings.get_boolean('always-show'),
        });
        alwaysShow.connect('notify::active', () =>
            settings.set_boolean('always-show', alwaysShow.get_active()));
        group.add(alwaysShow);

        return group;
    }
}
