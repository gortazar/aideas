// The daemon's side of org.gnome.Tasks.Shell.
//
// The extension may not be loaded, may be reloaded under us (a Shell restart, an upgrade), or may be
// an older version than this daemon. So nothing here throws on construction, every call tolerates
// the interface being absent, and the daemon keeps working — without window information — when it is.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { SHELL_NAME, SHELL_OBJECT_PATH } from '../lib/protocol.js';

/**
 * A D-Bus call as a promise, wired to the callback explicitly rather than through Gio._promisify.
 *
 * _promisify was tried first and its promise never settled inside the daemon's GLib.MainLoop, while
 * the identical code resolved fine in a plain script — the call went out, the reply came back, and
 * the continuation never ran. Wiring the callback by hand is one line longer and does not depend on
 * which main context the shim happened to capture.
 */
function callAsync(name, path, iface, method, parameters, replyType, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            name, path, iface, method, parameters,
            replyType ? new GLib.VariantType(replyType) : null,
            Gio.DBusCallFlags.NONE, timeoutMs, null,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

function packGeometry(geometry) {
    return new GLib.Variant('a{sv}', {
        x: GLib.Variant.new_int32(Math.round(geometry.x)),
        y: GLib.Variant.new_int32(Math.round(geometry.y)),
        width: GLib.Variant.new_int32(Math.round(geometry.width)),
        height: GLib.Variant.new_int32(Math.round(geometry.height)),
    });
}

/**
 * A placement as the a{sv} member of a tuple: a *plain object* whose values are variants, not a
 * GLib.Variant. Handing `new GLib.Variant('(sasa{sv})', …)` a ready-made variant for the dict fails
 * with "not a subclass of GObject_Boxed, it's a GIRepositoryFunction", which says nothing about the
 * actual mistake. Absent keys mean "leave this alone".
 */
export function packPlacement(placement = {}) {
    const packed = {};

    if (Number.isInteger(placement.workspace) && placement.workspace >= 0)
        packed.workspace = GLib.Variant.new_uint32(placement.workspace);
    if (placement.geometry)
        packed.geometry = packGeometry(placement.geometry);
    if (typeof placement.maximized === 'string')
        packed.maximized = GLib.Variant.new_string(placement.maximized);
    if (typeof placement.fullscreen === 'boolean')
        packed.fullscreen = GLib.Variant.new_boolean(placement.fullscreen);
    if (typeof placement.monitorConnector === 'string' && placement.monitorConnector)
        packed.monitorConnector = GLib.Variant.new_string(placement.monitorConnector);

    return packed;
}

export class ShellClient {
    /** @param onWindowsChanged called with the window records whenever the compositor reports a change */
    constructor(onWindowsChanged = () => {}) {
        this._onWindowsChanged = onWindowsChanged;
        this._available = false;
        this._subscriptionId = 0;

        this._watchId = Gio.bus_watch_name(
            Gio.BusType.SESSION, SHELL_NAME, Gio.BusNameWatcherFlags.NONE,
            () => {
                this._available = true;
            },
            () => {
                this._available = false;
            });

        this._subscriptionId = Gio.DBus.session.signal_subscribe(
            null, SHELL_NAME, 'WindowsChanged', SHELL_OBJECT_PATH, null,
            Gio.DBusSignalFlags.NONE,
            (connection, sender, path, iface, signal, parameters) => {
                const [json] = parameters.deepUnpack();
                this._onWindowsChanged(parseWindows(json));
            });
    }

    get available() {
        return this._available;
    }

    destroy() {
        if (this._subscriptionId) {
            Gio.DBus.session.signal_unsubscribe(this._subscriptionId);
            this._subscriptionId = 0;
        }
        if (this._watchId) {
            Gio.bus_unwatch_name(this._watchId);
            this._watchId = 0;
        }
    }

    /** Every window the compositor manages, or [] when the extension is not there. */
    async listWindows() {
        const reply = await this._call('ListWindows', null, '(s)');
        if (!reply)
            return [];
        return parseWindows(reply[0]);
    }

    /** The monitor set, or [] when the extension is not there. */
    async listMonitors() {
        const reply = await this._call('ListMonitors', null, '(s)');
        if (!reply)
            return [];
        try {
            return JSON.parse(reply[0]).monitors ?? [];
        } catch {
            return [];
        }
    }

    /** `{ count, active, dynamic }`, or null when the extension is not there. */
    async listWorkspaces() {
        const reply = await this._call('ListWorkspaces', null, '(s)');
        if (!reply)
            return null;
        try {
            return JSON.parse(reply[0]);
        } catch {
            return null;
        }
    }

    /** Returns the launch id, or '' if the launch could not be requested. */
    async launchApp(appId, uris = [], placement = {}) {
        const reply = await this._call(
            'LaunchApp',
            new GLib.Variant('(sasa{sv})', [appId, uris, packPlacement(placement)]),
            '(s)');
        return reply ? reply[0] : '';
    }

    async placeWindow(windowId, placement) {
        const reply = await this._call(
            'PlaceWindow',
            new GLib.Variant('(sa{sv})', [String(windowId), packPlacement(placement)]),
            '(b)');
        return reply ? reply[0] : false;
    }

    async closeWindow(windowId) {
        await this._call('CloseWindow', new GLib.Variant('(s)', [String(windowId)]), null);
    }

    async _call(method, parameters, replyType) {
        try {
            const reply = await callAsync(
                SHELL_NAME, SHELL_OBJECT_PATH, SHELL_NAME, method, parameters, replyType);
            return reply?.deepUnpack();
        } catch (error) {
            // Absent extension is normal, not exceptional: the daemon outlives the Shell.
            printerr(`gnome-tasks-daemon: ${method} failed: ${error.message}`);
            return null;
        }
    }
}

function parseWindows(json) {
    try {
        return JSON.parse(json).windows ?? [];
    } catch (error) {
        printerr(`gnome-tasks-daemon: could not parse window list: ${error.message}`);
        return [];
    }
}
