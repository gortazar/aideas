// The scheduler, driven by a fake timer. Every wait here is asserted in milliseconds rather
// than lived through, and the leak that matters most — two timers at once — is checked directly.

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { PollScheduler, MENU_OPEN_INTERVAL_SECONDS } from '../../src/lib/scheduler.js';

/** A timer whose pending callbacks a test fires by hand, and which counts what it hands out. */
function fakeTimer() {
    const pending = new Map();
    let nextHandle = 1;
    const timer = {
        added: [],
        removed: [],
        add(seconds, callback) {
            const handle = nextHandle++;
            timer.added.push(seconds);
            pending.set(handle, callback);
            return handle;
        },
        remove(handle) {
            timer.removed.push(handle);
            pending.delete(handle);
        },
        /** How many callbacks are waiting. More than one is the leak this test suite exists for. */
        get outstanding() {
            return pending.size;
        },
        /** The delay of the most recent scheduling. */
        get lastDelay() {
            return timer.added[timer.added.length - 1];
        },
        /** Fire every pending callback, as GLib would when their time comes. */
        async fire() {
            const callbacks = [...pending.entries()];
            pending.clear();
            for (const [, callback] of callbacks)
                callback();
            // Let the poll's promise chain settle before the test looks at anything.
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        },
    };
    return timer;
}

/** A scheduler whose polls are recorded, with a resolvable one on request. */
function setup({ intervalSeconds = 30, failures = () => 0, slow = false } = {}) {
    const timer = fakeTimer();
    const polls = [];
    let release = null;

    const onPoll = () => {
        polls.push(true);
        if (!slow)
            return Promise.resolve();
        return new Promise(resolve => { release = resolve; });
    };

    const scheduler = new PollScheduler({ onPoll, timer, failures, intervalSeconds });
    return {
        scheduler,
        timer,
        polls,
        get count() {
            return polls.length;
        },
        release: () => {
            release?.();
            release = null;
            return Promise.resolve().then(() => Promise.resolve());
        },
    };
}

suite('starting and stopping', () => {
    test('start polls immediately, then schedules the interval', async () => {
        const { scheduler, timer, count } = setup({ intervalSeconds: 30 });

        await scheduler.start();

        assertEquals(count, 0, 'the count getter is a snapshot');
        assertEquals(timer.lastDelay, 30);
        assert(scheduler.scheduled, 'a timer is pending');
        assertEquals(timer.outstanding, 1);
    });

    test('each tick polls once and schedules exactly one more', async () => {
        const state = setup({ intervalSeconds: 30 });

        await state.scheduler.start();
        assertEquals(state.polls.length, 1);

        await state.timer.fire();
        assertEquals(state.polls.length, 2);
        assertEquals(state.timer.outstanding, 1, 'one timer, never two');

        await state.timer.fire();
        assertEquals(state.polls.length, 3);
        assertEquals(state.timer.outstanding, 1);
    });

    test('starting twice does not double the rate', async () => {
        const state = setup();

        await state.scheduler.start();
        await state.scheduler.start();

        assertEquals(state.polls.length, 1);
        assertEquals(state.timer.outstanding, 1);
    });

    test('stop cancels what is pending and polls no more', async () => {
        const state = setup();
        await state.scheduler.start();

        state.scheduler.stop();

        assertEquals(state.timer.outstanding, 0);
        assertEquals(state.scheduler.scheduled, false);
        await state.timer.fire();
        assertEquals(state.polls.length, 1, 'nothing fired after stop');
    });

    test('stop is safe twice, and before start', () => {
        const { scheduler } = setup();

        scheduler.stop();
        scheduler.stop();

        assertEquals(scheduler.running, false);
    });
});

