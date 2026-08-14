// The smoke test's eyes and hands inside the compositor. Never shipped.
//
// A test outside the Shell cannot see an St widget or open a popup menu: `org.gnome.Shell.Eval`
// is refused outside unsafe mode, and GNOME 46 refuses `org.gnome.Shell.Screenshot` to callers
// that are not the portal. So the things that must happen in-process happen here, behind a
// small D-Bus interface, and the test drives them with `gdbus`.
//
// Modelled on ideas/gnome-tasks/tools/probe/extension.js, which is where the screenshot and
// menu-opening sequences were worked out.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'aideas-shell@patxi.gortazar';
const NAME = 'org.gnome.AideasProbe';
const PATH = '/org/gnome/AideasProbe';

const IFACE = `
<node>
  <interface name="org.gnome.AideasProbe">
    <!-- Everything the smoke test asserts about the panel, as JSON. -->
    <method name="Describe">
      <arg type="s" name="json" direction="out"/>
    </method>
    <!-- Open the aideas menu (hiding the overview, which covers the panel in a session with
         no windows) so that Describe can read its items back. -->
    <method name="OpenMenu">
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="CloseMenu">
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="Screenshot">
      <arg type="s" name="path" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
    <!-- Open the menu and shoot it in one in-process sequence: a D-Bus round trip between the
         two is long enough for a popup to lose its grab in a headless session. -->
    <method name="ShootMenu">
      <arg type="s" name="path" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
    <!-- Disable and re-enable aideas `rounds` times, which is the leak test. -->
    <method name="Cycle">
      <arg type="i" name="rounds" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="SetEnabled">
      <arg type="b" name="enabled" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
  </interface>
</node>`;

/** Every St.Label text under an actor, in tree order — how a menu item's words are read back. */
function labelsOf(actor) {
    const found = [];
    const walk = node => {
        if (node === null || node === undefined)
            return;
        // St.Label has a `text` property; everything else is a container to descend into.
        const text = node.text;
        if (typeof text === 'string' && text !== '')
            found.push(text);
        for (const child of node.get_children?.() ?? [])
            walk(child);
    };
    walk(actor);
    return found;
}

export default class AideasProbe extends Extension {
    enable() {
        this._exported = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._exported.export(Gio.DBus.session, PATH);
        this._nameId = Gio.bus_own_name(
            Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.REPLACE, null, null, null);
        log(`aideas-probe: exported ${NAME}`);
    }

    disable() {
        if (this._nameId) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = null;
        }
        this._exported?.unexport();
        this._exported = null;
    }

    get _indicator() {
        return Main.panel.statusArea[UUID] ?? null;
    }

    Describe() {
        const indicator = this._indicator;

        if (indicator === null)
            return JSON.stringify({ present: false });

        const menu = indicator.menu;
        const items = (menu?._getMenuItems?.() ?? []).map(item => {
            const labels = labelsOf(item);
            return {
                // A separator has no labels of its own, which is how the test tells them apart.
                separator: labels.length === 0,
                labels,
                reactive: item.reactive === true,
            };
        });

        // The badge and icon are the panel's own children, found by the style class the
        // extension gives them rather than by position.
        const panelLabels = labelsOf(indicator).filter(text => text !== '');

        return JSON.stringify({
            present: true,
            // More than one means an enable/disable round left a button behind.
            instances: Object.keys(Main.panel.statusArea)
                .filter(key => key.startsWith('aideas-shell@')).length,
            visible: indicator.visible === true,
            icon: this._iconName(indicator),
            badge: panelLabels.length > 0 ? panelLabels[0] : null,
            accessibleName: indicator.accessible_name ?? null,
            menuOpen: menu?.isOpen === true,
            items,
        });
    }

    _iconName(actor) {
        const walk = node => {
            if (node === null || node === undefined)
                return null;
            if (typeof node.icon_name === 'string' && node.icon_name !== '')
                return node.icon_name;
            for (const child of node.get_children?.() ?? []) {
                const found = walk(child);
                if (found !== null)
                    return found;
            }
            return null;
        };
        return walk(actor);
    }

    OpenMenu() {
        const indicator = this._indicator;
        if (indicator === null)
            return 'error: the aideas indicator is not in the panel';

        // A nested session with no windows starts in the overview, which covers panel menus.
        Main.overview.hide();
        indicator.menu.open();
        return indicator.menu.isOpen ? 'ok' : 'error: the menu did not open';
    }

    CloseMenu() {
        this._indicator?.menu?.close();
        return 'ok';
    }

    Screenshot(path) {
        try {
            const shooter = new Shell.Screenshot();
            const file = Gio.File.new_for_path(path);
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);

            shooter.screenshot(false, stream, (source, result) => {
                try {
                    source.screenshot_finish(result);
                    stream.close(null);
                    log(`aideas-probe: wrote ${path}`);
                } catch (error) {
                    logError(error, `aideas-probe: screenshot ${path} failed`);
                }
            });
            return 'started';
        } catch (error) {
            return `error: ${error}`;
        }
    }

    ShootMenu(path) {
        const indicator = this._indicator;
        if (indicator === null)
            return 'error: the aideas indicator is not in the panel';

        Main.overview.hide();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            indicator.menu.open();
            // One or two frames for the popup to be painted before it is captured.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this.Screenshot(path);
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
        return 'started';
    }

    SetEnabled(enabled) {
        const manager = Main.extensionManager;
        if (enabled)
            manager.enableExtension(UUID);
        else
            manager.disableExtension(UUID);
        return 'ok';
    }

    /** Disable and re-enable, `rounds` times. Synchronous: both calls are synchronous in the Shell. */
    Cycle(rounds) {
        const manager = Main.extensionManager;
        for (let round = 0; round < rounds; round++) {
            manager.disableExtension(UUID);
            manager.enableExtension(UUID);
        }
        return `ok: ${rounds} rounds`;
    }
}
