// The only place that touches Meta.Window.
//
// Its job is extraction, not interpretation: pull plain values out of the compositor and hand them
// to src/lib/windowModel.js, which decides what they mean and is unit tested without a compositor.
// Keeping the split sharp is what stops window rules from becoming untestable.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import { describeWindow } from './lib/windowModel.js';

function windowTypeName(window) {
    const type = window.get_window_type();
    for (const [name, value] of Object.entries(Meta.WindowType)) {
        if (value === type)
            return name;
    }
    return `UNKNOWN(${type})`;
}

function clientTypeName(window) {
    try {
        return window.get_client_type() === Meta.WindowClientType.X11 ? 'x11' : 'wayland';
    } catch {
        return 'wayland';
    }
}

/**
 * A stable-within-this-session identifier. Meta's own ids are not persistable, which is fine: they
 * only ever have to survive long enough to correlate a capture with a placement request.
 */
export function windowId(window) {
    return String(window.get_id());
}

/** Connector names (DP-1, eDP-1) come from DisplayConfig; see monitors.js. */
export function introspectWindow(window, { monitorConnectors = [] } = {}) {
    const tracker = Shell.WindowTracker.get_default();
    const app = tracker.get_window_app(window);
    const monitorIndex = window.get_monitor();

    return describeWindow({
        id: windowId(window),
        appId: app ? app.get_id() : '',
        title: window.get_title(),
        wmClass: window.get_wm_class(),
        pid: window.get_pid(),
        startupId: window.get_startup_id(),
        windowType: windowTypeName(window),
        clientType: clientTypeName(window),
        gtkApplicationId: window.get_gtk_application_id(),
        gtkWindowObjectPath: window.get_gtk_window_object_path(),
        gtkUniqueBusName: window.get_gtk_unique_bus_name(),
        sandboxedAppId: window.get_sandboxed_app_id(),
        frameRect: window.get_frame_rect(),
        workspaceIndex: window.get_workspace()?.index() ?? null,
        monitorIndex,
        monitorConnector: monitorConnectors[monitorIndex] ?? null,
        maximized: window.get_maximized(),
        fullscreen: window.is_fullscreen(),
        onAllWorkspaces: window.is_on_all_workspaces(),
        skipTaskbar: window.is_skip_taskbar(),
    });
}

/** Every window the compositor currently manages, in stacking order. */
export function introspectAllWindows(options) {
    return global.get_window_actors()
        .map(actor => actor.meta_window)
        .filter(window => window !== null)
        .map(window => introspectWindow(window, options));
}
