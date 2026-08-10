// recap — agent statuses in the GNOME Shell top bar.
//
// This file is the only one that may import from gi://St or resource:///org/gnome/shell:
// everything with a rule in it lives under lib/ and is tested headlessly. What happens here
// is creation and, symmetrically, destruction — an extension that leaks a timer or a signal
// handler across disable() is the classic review rejection.

import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const RecapIndicator = GObject.registerClass(
class RecapIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Recap', false);

        this._icon = new St.Icon({
            icon_name: 'utilities-terminal-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);
    }
});

export default class RecapExtension extends Extension {
    enable() {
        this._indicator = new RecapIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
