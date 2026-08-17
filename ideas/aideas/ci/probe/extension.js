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
    <!-- One half of an enable/disable round. The rounds are driven from outside, one call at a
         time with a wait between them: disabling and re-enabling within a single main-loop
         iteration leaves ExtensionManager's bookkeeping out of step with reality, and the
         extension stays down with no error logged. Lock and unlock are seconds apart anyway. -->
    <method name="SetEnabled">
      <arg type="b" name="enabled" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
  </interface>
</node>`;

/**
 * Every St.Label text under an actor, in tree order — how a menu item's words are read back.
 *
 * Descending stops at whatever has text, because an St.Label owns an internal Clutter.Text
 * carrying the same string: recursing into it reports every label in the menu twice.
 */
function labelsOf(actor) {
    const found = [];
    const walk = node => {
        if (node === null || node === undefined)
            return;
        const text = node.text;
        if (typeof text === 'string' && text !== '') {
            found.push(text);
            return;
        }
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

        const icon = this._iconActor(indicator);

        return JSON.stringify({
            present: true,
            // More than one means an enable/disable round left a button behind.
            instances: Object.keys(Main.panel.statusArea)
                .filter(key => key.startsWith('aideas-shell@')).length,
            visible: indicator.visible === true,
            icon: this._iconName(indicator),
            // What the icon actually resolved to, and where it is on the stage. The smoke test
            // needs both: the first says the shipped bulb was picked rather than a theme name,
            // the second says which pixels to look at to see whether it was recoloured.
            iconFile: icon?.gicon?.get_file?.()?.get_path?.() ?? null,
            iconGeometry: icon ? this._geometryOf(icon) : null,
            badge: panelLabels.length > 0 ? panelLabels[0] : null,
            accessibleName: indicator.accessible_name ?? null,
            menuOpen: menu?.isOpen === true,
            items,
        });
    }

    /** The St.Icon inside the panel button, whatever it is wrapped in. */
    _iconActor(actor) {
        const walk = node => {
            if (node === null || node === undefined)
                return null;
            if (node.constructor?.$gtype?.name === 'StIcon')
                return node;
            for (const child of node.get_children?.() ?? []) {
                const found = walk(child);
                if (found !== null)
                    return found;
            }
            return null;
        };
        return walk(actor);
    }

    _geometryOf(actor) {
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return {
            x: Math.round(x), y: Math.round(y),
            width: Math.round(width), height: Math.round(height),
        };
    }

    /**
     * What the icon is, however it was set.
     *
     * A stock icon has an `icon_name`; one of this extension's own bulbs is a Gio.FileIcon and
     * has none, so its file's base name stands in — which is the same string ICONS holds, and
     * therefore the string a test can assert against either way.
     */
    _iconName(actor) {
        const icon = this._iconActor(actor);
        if (icon === null)
            return null;
        if (typeof icon.icon_name === 'string' && icon.icon_name !== '')
            return icon.icon_name;

        const path = icon.gicon?.get_file?.()?.get_path?.();
        return path ? GLib.path_get_basename(path).replace(/\.svg$/, '') : null;
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
}
