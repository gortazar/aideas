// Turning windows into a saved layout, and a saved layout back into a plan of action.
//
// Both directions are pure functions of plain data, so the decisions that matter — what is worth
// recording, what counts as a change, what to launch versus what to move — are unit tested without
// a compositor anywhere near them.

import { canCapture } from './windowModel.js';

/**
 * The layout of a task: one entry per window worth restoring, in a stable order.
 *
 * Stability matters more than it looks. Capture runs continuously and compares its result with what
 * is on disk to decide whether to write; an order that followed the stacking order would make every
 * click look like a change.
 */
export function layoutFromWindows(windows, {
    excludedAppIds = [], documents = null, browserWindowId = null, monitors = null,
} = {}) {
    const monitorByConnector = new Map(
        (monitors ?? []).filter(monitor => monitor.connector)
            .map(monitor => [monitor.connector, monitor]));
    const excluded = new Set(excludedAppIds);

    return windows
        .filter(window => canCapture(window) && !excluded.has(window.appId))
        .map(window => ({
            appId: window.appId,
            title: window.title,
            // From the per-app adapters (src/lib/adapters/), which the daemon wires up because they
            // need to read /proc. Empty means "launch with no document", which is the tier-0 answer.
            documents: documents ? documents(window) : [],
            // Which of a browser's own windows this is, when the two could be correlated (see
            // src/lib/browserState.js). Absent for everything else, and absent for a browser window
            // whose title matched nothing — in which case restore loses the per-window split.
            ...(browserWindowId?.(window) != null
                ? { browserWindowId: browserWindowId(window) }
                : {}),
            placement: {
                workspace: window.workspaceIndex,
                geometry: { ...window.geometry },
                maximized: window.maximized,
                fullscreen: window.fullscreen,
                monitorConnector: window.monitorConnector,
                // The monitor's own geometry, so that if this display is gone at restore time the
                // window can keep its proportional place rather than just being clamped on screen.
                ...(monitorByConnector.has(window.monitorConnector)
                    ? { monitorGeometry: rectOf(monitorByConnector.get(window.monitorConnector)) }
                    : {}),
            },
        }))
        .sort(compareEntries);
}

function rectOf(monitor) {
    return { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height };
}

function compareEntries(a, b) {
    if (a.appId !== b.appId)
        return a.appId < b.appId ? -1 : 1;
    const aPlace = a.placement ?? {};
    const bPlace = b.placement ?? {};
    if ((aPlace.workspace ?? 0) !== (bPlace.workspace ?? 0))
        return (aPlace.workspace ?? 0) - (bPlace.workspace ?? 0);
    const aGeometry = aPlace.geometry ?? { x: 0, y: 0 };
    const bGeometry = bPlace.geometry ?? { x: 0, y: 0 };
    if (aGeometry.x !== bGeometry.x)
        return aGeometry.x - bGeometry.x;
    return aGeometry.y - bGeometry.y;
}

/**
 * Whether two layouts are the same for persistence purposes. Titles are excluded: they change
 * constantly (a browser shows the page, an editor the cursor position) and writing the task file on
 * every keystroke would be absurd.
 */
export function sameLayout(a, b) {
    return JSON.stringify(a.map(withoutTitle)) === JSON.stringify(b.map(withoutTitle));
}

function withoutTitle({ title: _title, ...rest }) {
    return rest;
}

/**
 * What to do to make the desktop match `layout`.
 *
 * `launches` are applications to start, `places` are windows already open that belong to the layout
 * and only need moving, and `untouched` are windows the task knows nothing about — listed rather
 * than silently ignored, because the deactivation policy needs them.
 *
 * Re-activating a task that is already up must not open a second copy of everything, which is why
 * existing windows are consumed one per layout entry.
 */
export function restorePlan(layout, currentWindows) {
    const available = new Map();
    for (const window of currentWindows) {
        if (!available.has(window.appId))
            available.set(window.appId, []);
        available.get(window.appId).push(window);
    }

    const launches = [];
    const places = [];
    const consumed = new Set();

    for (const entry of layout) {
        const candidates = available.get(entry.appId) ?? [];
        const existing = candidates.find(window => !consumed.has(window.id));

        if (existing) {
            consumed.add(existing.id);
            places.push({ windowId: existing.id, placement: entry.placement ?? {} });
        } else {
            launches.push({
                appId: entry.appId,
                uris: [...(entry.documents ?? [])],
                placement: entry.placement ?? {},
            });
        }
    }

    return {
        launches,
        places,
        untouched: currentWindows.filter(window => !consumed.has(window.id)),
    };
}
