// Reading /proc, so the adapters do not have to.
//
// This lives in the daemon, never in the extension: walking a process's file descriptors is
// exactly the kind of syscall-heavy work that must not happen inside the compositor. Everything
// here is best-effort — a process can exit between two reads, and /proc entries for other users are
// unreadable — so failure returns null or an empty list rather than throwing.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/** Path prefixes that are never a user document, skipped before stat'ing anything. */
const UNINTERESTING_PREFIXES = [
    '/proc', '/dev', '/sys', '/usr', '/nix', '/snap', '/memfd', '/run', '/etc', '/var/lib',
];

/** How many file descriptors to look at. A browser can have thousands; documents are near the front. */
const MAX_FDS = 256;

/**
 * What the adapters need about a process: its command line, working directory, the interesting paths
 * it holds open, which of those are directories, and which still exist.
 *
 * Returns null when the process is gone or unreadable.
 */
export function readProcessInfo(pid) {
    if (!pid || pid <= 0)
        return null;
    if (!GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS))
        return null;

    const info = {
        pid,
        cmdline: readCmdline(pid),
        cwd: readLink(`/proc/${pid}/cwd`),
        files: [],
        directories: [],
        existing: [],
        home: GLib.get_home_dir(),
    };

    const { files, directories } = readOpenFiles(pid);
    info.files = files;
    info.directories = directories;

    // Everything the adapters might consider, stat'ed once here so the adapter rules stay pure.
    const candidates = new Set([...files, ...directories]);
    for (const argument of info.cmdline.slice(1)) {
        if (argument.startsWith('-'))
            continue;
        const absolute = argument.startsWith('/')
            ? argument
            : info.cwd ? GLib.build_filenamev([info.cwd, argument]) : null;
        if (absolute)
            candidates.add(GLib.canonicalize_filename(absolute, info.cwd ?? '/'));
    }
    // A terminal's title names a directory that is not open as an fd anywhere.
    for (const candidate of candidates) {
        if (GLib.file_test(candidate, GLib.FileTest.EXISTS))
            info.existing.push(candidate);
    }

    return info;
}

/**
 * Add a path to the "does it exist" set. The terminal adapter derives a directory from a window
 * title, which /proc knows nothing about, so the caller has to offer it.
 */
export function withExtraCandidates(info, paths) {
    if (!info)
        return info;
    const existing = new Set(info.existing);
    for (const path of paths) {
        if (path && GLib.file_test(path, GLib.FileTest.EXISTS))
            existing.add(path);
    }
    return { ...info, existing: [...existing] };
}

function readCmdline(pid) {
    try {
        const [, bytes] = GLib.file_get_contents(`/proc/${pid}/cmdline`);
        return new TextDecoder()
            .decode(bytes)
            .split('\0')
            .filter(part => part.length > 0);
    } catch {
        return [];
    }
}

function readLink(path) {
    try {
        return GLib.file_read_link(path);
    } catch {
        return null;
    }
}

function readOpenFiles(pid) {
    const files = [];
    const directories = [];

    let enumerator;
    try {
        enumerator = Gio.File.new_for_path(`/proc/${pid}/fd`)
            .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return { files, directories };
    }

    let seen = 0;
    let entry;
    while ((entry = next(enumerator)) !== null && seen < MAX_FDS) {
        seen++;
        const target = readLink(`/proc/${pid}/fd/${entry.get_name()}`);
        if (!target || !target.startsWith('/') || isUninteresting(target))
            continue;

        files.push(target);
        if (GLib.file_test(target, GLib.FileTest.IS_DIR))
            directories.push(target);
    }

    return { files: [...new Set(files)], directories: [...new Set(directories)] };
}

function next(enumerator) {
    try {
        return enumerator.next_file(null);
    } catch {
        // The descriptor vanished mid-walk, which is entirely normal.
        return null;
    }
}

function isUninteresting(path) {
    return UNINTERESTING_PREFIXES.some(prefix => path.startsWith(prefix)) ||
        path.includes('/fonts/') ||
        path.endsWith('(deleted)');
}
