// A stand-in for the Shell extension, on the test's private bus.
//
// Capture and restore are the daemon's most interesting behaviour and they need a compositor — but
// only for *window information*, which is just JSON on a bus. So the tests own
// org.gnome.Tasks.Shell themselves, hand the daemon a scripted desktop, and assert on the calls the
// daemon makes back. That covers the whole orchestration (what to launch, what to move, what to
// close) without a compositor anywhere, leaving only "does Mutter obey" for the nested-Shell
// experiments.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { SHELL_IFACE_XML, SHELL_NAME, SHELL_OBJECT_PATH } from '../../src/lib/protocol.js';

export class FakeShell {
    constructor() {
        this.windows = [];
        this.calls = [];
        this._launchCounter = 0;
        this._impl = Gio.DBusExportedObject.wrapJSObject(SHELL_IFACE_XML, this);
        this._ownerId = 0;
    }

    export() {
        this._impl.export(Gio.DBus.session, SHELL_OBJECT_PATH);
        return new Promise(resolve => {
            this._ownerId = Gio.bus_own_name(
                Gio.BusType.SESSION, SHELL_NAME, Gio.BusNameOwnerFlags.REPLACE,
                null, () => resolve(), () => resolve());
        });
    }

    destroy() {
        if (this._ownerId) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }
        this._impl.unexport();
    }

    /** Replace the scripted desktop and tell the daemon it changed. */
    setWindows(windows) {
        this.windows = windows;
        this._impl.emit_signal('WindowsChanged',
            new GLib.Variant('(s)', [JSON.stringify({ windows: this.windows })]));
    }

    callsTo(method) {
        return this.calls.filter(call => call.method === method);
    }

    reset() {
        this.calls = [];
    }

    // --- the interface the daemon uses ------------------------------------------------------

    Ping(message) {
        return `fake-shell ${message}`;
    }

    ListWindows() {
        this.calls.push({ method: 'ListWindows' });
        return JSON.stringify({ windows: this.windows });
    }

    LaunchApp(desktopId, uris, placement) {
        this.calls.push({
            method: 'LaunchApp',
            desktopId,
            uris,
            placement: unpack(placement),
        });
        return `fake-launch-${++this._launchCounter}`;
    }

    PlaceWindow(windowId, placement) {
        this.calls.push({ method: 'PlaceWindow', windowId, placement: unpack(placement) });
        return true;
    }

    CloseWindow(windowId) {
        this.calls.push({ method: 'CloseWindow', windowId });
        // A closed window is gone from the next window list, like the real thing.
        this.windows = this.windows.filter(window => String(window.id) !== String(windowId));
    }

    GetPlacementReport(windowId) {
        return JSON.stringify(null);
    }

    get ApiVersion() {
        return 1;
    }

    get ShellVersion() {
        return 'fake';
    }
}

function unpack(variantDict) {
    const out = {};
    for (const [key, value] of Object.entries(variantDict ?? {}))
        out[key] = value instanceof GLib.Variant ? value.recursiveUnpack() : value;
    return out;
}

/** A window record shaped the way the real extension reports them. */
export function fakeWindow(appId, { id = null, x = 0, y = 0, width = 800, height = 600,
    workspace = 0, title = '', maximized = 'none' } = {}) {
    return {
        id: id ?? `${appId}-${x}-${y}`,
        appId,
        identified: true,
        title,
        wmClass: appId.replace(/\.desktop$/, ''),
        pid: 1234,
        startupId: null,
        windowType: 'NORMAL',
        clientType: 'wayland',
        sandboxedAppId: null,
        gtk: null,
        geometry: { x, y, width, height },
        workspaceIndex: workspace,
        monitorIndex: 0,
        monitorConnector: 'eDP-1',
        maximized,
        fullscreen: false,
        onAllWorkspaces: false,
        skipTaskbar: false,
    };
}
