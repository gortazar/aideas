import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { LaunchMatcher } from '../../src/lib/launchMatcher.js';
import { describeWindow } from '../../src/lib/windowModel.js';

// A clock we control: matching is all about time windows, and a test that sleeps is a test that
// fails on a loaded machine.
function clock(start = 1000) {
    const state = { now: start };
    return {
        now: () => state.now,
        advance: ms => {
            state.now += ms;
        },
    };
}

function window(overrides = {}) {
    return describeWindow({
        id: 'w1',
        appId: 'org.gnome.Calculator.desktop',
        pid: 4242,
        windowType: 'NORMAL',
        frameRect: { x: 0, y: 0, width: 400, height: 300 },
        ...overrides,
    });
}

suite('LaunchMatcher', () => {
    test('a window is matched to a pending launch by activation token', () => {
        const time = clock();
        const matcher = new LaunchMatcher({ now: time.now });

        const launchId = matcher.register({
            desktopId: 'org.gnome.Calculator.desktop',
            token: 'token-abc',
        });

        const match = matcher.match(window({ startupId: 'token-abc' }));

        assertEquals(match.launchId, launchId);
        assertEquals(match.strategy, 'token');
    });

    // The token is the only strategy that is actually correct; everything else is a guess, and the
    // guesses have to be labelled as such so limitations.md can be honest.
    test('the token wins even when another launch has the same app id', () => {
        const matcher = new LaunchMatcher({ now: clock().now });

        matcher.register({ desktopId: 'org.gnome.Calculator.desktop', token: 'token-1' });
        const second = matcher.register({
            desktopId: 'org.gnome.Calculator.desktop', token: 'token-2',
        });

        const match = matcher.match(window({ startupId: 'token-2' }));

        assertEquals(match.launchId, second);
        assertEquals(match.strategy, 'token');
    });

    test('without a token, the oldest pending launch for that app id matches', () => {
        const time = clock();
        const matcher = new LaunchMatcher({ now: time.now });

        const first = matcher.register({ desktopId: 'org.gnome.Calculator.desktop' });
        time.advance(10);
        matcher.register({ desktopId: 'org.gnome.Calculator.desktop' });

        const match = matcher.match(window());

        assertEquals(match.launchId, first);
        assertEquals(match.strategy, 'app-id');
    });

    test('a pid recorded at spawn time matches a window with that pid', () => {
        const matcher = new LaunchMatcher({ now: clock().now });

        const launchId = matcher.register({ desktopId: 'org.example.Other.desktop', pid: 4242 });
        const match = matcher.match(window({ appId: 'org.gnome.Calculator.desktop' }));

        assertEquals(match.launchId, launchId);
        assertEquals(match.strategy, 'pid');
    });

    test('a matched launch is consumed, so two windows do not claim the same one', () => {
        const matcher = new LaunchMatcher({ now: clock().now });
        matcher.register({ desktopId: 'org.gnome.Calculator.desktop', token: 't' });

        assert(matcher.match(window({ startupId: 't' })) !== null);
        assertEquals(matcher.match(window({ startupId: 't' })), null);
        assertEquals(matcher.pending.length, 0);
    });

    test('an unrelated window matches nothing', () => {
        const matcher = new LaunchMatcher({ now: clock().now });
        matcher.register({ desktopId: 'org.gnome.Calculator.desktop', token: 't' });

        assertEquals(matcher.match(window({ appId: 'org.gnome.Nautilus.desktop', pid: 9 })), null);
        assertEquals(matcher.pending.length, 1, 'the launch is still waiting');
    });

    // Per docs/gnome-internals.md a window has no app id at all when it first appears. Matching one
    // by app id would match nothing; matching it by *absence* would match the wrong launch.
    test('an unidentified window never matches', () => {
        const matcher = new LaunchMatcher({ now: clock().now });
        matcher.register({ desktopId: 'org.gnome.Calculator.desktop' });

        assertEquals(matcher.match(window({ appId: 'window:7' })), null);
        assertEquals(matcher.pending.length, 1);
    });

    test('launches expire, and expiry reports what gave up', () => {
        const time = clock();
        const matcher = new LaunchMatcher({ now: time.now, timeoutMs: 5000 });

        const launchId = matcher.register({ desktopId: 'org.gnome.Calculator.desktop' });

        time.advance(4999);
        assertDeepEquals(matcher.expire(), []);

        time.advance(2);
        assertDeepEquals(matcher.expire().map(l => l.launchId), [launchId]);
        assertEquals(matcher.pending.length, 0);
    });

    test('an expired launch no longer matches its own window', () => {
        const time = clock();
        const matcher = new LaunchMatcher({ now: time.now, timeoutMs: 1000 });
        matcher.register({ desktopId: 'org.gnome.Calculator.desktop', token: 't' });

        time.advance(2000);

        assertEquals(matcher.match(window({ startupId: 't' })), null,
            'a window arriving after the timeout is somebody else\'s');
    });

    test('the placement asked for is handed back with the match', () => {
        const matcher = new LaunchMatcher({ now: clock().now });
        const placement = { workspace: 2, geometry: { x: 10, y: 20, width: 800, height: 600 } };

        matcher.register({ desktopId: 'org.gnome.Calculator.desktop', token: 't', placement });
        const match = matcher.match(window({ startupId: 't' }));

        assertDeepEquals(match.placement, placement);
    });

    test('launch ids are unique', () => {
        const matcher = new LaunchMatcher({ now: clock().now });
        const ids = new Set();
        for (let i = 0; i < 50; i++)
            ids.add(matcher.register({ desktopId: `app-${i}.desktop` }));

        assertEquals(ids.size, 50);
    });
});
