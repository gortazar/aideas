// A test harness small enough to read in one sitting. No dependencies beyond GLib, so the
// whole suite runs under plain `gjs -m tests/run.js` with no display and no compositor.

const suites = [];
let current = null;

/** Declare a group of tests. Groups print together and share nothing. */
export function suite(name, body) {
    current = { name, tests: [] };
    suites.push(current);
    body();
    current = null;
}

/** Declare one test. `fn` throws to fail. */
export function test(name, fn) {
    if (current === null)
        throw new Error(`test("${name}") declared outside a suite()`);
    current.tests.push({ name, fn });
}

export function assert(cond, message = 'assertion failed') {
    if (!cond)
        throw new Error(message);
}

export function assertEqual(actual, expected, message = '') {
    if (!Object.is(actual, expected)) {
        throw new Error(
            `${message ? message + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

/** Deep equality over JSON-shaped values — enough for row models and argv arrays. */
export function assertDeepEqual(actual, expected, message = '') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b)
        throw new Error(`${message ? message + ': ' : ''}expected ${b}, got ${a}`);
}

export function assertThrows(fn, message = 'expected a throw') {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error(message);
}

/** Run every declared suite. Returns the process exit code. */
export function run() {
    let passed = 0;
    const failures = [];

    for (const s of suites) {
        print(`\n${s.name}`);
        for (const t of s.tests) {
            try {
                t.fn();
                passed++;
                print(`  ok   ${t.name}`);
            } catch (e) {
                failures.push({ suite: s.name, test: t.name, error: e });
                print(`  FAIL ${t.name}`);
                print(`       ${e.message}`);
                if (e.stack)
                    print(e.stack.split('\n').map(l => `       ${l}`).join('\n'));
            }
        }
    }

    print('');
    if (failures.length === 0) {
        print(`${passed} tests passed`);
        return 0;
    }
    print(`${passed} passed, ${failures.length} FAILED`);
    for (const f of failures)
        print(`  ${f.suite} / ${f.test}`);
    return 1;
}
