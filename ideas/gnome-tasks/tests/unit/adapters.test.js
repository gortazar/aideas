import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { adapterFor, describeAdapters, documentsFor } from '../../src/lib/adapters/index.js';
import { describeWindow } from '../../src/lib/windowModel.js';

function win(appId, extra = {}) {
    return describeWindow({
        id: 'w1',
        appId,
        pid: 4242,
        windowType: 'NORMAL',
        frameRect: { x: 0, y: 0, width: 800, height: 600 },
        ...extra,
    });
}

suite('adapter selection', () => {
    test('an app with no adapter gets the tier-0 fallback', () => {
        const adapter = adapterFor(win('org.gnome.Calculator.desktop'));

        assertEquals(adapter.id, 'app-only');
        assertEquals(adapter.tier, 0);
    });

    test('a specific adapter wins over the generic command-line one', () => {
        assertEquals(adapterFor(win('org.gnome.Nautilus.desktop')).id, 'nautilus');
        assertEquals(adapterFor(win('org.gnome.Terminal.desktop')).id, 'terminal');
    });

    test('apps known to take file arguments use the command-line adapter', () => {
        assertEquals(adapterFor(win('org.gnome.TextEditor.desktop')).id, 'command-line');
        assertEquals(adapterFor(win('org.gnome.Evince.desktop')).id, 'command-line');
    });

    test('every registered adapter declares an id, a tier and how it finds documents', () => {
        for (const adapter of describeAdapters()) {
            assert(typeof adapter.id === 'string' && adapter.id.length > 0, 'id');
            assert([0, 1, 2].includes(adapter.tier), `tier of ${adapter.id}`);
            assert(typeof adapter.describes === 'string' && adapter.describes.length > 10,
                `${adapter.id} must say what it does, for docs/app-adapters.md`);
        }
    });
});

suite('command-line adapter', () => {
    // The M0 finding this is built on: gnome-text-editor's cmdline literally contains the file.
    test('file arguments become file:// URIs', () => {
        const documents = documentsFor(win('org.gnome.TextEditor.desktop'), {
            cmdline: ['/usr/bin/gnome-text-editor', '/home/u/notes.txt'],
            cwd: '/home/u',
            files: [],
            existing: ['/home/u/notes.txt'],
        });

        assertDeepEquals(documents, ['file:///home/u/notes.txt']);
    });

    test('a relative argument is resolved against the working directory', () => {
        const documents = documentsFor(win('org.gnome.TextEditor.desktop'), {
            cmdline: ['gnome-text-editor', 'notes.txt'],
            cwd: '/home/u/project',
            files: [],
            existing: ['/home/u/project/notes.txt'],
        });

        assertDeepEquals(documents, ['file:///home/u/project/notes.txt']);
    });

    test('URIs on the command line are passed through', () => {
        const documents = documentsFor(win('org.gnome.TextEditor.desktop'), {
            cmdline: ['gnome-text-editor', 'sftp://host/tmp/x.txt'],
            cwd: '/',
            files: [],
            existing: [],
        });

        assertDeepEquals(documents, ['sftp://host/tmp/x.txt']);
    });

    test('flags and non-existent paths are not documents', () => {
        const documents = documentsFor(win('org.gnome.TextEditor.desktop'), {
            cmdline: ['gnome-text-editor', '--new-window', '-v', '/home/u/deleted.txt'],
            cwd: '/home/u',
            files: [],
            existing: [],
        });

        assertDeepEquals(documents, []);
    });

    // The other M0 finding: a D-Bus-activated app's cmdline says nothing about documents.
    test('a --gapplication-service command line yields nothing', () => {
        const documents = documentsFor(win('org.gnome.TextEditor.desktop'), {
            cmdline: ['/usr/bin/gnome-text-editor', '--gapplication-service'],
            cwd: '/',
            files: [],
            existing: [],
        });

        assertDeepEquals(documents, []);
    });

    // The filter that keeps an app's own state out of the capture must not apply to arguments: a
    // file the user explicitly opened is a document wherever it happens to live.
    test('an explicitly passed file in /tmp is still a document', () => {
        const documents = documentsFor(win('org.gnome.TextEditor.desktop'), {
            cmdline: ['gnome-text-editor', '/tmp/scratch.txt'],
            cwd: '/tmp',
            files: [],
            existing: ['/tmp/scratch.txt'],
        });

        assertDeepEquals(documents, ['file:///tmp/scratch.txt']);
    });

    test('a path is never recorded twice', () => {
        const documents = documentsFor(win('org.gnome.TextEditor.desktop'), {
            cmdline: ['gnome-text-editor', '/home/u/a.txt', '/home/u/a.txt'],
            cwd: '/home/u',
            files: [],
            existing: ['/home/u/a.txt'],
        });

        assertDeepEquals(documents, ['file:///home/u/a.txt']);
    });
});

