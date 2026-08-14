#!/usr/bin/env -S gjs -m
// Test runner: `gjs -m tests/run.js [dir-or-file ...]`
//
// With no arguments it runs every *.test.js under tests/unit. Directories are scanned
// recursively; individual files are imported as given.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { runAll } from './harness.js';

function scriptDir() {
    // import.meta.url is file:///…/tests/run.js
    const path = GLib.filename_from_uri(import.meta.url)[0];
    return GLib.path_get_dirname(path);
}

function collect(path, found) {
    const file = Gio.File.new_for_path(path);
    const type = file.query_file_type(Gio.FileQueryInfoFlags.NONE, null);

    if (type === Gio.FileType.DIRECTORY) {
        const children = [];
        const enumerator = file.enumerate_children(
            'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null)
            children.push(info.get_name());
        // Deterministic order so a failure list is reproducible.
        for (const name of children.sort())
            collect(GLib.build_filenamev([path, name]), found);
    } else if (path.endsWith('.test.js')) {
        found.push(path);
    }
    return found;
}

// GLib.filename_to_uri() insists on absolute paths, so resolve arguments against the working
// directory rather than failing on `tests/run.js tests/unit`.
function absolute(path) {
    return GLib.path_is_absolute(path)
        ? path
        : GLib.build_filenamev([GLib.get_current_dir(), path]);
}

const targets = (ARGV.length > 0
    ? ARGV
    : [GLib.build_filenamev([scriptDir(), 'unit'])]).map(absolute);

const files = [];
for (const target of targets)
    collect(target, files);

if (files.length === 0) {
    printerr('no test files found');
    imports.system.exit(1);
}

for (const file of files)
    await import(GLib.filename_to_uri(file, null));

const ok = await runAll();
imports.system.exit(ok ? 0 : 1);
