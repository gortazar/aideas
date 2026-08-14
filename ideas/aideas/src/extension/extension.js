// The Shell entry point. Deliberately thin: it owns the indicator's lifetime and nothing
// else, so that everything worth testing lives in lib/, which runs under plain gjs.
//
// The one rule this file exists to keep: whatever enable() creates, disable() destroys. The
// Shell calls the pair on every lock, unlock and session switch, so a leaked timer, signal or
// Soup session here is a leak per screen lock.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { AideasIndicator } from './indicator.js';
import { unconfiguredReading } from './lib/state.js';

export default class AideasExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._indicator = new AideasIndicator({
            onOpenPreferences: () => this.openPreferences(),
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Redraw when the one preference that changes what the panel looks like changes. The
        // address and the interval matter to the poller, which arrives with the next unit.
        this._alwaysShowId = this._settings.connect('changed::always-show',
            () => this._render());

        this._render();
    }

    disable() {
        if (this._alwaysShowId) {
            this._settings.disconnect(this._alwaysShowId);
            this._alwaysShowId = null;
        }
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }

    /**
     * Show what we currently know.
     *
     * Nothing is fetched yet — the HTTP client and the scheduler are the next two units — so
     * the reading is always "no address configured", which is also exactly what a fresh
     * install should say.
     */
    _render() {
        this._indicator?.update({
            reading: unconfiguredReading(),
            fetchedAt: null,
            alwaysShow: this._settings.get_boolean('always-show'),
        });
    }
}
