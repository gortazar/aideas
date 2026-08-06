// org.gnome.Tasks.Shell — the compositor-side half of the protocol, owned by this extension.
//
// The daemon calls in here for the things only in-process code can do. Everything is cheap and
// synchronous-to-answer: no spawning, no file I/O, no blocking calls, because this runs inside
// gnome-shell where a stall is a frozen desktop.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';

import {
    API_VERSION,
    SHELL_IFACE_XML,
    SHELL_NAME,
    SHELL_OBJECT_PATH,
} from './lib/protocol.js';
import { introspectAllWindows, introspectWindow, windowId } from './windowIntrospect.js';
import { LaunchMatcher } from './lib/launchMatcher.js';
import {
    closeWindow, compareGeometry, findWindow, launchApp, placeWindow, unpackPlacement,
} from './placement.js';

/**
 * Window changes are forwarded to the daemon coalesced: a window drag emits position-changed
 * continuously, and one D-Bus message per motion event would be absurd. The daemon debounces its
 * own writes on top of this.
 */
const WINDOWS_CHANGED_DEBOUNCE_MS = 400;

export class ShellService {
    constructor({ monitors }) {
        this._monitors = monitors;
        this._impl = Gio.DBusExportedObject.wrapJSObject(SHELL_IFACE_XML, this);
        this._ownerId = 0;
        this._debounceId = 0;
        this._matcher = new LaunchMatcher();
        // Placement reports, kept per launch so the daemon can ask what actually happened.
        this._lastReports = new Map();
    }

    export() {
        this._impl.export(Gio.DBus.session, SHELL_OBJECT_PATH);
        this._ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION, SHELL_NAME, Gio.BusNameOwnerFlags.REPLACE, null, null,
            () => console.warn(`gnome-tasks: could not own ${SHELL_NAME}`));
    }

    destroy() {
        if (this._debounceId) {
            GLib.source_remove(this._debounceId);
            this._debounceId = 0;
        }
        if (this._ownerId) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }
        this._impl.unexport();
    }

    /** Call when any window changed; emits WindowsChanged at most every debounce interval. */
    queueWindowsChanged() {
        if (this._debounceId)
            return;

        this._debounceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT_IDLE, WINDOWS_CHANGED_DEBOUNCE_MS, () => {
                this._debounceId = 0;
                this._impl.emit_signal('WindowsChanged',
                    new GLib.Variant('(s)', [this._windowsJson()]));
                return GLib.SOURCE_REMOVE;
            });
    }

    // --- methods ---------------------------------------------------------------------------

    Ping(message) {
        return `gnome-tasks-shell/${API_VERSION} ${message}`;
    }

    ListWindows() {
        return this._windowsJson();
    }

    LaunchApp(desktopId, uris, placement) {
        const wanted = unpackPlacement(placement);

        let result;
        try {
            result = launchApp(desktopId, uris);
        } catch (error) {
            throw new GLib.Error(Gio.DBusError, Gio.DBusError.INVALID_ARGS, error.message);
        }

        return this._matcher.register({
            desktopId,
            uris,
            token: result.token,
            pid: result.pid,
            placement: wanted,
        });
    }

    PlaceWindow(id, placement) {
        const window = findWindow(id);
        if (!window) {
            throw new GLib.Error(Gio.DBusError, Gio.DBusError.INVALID_ARGS,
                `no such window: ${id}`);
        }

        const report = placeWindow(window, unpackPlacement(placement));
        this._lastReports.set(String(id), report);

        // True means "the compositor accepted the request". Whether the client honoured it can only
        // be known later, from GetPlacementReport — a Wayland resize is a negotiation, not an order.
        return true;
    }

    CloseWindow(id) {
        const window = findWindow(id);
        if (!window) {
            throw new GLib.Error(Gio.DBusError, Gio.DBusError.INVALID_ARGS,
                `no such window: ${id}`);
        }
        closeWindow(window);
    }

    /**
     * What the compositor actually did with the last placement for this window, as JSON. This is
     * how the daemon learns that a Wayland client ignored its geometry, instead of assuming.
     */
    GetPlacementReport(id) {
        const report = this._lastReports.get(String(id));
        if (!report)
            return JSON.stringify(null);

        // The verdict is computed now rather than at placement time, because only now can the
        // window's actual frame reflect a configure the client has acknowledged.
        const window = findWindow(id);
        const geometry = report.geometry && window
            ? compareGeometry(report.geometry.requested, window.get_frame_rect())
            : report.geometry;

        return JSON.stringify({ ...report, geometry });
    }

    /**
     * Called for every window once it is identified. If it belongs to a launch we made, apply that
     * launch's placement and tell the daemon which strategy matched — the honest signal about how
     * good the correlation was.
     */
    considerWindow(window) {
        const record = introspectWindow(window, {
            monitorConnectors: this._monitors.byIndex,
        });

        const match = this._matcher.match(record);
        if (!match)
            return null;

        const id = windowId(window);
        if (match.placement && Object.keys(match.placement).length > 0)
            this._lastReports.set(id, placeWindow(window, match.placement));

        // Which strategy matched is the difference between "restored correctly" and "restored
        // something plausible", so it is logged rather than kept internal — tools/experiment-m3.sh
        // reads exactly these lines, and so can anyone debugging a bad restore.
        console.log(`gnome-tasks: launch-matched ${JSON.stringify({
            launchId: match.launchId,
            strategy: match.strategy,
            token: match.token,
            windowStartupId: record.startupId,
            windowId: id,
            appId: record.appId,
            placement: this._lastReports.get(id) ?? null,
        })}`);

        this._impl.emit_signal('LaunchMatched',
            new GLib.Variant('(ss)', [match.launchId, id]));

        return { ...match, windowId: id };
    }

    expireLaunches() {
        return this._matcher.expire();
    }

    // --- properties ------------------------------------------------------------------------

    get ApiVersion() {
        return API_VERSION;
    }

    get ShellVersion() {
        // The running Shell's version, not metadata.json's claim about which versions we support.
        return Config.PACKAGE_VERSION;
    }

    // --- internals -------------------------------------------------------------------------

    _windowsJson() {
        return JSON.stringify({
            windows: introspectAllWindows({ monitorConnectors: this._monitors.byIndex }),
        });
    }
}
