// "Is anybody there?", for the scheduler.
//
// Two things stop the extension talking to a VPN host that nobody is waiting on:
//
//   * **The screen lock** needs no code at all. This extension declares no `session-modes`, so
//     GNOME disables it outright when the session locks and enables it again on unlock —
//     `disable()` stops the scheduler and drops the Soup session. Locking is therefore the
//     strongest form of suppression there is, and it is free.
//   * **Idleness** is this file. A screen that has blanked without locking leaves the extension
//     running, and polling a box every 30 s for an hour while its owner is at lunch is exactly
//     the battery cost the plan calls out. Mutter's idle monitor is what the Shell itself uses
//     for this.
//
// Shell-only, so it is verified by the compositor smoke test rather than headlessly.

const DEFAULT_IDLE_SECONDS = 120;

export class IdleWatcher {
    /**
     * @param {object} options
     * @param {function(): void} options.onIdle    the session went idle
     * @param {function(): void} options.onActive  somebody came back
     * @param {number} [options.idleSeconds]
     */
    constructor({ onIdle, onActive, idleSeconds = DEFAULT_IDLE_SECONDS }) {
        this._onIdle = onIdle;
        this._onActive = onActive;
        this._idleWatch = null;
        this._activeWatch = null;

        // Wrapped: an extension that throws in enable() is disabled by the Shell, and losing
        // the whole panel button over a monitor that could not be obtained is a bad trade for
        // a battery optimisation.
        try {
            this._monitor = global.backend.get_core_idle_monitor();
        } catch (error) {
            logError(error, 'aideas: no idle monitor; polling will not pause when idle');
            this._monitor = null;
            return;
        }

        this._idleWatch = this._monitor.add_idle_watch(idleSeconds * 1000, () => {
            this._onIdle?.();
            this._watchForUser();
        });
    }

    /** One-shot: fires the moment the user touches anything. */
    _watchForUser() {
        if (this._monitor === null || this._activeWatch !== null)
            return;
        this._activeWatch = this._monitor.add_user_active_watch(() => {
            // Mutter removes a user-active watch as it fires, so the id is already dead here.
            this._activeWatch = null;
            this._onActive?.();
        });
    }

    destroy() {
        if (this._monitor !== null) {
            for (const watch of [this._idleWatch, this._activeWatch]) {
                if (watch !== null)
                    this._monitor.remove_watch(watch);
            }
        }
        this._idleWatch = null;
        this._activeWatch = null;
        this._monitor = null;
        this._onIdle = null;
        this._onActive = null;
    }
}