suite('nautilus adapter', () => {
    // Nautilus is D-Bus activated, so its command line is useless; it does hold an fd on the
    // directory it is showing, which is what this uses.
    test('an open directory fd becomes the document', () => {
        const documents = documentsFor(win('org.gnome.Nautilus.desktop'), {
            cmdline: ['/usr/bin/nautilus', '--gapplication-service'],
            cwd: '/',
            files: ['/home/u/.local/share/nautilus/tags/meta.db', '/home/u/project'],
            directories: ['/home/u/project'],
            existing: ['/home/u/project'],
        });

        assertDeepEquals(documents, ['file:///home/u/project']);
    });

    test('its own state files are not documents', () => {
        const documents = documentsFor(win('org.gnome.Nautilus.desktop'), {
            cmdline: ['/usr/bin/nautilus', '--gapplication-service'],
            cwd: '/',
            files: ['/home/u/.local/share/nautilus/tags/meta.db',
                '/home/u/.cache/nautilus/thumbnails'],
            directories: ['/home/u/.cache/nautilus/thumbnails'],
            existing: ['/home/u/.cache/nautilus/thumbnails'],
        });

        assertDeepEquals(documents, []);
    });
});

suite('terminal adapter', () => {
    // Confirmed in M0: the window belongs to gnome-terminal-server, whose pid and cwd are the
    // server's, and the shell's directory appears only in the title.
    test('the working directory is read out of the title', () => {
        const documents = documentsFor(win('org.gnome.Terminal.desktop', {
            title: 'patxi@host:/home/u/project',
        }), { cmdline: ['/usr/libexec/gnome-terminal-server'], cwd: '/home/u', files: [],
            existing: ['/home/u/project'] });

        assertDeepEquals(documents, ['file:///home/u/project']);
    });

    test('a tilde in the title is expanded', () => {
        const documents = documentsFor(win('org.gnome.Terminal.desktop', {
            title: 'patxi@host:~/project',
        }), { cmdline: [], cwd: '/', files: [], home: '/home/u',
            existing: ['/home/u/project'] });

        assertDeepEquals(documents, ['file:///home/u/project']);
    });

    test('a title that is not a path yields nothing rather than a guess', () => {
        for (const title of ['vim notes.txt', 'htop', '']) {
            const documents = documentsFor(win('org.gnome.Terminal.desktop', { title }),
                { cmdline: [], cwd: '/', files: [], existing: [] });
            assertDeepEquals(documents, [], `title ${JSON.stringify(title)}`);
        }
    });

    test('a directory that no longer exists is not restored', () => {
        const documents = documentsFor(win('org.gnome.Terminal.desktop', {
            title: 'patxi@host:/home/u/gone',
        }), { cmdline: [], cwd: '/', files: [], existing: [] });

        assertDeepEquals(documents, []);
    });
});

suite('tier-0 fallback', () => {
    test('an app with no adapter has no documents, whatever its command line says', () => {
        const documents = documentsFor(win('org.gnome.Calculator.desktop'), {
            cmdline: ['/usr/bin/gnome-calculator', '/home/u/notes.txt'],
            cwd: '/home/u',
            files: [],
            existing: ['/home/u/notes.txt'],
        });

        assertDeepEquals(documents, [],
            'guessing for unknown apps would restore the wrong thing');
    });

    test('missing process information is not an error', () => {
        assertDeepEquals(documentsFor(win('org.gnome.TextEditor.desktop'), null), []);
        assertDeepEquals(documentsFor(win('org.gnome.TextEditor.desktop'), {}), []);
    });
});
