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
export function layoutFromWindows(windows, { excludedAppIds = [] } = {}) {
    const excluded = new Set(excludedAppIds);

    return windows
        .filter(window => canCapture(window) && !excluded.has(window.appId))
        .map(window => ({
            appId: window.appId,
            title: window.title,
            // Filled in by the tier-1 adapters in M4; empty means "launch with no document".
            documents: [],
            placement: {
                workspace: window.workspaceIndex,
                geometry: { ...window.geometry },
                maximized: window.maximized,
                fullscreen: window.fullscreen,
                monitorConnector: window.monitorConnector,
            },
        }))
        .sort(compareEntries);
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
