// The task model: what a task *is*, independent of how it is stored or shown.
//
// Shell-free and Gio-free on purpose — this is the part that can be unit tested under plain gjs,
// and it is where the on-disk schema is defined (see docs/state-schema.md).

import { DeactivatePolicy, TaskState } from './protocol.js';

/**
 * Bumped only for changes that older documents cannot be read as. Every bump needs a step in
 * migrate(); tests/unit/task.test.js fails if one is missing.
 */
export const SCHEMA_VERSION = 1;

const VALID_POLICIES = new Set(Object.values(DeactivatePolicy));

/** Keys a client may change through SetTaskProperties. */
const MUTABLE_KEYS = new Set(['name', 'icon', 'description', 'deactivatePolicy', 'apps', 'commands']);

function requireName(value) {
    if (typeof value !== 'string')
        throw new Error('a task needs a name');
    const name = value.trim();
    if (name.length === 0)
        throw new Error('a task needs a name');
    return name;
}

function requirePolicy(value) {
    if (!VALID_POLICIES.has(value))
        throw new Error(`unknown deactivation policy: ${value}`);
    return value;
}

// Random UUID without pulling in GLib, so this module stays runnable anywhere. Version 4 layout.
function randomUuid() {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++)
        bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return [
        hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20),
    ].join('-');
}

/**
 * A new task. `apps` and `commands` stay empty until the first capture; a task is useful the
 * moment it has a name.
 */
export function createTask({ uuid, name, icon = '', description = '',
    // LEAVE rather than HIDE: a default has to be a behaviour that exists, and leaving windows
    // alone is also the safest thing to do with somebody's open work.
    deactivatePolicy = DeactivatePolicy.LEAVE, apps = [], commands = [] } = {}) {
    return {
        version: SCHEMA_VERSION,
        uuid: uuid ?? randomUuid(),
        name: requireName(name),
        icon,
        description,
        deactivatePolicy: requirePolicy(deactivatePolicy),
        apps: [...apps],
        commands: [...commands],
        // Runtime only: recomputed from the compositor, never read back from disk.
        state: TaskState.STOPPED,
    };
}

/** A copy of `task` with `properties` applied. Unknown or read-only keys are an error. */
export function updateTask(task, properties) {
    const updated = { ...task, apps: [...task.apps], commands: [...task.commands] };

    for (const [key, value] of Object.entries(properties)) {
        if (!MUTABLE_KEYS.has(key))
            throw new Error(`${key} is not a settable task property`);

        switch (key) {
            case 'name':
                updated.name = requireName(value);
                break;
            case 'deactivatePolicy':
                updated.deactivatePolicy = requirePolicy(value);
                break;
            case 'apps':
            case 'commands':
                if (!Array.isArray(value))
                    throw new Error(`${key} must be an array`);
                updated[key] = [...value];
                break;
            default:
                if (typeof value !== 'string')
                    throw new Error(`${key} must be a string`);
                updated[key] = value;
        }
    }

    return updated;
}

/** The persisted form: pretty-printed and newline-terminated, so diffs are readable. */
export function serializeTask(task) {
    const { state: _state, ...persisted } = task;
    return `${JSON.stringify(persisted, null, 2)}\n`;
}

export function parseTask(text) {
    let document;
    try {
        document = JSON.parse(text);
    } catch (error) {
        throw new Error(`not valid JSON: ${error.message}`);
    }

    if (document === null || typeof document !== 'object' || Array.isArray(document))
        throw new Error('a task document must be a JSON object');

    const migrated = migrate(document);

    return createTask({
        uuid: (() => {
            if (typeof migrated.uuid !== 'string' || migrated.uuid.length === 0)
                throw new Error('a task document needs a uuid');
            return migrated.uuid;
        })(),
        name: migrated.name,
        icon: migrated.icon ?? '',
        description: migrated.description ?? '',
        deactivatePolicy: migrated.deactivatePolicy ?? DeactivatePolicy.LEAVE,
        apps: migrated.apps ?? [],
        commands: migrated.commands ?? [],
    });
}

/**
 * Bring a parsed document up to SCHEMA_VERSION. Each step is a function from version N to N+1, so
 * a document written by any older release migrates by composition.
 */
export function migrate(document) {
    const version = document.version ?? 1;

    if (version > SCHEMA_VERSION) {
        throw new Error(
            `task schema version ${version} is newer than this version of gnome-tasks ` +
            `understands (${SCHEMA_VERSION}); refusing to read it rather than lose data`);
    }

    let migrated = { ...document, version };
    while (migrated.version < SCHEMA_VERSION) {
        const step = MIGRATIONS[migrated.version];
        if (!step)
            throw new Error(`no migration from task schema version ${migrated.version}`);
        migrated = { ...step(migrated), version: migrated.version + 1 };
    }

    return migrated;
}

/** version N -> N+1. Empty while SCHEMA_VERSION is 1. */
const MIGRATIONS = {};

/** The a{sv}-friendly summary ListTasks returns. */
export function summarizeTask(task) {
    return {
        uuid: task.uuid,
        name: task.name,
        icon: task.icon,
        description: task.description,
        state: task.state,
    };
}
