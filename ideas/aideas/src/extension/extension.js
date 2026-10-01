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
import { StopClient } from './lib/stopClient.js';
import { describeOpen, openQueue, systemSeams } from './lib/editorLauncher.js';
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

// How long to keep watching a cycle we asked to stop, before saying out loud that it is still
// going. Taken from what a wind-down actually costs rather than copied from the number above:
// the supervising loop checks the stop file every 5 s, `agent_grace_seconds` is 90, and the
// cycle then still commits, merges and pushes while holding its lock — so `running` stays true
// for a good while after the last agent has gone. 150 s covers the first two with room for the
// third; past that the extension stops guessing and says so.
const WIND_DOWN_SECONDS = 150;
const WIND_DOWN_INTERVAL_SECONDS = 5;

export default class AideasExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._transport = new SoupTransport();
        this._client = new StateClient({
            transport: this._transport,
            clock: nowSeconds,
        });

        this._cycleClient = new CycleClient({ transport: this._transport });
        this._stopClient = new StopClient({ transport: this._transport });

        // What the items are doing right now, and what the last click came back with. The menu
        // is built from this as much as from the reading.
        this._actions = {
            refreshing: false,
            cycleInFlight: false, cycleOutcome: null,
            stopInFlight: null, stopOutcome: null,
            editor: null, openOutcome: null,
        };
        // The filesystem and the process table, as seams, so that everything the menu says about
        // the editor is decided by a module the tests can drive without launching anything.
        this._seams = systemSeams();
        this._confirmUntil = 0;
        this._confirmTimer = null;
        this._windDownUntil = 0;
        this._windDownTimer = null;

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
        this._stopWatching();
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
        this._stopClient = null;
        this._actions = null;
        this._seams = null;
        this._settings = null;
    }

    /** A menu item was clicked. Never throws: this is a signal handler inside the Shell. */
    _act(name) {
        if (name === 'refresh')
            this._refresh().catch(error => logError(error, 'aideas: refresh failed'));
        else if (name === 'cycle' || name === 'override')
            this._startCycle(name === 'override')
                .catch(error => logError(error, 'aideas: starting a cycle failed'));
        else if (name === 'stop')
            this._stopOrResume()
                .catch(error => logError(error, 'aideas: pausing the queue failed'));
        else if (name === 'open')
            this._openQueue();
    }

    /** The two preferences the editor item depends on, as the module reads them. */
    _editorSettings() {
        return {
            repoPath: this._settings.get_string('repo-path'),
            editorCommand: this._settings.get_string('editor-command'),
        };
    }

    /**
     * Open README.md in an editor, at the end of the `## Ideas` list.
     *
     * Synchronous and unwatched: the editor is launched and forgotten. What stays behind is the
     * sentence under the item if it could not be launched — never a click that did nothing.
     */
    _openQueue() {
        const { launched, reason } = openQueue({
            ...this._editorSettings(),
            ...this._seams,
        });
        this._actions.openOutcome = launched ? null : reason;
        this._render();
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

    /**
     * Pause the queue, or — when it already is — let it go again.
     *
     * Which of the two is decided from the reading on screen, not from a separate toggle this
     * extension keeps: the stop file is the state, and the panel is only ever reporting it. A
     * panel that remembered its own idea of "paused" would disagree with `rm` the moment anyone
     * used it, and the file is explicitly something a person can remove by hand.
     */
    async _stopOrResume() {
        // A wind-down being watched belongs to the request that started it. Letting its timer
        // outlive this click would let "Still winding down" overwrite the answer to a resume.
        this._stopWatching();

        const resume = this._client?.snapshot()?.reading?.paused === true;
        this._actions.stopInFlight = resume ? 'resume' : 'stop';
        this._actions.stopOutcome = null;
        this._render();

        let outcome;
        try {
            outcome = await this._stopClient.requestStop({
                host: this._settings.get_string('orchestrator-host'),
                port: this._settings.get_int('orchestrator-port'),
                secret: this._settings.get_string('orchestrator-secret'),
                resume,
            });
        } finally {
            this._actions.stopInFlight = null;
        }

        this._actions.stopOutcome = outcome;
        this._render();

        // The header saying `paused` is the real feedback for this click, and it comes from
        // /state rather than from the reply, so read it back at once instead of waiting out the
        // poll interval.
        this._scheduler?.pollNow();

        if (outcome.gate === null && outcome.paused === true)
            this._watchWindDown();
    }

    /**
     * Keep an eye on a cycle that was asked to stop, and say so if it is still going.
     *
     * Not a timeout dressed as a failure: the file is on disk either way and the header keeps
     * saying `Paused`. What this produces is the one sentence that is actually true after a
     * couple of minutes — the agents are finishing their step — rather than a menu that shows
     * "the queue is paused" beside a cycle that is visibly still running.
     */
    _watchWindDown() {
        if (!this._client?.snapshot()?.reading?.running)
            return;

        this._windDownUntil = nowSeconds() + WIND_DOWN_SECONDS;
        if (this._windDownTimer)
            return;

        this._windDownTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, WIND_DOWN_INTERVAL_SECONDS, () => {
                const reading = this._client?.snapshot()?.reading;
                if (!reading?.running) {
                    this._windDownTimer = null;
                    return GLib.SOURCE_REMOVE;
                }
                if (nowSeconds() >= this._windDownUntil) {
                    this._windDownTimer = null;
                    this._actions.stopOutcome = {
                        paused: true,
                        changed: false,
                        gate: null,
                        reason: 'Still winding down — agents finish their step first',
                    };
                    this._render();
                    return GLib.SOURCE_REMOVE;
                }
                this._scheduler?.pollNow();
                return GLib.SOURCE_CONTINUE;
            });
    }

    /** Drop the wind-down watch, if there is one. */
    _stopWatching() {
        if (this._windDownTimer) {
            GLib.source_remove(this._windDownTimer);
            this._windDownTimer = null;
        }
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
        // Re-read every time rather than cached: both preferences and the file they point at
        // can change while the menu sits open, and a stale "does not exist" is as misleading as
        // a stale path.
        this._actions.editor = describeOpen({ ...this._editorSettings(), ...this._seams });

        this._indicator.update({
            ...this._client.snapshot(),
            alwaysShow: this._settings.get_boolean('always-show'),
            actions: this._actions,
        });
    }
}
