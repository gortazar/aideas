import { suite, test, assertEquals } from '../harness.js';
import { formatDuration, formatAge } from '../../src/lib/duration.js';

suite('formatDuration', () => {
    test('seconds below a minute', () => {
        assertEquals(formatDuration(0), '0 s');
        assertEquals(formatDuration(8), '8 s');
        assertEquals(formatDuration(59), '59 s');
    });

    test('rounds to the nearest second', () => {
        assertEquals(formatDuration(8.4), '8 s');
        assertEquals(formatDuration(8.6), '9 s');
    });

    test('whole minutes, truncated — a cycle is 12 min, not 12.7', () => {
        assertEquals(formatDuration(60), '1 min');
        assertEquals(formatDuration(12 * 60 + 45), '12 min');
        assertEquals(formatDuration(3599), '59 min');
    });

    test('hours carry their minutes, and drop them when there are none', () => {
        assertEquals(formatDuration(3600), '1 h');
        assertEquals(formatDuration(2 * 3600 + 5 * 60), '2 h 5 min');
        assertEquals(formatDuration(2 * 3600 + 59), '2 h');
    });

    test('days carry their hours', () => {
        assertEquals(formatDuration(24 * 3600), '1 d');
        assertEquals(formatDuration(3 * 24 * 3600 + 4 * 3600), '3 d 4 h');
    });

    test('a negative span is clock skew, clamped rather than shown', () => {
        assertEquals(formatDuration(-1), '0 s');
        assertEquals(formatDuration(-9999), '0 s');
    });

    test('an unknown span is null, so the caller can omit the phrase', () => {
        assertEquals(formatDuration(null), null);
        assertEquals(formatDuration(undefined), null);
        assertEquals(formatDuration(NaN), null);
        assertEquals(formatDuration(Infinity), null);
        assertEquals(formatDuration('42'), null);
        assertEquals(formatDuration({}), null);
    });
});

suite('formatAge', () => {
    test('the first few seconds are "just now"', () => {
        assertEquals(formatAge(0), 'just now');
        assertEquals(formatAge(4.9), 'just now');
    });

    test('after that it counts', () => {
        assertEquals(formatAge(5), '5 s ago');
        assertEquals(formatAge(8), '8 s ago');
        assertEquals(formatAge(12 * 60), '12 min ago');
    });

    test('a negative age is skew, and reads as just now', () => {
        assertEquals(formatAge(-2), 'just now');
    });

    test('an unknown age is null — different from "0 s ago"', () => {
        assertEquals(formatAge(null), null);
        assertEquals(formatAge(undefined), null);
    });
});
