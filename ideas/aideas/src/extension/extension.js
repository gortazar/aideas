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
import { CycleClient } from './lib/cycleClient.js';
import { PollScheduler } from './lib/scheduler.js';

/** The scheduler's timer seam, as GLib provides it. */
const glibTimer = {
    add: (seconds, callback) =>
        GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, callback),
    remove: handle => GLib.source_remove(handle),
};

const nowSeconds = () => GLib.get_real_time() / 1e6;

// How long to keep asking /state whether a cycle we launched actually appeared, and how often.
// `started: true` from the box means *launched*, never finished: the cycle re-applies its own
// gates and may still exit, so the only honest confirmation is watching the queue.
const CONFIRM_SECONDS = 45;
const CONFIRM_INTERVAL_SECONDS = 5;

export default class AideasExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._transport = new SoupTransport();
        this._client = new StateClient({
            transport: this._transport,
            clock: nowSeconds,
        });

        this._cycleClient = new CycleClient({ transport: this._transport });

        // What the two items are doing right now, and what the last click came back with. The
        // menu is built from this as much as from the reading.
        this._actions = { refreshing: false, cycleInFlight: false, cycleOutcome: null };
        this._confirmUntil = 0;
        this._confirmTimer = null;

        this._indicator = new AideasIndicator({
            onOpenPreferences: () => this.openPreferences(),
            onMenuOpenChanged: open => this._scheduler?.setMenuOpen(open),
            clock: nowSeconds,
            // The bulbs ship inside the extension, so only the extension knows where they are.
            iconsPath: `${this.path}/icons`,
            onAction: name => this._act(name),
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
        if (this._confirmTimer) {
            GLib.source_remove(this._confirmTimer);
            this._confirmTimer = null;
        }
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
        this._cycleClient = null;
        this._actions = null;
        this._settings = null;
    }

    /** A menu item was clicked. Never throws: this is a signal handler inside the Shell. */
    _act(name) {
        if (name === 'refresh')
            this._refresh().catch(error => logError(error, 'aideas: refresh failed'));
        else if (name === 'cycle' || name === 'override')
            this._startCycle(name === 'override')
                .catch(error => logError(error, 'aideas: starting a cycle failed'));
    }

    /**
     * Read /state now.
     *
     * `pollNow()` cancels the pending timer, single-flights against a poll already in the air
     * and reschedules from the new reading — so this also *resets the backoff*, which is the
     * main reason to want it after the box has been unreachable for a while.
     */
    async _refresh() {
        this._actions.refreshing = true;
        this._render();
        try {
            await this._scheduler?.pollNow();
        } finally {
            this._actions.refreshing = false;
            this._render();
        }
    }

    /** Ask the box to start a cycle, and say what came back. */
    async _startCycle(override) {
        this._actions.cycleInFlight = true;
        this._actions.cycleOutcome = null;
        this._render();

        let outcome;
        try {
            outcome = await this._cycleClient.requestCycle({
                host: this._settings.get_string('orchestrator-host'),
                port: this._settings.get_int('orchestrator-port'),
                secret: this._settings.get_string('orchestrator-secret'),
                override,
            });
        } finally {
            this._actions.cycleInFlight = false;
        }

        this._actions.cycleOutcome = outcome;
        this._render();

        if (outcome.started)
            this._confirmCycleAppeared();
    }

    /**
     * Watch /state until the cycle we asked for shows up — or say that it never did.
     *
     * This is the honest reading of `started: true`, and the only way anybody learns about a
     * refusal the preflight could not predict: the cycle checks its own gates again, and can
     * exit for a reason that arose in the second after it was launched.
     */
    _confirmCycleAppeared() {
        this._confirmUntil = nowSeconds() + CONFIRM_SECONDS;
        if (this._confirmTimer)
            return;

        this._confirmTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, CONFIRM_INTERVAL_SECONDS, () => {
                const reading = this._client?.snapshot()?.reading;
                if (reading?.running) {
                    this._confirmTimer = null;
                    return GLib.SOURCE_REMOVE;
                }
                if (nowSeconds() >= this._confirmUntil) {
                    this._confirmTimer = null;
                    this._actions.cycleOutcome = {
                        started: false,
                        gate: 'vanished',
                        reason: 'The cycle exited without starting — check the journal on the box',
                    };
                    this._render();
                    return GLib.SOURCE_REMOVE;
                }
                this._scheduler?.pollNow();
                return GLib.SOURCE_CONTINUE;
            });
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
            actions: this._actions,
        });
    }
}
