import { suite, test, assert, assertEquals, assertDeepEquals, assertThrows, assertMatch } from '../harness.js';
import {
    SCHEMA_VERSION,
    createTask,
    migrate,
    parseTask,
    serializeTask,
    summarizeTask,
    updateTask,
} from '../../src/lib/task.js';
import { DeactivatePolicy, TaskState } from '../../src/lib/protocol.js';

suite('task model', () => {
    test('createTask fills in a uuid, a schema version and defaults', () => {
        const task = createTask({ name: 'Writing', uuid: 'fixed-uuid' });

        assertEquals(task.uuid, 'fixed-uuid');
        assertEquals(task.name, 'Writing');
        assertEquals(task.version, SCHEMA_VERSION);
        assertEquals(task.icon, '');
        assertEquals(task.description, '');
        assertEquals(task.deactivatePolicy, DeactivatePolicy.LEAVE,
            'the default must be a policy that is actually implemented');
        assertDeepEquals(task.apps, []);
        assertDeepEquals(task.commands, []);
        assertEquals(task.state, TaskState.STOPPED);
    });

    test('createTask generates a uuid when none is given', () => {
        const a = createTask({ name: 'a' });
        const b = createTask({ name: 'b' });

        assertMatch(a.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            'uuid should look like a uuid');
        assert(a.uuid !== b.uuid, 'uuids should differ');
    });

    test('a task must have a name', () => {
        assertThrows(() => createTask({ name: '' }), 'empty name should be rejected');
        assertThrows(() => createTask({}), 'missing name should be rejected');
        assertThrows(() => createTask({ name: '   ' }), 'whitespace-only name should be rejected');
    });

    test('names are trimmed', () => {
        assertEquals(createTask({ name: '  Writing  ' }).name, 'Writing');
    });

    test('an unknown deactivation policy is rejected', () => {
        assertThrows(() => createTask({ name: 'x', deactivatePolicy: 'explode' }));
        // ...and every documented one is accepted
        for (const policy of Object.values(DeactivatePolicy))
            assertEquals(createTask({ name: 'x', deactivatePolicy: policy }).deactivatePolicy, policy);
    });

    test('serialize/parse is a round trip', () => {
        const task = createTask({
            name: 'Client work',
            icon: 'folder-symbolic',
            description: 'invoices and the tracker',
            deactivatePolicy: DeactivatePolicy.CLOSE,
        });
        const parsed = parseTask(serializeTask(task));

        assertDeepEquals(parsed, task);
    });

    test('serialized form is indented JSON ending in a newline, for reviewable diffs', () => {
        const text = serializeTask(createTask({ name: 'x' }));

        assert(text.endsWith('\n'), 'should end with a newline');
        assert(text.includes('\n  '), 'should be indented');
    });

    // Runtime state is derived from what the compositor currently shows, so persisting it would
    // mean a task claiming to be running after a reboot.
    test('runtime state is not persisted', () => {
        const task = createTask({ name: 'x' });
        task.state = TaskState.ACTIVE;

        const parsed = parseTask(serializeTask(task));
        assertEquals(parsed.state, TaskState.STOPPED);
    });

    test('parseTask rejects junk', () => {
        assertThrows(() => parseTask('not json'));
        assertThrows(() => parseTask('[]'), 'an array is not a task');
        assertThrows(() => parseTask('{"name":"no uuid"}'));
        assertThrows(() => parseTask('{"uuid":"u","version":1}'), 'no name');
    });

    test('parseTask rejects a schema from the future', () => {
        const text = JSON.stringify({ uuid: 'u', name: 'n', version: SCHEMA_VERSION + 1 });
        const error = assertThrows(() => parseTask(text));

        assertMatch(error.message, /newer/i, 'the error should say the schema is newer');
    });

    test('updateTask only touches the keys it is given, and validates them', () => {
        const task = createTask({ name: 'Writing', icon: 'a' });
        const updated = updateTask(task, { name: 'Reading' });

        assertEquals(updated.name, 'Reading');
        assertEquals(updated.icon, 'a', 'untouched keys survive');
        assertEquals(updated.uuid, task.uuid);
        assertEquals(task.name, 'Writing', 'the original is not mutated');
        assertThrows(() => updateTask(task, { name: '' }));
        assertThrows(() => updateTask(task, { uuid: 'a-different-uuid' }),
            'the uuid is not a settable property');
    });

    test('summarizeTask is the shape ListTasks puts on the bus', () => {
        const task = createTask({ name: 'Writing', icon: 'folder', uuid: 'u1' });
        task.state = TaskState.ACTIVE;

        assertDeepEquals(summarizeTask(task), {
            uuid: 'u1',
            name: 'Writing',
            icon: 'folder',
            description: '',
            state: TaskState.ACTIVE,
            shortcut: '',
        });
    });

    test('a task can carry a keyboard shortcut', () => {
        assertEquals(createTask({ name: 'x', shortcut: '<Super><Alt>1' }).shortcut,
            '<Super><Alt>1');
        assertEquals(createTask({ name: 'x' }).shortcut, '', 'none by default');
        assertEquals(createTask({ name: 'x', shortcut: '  <Super>F1  ' }).shortcut, '<Super>F1');
    });

    // Only the shape is checked: whether the compositor grants the grab is its business, and it
    // reports that separately.
    test('a shortcut that is not an accelerator is rejected', () => {
        for (const bad of ['Super+1', '<Super> 1', 'ctrl-a', '<>'])
            assertThrows(() => createTask({ name: 'x', shortcut: bad }), `expected ${bad} rejected`);
    });

    test('a shortcut survives serialization and can be cleared', () => {
        const task = createTask({ name: 'x', shortcut: '<Super>1' });
        assertEquals(parseTask(serializeTask(task)).shortcut, '<Super>1');
        assertEquals(updateTask(task, { shortcut: '' }).shortcut, '');
    });
});

suite('schema migration', () => {
    test('a current-version document is returned unchanged', () => {
        const task = createTask({ name: 'x' });
        assertDeepEquals(migrate(JSON.parse(serializeTask(task))), JSON.parse(serializeTask(task)));
    });

    // There is only one schema version so far. This test exists to fail the moment
    // SCHEMA_VERSION is bumped without a migration step being written for it.
    test('every version below the current one has a migration', () => {
        for (let version = 1; version < SCHEMA_VERSION; version++) {
            const migrated = migrate({ uuid: 'u', name: 'n', version });
            assertEquals(migrated.version, SCHEMA_VERSION,
                `no migration path from version ${version}`);
        }
    });
});
