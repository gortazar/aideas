import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertDeepEquals, assertEquals, assertThrows } from '../harness.js';
import { TaskStore } from '../../src/lib/taskStore.js';
import { DeactivatePolicy } from '../../src/lib/protocol.js';

let counter = 0;
function scratchDir() {
    const path = GLib.build_filenamev([
        GLib.dir_make_tmp('gnome-tasks-test-XXXXXX'), `store-${counter++}`,
    ]);
    return path;
}

function read(path) {
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    return new TextDecoder().decode(bytes);
}

suite('TaskStore', () => {
    test('a fresh store is empty and has no current task', () => {
        const store = new TaskStore({ directory: scratchDir() });
        store.load();

        assertEquals(store.list().length, 0);
        assertEquals(store.currentUuid, '');
    });

    test('create writes one file per task, named after the uuid', () => {
        const directory = scratchDir();
        const store = new TaskStore({ directory });

        const task = store.create({ name: 'Writing' });

        const path = GLib.build_filenamev([directory, 'tasks', `${task.uuid}.json`]);
        assert(GLib.file_test(path, GLib.FileTest.EXISTS), `expected ${path} to exist`);
        assertEquals(JSON.parse(read(path)).name, 'Writing');
    });

    test('tasks survive a reload', () => {
        const directory = scratchDir();
        const first = new TaskStore({ directory });
        const created = first.create({ name: 'Writing', icon: 'folder' });

        const second = new TaskStore({ directory });
        second.load();

        assertEquals(second.list().length, 1);
        const loaded = second.get(created.uuid);
        assertEquals(loaded.name, 'Writing');
        assertEquals(loaded.icon, 'folder');
    });

    test('the current task survives a reload', () => {
        const directory = scratchDir();
        const first = new TaskStore({ directory });
        const task = first.create({ name: 'Writing' });
        first.setCurrent(task.uuid);

        const second = new TaskStore({ directory });
        second.load();

        assertEquals(second.currentUuid, task.uuid);
    });

    test('update persists and does not disturb other tasks', () => {
        const directory = scratchDir();
        const store = new TaskStore({ directory });
        const a = store.create({ name: 'A' });
        const b = store.create({ name: 'B' });

        store.update(a.uuid, { name: 'A renamed', deactivatePolicy: DeactivatePolicy.CLOSE });

        const reloaded = new TaskStore({ directory });
        reloaded.load();
        assertEquals(reloaded.get(a.uuid).name, 'A renamed');
        assertEquals(reloaded.get(a.uuid).deactivatePolicy, DeactivatePolicy.CLOSE);
        assertEquals(reloaded.get(b.uuid).name, 'B');
    });

    test('remove deletes the file, and clears the current task if it was current', () => {
        const directory = scratchDir();
        const store = new TaskStore({ directory });
        const task = store.create({ name: 'Writing' });
        store.setCurrent(task.uuid);

        store.remove(task.uuid);

        assertEquals(store.list().length, 0);
        assertEquals(store.currentUuid, '');
        const path = GLib.build_filenamev([directory, 'tasks', `${task.uuid}.json`]);
        assert(!GLib.file_test(path, GLib.FileTest.EXISTS), 'the file should be gone');
    });

    test('unknown uuids are an error, not a silent no-op', () => {
        const store = new TaskStore({ directory: scratchDir() });
        store.load();

        assertThrows(() => store.get('nope'));
        assertThrows(() => store.update('nope', { name: 'x' }));
        assertThrows(() => store.remove('nope'));
        assertThrows(() => store.setCurrent('nope'));
    });

    test('setCurrent("") means no current task', () => {
        const store = new TaskStore({ directory: scratchDir() });
        const task = store.create({ name: 'Writing' });
        store.setCurrent(task.uuid);

        store.setCurrent('');

        assertEquals(store.currentUuid, '');
    });

    test('changes are announced, with the uuid and what happened', () => {
        const store = new TaskStore({ directory: scratchDir() });
        const seen = [];
        store.connect((kind, uuid) => seen.push(`${kind}:${uuid}`));

        const task = store.create({ name: 'Writing' });
        store.update(task.uuid, { name: 'Reading' });
        store.setCurrent(task.uuid);
        store.remove(task.uuid);

        assertEquals(seen.join(' '), [
            `added:${task.uuid}`,
            `changed:${task.uuid}`,
            `current:${task.uuid}`,
            `removed:${task.uuid}`,
            'current:',
        ].join(' '));
    });

    // A crash mid-write must not leave a task file that parses as nothing.
    test('writes are atomic: no partial file is ever visible', () => {
        const directory = scratchDir();
        const store = new TaskStore({ directory });
        const task = store.create({ name: 'Writing' });
        const path = GLib.build_filenamev([directory, 'tasks', `${task.uuid}.json`]);

        // Whatever the write strategy, the file that exists must be complete and parseable.
        const text = read(path);
        assertEquals(JSON.parse(text).uuid, task.uuid);
        assert(text.endsWith('\n'), 'complete files end with a newline');

        // And no temporary files should be left lying around.
        const enumerator = Gio.File.new_for_path(GLib.build_filenamev([directory, 'tasks']))
            .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        const names = [];
        let info;
        while ((info = enumerator.next_file(null)) !== null)
            names.push(info.get_name());
        assertEquals(names.join(','), `${task.uuid}.json`);
    });

    test('a corrupt task file is skipped rather than taking the whole store down', () => {
        const directory = scratchDir();
        const store = new TaskStore({ directory });
        const good = store.create({ name: 'Good' });

        const junk = Gio.File.new_for_path(
            GLib.build_filenamev([directory, 'tasks', 'broken.json']));
        junk.replace_contents(new TextEncoder().encode('{ not json'), null, false,
            Gio.FileCreateFlags.NONE, null);

        const reloaded = new TaskStore({ directory });
        const problems = reloaded.load();

        assertEquals(reloaded.list().length, 1);
        assertEquals(reloaded.get(good.uuid).name, 'Good');
        assertEquals(problems.length, 1, 'the problem should be reported, not swallowed');
    });

    // Daemon-level settings live beside the tasks rather than in the extension's GSettings: the
    // daemon is what acts on them, and it has to keep working when the extension is not loaded.
    test('settings default sensibly and survive a reload', () => {
        const directory = scratchDir();
        const store = new TaskStore({ directory });

        assertEquals(store.settings.captureEnabled, true, 'capture is on by default');
        assertDeepEquals(store.settings.excludedApps, []);

        store.setSettings({ captureEnabled: false, excludedApps: ['org.keepassxc.KeePassXC.desktop'] });

        const reloaded = new TaskStore({ directory });
        reloaded.load();
        assertEquals(reloaded.settings.captureEnabled, false);
        assertDeepEquals(reloaded.settings.excludedApps, ['org.keepassxc.KeePassXC.desktop']);
    });

    test('setSettings only changes the keys it is given', () => {
        const store = new TaskStore({ directory: scratchDir() });
        store.setSettings({ excludedApps: ['a.desktop'] });
        store.setSettings({ captureEnabled: false });

        assertDeepEquals(store.settings.excludedApps, ['a.desktop']);
        assertEquals(store.settings.captureEnabled, false);
    });

    test('a settings change is announced', () => {
        const store = new TaskStore({ directory: scratchDir() });
        const seen = [];
        store.connect((kind, uuid) => seen.push(`${kind}:${uuid}`));

        store.setSettings({ captureEnabled: false });

        assertEquals(seen.join(' '), 'settings:');
    });

    test('an unknown setting is rejected rather than silently stored', () => {
        const store = new TaskStore({ directory: scratchDir() });
        assertThrows(() => store.setSettings({ nonsense: true }));
    });

    test('the current task and the settings share one state file', () => {
        const directory = scratchDir();
        const store = new TaskStore({ directory });
        const task = store.create({ name: 'A' });
        store.setCurrent(task.uuid);
        store.setSettings({ captureEnabled: false });

        const reloaded = new TaskStore({ directory });
        reloaded.load();
        assertEquals(reloaded.currentUuid, task.uuid);
        assertEquals(reloaded.settings.captureEnabled, false);
    });

    test('list is ordered by name, so the switcher menu is stable', () => {
        const store = new TaskStore({ directory: scratchDir() });
        store.create({ name: 'Zebra' });
        store.create({ name: 'apple' });
        store.create({ name: 'Mango' });

        assertEquals(store.list().map(t => t.name).join(','), 'apple,Mango,Zebra');
    });
});
