import { suite, test, assertEquals, assert } from '../harness.js';
import {
    nextDelaySeconds, DEFAULT_CEILING_SECONDS,
} from '../../src/lib/backoff.js';

suite('nextDelaySeconds', () => {
    test('a success polls at the configured interval', () => {
        assertEquals(nextDelaySeconds({ intervalSeconds: 30, failures: 0 }), 30);
        assertEquals(nextDelaySeconds({ intervalSeconds: 10, failures: 0 }), 10);
    });

    test('failures double the wait, up to the ceiling', () => {
        const delays = [0, 1, 2, 3, 4, 5, 6].map(failures =>
            nextDelaySeconds({ intervalSeconds: 30, failures }));

        assertEquals(delays.join(','), '30,60,120,240,300,300,300');
    });

    test('the ceiling is five minutes by default', () => {
        assertEquals(nextDelaySeconds({ intervalSeconds: 30, failures: 20 }),
            DEFAULT_CEILING_SECONDS);
    });

    test('a huge failure count does not overflow into Infinity', () => {
        const delay = nextDelaySeconds({ intervalSeconds: 30, failures: 100000 });

        assert(Number.isFinite(delay), 'a delay must be a number somebody can wait for');
        assertEquals(delay, DEFAULT_CEILING_SECONDS);
    });

    test('an interval longer than the ceiling wins — it was asked for explicitly', () => {
        assertEquals(nextDelaySeconds({ intervalSeconds: 600, failures: 0 }), 600);
        assertEquals(nextDelaySeconds({ intervalSeconds: 600, failures: 5 }), 600);
    });

    test('the ceiling and factor are configurable', () => {
        assertEquals(nextDelaySeconds({
            intervalSeconds: 10, failures: 3, ceilingSeconds: 60, factor: 3,
        }), 60);
        assertEquals(nextDelaySeconds({
            intervalSeconds: 10, failures: 1, ceilingSeconds: 60, factor: 3,
        }), 30);
    });

    test('nonsense in gives the default interval, not NaN', () => {
        for (const intervalSeconds of [0, -5, NaN, Infinity, null, undefined, '30'])
            assertEquals(nextDelaySeconds({ intervalSeconds, failures: 0 }), 30,
                `for ${JSON.stringify(intervalSeconds)}`);
    });

    test('a nonsense failure count is treated as none', () => {
        for (const failures of [-1, 1.5, NaN, null, '3', undefined])
            assertEquals(nextDelaySeconds({ intervalSeconds: 30, failures }), 30,
                `for ${JSON.stringify(failures)}`);
    });

    test('never below the interval, never above the ceiling', () => {
        for (let failures = 0; failures < 40; failures++) {
            const delay = nextDelaySeconds({ intervalSeconds: 15, failures, ceilingSeconds: 200 });
            assert(delay >= 15 && delay <= 200, `${failures} failures gave ${delay}`);
        }
    });
});
