// The extension's manifest. A malformed or inconsistent metadata.json is not a runtime
// error you can debug: the Shell refuses to load the extension and says almost nothing, so
// it is worth asserting from outside the compositor.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertEquals } from '../harness.js';

const UUID = 'aideas-shell@patxi.gortazar';

function repoFile(relative) {
    // import.meta.url is file:///…/tests/unit/metadata.test.js
    const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
    return GLib.build_filenamev([here, '..', '..', relative]);
}

function readJson(relative) {
    const [, bytes] = Gio.File.new_for_path(repoFile(relative)).load_contents(null);
    return JSON.parse(new TextDecoder().decode(bytes));
}

suite('metadata.json', () => {
    const metadata = readJson('src/extension/metadata.json');

    test('is valid JSON carrying the fields the Shell requires', () => {
        for (const key of ['uuid', 'name', 'description', 'shell-version'])
            assert(metadata[key] !== undefined, `metadata.json has no ${key}`);
    });

    test('uses the uuid the build, the installer and the release all name', () => {
        assertEquals(metadata.uuid, UUID);
    });

    test('declares the GNOME versions the plan supports', () => {
        // 46 is what the sibling extensions target; 50 is the newest the plan commits to.
        assertEquals(metadata['shell-version'].join(','), '46,47,48,49,50');
    });

    test('names a settings schema, since preferences are part of 0.1', () => {
        assertEquals(metadata['settings-schema'], 'org.gnome.shell.extensions.aideas');
    });

    test('carries a version-name matching the idea version', () => {
        assertEquals(metadata['version-name'], '0.4');
    });

    test('has no version key, which the Shell assigns and EGO rejects by hand', () => {
        assertEquals(metadata.version, undefined);
    });
});
