// A deliberately tiny test harness. Runs under plain `gjs -m`, no npm, no network.
//
// Tests register themselves with test()/suite() and the runner (tests/run.js) imports every
// *.test.js under tests/ and then calls runAll(). Keeping this in-tree rather than pulling a
// framework in means the unit tests stay runnable inside the same sandboxed `nix flake check`
// that has no network access.

const registered = [];
let currentSuite = null;

export function suite(name, fn) {
    const previous = currentSuite;
    currentSuite = previous ? `${previous} › ${name}` : name;
    try {
        fn();
    } finally {
        currentSuite = previous;
    }
}

export function test(name, fn) {
    registered.push({ name: currentSuite ? `${currentSuite} › ${name}` : name, fn });
}

export class AssertionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AssertionError';
    }
}

function show(value) {
    if (typeof value === 'string')
        return JSON.stringify(value);
    if (value === undefined)
        return 'undefined';
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function assert(condition, message = 'assertion failed') {
    if (!condition)
        throw new AssertionError(message);
}

export function assertEquals(actual, expected, message = '') {
    if (actual !== expected) {
        throw new AssertionError(
            `${message ? `${message}: ` : ''}expected ${show(expected)}, got ${show(actual)}`);
    }
}

export function assertDeepEquals(actual, expected, message = '') {
    const a = JSON.stringify(sortKeys(actual));
    const b = JSON.stringify(sortKeys(expected));
    if (a !== b)
        throw new AssertionError(`${message ? `${message}: ` : ''}expected ${b}, got ${a}`);
}

export function assertThrows(fn, message = 'expected a throw') {
    try {
        fn();
    } catch (error) {
        return error;
    }
    throw new AssertionError(message);
}

export function assertMatch(actual, regex, message = '') {
    if (!regex.test(actual)) {
        throw new AssertionError(
            `${message ? `${message}: ` : ''}expected ${show(actual)} to match ${regex}`);
    }
}

// Stable-key deep clone so assertDeepEquals does not depend on property insertion order.
function sortKeys(value) {
    if (Array.isArray(value))
        return value.map(sortKeys);
    if (value === null || typeof value !== 'object')
        return value;
    const out = {};
    for (const key of Object.keys(value).sort())
        out[key] = sortKeys(value[key]);
    return out;
}

export async function runAll({ log = print } = {}) {
    let passed = 0;
    const failures = [];

    for (const { name, fn } of registered) {
        try {
            await fn();
            passed++;
            log(`  ok   ${name}`);
        } catch (error) {
            failures.push({ name, error });
            log(`  FAIL ${name}`);
            log(`       ${error.message}`);
            if (!(error instanceof AssertionError) && error.stack)
                log(error.stack.split('\n').map(l => `       ${l}`).join('\n'));
        }
    }

    log('');
    log(`${passed} passed, ${failures.length} failed, ${registered.length} total`);
    return failures.length === 0;
}
