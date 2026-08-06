// How a window is interpreted, separated from how it is read.
//
// The extension extracts plain values from a Meta.Window (see src/extension/windowIntrospect.js)
// and everything that decides what those values *mean* lives here — Shell-free, so the rules that
// came out of the M0 probe are unit tested rather than trusted.

/** Window types that belong to a task's layout. Everything else is the app's own business. */
const CAPTURABLE_WINDOW_TYPES = new Set(['NORMAL']);

/**
 * Shell.WindowTracker returns a synthetic `window:N` id for a window it has not yet matched to an
 * application — which, per docs/gnome-internals.md, is the state *every* window is in at
 * `window-created` time. Treating those as app ids would fill a task with apps called "window:3".
 */
export function isIdentifiedAppId(appId) {
    if (typeof appId !== 'string' || appId.length === 0)
        return false;
    return !/^window:\d+$/.test(appId);
}

/**
 * A frame rect is `0x0` until the client commits a buffer (52 ms – 1.3 s after the window appears,
 * measured). Null means "not known yet"; it must never be recorded as a position.
 */
export function normalizeGeometry(rect) {
    if (!rect)
        return null;
    const { x, y, width, height } = rect;
    if (!(width > 0) || !(height > 0))
        return null;
    return { x, y, width, height };
}

/** Meta.MaximizeFlags is a bitmask: 1 = horizontal, 2 = vertical. */
export function maximizedState(flags) {
    const horizontal = (flags & 1) !== 0;
    const vertical = (flags & 2) !== 0;
    if (horizontal && vertical)
        return 'both';
    if (horizontal)
        return 'horizontal';
    if (vertical)
        return 'vertical';
    return 'none';
}

/**
 * The canonical record for one window: what capture stores and what restore matches against.
 * `identified` and `geometry` carry the two "not known yet" cases explicitly, so a caller can tell
 * an incomplete window from a complete one instead of guessing from empty fields.
 */
export function describeWindow(raw) {
    const gtk = raw.gtkApplicationId || raw.gtkWindowObjectPath
        ? {
            applicationId: raw.gtkApplicationId ?? null,
            windowObjectPath: raw.gtkWindowObjectPath ?? null,
            uniqueBusName: raw.gtkUniqueBusName ?? null,
        }
        : null;

    return {
        id: raw.id,
        appId: raw.appId ?? '',
        identified: isIdentifiedAppId(raw.appId),
        title: raw.title ?? '',
        wmClass: raw.wmClass ?? null,
        pid: raw.pid ?? 0,
        // The XDG activation token / startup id, when the window carries one. Null is the norm:
        // only a window launched with a token we issued should have it (see launchMatcher.js).
        startupId: raw.startupId ?? null,
        windowType: raw.windowType ?? 'NORMAL',
        clientType: raw.clientType ?? 'wayland',
        sandboxedAppId: raw.sandboxedAppId ?? null,
        gtk,
        geometry: normalizeGeometry(raw.frameRect),
        workspaceIndex: raw.workspaceIndex ?? null,
        monitorIndex: raw.monitorIndex ?? null,
        monitorConnector: raw.monitorConnector ?? null,
        maximized: maximizedState(raw.maximized ?? 0),
        fullscreen: Boolean(raw.fullscreen),
        onAllWorkspaces: Boolean(raw.onAllWorkspaces),
        skipTaskbar: Boolean(raw.skipTaskbar),
    };
}

/**
 * Whether this window can go into a saved layout *now*. A false answer is usually temporary: the
 * window has appeared but is not yet identified or not yet sized, and capture should wait for the
 * next signal rather than record a half-known window.
 */
export function canCapture(record) {
    if (!record.identified)
        return false;
    if (!CAPTURABLE_WINDOW_TYPES.has(record.windowType))
        return false;
    if (record.skipTaskbar)
        return false;
    if (record.geometry === null)
        return false;
    return true;
}