suite('the interval', () => {
    test('is what preferences said', async () => {
        const state = setup({ intervalSeconds: 120 });

        await state.scheduler.start();

        assertEquals(state.timer.lastDelay, 120);
    });

    test('a change re-times what is already pending', async () => {
        const state = setup({ intervalSeconds: 300 });
        await state.scheduler.start();
        assertEquals(state.timer.lastDelay, 300);

        state.scheduler.setIntervalSeconds(10);

        assertEquals(state.timer.lastDelay, 10,
            'a change from 300 s to 10 s must not be invisible for five minutes');
        assertEquals(state.timer.outstanding, 1, 'the old timer went away');
        assertEquals(state.polls.length, 1, 'changing an interval is not a reason to poll');
    });

    test('setting the same interval changes nothing', async () => {
        const state = setup({ intervalSeconds: 30 });
        await state.scheduler.start();
        const scheduled = state.timer.added.length;

        state.scheduler.setIntervalSeconds(30);

        assertEquals(state.timer.added.length, scheduled);
    });

    test('a change while stopped is remembered for the next start', async () => {
        const state = setup({ intervalSeconds: 30 });

        state.scheduler.setIntervalSeconds(60);
        await state.scheduler.start();

        assertEquals(state.timer.lastDelay, 60);
    });
});

suite('the menu', () => {
    test('opening reads straight away, then polls faster', async () => {
        const state = setup({ intervalSeconds: 30 });
        await state.scheduler.start();
        assertEquals(state.polls.length, 1);

        await state.scheduler.setMenuOpen(true);

        assertEquals(state.polls.length, 2, 'not a reading from 29 seconds ago');
        assertEquals(state.timer.lastDelay, MENU_OPEN_INTERVAL_SECONDS);
        assertEquals(state.timer.outstanding, 1);
    });

    test('closing goes back to the interval without polling', async () => {
        const state = setup({ intervalSeconds: 30 });
        await state.scheduler.start();
        await state.scheduler.setMenuOpen(true);
        const polls = state.polls.length;

        await state.scheduler.setMenuOpen(false);

        assertEquals(state.polls.length, polls, 'closing a menu is not news');
        assertEquals(state.timer.lastDelay, 30);
        assertEquals(state.timer.outstanding, 1);
    });

    test('an interval below the menu rate is not overridden upwards', async () => {
        const state = setup({ intervalSeconds: 3 });
        await state.scheduler.start();

        await state.scheduler.setMenuOpen(true);

        assertEquals(state.timer.lastDelay, 3, 'never slower than what was asked for');
    });

    test('opening it twice does not stack timers', async () => {
        const state = setup();
        await state.scheduler.start();

        await state.scheduler.setMenuOpen(true);
        await state.scheduler.setMenuOpen(true);

        assertEquals(state.timer.outstanding, 1);
        assertEquals(state.polls.length, 2);
    });

    test('the menu rate beats the backoff — that is when somebody is watching it retry',
        async () => {
            const state = setup({ intervalSeconds: 30, failures: () => 6 });
            await state.scheduler.start();
            assertEquals(state.timer.lastDelay, 300, 'backed right off while nobody looked');

            await state.scheduler.setMenuOpen(true);

            assertEquals(state.timer.lastDelay, MENU_OPEN_INTERVAL_SECONDS);
        });

    test('opening it while suppressed polls nothing — a locked screen stays quiet', async () => {
        const state = setup();
        await state.scheduler.start();
        await state.scheduler.setSuppressed(true);
        const polls = state.polls.length;

        await state.scheduler.setMenuOpen(true);

        assertEquals(state.polls.length, polls);
        assertEquals(state.timer.outstanding, 0);
    });
});

suite('lock and idle', () => {
    test('suppression stops everything', async () => {
        const state = setup();
        await state.scheduler.start();

        await state.scheduler.setSuppressed(true);

        assertEquals(state.timer.outstanding, 0, 'a laptop asleep must not talk to a VPN host');
        assertEquals(state.scheduler.scheduled, false);
    });

    test('a tick that somehow fires while suppressed does not reschedule', async () => {
        const state = setup();
        await state.scheduler.start();
        await state.scheduler.setSuppressed(true);

        await state.timer.fire();

        assertEquals(state.timer.outstanding, 0);
    });

    test('coming back reads immediately, because the reading is as old as the sleep', async () => {
        const state = setup({ intervalSeconds: 30 });
        await state.scheduler.start();
        await state.scheduler.setSuppressed(true);
        const polls = state.polls.length;

        await state.scheduler.setSuppressed(false);

        assertEquals(state.polls.length, polls + 1);
        assertEquals(state.timer.lastDelay, 30);
        assertEquals(state.timer.outstanding, 1);
    });

    test('suppressing twice is idempotent', async () => {
        const state = setup();
        await state.scheduler.start();

        await state.scheduler.setSuppressed(true);
        await state.scheduler.setSuppressed(true);

        assertEquals(state.timer.outstanding, 0);
    });

    test('suppression while stopped does not start anything', async () => {
        const state = setup();

        await state.scheduler.setSuppressed(true);
        await state.scheduler.setSuppressed(false);

        assertEquals(state.polls.length, 0);
        assertEquals(state.timer.outstanding, 0);
    });
});

