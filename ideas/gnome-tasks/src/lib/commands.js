// Per-task commands: the model, and the rules about what may run.
//
// A stored string that gets executed on a desktop event deserves care, so two rules are built in
// rather than left to the UI:
//
//   1. A command is never run until the user has confirmed it. `confirmed` starts false, and a
//      command that has not been confirmed is reported for confirmation instead of being started.
//   2. A command line is split into argv here and handed to systemd as argv. It is never passed to a
//      shell, so a `;` or a `|` that appears in a stored command is an argument, not an instruction.
//
// Pure and Shell-free: the systemd side lives in src/daemon/systemdRunner.js.

/** systemd allows a restricted character set in unit names; everything else has to be escaped. */
const UNIT_NAME_SAFE = /[^a-zA-Z0-9:_.-]/g;

function randomUuid() {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++)
        bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
        .join('-');
}

/**
 * A command the user has declared for a task. `confirmed` is deliberately false: the caller has to
 * show it to the user and set it, which is what stops a task file from silently running something.
 */
export function createCommand({ id, commandLine, label, workingDirectory = '',
    enabled = true, confirmed = false } = {}) {
    if (typeof commandLine !== 'string' || commandLine.trim().length === 0)
        throw new Error('a command needs a command line');

    const trimmed = commandLine.trim();

    return {
        id: id ?? randomUuid(),
        commandLine: trimmed,
        label: label && label.trim().length > 0 ? label.trim() : trimmed,
        workingDirectory,
        enabled,
        confirmed,
    };
}

/** null when the command can be run, otherwise a human-readable reason why not. */
export function validateCommand(command) {
    if (!command || typeof command.commandLine !== 'string' ||
        command.commandLine.trim().length === 0)
        return 'the command line is empty';

    let argv;
    try {
        argv = parseCommandLine(command.commandLine);
    } catch (error) {
        return error.message;
    }

    if (argv.length === 0)
        return 'the command line is empty';

    return null;
}

/**
 * Split a command line into argv the way a shell would *quote* — but without any of the things a
 * shell would *interpret*. Handles single and double quotes; leaves `;`, `|`, `&`, `$` and friends as
 * ordinary characters, because this argv goes straight to exec.
 */
export function parseCommandLine(commandLine) {
    const argv = [];
    let current = '';
    let quote = null;
    let started = false;

    for (const character of commandLine) {
        if (quote) {
            if (character === quote) {
                quote = null;
            } else {
                current += character;
            }
            continue;
        }

        if (character === '"' || character === '\'') {
            quote = character;
            started = true;
            continue;
        }

        if (/\s/.test(character)) {
            if (started) {
                argv.push(current);
                current = '';
                started = false;
            }
            continue;
        }

        current += character;
        started = true;
    }

    if (quote)
        throw new Error(`unbalanced ${quote} in the command line`);
    if (started)
        argv.push(current);

    return argv;
}

/**
 * The transient unit a command runs in. A scope rather than a service, so the command keeps its own
 * cgroup and stopping the task reliably stops everything it spawned; the task uuid is in the name so
 * `journalctl --user -u gnome-tasks-*` is readable.
 */
export function unitNameFor(taskUuid, commandId) {
    const task = String(taskUuid).replace(UNIT_NAME_SAFE, '_').slice(0, 12);
    const command = String(commandId).replace(UNIT_NAME_SAFE, '_').slice(0, 12);
    return `gnome-tasks-${task}-${command}.scope`;
}

/**
 * Sort a task's commands into what to start now, what to ask the user about first, and what cannot
 * run at all. Nothing here starts anything; the daemon does that.
 */
export function commandsToStart(commands) {
    const result = { start: [], needConfirmation: [], invalid: [] };

    for (const command of commands ?? []) {
        if (command.enabled === false)
            continue;

        const problem = validateCommand(command);
        if (problem) {
            result.invalid.push({ ...command, problem });
            continue;
        }

        if (command.confirmed)
            result.start.push(command);
        else
            result.needConfirmation.push(command);
    }

    return result;
}
