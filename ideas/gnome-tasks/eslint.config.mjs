// ESLint flat config, using only rules built into eslint itself so it runs inside the Nix
// sandbox with no node_modules and no network.

const gjsGlobals = {
    // gjs runtime
    ARGV: 'readonly',
    imports: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    console: 'readonly',
    globalThis: 'readonly',
    TextDecoder: 'readonly',
    TextEncoder: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
};

const shellGlobals = {
    // only defined inside gnome-shell
    global: 'readonly',
    _: 'readonly',
    C_: 'readonly',
    ngettext: 'readonly',
};

export default [
    {
        ignores: ['build/**', 'result', 'result-*', 'screenshots/**'],
    },
    {
        files: ['**/*.js', '**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: gjsGlobals,
        },
        linterOptions: {
            reportUnusedDisableDirectives: true,
        },
        rules: {
            // correctness
            'no-undef': 'error',
            'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
            'no-dupe-keys': 'error',
            'no-dupe-args': 'error',
            'no-duplicate-case': 'error',
            'no-unreachable': 'error',
            'no-fallthrough': 'error',
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-self-compare': 'error',
            'no-unsafe-negation': 'error',
            'valid-typeof': 'error',
            'use-isnan': 'error',
            'no-async-promise-executor': 'error',
            'require-atomic-updates': 'off',

            // style, kept close to the GJS style guide
            eqeqeq: ['error', 'smart'],
            'prefer-const': 'error',
            'no-var': 'error',
            semi: ['error', 'always'],
            quotes: ['error', 'single', { avoidEscape: true }],
            // GNOME Shell code writes GObject.registerClass(\nclass Foo … ) with the class
            // expression at column 0 and its body one level in, which the indent rule cannot
            // express. gnome-shell's own config exempts those nodes; so does this one.
            indent: ['error', 4, {
                SwitchCase: 1,
                ignoredNodes: [
                    'CallExpression[callee.object.name="GObject"][callee.property.name="registerClass"] > ClassExpression',
                    'CallExpression[callee.object.name="GObject"][callee.property.name="registerClass"] > ClassExpression > ClassBody',
                    'CallExpression[callee.object.name="GObject"][callee.property.name="registerClass"] > ClassExpression > ClassBody > *',
                ],
            }],
            'comma-dangle': ['error', 'always-multiline'],
            'no-trailing-spaces': 'error',
            'eol-last': 'error',
            'space-before-blocks': 'error',
            'keyword-spacing': 'error',
            'arrow-spacing': 'error',
            'no-multi-spaces': 'error',
            camelcase: ['error', { properties: 'never', allow: ['^[a-z]+(_[a-z]+)*$'] }],
        },
    },
    {
        // Extension-side code additionally runs inside gnome-shell.
        files: ['src/extension/**/*.js', 'tools/**/*.js'],
        languageOptions: {
            globals: { ...gjsGlobals, ...shellGlobals },
        },
    },
];