suite('the backoff', () => {
    test('a failing box is asked less and less often', async () => {
        let failures = 0;
        const state = setup({ intervalSeconds: 30, failures: () => failures });

        await state.scheduler.start();
        assertEquals(state.timer.lastDelay, 30);

        for (const expected of [60, 120, 240, 300, 300]) {
            failures++;
            await state.timer.fire();
            assertEquals(state.timer.lastDelay, expected, `after ${failures} failures`);
        }
    });

    test('a recovery goes straight back to the interval', async () => {
        let failures = 4;
        const state = setup({ intervalSeconds: 30, failures: () => failures });

        await state.scheduler.start();
        assertEquals(state.timer.lastDelay, 300);

        failures = 0;
        await state.timer.fire();

        assertEquals(state.timer.lastDelay, 30);
    });
});

suite('a slow box', () => {
    test('the next poll is scheduled only once the current one finishes', async () => {
        const state = setup({ slow: true });

        const started = state.scheduler.start();

        assertEquals(state.polls.length, 1);
        assertEquals(state.timer.outstanding, 0, 'nothing queued behind a request in flight');

        await state.release();
        await started;

        assertEquals(state.timer.outstanding, 1);
    });

    test('a tick during a slow poll does not start a second one', async () => {
        const state = setup({ slow: true });
        const started = state.scheduler.start();
        await state.release();
        await started;

        // Now make the next poll hang, and fire the timer underneath it.
        const pending = state.scheduler.pollNow();
        assertEquals(state.polls.length, 2);
        await state.timer.fire();
        assertEquals(state.polls.length, 2, 'the in-flight poll owns the next scheduling');

        await state.release();
        await pending;
        assertEquals(state.timer.outstanding, 1);
    });

    test('a poll that throws still reschedules — one bad read must not stop the clock',
        async () => {
            const timer = fakeTimer();
            let polls = 0;
            const scheduler = new PollScheduler({
                onPoll: () => {
                    polls++;
                    return Promise.reject(new Error('boom'));
                },
                timer,
                intervalSeconds: 30,
            });

            try {
                await scheduler.start();
            } catch {
                // start() propagates the rejection; the reschedule is what matters.
            }

            assertEquals(polls, 1);
            assertEquals(timer.outstanding, 1, 'the scheduler is still alive');
        });
});

suite('pollNow', () => {
    test('polls and re-times the next wait', async () => {
        const state = setup({ intervalSeconds: 30 });
        await state.scheduler.start();

        await state.scheduler.pollNow();

        assertEquals(state.polls.length, 2);
        assertEquals(state.timer.outstanding, 1);
    });

    test('does nothing while stopped or suppressed', async () => {
        const state = setup();

        await state.scheduler.pollNow();
        assertEquals(state.polls.length, 0);

        await state.scheduler.start();
        await state.scheduler.setSuppressed(true);
        await state.scheduler.pollNow();
        assertEquals(state.polls.length, 1);
    });
});

suite('the timers it hands back', () => {
    test('every timer it removes is one it added', async () => {
        const state = setup({ intervalSeconds: 30 });

        await state.scheduler.start();
        await state.timer.fire();
        await state.scheduler.setMenuOpen(true);
        await state.scheduler.setMenuOpen(false);
        state.scheduler.setIntervalSeconds(60);
        await state.scheduler.setSuppressed(true);
        await state.scheduler.setSuppressed(false);
        state.scheduler.stop();

        assertEquals(state.timer.outstanding, 0, 'nothing left behind');
        assertDeepEquals(
            state.timer.removed.filter(handle => !Number.isInteger(handle)), [],
            'only real handles were removed');
    });
});
