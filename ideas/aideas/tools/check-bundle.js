#!/usr/bin/env -S gjs -m
// Validate an assembled extension bundle: `gjs -m tools/check-bundle.js build/<uuid>`
//
// A Shell extension fails at *load* time, inside the compositor, with the error going to the
// journal — so a missing file or a typo'd import is a bug the user finds, not CI. This check
// substitutes for `gnome-extensions pack --validate` (which would drag the whole gnome-shell
// closure into CI) by verifying the two things that actually break:
//
//   1. metadata.json is valid and complete, and its uuid matches the directory name
//   2. every relative import in every shipped file resolves inside the bundle
//
// It cannot catch a bad `resource:///org/gnome/shell/…` import; only a real Shell can.
//
// Copied from ideas/gnome-tasks/tools/check-bundle.js, with the compiled-schema check added:
// this extension has preferences from 0.1, and an uncompiled schema in the bundle is a
// crash on first open of the preferences window.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const REQUIRED_METADATA = ['uuid', 'name', 'description', 'shell-version'];

const problems = [];

if (!ARGV[0]) {
    printerr('usage: check-bundle.js <bundle-directory>');
    imports.system.exit(2);
}

// Absolute, because GLib.canonicalize_filename() requires an absolute base directory.
const bundle = GLib.path_is_absolute(ARGV[0])
    ? ARGV[0]
    : GLib.canonicalize_filename(ARGV[0], GLib.get_current_dir());

function read(path) {
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    return new TextDecoder().decode(bytes);
}

function jsFiles(directory, found = []) {
    const file = Gio.File.new_for_path(directory);
    const enumerator = file.enumerate_children(
        'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        const child = GLib.build_filenamev([directory, info.get_name()]);
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            jsFiles(child, found);
        else if (info.get_name().endsWith('.js'))
            found.push(child);
    }
    return found;
}

// --- metadata ---------------------------------------------------------------------------------

const metadataPath = GLib.build_filenamev([bundle, 'metadata.json']);
let metadata = null;

if (!GLib.file_test(metadataPath, GLib.FileTest.EXISTS)) {
    problems.push(`no metadata.json in ${bundle}`);
} else {
    try {
        metadata = JSON.parse(read(metadataPath));
    } catch (error) {
        problems.push(`metadata.json is not valid JSON: ${error.message}`);
    }
}

if (metadata) {
    for (const key of REQUIRED_METADATA) {
        if (metadata[key] === undefined || metadata[key] === '')
            problems.push(`metadata.json is missing "${key}"`);
    }

    const directoryName = GLib.path_get_basename(bundle);
    if (metadata.uuid && metadata.uuid !== directoryName) {
        problems.push(
            `metadata.json uuid "${metadata.uuid}" does not match the directory "${directoryName}" ` +
            '— the Shell keys extensions by directory name and would not find it');
    }

    if (!Array.isArray(metadata['shell-version']) || metadata['shell-version'].length === 0)
        problems.push('metadata.json "shell-version" must be a non-empty array');

    if (!GLib.file_test(GLib.build_filenamev([bundle, 'extension.js']), GLib.FileTest.EXISTS))
        problems.push('no extension.js in the bundle');

    // A settings-schema that names nothing installable leaves prefs and the extension both
    // throwing on first settings access, which reads as "the extension is broken".
    const schemaId = metadata['settings-schema'];
    if (schemaId) {
        const schemas = GLib.build_filenamev([bundle, 'schemas']);
        if (!GLib.file_test(schemas, GLib.FileTest.IS_DIR)) {
            problems.push(`metadata.json declares settings-schema "${schemaId}" but the bundle ` +
                'has no schemas/ directory');
        } else {
            const compiled = GLib.build_filenamev([schemas, 'gschemas.compiled']);
            if (!GLib.file_test(compiled, GLib.FileTest.EXISTS))
                problems.push('schemas/gschemas.compiled is missing — run glib-compile-schemas');

            const source = GLib.build_filenamev([schemas, `${schemaId}.gschema.xml`]);
            if (!GLib.file_test(source, GLib.FileTest.EXISTS)) {
                problems.push(`schemas/${schemaId}.gschema.xml is missing — EGO requires the ` +
                    'schema source alongside the compiled form');
            }
        }
    }
}

// --- imports ----------------------------------------------------------------------------------

const files = jsFiles(bundle);
const importPattern = /(?:^|\n)\s*(?:import|export)\s[^;]*?['"](\.[^'"]+)['"]/gs;

for (const path of files) {
    const source = read(path);
    const directory = GLib.path_get_dirname(path);

    for (const match of source.matchAll(importPattern)) {
        const target = match[1];
        const resolved = GLib.canonicalize_filename(target, directory);
        if (!GLib.file_test(resolved, GLib.FileTest.EXISTS)) {
            problems.push(
                `${path.slice(bundle.length + 1)} imports "${target}", which is not in the bundle`);
        }
    }
}

// --- verdict ----------------------------------------------------------------------------------

if (problems.length > 0) {
    printerr(`${bundle}: ${problems.length} problem(s)`);
    for (const problem of problems)
        printerr(`  - ${problem}`);
    imports.system.exit(1);
}

print(`${bundle}: ok (${files.length} js files, uuid ${metadata.uuid})`);
