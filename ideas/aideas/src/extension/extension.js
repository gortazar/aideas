// The Shell entry point: it owns the lifetime of everything, and decides nothing.
//
// The pieces it assembles, each tested on its own: a libsoup transport, the client that turns
// replies into readings and remembers the last good one, the scheduler that decides when to
// ask, the idle watcher that says when not to, and the indicator that renders it.
//
// The one rule this file exists to keep: whatever enable() creates, disable() destroys. The
// Shell calls the pair on every screen lock — this extension declares no session-modes, so
// locking disables it outright, which is also how polling stops while the screen is locked. A
// timer, signal or Soup session leaked here is a leak per lock.

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { AideasIndicator } from './indicator.js';
import { IdleWatcher } from './idleWatcher.js';
import { SoupTransport } from './lib/soupTransport.js';
import { StateClient } from './lib/stateClient.js';
import { PollScheduler } from './lib/scheduler.js';

/** The scheduler's timer seam, as GLib provides it. */
const glibTimer = {
    add: (seconds, callback) =>
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, callback),
    remove: handle => GLib.source_remove(handle),
};

const nowSeconds = () => GLib.get_real_time() / 1e6;

export default class AideasExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._transport = new SoupTransport();
        this._client = new StateClient({
            transport: this._transport,
            clock: nowSeconds,
        });

        this._indicator = new AideasIndicator({
            onOpenPreferences: () => this.openPreferences(),
            onMenuOpenChanged: open => this._scheduler?.setMenuOpen(open),
            clock: nowSeconds,
            // The bulbs ship inside the extension, so only the extension knows where they are.
            iconsPath: `${this.path}/icons`,
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._scheduler = new PollScheduler({
            onPoll: () => this._poll(),
            timer: glibTimer,
            failures: () => this._client?.failures ?? 0,
            intervalSeconds: this._settings.get_int('poll-interval-seconds'),
        });

        this._idleWatcher = new IdleWatcher({
            onIdle: () => this._scheduler?.setSuppressed(true),
            onActive: () => this._scheduler?.setSuppressed(false),
        });

        this._settingsIds = [
            // A new address deserves an immediate answer: the user has just typed it and is
            // looking at the panel to see whether it worked.
            this._settings.connect('changed::orchestrator-host', () => this._scheduler?.pollNow()),
            this._settings.connect('changed::orchestrator-port', () => this._scheduler?.pollNow()),
            this._settings.connect('changed::poll-interval-seconds', () =>
                this._scheduler?.setIntervalSeconds(this._settings.get_int('poll-interval-seconds'))),
            this._settings.connect('changed::always-show', () => this._render()),
        ];

        this._render();
        this._scheduler.start();
    }

    disable() {
        this._scheduler?.stop();
        this._scheduler = null;

        this._idleWatcher?.destroy();
        this._idleWatcher = null;

        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = null;

        this._indicator?.destroy();
        this._indicator = null;

        // Last: a request in flight is cancelled here, and its callback must not find a
        // half-dismantled extension.
        this._transport?.destroy();
        this._transport = null;
        this._client = null;
        this._settings = null;
    }

    /** One reading, then redraw. Never throws: it is a timer callback. */
    async _poll() {
        try {
            await this._client?.read({
                host: this._settings.get_string('orchestrator-host'),
                port: this._settings.get_int('orchestrator-port'),
            });
        } catch (error) {
            // StateClient.read() is written not to reject; this is the belt to that braces.
            logError(error, 'aideas: reading /state failed unexpectedly');
        }
        this._render();
    }

    /** Show what the client currently knows. */
    _render() {
        if (this._indicator === null || this._client === null)
            return;
        this._indicator.update({
            ...this._client.snapshot(),
            alwaysShow: this._settings.get_boolean('always-show'),
        });
    }
}
