// Launching apps and placing windows — the two things that can only be done from inside the
// compositor, and the two things most likely to be refused by it.
//
// Everything here reports what actually happened rather than assuming success: whether Mutter
// honours move_resize_frame() for a given Wayland client is not knowable in advance, so
// PlaceWindow returns whether the geometry stuck, and the daemon (and docs/limitations.md) get to
// be honest about it.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** How close the resulting frame has to be to the requested one to count as honoured. */
const GEOMETRY_TOLERANCE_PX = 2;

/**
 * Compare a requested rect with one read later. Separate from placeWindow() because a Wayland
 * geometry change is a *request*: Mutter sends a configure event, the client acknowledges it and
 * commits a new buffer, and only then does get_frame_rect() change. Reading the frame straight
 * after move_resize_frame() returns the OLD rect and makes every placement look refused — which is
 * exactly the wrong conclusion, and the one the first version of this code drew.
 */
export function compareGeometry(requested, actual) {
    if (!requested || !actual)
        return null;

    const applied = { x: actual.x, y: actual.y, width: actual.width, height: actual.height };
    // A 0x0 frame means the client has not committed a buffer yet, so the answer is "not known".
    if (!(applied.width > 0) || !(applied.height > 0))
        return { requested, applied, honoured: null, reason: 'no buffer committed yet' };

    const honoured =
        Math.abs(applied.x - requested.x) <= GEOMETRY_TOLERANCE_PX &&
        Math.abs(applied.y - requested.y) <= GEOMETRY_TOLERANCE_PX &&
        Math.abs(applied.width - requested.width) <= GEOMETRY_TOLERANCE_PX &&
        Math.abs(applied.height - requested.height) <= GEOMETRY_TOLERANCE_PX;

    return { requested, applied, honoured };
}

/**
 * Launch a desktop app with documents, carrying an activation token so the window it produces can
 * be matched back to this request.
 *
 * Returns `{ token, pid }`. The token is null when the platform declined to issue one, which is
 * itself a finding worth reporting rather than hiding.
 */
export function launchApp(desktopId, uris = []) {
    const appInfo = Gio.DesktopAppInfo.new(desktopId);
    if (!appInfo)
        throw new Error(`no such desktop file: ${desktopId}`);

    // The Shell's launch context is what carries XDG_ACTIVATION_TOKEN / DESKTOP_STARTUP_ID; a
    // plain Gio launch context would not, which is why this cannot live in the daemon.
    const context = global.create_app_launch_context(0, -1);

    let token = null;
    try {
        // get_startup_notify_id() is what the token will be, and asking for it is also what makes
        // the context emit one.
        token = context.get_startup_notify_id(appInfo, uris.map(uri => Gio.File.new_for_uri(uri)));
    } catch (error) {
        console.warn(`gnome-tasks: no startup notification id: ${error}`);
    }

    let pid = 0;
    const pidWatcher = context.connect('launched', (ctx, info, platformData) => {
        const data = platformData.deepUnpack();
        pid = data.pid?.deepUnpack?.() ?? data.pid ?? 0;
    });

    try {
        if (uris.length > 0)
            appInfo.launch_uris(uris, context);
        else
            appInfo.launch([], context);
    } finally {
        context.disconnect(pidWatcher);
    }

    return { token, pid };
}

/**
 * Apply a saved placement to a window. `placement` may carry `workspace`, `geometry`,
 * `maximized` and `fullscreen`; anything absent is left alone.
 *
 * Returns a report of what was requested and what the compositor actually did — the answer to
 * "does Wayland geometry control work?" for this client.
 */
export function placeWindow(window, placement = {}) {
    const report = { workspace: null, geometry: null, maximized: null, fullscreen: null };

    if (Number.isInteger(placement.workspace) && placement.workspace >= 0) {
        const manager = global.workspace_manager;
        // A saved layout can name a workspace that no longer exists — with dynamic workspaces that
        // is the normal case, not an error.
        const index = Math.min(placement.workspace, manager.get_n_workspaces() - 1);
        const workspace = manager.get_workspace_by_index(index);
        if (workspace) {
            window.change_workspace(workspace);
            report.workspace = {
                requested: placement.workspace,
                applied: window.get_workspace()?.index() ?? null,
            };
        }
    }

    // Unmaximise before moving: Mutter ignores a move on a maximised window, and the saved
    // geometry is the unmaximised one anyway.
    if (placement.maximized === 'none' || placement.geometry)
        window.unmaximize(Meta.MaximizeFlags.BOTH);

    if (placement.geometry) {
        const { x, y, width, height } = placement.geometry;
        const before = window.get_frame_rect();
        window.move_resize_frame(true, x, y, width, height);

        // No verdict here: the client has not had a chance to respond yet. The requested rect is
        // recorded so it can be compared against reality later (see compareGeometry).
        report.geometry = {
            requested: { x, y, width, height },
            before: { x: before.x, y: before.y, width: before.width, height: before.height },
            honoured: null,
        };
    }

    if (placement.maximized && placement.maximized !== 'none') {
        const flags = placement.maximized === 'both'
            ? Meta.MaximizeFlags.BOTH
            : placement.maximized === 'horizontal'
                ? Meta.MaximizeFlags.HORIZONTAL
                : Meta.MaximizeFlags.VERTICAL;
        window.maximize(flags);
        report.maximized = { requested: placement.maximized, applied: window.get_maximized() };
    }

    if (typeof placement.fullscreen === 'boolean') {
        if (placement.fullscreen)
            window.make_fullscreen();
        else
            window.unmake_fullscreen();
        report.fullscreen = {
            requested: placement.fullscreen,
            applied: window.is_fullscreen(),
        };
    }

    return report;
}

/**
 * Ask a window to close the way a user would: politely, so the app's own "save changes?" dialog
 * gets its say. Never kills a pid.
 */
export function closeWindow(window) {
    window.delete(global.get_current_time());
}

/** Find a managed window by the id windowIntrospect gives it. */
export function findWindow(windowId) {
    for (const actor of global.get_window_actors()) {
        const window = actor.meta_window;
        if (window && String(window.get_id()) === String(windowId))
            return window;
    }
    return null;
}

/** Placement as it comes off the bus: a{sv} with plain values inside. */
export function unpackPlacement(variantDict = {}) {
    const placement = {};

    for (const [key, variant] of Object.entries(variantDict)) {
        const value = variant instanceof GLib.Variant ? variant.recursiveUnpack() : variant;
        switch (key) {
            case 'workspace':
                placement.workspace = Number(value);
                break;
            case 'geometry':
                // Sent as {x, y, width, height}; a partial rect is not usable.
                if (value && ['x', 'y', 'width', 'height'].every(k => k in value)) {
                    placement.geometry = {
                        x: Number(value.x), y: Number(value.y),
                        width: Number(value.width), height: Number(value.height),
                    };
                }
                break;
            case 'maximized':
                placement.maximized = String(value);
                break;
            case 'fullscreen':
                placement.fullscreen = Boolean(value);
                break;
            case 'monitorConnector':
                placement.monitorConnector = String(value);
                break;
            default:
                // Unknown keys are ignored rather than rejected: an older extension talking to a
                // newer daemon should degrade, not fail.
                break;
        }
    }

    return placement;
}

/** Where the pointer-independent "current" monitor is, for placement without a saved monitor. */
export function primaryMonitorIndex() {
    return Main.layoutManager.primaryIndex;
}
