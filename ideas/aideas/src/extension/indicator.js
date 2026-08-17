// The panel button and its menu, in the compositor.
//
// Everything decided has already been decided by the time it gets here: `buildIndicator`
// settles visibility, icon and badge, `buildMenu` settles the wording, and `menuItems`
// settles the order. This file only turns descriptors into widgets, one apiece, which is why
// it has almost no branches worth testing and why the ones it does have are covered by the
// compositor smoke test rather than headlessly.
//
// Two habits the whole extension depends on:
//   * `destroy()` must undo everything the constructor did, because enable/disable runs on
//     every screen lock. The menu's children are owned by the menu and go with it; the timer
//     and the client belong to whoever passed them in.
//   * nothing here throws. A throw inside a Shell extension takes the session's UI with it.
//
// The `./lib/…` imports below resolve in the *assembled bundle*, where `make build` copies
// src/lib/ in beside this file — an extension may only import from inside its own directory.
// They do not resolve in the source tree, which is the same convention ideas/gnome-tasks uses,
// and is why `tools/check-bundle.js` verifies every relative import against a built bundle.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { buildIndicator } from './lib/indicatorModel.js';
import { buildMenu } from './lib/menuModel.js';
import { menuItems } from './lib/menuItems.js';
import { unconfiguredReading } from './lib/state.js';

/** A dim, non-interactive line of text, optionally with a second line beneath it. */
function infoItem(text, detail, { dim = false, styleClass = '' } = {}) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        style_class: `popup-menu-item ${styleClass}`.trim(),
    });
    const box = new St.BoxLayout({ vertical: true, x_expand: true });

    box.add_child(new St.Label({
        text,
        style_class: dim ? 'aideas-dim' : '',
    }));
    if (detail)
        box.add_child(new St.Label({ text: detail, style_class: 'aideas-detail' }));

    item.add_child(box);
    return item;
}

/** One queue row: the slug, its detail beneath, and the "next" marker on the right. */
function rowItem(descriptor) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        style_class: 'popup-menu-item',
    });

    const box = new St.BoxLayout({ vertical: true, x_expand: true });
    box.add_child(new St.Label({
        text: descriptor.label,
        style_class: descriptor.stale ? 'aideas-dim' : '',
    }));
    if (descriptor.detail)
        box.add_child(new St.Label({ text: descriptor.detail, style_class: 'aideas-detail' }));
    item.add_child(box);

    if (descriptor.marker) {
        item.add_child(new St.Label({
            text: descriptor.marker,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'aideas-marker',
        }));
    }

    return item;
}

/**
 * One unanswered question, indented under the idea it belongs to and dimmed.
 *
 * Wrapping rather than truncating: the model has already cut the text to something that fits
 * about two lines, and the label wraps at word boundaries and ellipsizes if a theme's font makes
 * it longer than that. Non-reactive, like every row — answering a question means editing
 * PLAN.md on the box.
 */
function questionItem(descriptor) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
        style_class: 'popup-menu-item aideas-question',
    });

    const label = new St.Label({
        text: descriptor.text,
        style_class: descriptor.stale ? 'aideas-question-text aideas-dim' : 'aideas-question-text',
        x_expand: true,
    });
    label.clutter_text.line_wrap = true;
    label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

    item.add_child(label);
    return item;
}

export const AideasIndicator = GObject.registerClass(
class AideasIndicator extends PanelMenu.Button {
    /**
     * @param {object} options
     * @param {function():void} options.onOpenPreferences  what the Preferences row does
     * @param {function(boolean):void} [options.onMenuOpenChanged]  told when the menu opens or
     *     closes, so the scheduler can poll faster while somebody is reading it
     * @param {function():number} [options.clock]  unix seconds; injected so a test or the
     *     smoke test can hold time still
     */
    _init({ onOpenPreferences, onMenuOpenChanged = null, clock = null } = {}) {
        super._init(0.5, 'aideas', false);

        this._onOpenPreferences = onOpenPreferences;
        this._onMenuOpenChanged = onMenuOpenChanged;
        this._clock = clock ?? (() => Date.now() / 1000);

        this._icon = new St.Icon({ style_class: 'system-status-icon' });
        this._badge = new St.Label({
            text: '',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'aideas-badge',
        });

        const box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        box.add_child(this._icon);
        box.add_child(this._badge);
        this.add_child(box);

        this._openStateId = this.menu.connect('open-state-changed', (_menu, open) => {
            this._onMenuOpenChanged?.(open);
        });

        // Until the first reading arrives there is nothing to say. An unconfigured reading is
        // the honest placeholder: it renders the "set an address" menu, and with the default
        // preferences it keeps the button hidden.
        this.update({ reading: unconfiguredReading(), fetchedAt: null });
    }

    /**
     * Show a reading.
     *
     * @param {object} state
     * @param {object} state.reading  the latest reading, from lib/state.js
     * @param {?number} state.fetchedAt  unix seconds it was taken
     * @param {?object} state.lastGood  `{reading, fetchedAt}` of the last ok reading
     * @param {?string} state.host  what was tried, for the unreachable message
     * @param {boolean} state.alwaysShow  the preference
     */
    update({ reading, fetchedAt = null, lastGood = null, host = null, alwaysShow = false }) {
        const now = this._clock();

        const panel = buildIndicator({ reading, now, lastGood, alwaysShow });
        this.visible = panel.visible;
        this._icon.icon_name = panel.icon;
        this._badge.text = panel.badge ?? '';
        this._badge.visible = panel.badge !== null;
        this.accessible_name = panel.accessibleName;

        this._rebuildMenu(buildMenu({ reading, now, fetchedAt, lastGood, host }));
    }

    /** Rebuild every item. The menu is small and rebuilt at most once per reading. */
    _rebuildMenu(built) {
        this.menu.removeAll();

        for (const item of menuItems(built)) {
            switch (item.type) {
                case 'separator':
                    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                    break;
                case 'header':
                    this.menu.addMenuItem(infoItem(item.text, item.detail,
                        { styleClass: 'aideas-header' }));
                    break;
                case 'message':
                    this.menu.addMenuItem(infoItem(item.text, item.detail,
                        { styleClass: 'aideas-message' }));
                    break;
                case 'title': {
                    const title = new PopupMenu.PopupMenuItem(item.text, {
                        reactive: false,
                        can_focus: false,
                        style_class: 'popup-menu-item aideas-title',
                    });
                    this.menu.addMenuItem(title);
                    break;
                }
                case 'row':
                    this.menu.addMenuItem(rowItem(item));
                    break;
                case 'question':
                    this.menu.addMenuItem(questionItem(item));
                    break;
                case 'question-more':
                    this.menu.addMenuItem(infoItem(item.text, null,
                        { dim: true, styleClass: 'aideas-question' }));
                    break;
                case 'footer':
                    this.menu.addMenuItem(infoItem(item.text, null, { dim: true }));
                    break;
                case 'preferences': {
                    const preferences = new PopupMenu.PopupMenuItem(item.text);
                    preferences.connect('activate', () => this._onOpenPreferences?.());
                    this.menu.addMenuItem(preferences);
                    break;
                }
            }
        }
    }

    destroy() {
        if (this._openStateId) {
            this.menu.disconnect(this._openStateId);
            this._openStateId = null;
        }
        this._onMenuOpenChanged = null;
        this._onOpenPreferences = null;
        super.destroy();
    }
});
