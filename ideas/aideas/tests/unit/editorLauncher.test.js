// Opening the queue in an editor: discovery, argv, and the line a new idea goes on.
//
// Everything here is driven through injected seams — "does this program exist", "does this file
// exist", "read this file", "start this" — so no editor is ever launched and no file on this
// machine is read. That matters more than usual: this is the first thing the extension does
// *locally*, and a test that really spawned a process would open a window on whoever ran it.

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import {
    EDITOR_CANDIDATES, splitCommand, ideasInsertionLine, resolveEditor, resolveQueue,
    describeOpen, openQueue,
} from '../../src/lib/editorLauncher.js';

/** A world where only the named programs are on PATH and only the named files exist. */
function world({ programs = [], files = [], contents = {} } = {}) {
    return {
        exists: name => programs.includes(name),
        fileExists: path => files.includes(path),
        readFile: path => {
            if (!(path in contents))
                throw new Error(`no such file: ${path}`);
            return contents[path];
        },
    };
}

const QUEUE = [
    '# aideas — ranked idea list',
    '',
    'Some prose about the list.',
    '',
    '## Ideas',
    '',
    '1. [pwgen](ideas/pwgen/) - a password generator',
    '',
    '2. [recap](ideas/recap/) - a daily summary',
    '',
    '## Finished',
    '',
    '1. [vacas](ideas/vacas/) - holidays',
    '',
].join('\n');

suite('splitCommand', () => {
    test('a bare command is one word', () => {
        assertDeepEquals(splitCommand('codium'), ['codium']);
    });

    test('words are split on whitespace, and the empties dropped', () => {
        assertDeepEquals(splitCommand('  flatpak   run  com.vscodium.codium '),
            ['flatpak', 'run', 'com.vscodium.codium']);
    });

    test('a quoted path with a space stays one argument', () => {
        assertDeepEquals(splitCommand('"/opt/my editor/bin/codium" --wait'),
            ['/opt/my editor/bin/codium', '--wait']);
        assertDeepEquals(splitCommand("'/opt/my editor/codium'"), ['/opt/my editor/codium']);
    });

    test('a backslash escapes the next character outside quotes', () => {
        assertDeepEquals(splitCommand('/opt/my\\ editor/codium'), ['/opt/my editor/codium']);
    });

    test('nothing configured is no words at all', () => {
        for (const value of ['', '   ', null, undefined])
            assertDeepEquals(splitCommand(value), [], `for ${JSON.stringify(value)}`);
    });

    test('an unterminated quote still yields the word rather than throwing', () => {
        // A half-typed preference must not be able to break the menu.
        assertDeepEquals(splitCommand('"/opt/codium'), ['/opt/codium']);
    });
});

suite('resolveEditor', () => {
    test('codium first, when it is there', () => {
        const { argv, problem } = resolveEditor('', world({ programs: ['codium', 'vscodium'] }).exists);

        assertDeepEquals(argv, ['codium']);
        assertEquals(problem, null);
    });

    test('vscodium when codium is not', () => {
        assertDeepEquals(resolveEditor('', world({ programs: ['vscodium'] }).exists).argv,
            ['vscodium']);
    });

    test('the flatpak\'s exported wrapper last', () => {
        // A flatpak install exports <app-id> onto PATH, so one seam finds all three forms.
        assertDeepEquals(
            resolveEditor('', world({ programs: ['com.vscodium.codium'] }).exists).argv,
            ['com.vscodium.codium']);
    });

    test('nothing found names the preference that fixes it', () => {
        const { argv, problem } = resolveEditor('', world().exists);

        assertEquals(argv, null);
        assert(problem.includes('preferences'), problem);
    });

    test('a configured command is used verbatim, without being looked for', () => {
        // Deliberate: this is also how somebody who wants a different editor gets one.
        const { argv, problem } = resolveEditor('gnome-text-editor', world().exists);

        assertDeepEquals(argv, ['gnome-text-editor']);
        assertEquals(problem, null);
    });

    test('a configured command with arguments keeps them', () => {
        assertDeepEquals(resolveEditor('flatpak run com.vscodium.codium', world().exists).argv,
            ['flatpak', 'run', 'com.vscodium.codium']);
    });

    test('the candidates are tried in the documented order', () => {
        assertDeepEquals(EDITOR_CANDIDATES, ['codium', 'vscodium', 'com.vscodium.codium']);
    });
});

suite('resolveQueue', () => {
    test('a configured repository names its README', () => {
        const { readme, problem } = resolveQueue('/home/p/aideas',
            world({ files: ['/home/p/aideas/README.md'] }).fileExists);

        assertEquals(readme, '/home/p/aideas/README.md');
        assertEquals(problem, null);
    });

    test('a trailing slash is not doubled', () => {
        assertEquals(resolveQueue('/home/p/aideas/',
            world({ files: ['/home/p/aideas/README.md'] }).fileExists).readme,
        '/home/p/aideas/README.md');
    });

    test('nothing configured says which preference to set, and never guesses ~/aideas', () => {
        const { repo, problem } = resolveQueue('   ', world().fileExists);

        assertEquals(repo, null);
        assertEquals(problem, 'set the repository path in preferences');
    });

    test('a wrong path says so, naming the file it looked for', () => {
        const { problem } = resolveQueue('/home/p/typo', world().fileExists);

        assertEquals(problem, '/home/p/typo/README.md does not exist');
    });
});

