// Per-application document recovery, by capability tier.
//
// "Which file is this window showing?" has no general answer on Linux, so this is deliberately a
// registry of narrow, declared answers rather than one clever heuristic. Each adapter says what it
// looks at, and an application with no adapter gets no documents at all — guessing for unknown apps
// would restore the wrong file, which is worse than restoring none.
//
// Pure: an adapter is a function of (window record, process information). Reading /proc is the
// daemon's job (src/daemon/procReader.js), which keeps every rule here unit-testable.
//
// Tiers, as in docs/app-adapters.md:
//   0  app only        — we know what to launch, nothing about its contents
//   1  documents       — the open file or folder is recoverable from outside the app
//   2  full inner state — needs the app's cooperation (browser tabs, editor projects); see M6

import { pathToUri, resolvePath, uriFor } from './paths.js';

/**
 * Applications whose command line carries their documents. Deliberately a list rather than "try it
 * on everything": an app that takes a *profile* or a *URL to open in a running instance* would have
 * its arguments misread as documents.
 */
const COMMAND_LINE_APPS = new Set([
    'org.gnome.TextEditor.desktop',
    'org.gnome.gedit.desktop',
    'gedit.desktop',
    'org.gnome.Evince.desktop',
    'evince.desktop',
    'org.gnome.Loupe.desktop',
    'eog.desktop',
    'org.gnome.eog.desktop',
    'libreoffice-writer.desktop',
    'libreoffice-calc.desktop',
    'libreoffice_writer.desktop',
    'org.gnome.meld.desktop',
    'code.desktop',
    'codium.desktop',
]);

const TERMINAL_APPS = new Set([
    'org.gnome.Terminal.desktop',
    'org.gnome.Console.desktop',
    'terminator.desktop',
    'com.gexperts.Tilix.desktop',
]);

const FILE_MANAGER_APPS = new Set([
    'org.gnome.Nautilus.desktop',
    'nautilus.desktop',
]);

/**
 * Paths that are an app's own state rather than something the user opened.
 *
 * Applied only to paths gathered *incidentally* — open file descriptors — never to a path the user
 * explicitly passed on a command line. `foo /tmp/notes.txt` means the user is editing that file, and
 * filtering it out because it lives in /tmp would silently lose a real document.
 */
const INCIDENTAL_STATE_PATTERN =
    /\/\.(local\/share|cache|config)\/|\/\.var\/app\/|\/snap\/|\/tmp\/|\/run\/|\/proc\//;

const ADAPTERS = [
    {
        id: 'nautilus',
        tier: 1,
        describes:
            'the directory a file manager is showing, taken from the directory file descriptors it ' +
            'holds open — its command line is useless because it is D-Bus activated',
        matches: record => FILE_MANAGER_APPS.has(record.appId),
        documents: (record, info) => {
            const directories = info.directories ?? [];
            return unique(directories
                .filter(path => !INCIDENTAL_STATE_PATTERN.test(path))
                .filter(path => exists(info, path))
                .map(pathToUri));
        },
    },
    {
        id: 'terminal',
        tier: 1,
        describes:
            'the working directory a terminal is showing, parsed out of its window title — the ' +
            'window belongs to a server process whose own directory is unrelated. Best effort: the ' +
            'title format is configurable, and the shell state inside cannot be restored at all',
        matches: record => TERMINAL_APPS.has(record.appId),
        documents: (record, info) => {
            const directory = directoryFromTitle(record.title ?? '', info.home);
            if (!directory || !exists(info, directory))
                return [];
            return [pathToUri(directory)];
        },
    },
    {
        id: 'command-line',
        tier: 1,
        describes:
            'the files an application was launched with, read from its command line — exact when it ' +
            'applies, and silent when the application was D-Bus activated instead',
        matches: record => COMMAND_LINE_APPS.has(record.appId),
        documents: (record, info) => {
            const args = (info.cmdline ?? []).slice(1);
            const documents = [];

            for (const arg of args) {
                if (arg.startsWith('-'))
                    continue;

                const uri = uriFor(arg);
                if (uri) {
                    documents.push(uri);
                    continue;
                }

                // No state filtering here: an argument is an explicit request, wherever it lives.
                const path = resolvePath(arg, info.cwd);
                if (path && exists(info, path))
                    documents.push(pathToUri(path));
            }

            return unique(documents);
        },
    },
];

/** The tier-0 answer: we know which application, and nothing else. */
const APP_ONLY = {
    id: 'app-only',
    tier: 0,
    describes:
        'nothing but the application itself, which is all that can be known without support from ' +
        'the application or a per-app rule',
    matches: () => true,
    documents: () => [],
};

/** The adapter that will be used for this window. Never null. */
export function adapterFor(record) {
    return ADAPTERS.find(adapter => adapter.matches(record)) ?? APP_ONLY;
}

/**
 * The documents to record for this window. `info` is what src/daemon/procReader.js gathered, or null
 * when it could not be read — an unreadable /proc is normal (the process may have exited) and must
 * not throw.
 */
export function documentsFor(record, info) {
    if (!info)
        return [];
    try {
        return adapterFor(record).documents(record, info) ?? [];
    } catch {
        // A bad heuristic must not cost the user the whole capture.
        return [];
    }
}

/** For docs/app-adapters.md and the preferences window. */
export function describeAdapters() {
    return [...ADAPTERS, APP_ONLY].map(({ id, tier, describes }) => ({ id, tier, describes }));
}

// --- helpers ----------------------------------------------------------------------------------

function unique(values) {
    return [...new Set(values)];
}

/**
 * Whether a path is still there. The answer comes from the caller, so this module stays free of file
 * I/O: the daemon passes an `exists` function, the tests pass a precomputed `existing` list. An
 * adapter that derives a path the daemon could not know about in advance (the terminal's title) needs
 * the function form.
 */
function exists(info, path) {
    if (typeof info.exists === 'function')
        return info.exists(path);
    if (!info.existing)
        return true;
    return info.existing.includes(path);
}

/**
 * `user@host:/path` or `user@host:~/path` — the default prompt format, which is also what ends up in
 * a terminal's title. Anything else is not a directory and must not be guessed at.
 */
function directoryFromTitle(title, home) {
    const match = /^[^\s:]+@[^\s:]+:\s*(\S+)$/.exec(title.trim());
    if (!match)
        return null;

    const path = match[1];
    if (path.startsWith('~'))
        return home ? `${home}${path.slice(1)}` : null;
    return path.startsWith('/') ? path : null;
}
