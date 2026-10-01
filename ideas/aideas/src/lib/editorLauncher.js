// Opening the queue where ideas are written.
//
// This is a different axis from everything else in this extension. The rest of it goes over HTTP
// to a box that may not be this computer; this launches a program on *this* machine, against a
// file on *this* machine. Three rules follow from that:
//
//   1. **Never guess.** No default of `~/aideas`, no silent no-op. If the repository path is
//      unset or wrong, the item says which preference fixes it, and the detail line names the
//      path it *will* open — opening the wrong checkout is a thing to notice before you have
//      typed an idea into it, not after.
//   2. **Never build a shell command.** The repository path is a string somebody typed into a
//      preferences field. It travels as one element of an argv and is never interpolated into
//      anything a shell will parse.
//   3. **Never show a GLib message.** They are localised — on this laptop a refused connection
//      says "Conexión rehusada" — so a failed spawn is worded here, from the `GError` code.
//
// Everything is driven through injected seams, so the unit tests never launch anything.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * What to look for when no editor command is configured, in order.
 *
 * The third one is the Flatpak: a Flatpak install exports `<app-id>` as a wrapper script onto
 * `PATH`, so one "is this program there" seam finds the native, the alternative and the Flatpak
 * form alike, without this module having to know what Flatpak is.
 */
export const EDITOR_CANDIDATES = ['codium', 'vscodium', 'com.vscodium.codium'];

/** The file in the repository that holds the queue. */
export const QUEUE_FILE = 'README.md';

/**
 * A configured command as a word list, the way a shell would split it.
 *
 * Quotes and backslashes are honoured so that a path with a space in it can be configured at
 * all. An unterminated quote yields the word anyway rather than throwing: this runs while a menu
 * is being built, from a preference somebody may be halfway through typing.
 */
export function splitCommand(command) {
    const text = typeof command === 'string' ? command : '';
    const words = [];
    let word = null;
    let quote = null;

    for (let i = 0; i < text.length; i++) {
        const character = text[i];

        if (quote === null && character === '\\' && i + 1 < text.length) {
            word = (word ?? '') + text[++i];
            continue;
        }
        if (quote === null && (character === '"' || character === '\'')) {
            quote = character;
            word = word ?? '';
            continue;
        }
        if (quote !== null && character === quote) {
            quote = null;
            continue;
        }
        if (quote === null && /\s/.test(character)) {
            if (word !== null)
                words.push(word);
            word = null;
            continue;
        }
        word = (word ?? '') + character;
    }

    if (word !== null)
        words.push(word);
    return words;
}

/**
 * The 1-based line a new idea should be typed on: the last entry under `## Ideas`.
 *
 * Opening at line 1 would be correct and useless — the queue's heading is prose and the entries
 * are numbered beneath it, so the cursor belongs at the end of the list. A file with no `##
 * Ideas` section opens at the top rather than refusing: it is still the file somebody asked for.
 */
export function ideasInsertionLine(text) {
    const lines = String(text ?? '').split('\n');
    const start = lines.findIndex(line => /^##\s+Ideas\s*$/.test(line));
    if (start === -1)
        return 1;

    let last = start;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i]))
            break;
        if (lines[i].trim() !== '')
            last = i;
    }
    return last + 1;
}

/** `{ argv, problem }` — the editor to run, or why there is none. */
export function resolveEditor(editorCommand, exists) {
    const configured = splitCommand(editorCommand);
    // Verbatim, and deliberately not looked for: this is how somebody who wants a different
    // editor gets one, and second-guessing a configured command would take that away.
    if (configured.length > 0)
        return { argv: configured, problem: null };

    for (const candidate of EDITOR_CANDIDATES) {
        if (exists(candidate))
            return { argv: [candidate], problem: null };
    }

    return {
        argv: null,
        problem: 'no codium found — set the editor command in preferences',
    };
}

/** `{ repo, readme, problem }` — the queue file to open, or why there is none. */
export function resolveQueue(repoPath, fileExists) {
    const repo = (typeof repoPath === 'string' ? repoPath : '').trim().replace(/\/+$/, '');
    if (repo === '') {
        return {
            repo: null, readme: null,
            problem: 'set the repository path in preferences',
        };
    }

    const readme = `${repo}/${QUEUE_FILE}`;
    if (!fileExists(readme))
        return { repo, readme, problem: `${readme} does not exist` };

    return { repo, readme, problem: null };
}

/**
 * What the menu item should say before anybody clicks it: the path, or the reason it cannot.
 *
 * The repository is checked first because it is the one somebody has to set by hand; a missing
 * editor is the rarer problem and the easier one to describe once the path is right.
 */
export function describeOpen({ repoPath, editorCommand, exists, fileExists }) {
    const queue = resolveQueue(repoPath, fileExists);
    if (queue.problem !== null)
        return { path: queue.readme, problem: queue.problem };

    const editor = resolveEditor(editorCommand, exists);
    if (editor.problem !== null)
        return { path: queue.readme, problem: editor.problem };

    return { path: queue.readme, problem: null };
}

/**
 * Launch the editor on the queue. Returns `{ launched, reason }` and never throws.
 *
 * The editor outlives the menu: nothing here waits for it or keeps a handle on it.
 */
export function openQueue({
    repoPath, editorCommand, exists, fileExists, readFile, spawn,
}) {
    const { path, problem } = describeOpen({ repoPath, editorCommand, exists, fileExists });
    if (problem !== null)
        return { launched: false, reason: problem };

    const { argv: editor } = resolveEditor(editorCommand, exists);

    // A file that exists but cannot be read is a permission problem or a race. Refusing to open
    // the editor over it would be worse than opening it on the wrong line.
    let line = 1;
    try {
        line = ideasInsertionLine(readFile(path));
    } catch {
        line = 1;
    }

    const repo = path.slice(0, -(QUEUE_FILE.length + 1));
    const argv = [...editor, repo, '--goto', `${path}:${line}`];

    try {
        spawn(argv);
    } catch (error) {
        return { launched: false, reason: spawnFailureReason(error) };
    }

    return { launched: true, reason: null };
}

/** A fixed English phrase for a spawn failure, from the code — never from the message. */
export function spawnFailureReason(error) {
    if (error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
        return 'the editor command was not found';
    if (error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.PERMISSION_DENIED))
        return 'permission denied starting the editor';
    const code = typeof error?.code === 'number' ? ` (code ${error.code})` : '';
    return `the editor could not be started${code}`;
}

/** The seams as this machine provides them. Shell-side; the tests inject their own. */
export function systemSeams() {
    return {
        exists: name => GLib.find_program_in_path(name) !== null,
        fileExists: path => GLib.file_test(path, GLib.FileTest.EXISTS),
        readFile: path => {
            const [, bytes] = GLib.file_get_contents(path);
            return new TextDecoder().decode(bytes);
        },
        // Detached and unwatched: the editor is not this extension's child to supervise, and its
        // output belongs nowhere. Gio reaps it, so nothing is left to zombie.
        spawn: argv => {
            Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        },
    };
}