suite('ideasInsertionLine', () => {
    test('the last entry under ## Ideas, which is where the next one goes', () => {
        // Line 9 of the fixture is `2. [recap](...)`, 1-based.
        assertEquals(ideasInsertionLine(QUEUE), 9);
    });

    test('it stops at ## Finished rather than running to the end of the file', () => {
        assert(ideasInsertionLine(QUEUE) < QUEUE.split('\n').length);
    });

    test('an empty Ideas section lands on the heading itself', () => {
        assertEquals(ideasInsertionLine('# t\n\n## Ideas\n\n## Finished\n'), 3);
    });

    test('a file with no Ideas section opens at the top rather than failing', () => {
        assertEquals(ideasInsertionLine('# just a readme\n'), 1);
    });

    test('an Ideas section that runs to the end of the file is fine', () => {
        assertEquals(ideasInsertionLine('## Ideas\n\n1. [a](ideas/a/) - one\n\n'), 3);
    });

    test('nothing at all is line 1, not a throw', () => {
        for (const value of ['', null, undefined])
            assertEquals(ideasInsertionLine(value), 1, `for ${JSON.stringify(value)}`);
    });

    test('a heading with trailing whitespace is still the heading', () => {
        assertEquals(ideasInsertionLine('## Ideas   \n\n1. [a](ideas/a/) - one\n'), 3);
    });
});

suite('describeOpen', () => {
    test('a ready setup offers the path it will open, before it is clicked', () => {
        const { path, problem } = describeOpen({
            repoPath: '/home/p/aideas',
            editorCommand: '',
            ...world({ programs: ['codium'], files: ['/home/p/aideas/README.md'] }),
        });

        assertEquals(problem, null);
        assertEquals(path, '/home/p/aideas/README.md',
            'opening the wrong checkout should be visible before you type into it');
    });

    test('an unset repository is the first thing it complains about', () => {
        const { problem } = describeOpen({
            repoPath: '', editorCommand: '', ...world({ programs: ['codium'] }),
        });

        assertEquals(problem, 'set the repository path in preferences');
    });

    test('a missing editor is reported even when the repository is fine', () => {
        const { problem } = describeOpen({
            repoPath: '/home/p/aideas',
            editorCommand: '',
            ...world({ files: ['/home/p/aideas/README.md'] }),
        });

        assert(problem.includes('preferences'), problem);
    });
});

suite('openQueue', () => {
    function spawner(explode = null) {
        const calls = [];
        const spawn = argv => {
            calls.push(argv);
            if (explode)
                throw explode;
        };
        spawn.calls = calls;
        return spawn;
    }

    const ready = {
        repoPath: '/home/p/aideas',
        editorCommand: '',
        ...world({
            programs: ['codium'],
            files: ['/home/p/aideas/README.md'],
            contents: { '/home/p/aideas/README.md': QUEUE },
        }),
    };

    test('it opens the repository with the README at the end of the queue', () => {
        const spawn = spawner();

        const result = openQueue({ ...ready, spawn });

        assertEquals(result.launched, true);
        assertEquals(result.reason, null);
        assertDeepEquals(spawn.calls[0], [
            'codium', '/home/p/aideas', '--goto', '/home/p/aideas/README.md:9',
        ]);
    });

    test('nothing is spawned when the setup is not ready', () => {
        const spawn = spawner();

        const result = openQueue({ ...ready, repoPath: '', spawn });

        assertEquals(result.launched, false);
        assertEquals(spawn.calls.length, 0);
        assertEquals(result.reason, 'set the repository path in preferences');
    });

    test('a README that cannot be read still opens the file, at the top', () => {
        // The file exists — this is a permission problem or a race, and refusing to open the
        // editor over it would be worse than opening it on the wrong line.
        const spawn = spawner();
        const unreadable = {
            ...ready,
            readFile: () => {
                throw new Error('EACCES');
            },
        };

        const result = openQueue({ ...unreadable, spawn });

        assertEquals(result.launched, true);
        assertDeepEquals(spawn.calls[0].slice(-1), ['/home/p/aideas/README.md:1']);
    });

    test('a configured editor is used with its own arguments, repo and file appended', () => {
        const spawn = spawner();

        openQueue({ ...ready, editorCommand: 'flatpak run com.vscodium.codium', spawn });

        assertDeepEquals(spawn.calls[0], [
            'flatpak', 'run', 'com.vscodium.codium',
            '/home/p/aideas', '--goto', '/home/p/aideas/README.md:9',
        ]);
    });

    test('nothing is ever handed to a shell', () => {
        // A repository path is a string a person typed into a preferences field, and this is the
        // extension's first local spawn. It travels as one argv element, never interpolated
        // into anything a shell will parse.
        const repoPath = '/home/p/my ideas; rm -rf ~';
        const spawn = spawner();

        openQueue({
            repoPath,
            editorCommand: '',
            spawn,
            ...world({
                programs: ['codium'],
                files: [`${repoPath}/README.md`],
                contents: { [`${repoPath}/README.md`]: QUEUE },
            }),
        });

        const argv = spawn.calls[0];
        assertEquals(argv[1], repoPath, 'one argument, whatever is in it');
        assert(!argv.some(word => word === 'sh' || word === '-c'), 'no shell in the argv');
    });

    test('a failure to spawn is reported, and never throws into the menu', () => {
        const spawn = spawner(new Error('nope'));

        const result = openQueue({ ...ready, spawn });

        assertEquals(result.launched, false);
        assert(result.reason.length > 0, 'something sayable');
    });
});
