// The Shell entry point. Deliberately thin: it owns the indicator's lifetime and nothing
// else, so that everything worth testing lives in lib/, which runs under plain gjs.
//
// The one rule this file exists to keep: whatever enable() creates, disable() destroys.
// The Shell calls the pair on every lock, unlock and session switch, so a leaked timer,
// signal or Soup session here is a leak per screen lock.

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class AideasExtension extends Extension {
    enable() {
        this._indicator = null;
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
