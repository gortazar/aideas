// Monitor connector names, so a saved layout survives a display being replugged.
//
// Mutter's monitor indices renumber, and Shell 46 has no Meta.Display.get_monitor_connector at all
// (the probe checked). The names have to come from org.gnome.Mutter.DisplayConfig, which also
// carries the EDID vendor/product/serial a stricter match could use later.

import Gio from 'gi://Gio';

const DISPLAY_CONFIG_NAME = 'org.gnome.Mutter.DisplayConfig';
const DISPLAY_CONFIG_PATH = '/org/gnome/Mutter/DisplayConfig';

export class MonitorConnectors {
    constructor() {
        this._byIndex = [];
        this._cancellable = new Gio.Cancellable();
    }

    /**
     * Connector names indexed the way Meta.Window.get_monitor() indexes monitors. Empty until the
     * first refresh completes; callers treat a missing name as "unknown", never as an error.
     */
    get byIndex() {
        return this._byIndex;
    }

    refresh() {
        Gio.DBus.session.call(
            DISPLAY_CONFIG_NAME, DISPLAY_CONFIG_PATH, DISPLAY_CONFIG_NAME,
            'GetCurrentState', null, null, Gio.DBusCallFlags.NONE, 2000, this._cancellable,
            (connection, result) => {
                try {
                    this._byIndex = parseConnectors(connection.call_finish(result));
                } catch (error) {
                    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`gnome-tasks: cannot read monitor connectors: ${error}`);
                }
            });
    }

    destroy() {
        this._cancellable.cancel();
    }
}

// GetCurrentState returns (u serial, monitors, logicalMonitors, properties). Mutter's monitor
// indices follow the *logical* monitors, and each logical monitor lists the physical outputs it is
// made of as [connector, vendor, product, serial] — the connector of the first one names it.
function parseConnectors(reply) {
    const [, , logicalMonitors] = reply.deepUnpack();

    return logicalMonitors.map(logical => {
        const outputs = logical[5];
        const connector = outputs?.[0]?.[0];
        return typeof connector === 'string' ? connector : null;
    });
}
