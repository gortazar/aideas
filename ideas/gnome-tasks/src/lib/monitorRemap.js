// Making a saved layout usable on a desktop that has changed shape since.
//
// A layout records absolute geometry plus the connector name of the monitor the window was on
// (`DP-2`, `eDP-1`), because Mutter's monitor *indices* renumber when displays are plugged or
// unplugged — see docs/gnome-internals.md. Restoring that geometry unchanged onto a laptop that is no
// longer docked would put the window at x=2000 on a 1920-wide screen: off-screen, and effectively
// lost.
//
// So the rule is: if the monitor is still there, place exactly as saved; if it is gone, move the
// window to the primary monitor, keeping where it sat *proportionally* and shrinking it if it no
// longer fits. Pure, so all of it is tested without a compositor.

/**
 * `placement` as it should be applied on the monitor set `monitors` (as reported by
 * org.gnome.Tasks.Shell.ListMonitors: connector, x, y, width, height, primary).
 */
export function remapPlacement(placement, monitors) {
    if (!placement?.monitorConnector || !Array.isArray(monitors) || monitors.length === 0)
        return placement;

    const saved = monitors.find(monitor => monitor.connector === placement.monitorConnector);
    if (saved)
        return placement;

    const target = monitors.find(monitor => monitor.primary) ?? monitors[0];

    if (!placement.geometry)
        return { ...placement, monitorConnector: target.connector };

    return {
        ...placement,
        monitorConnector: target.connector,
        geometry: fit(placement.geometry, target, placement.monitorGeometry),
    };
}

/**
 * Move and shrink a rect so it sits inside `monitor`.
 *
 * When the layout recorded the *old* monitor's geometry (capture does, since M3), the window keeps its
 * proportional place: a window a quarter of the way across a 2560-wide screen lands a quarter of the
 * way across a 1920-wide one. Without it — a layout written before that was recorded — the absolute
 * position modulo the new monitor's size at least keeps the window on screen and roughly where it was
 * along the desktop.
 */
function fit(geometry, monitor, sourceMonitor) {
    const width = Math.min(geometry.width, monitor.width);
    const height = Math.min(geometry.height, monitor.height);

    let relativeX;
    let relativeY;

    if (sourceMonitor?.width > 0 && sourceMonitor?.height > 0) {
        const fractionX = (geometry.x - (sourceMonitor.x ?? 0)) / sourceMonitor.width;
        const fractionY = (geometry.y - (sourceMonitor.y ?? 0)) / sourceMonitor.height;
        relativeX = Math.round(fractionX * monitor.width);
        relativeY = Math.round(fractionY * monitor.height);
    } else {
        relativeX = ((geometry.x % monitor.width) + monitor.width) % monitor.width;
        relativeY = ((geometry.y % monitor.height) + monitor.height) % monitor.height;
    }

    return {
        x: monitor.x + clamp(relativeX, 0, monitor.width - width),
        y: monitor.y + clamp(relativeY, 0, monitor.height - height),
        width,
        height,
    };
}

function clamp(value, low, high) {
    return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * Where the 'hide' deactivation policy parks a task's windows: the last workspace.
 *
 * With dynamic workspaces GNOME always keeps one empty workspace at the end, so parking there
 * displaces nothing the user arranged. With static workspaces the last one is a deliberate choice by
 * the user, so this is a compromise rather than a perfect answer — and with only one workspace there
 * is nowhere out of sight at all, which the caller has to handle.
 */
export function parkingWorkspace(workspaces) {
    const count = workspaces?.count ?? 0;
    if (!Number.isInteger(count) || count < 2)
        return null;
    return count - 1;
}
