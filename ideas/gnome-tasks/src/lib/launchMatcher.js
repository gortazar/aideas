// Correlating "the window that just appeared" with "the launch I asked for".
//
// This is the hard part of restore, and it is a guess with a hierarchy of confidence:
//
//   token   the window carries the XDG activation token we issued  — correct
//   app-id  a window of the right application appeared in time     — a guess, usually right
//   pid     a window whose pid is the process we spawned           — a guess, right unless the app
//                                                                    re-execs or hands off
//
// Pure logic with an injectable clock, because the whole thing is about time windows and a test
// that sleeps is a test that fails on a loaded machine.

/**
 * How long a launch waits for its window before being given up on. Generous on purpose: a cold
 * application start on a loaded machine is slow, and a measured Calculator launch in a headless
 * session took ~30 s to produce its first window. Giving up early means the window arrives
 * unplaced, which is the failure users would actually notice.
 */
const DEFAULT_TIMEOUT_MS = 90000;

export class LaunchMatcher {
    constructor({ now = () => Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
        this._now = now;
        this._timeoutMs = timeoutMs;
        this._pending = new Map();
        this._nextId = 1;
    }

    /** Launches still waiting for a window, oldest first. */
    get pending() {
        return [...this._pending.values()].sort((a, b) => a.startedAt - b.startedAt);
    }

    /**
     * Record a launch we just asked for. `token` is the XDG activation token, when the platform
     * gave us one; `pid` is the process we spawned, when we know it. Returns the launch id, which
     * the caller reports back to the daemon.
     */
    register({ desktopId, uris = [], token = null, pid = 0, placement = null }) {
        const launchId = `launch-${this._nextId++}`;

        this._pending.set(launchId, {
            launchId,
            desktopId,
            uris: [...uris],
            token,
            pid,
            placement,
            startedAt: this._now(),
        });

        return launchId;
    }

    /**
     * Find the launch this window belongs to, consuming it. Returns
     * `{ launchId, strategy, placement, … }` or null.
     *
     * Windows that are not yet identified never match: per docs/gnome-internals.md a window has no
     * app id at all when it first appears, and matching on an absent id would pick the wrong launch.
     */
    match(record) {
        this.expire();

        if (!record.identified)
            return null;

        const candidates = this.pending;

        const byToken = record.startupId
            ? candidates.find(launch => launch.token && launch.token === record.startupId)
            : null;
        if (byToken)
            return this._take(byToken, 'token');

        const byAppId = candidates.find(launch => launch.desktopId === record.appId);
        if (byAppId)
            return this._take(byAppId, 'app-id');

        const byPid = record.pid
            ? candidates.find(launch => launch.pid && launch.pid === record.pid)
            : null;
        if (byPid)
            return this._take(byPid, 'pid');

        return null;
    }

    /** Drop launches that waited too long, and return them so the caller can report the failure. */
    expire() {
        const deadline = this._now() - this._timeoutMs;
        const expired = [];

        for (const launch of this._pending.values()) {
            if (launch.startedAt < deadline)
                expired.push(launch);
        }
        for (const launch of expired)
            this._pending.delete(launch.launchId);

        return expired;
    }

    forget(launchId) {
        this._pending.delete(launchId);
    }

    _take(launch, strategy) {
        this._pending.delete(launch.launchId);
        return { ...launch, strategy };
    }
}
