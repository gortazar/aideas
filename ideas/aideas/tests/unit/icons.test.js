// The icons this extension ships.
//
// The one hard requirement is that GNOME recolours them like any stock symbolic icon, so the
// bulb is grey because it is symbolic rather than because it was painted grey. That cannot be
// proved without a compositor — the smoke test does it — but everything it *depends on* can be
// checked here: the `-symbolic` name, one colour, and that colour being `currentColor`.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { ICONS, isShippedIcon } from '../../src/lib/indicatorModel.js';

function iconsDir() {
    const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
    return GLib.build_filenamev([here, '..', '..', 'src', 'extension', 'icons']);
}

function shippedFiles() {
    const enumerator = Gio.File.new_for_path(iconsDir()).enumerate_children(
        'standard::name', Gio.FileQueryInfoFlags.NONE, null);
    const names = [];
    let info;
    while ((info = enumerator.next_file(null)) !== null)
        names.push(info.get_name());
    return names.sort();
}

function read(name) {
    const [, bytes] = Gio.File.new_for_path(GLib.build_filenamev([iconsDir(), name]))
        .load_contents(null);
    return new TextDecoder().decode(bytes);
}

const files = shippedFiles();

suite('the shipped icons', () => {
    test('there are some, and they are all SVGs', () => {
        assert(files.length > 0, 'no icons are shipped at all');
        for (const name of files)
            assert(name.endsWith('.svg'), `${name} is not an SVG`);
    });

    test('every one is named -symbolic.svg, which is what makes it recolourable', () => {
        for (const name of files) {
            assert(name.endsWith('-symbolic.svg'),
                `${name} would be blitted as a picture, not recoloured to the panel colour`);
        }
    });

    test('none carries a hard-coded colour', () => {
        for (const name of files) {
            const svg = read(name);
            assert(!/#[0-9a-fA-F]{3,8}\b/.test(svg), `${name} has a hex colour in it`);
            assert(!/\b(fill|stroke)\s*[:=]\s*["']?(?!currentColor|none)[a-z]{3,}/i.test(svg),
                `${name} names a colour instead of currentColor`);
        }
    });

    test('every one paints with currentColor', () => {
        for (const name of files)
            assert(read(name).includes('fill="currentColor"'), `${name} does not use currentColor`);
    });

    test('every one is drawn on the 16px grid Adwaita symbolics use', () => {
        for (const name of files) {
            const svg = read(name);
            assert(svg.includes('viewBox="0 0 16 16"'), `${name} is not on a 16x16 viewBox`);
            assert(svg.includes('width="16"') && svg.includes('height="16"'),
                `${name} does not declare a 16px size`);
        }
    });

    test('nothing stands between the top of the file and <svg>', () => {
        // gdk-pixbuf recognises an SVG by sniffing the start of the file. A comment before the
        // <svg> element pushes it past that window, and the loader then refuses the file
        // entirely: the shell silently substitutes a fallback icon, the panel shows a glyph
        // that is not ours, and nothing is logged. That is exactly what happened here — the
        // tests above all passed while the bulb was never once rendered. Comments live inside
        // the element now.
        for (const name of files) {
            const svg = read(name);
            const beforeSvg = svg.slice(0, svg.indexOf('<svg'));
            assert(!beforeSvg.includes('<!--'),
                `${name} has a comment before <svg>, which stops it being recognised at all`);
            assertEquals(beforeSvg.trim(), '<?xml version="1.0" encoding="UTF-8"?>',
                `${name} has something other than the XML declaration before <svg>`);
        }
    });

    test('every one actually rasterises', () => {
        // The check the structural rule above is a proxy for: ask the same loader the shell
        // uses whether this file is an image at all.
        for (const name of files) {
            const path = GLib.build_filenamev([iconsDir(), name]);
            let pixbuf = null;
            try {
                pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, 16, 16, true);
            } catch (error) {
                assert(false, `${name} could not be loaded as an image: ${error.message}`);
            }
            assertEquals(pixbuf.get_width(), 16, `${name} did not rasterise at 16px`);
        }
    });

    test('none embeds a raster image or a script', () => {
        for (const name of files) {
            const svg = read(name);
            assert(!svg.includes('<image'), `${name} embeds a raster image`);
            assert(!svg.includes('<script'), `${name} contains a script`);
            assert(!svg.includes('base64'), `${name} embeds base64 data`);
        }
    });
});

suite('ICONS and the files on disk', () => {
    test('every shipped name in ICONS is a file that exists', () => {
        for (const [state, name] of Object.entries(ICONS)) {
            if (!isShippedIcon(name))
                continue;
            assert(files.includes(`${name}.svg`),
                `${state} wants ${name}.svg, which is not in src/extension/icons`);
        }
    });

    test('every file on disk is named by ICONS — no orphans shipped', () => {
        const wanted = Object.values(ICONS)
            .filter(isShippedIcon)
            .map(name => `${name}.svg`)
            .sort();

        assertDeepEquals(files, wanted);
    });

    test('the queue states wear bulbs, and the connection states do not', () => {
        // The answered open question: the panel is a bulb, and the states that are about the
        // connection rather than the queue keep the stock glyph that says more.
        for (const state of ['running', 'blocked', 'idle', 'allBlocked'])
            assert(isShippedIcon(ICONS[state]), `${state} should wear a bulb`);

        for (const state of ['unreachable', 'unavailable', 'unconfigured']) {
            assert(!isShippedIcon(ICONS[state]), `${state} should keep its stock icon`);
            assert(ICONS[state].endsWith('-symbolic'), `${state} should still be symbolic`);
        }
    });

    test('isShippedIcon is not fooled by a name that merely mentions us', () => {
        assertEquals(isShippedIcon('aideas-bulb-idle-symbolic'), true);
        assertEquals(isShippedIcon('network-offline-symbolic'), false);
        assertEquals(isShippedIcon('theme-aideas-bulb'), false);
        for (const value of [null, undefined, 42, {}, []])
            assertEquals(isShippedIcon(value), false, `for ${JSON.stringify(value)}`);
    });

    test('every icon name, shipped or not, is symbolic', () => {
        for (const [state, name] of Object.entries(ICONS))
            assert(name.endsWith('-symbolic'), `${state}'s icon ${name} is not symbolic`);
    });
});
