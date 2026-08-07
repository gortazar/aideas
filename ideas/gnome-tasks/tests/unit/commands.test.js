import { suite, test, assert, assertEquals, assertDeepEquals, assertThrows, assertMatch } from '../harness.js';
import {
    commandsToStart,
    createCommand,
    parseCommandLine,
    unitNameFor,
    validateCommand,
} from '../../src/lib/commands.js';

suite('command model', () => {
    test('a command needs a command line', () => {
        assertThrows(() => createCommand({ commandLine: '' }));
        assertThrows(() => createCommand({}));
        assertThrows(() => createCommand({ commandLine: '   ' }));
    });

    test('a new command is not confirmed, and therefore will not run', () => {
        const command = createCommand({ commandLine: 'docker compose up' });

        assertEquals(command.confirmed, false,
            'a stored command must be shown to the user before it is ever executed');
    });

    test('a command carries a label, a working directory and an id', () => {
        const command = createCommand({
            commandLine: 'npm run dev',
            label: 'dev server',
            workingDirectory: '/home/u/project',
        });

        assertMatch(command.id, /^[0-9a-f-]{36}$/);
        assertEquals(command.label, 'dev server');
        assertEquals(command.workingDirectory, '/home/u/project');
        assertEquals(command.commandLine, 'npm run dev');
    });

    test('the label defaults to the command line', () => {
        assertEquals(createCommand({ commandLine: 'npm run dev' }).label, 'npm run dev');
    });

    test('validateCommand rejects what cannot be run', () => {
        assert(validateCommand(createCommand({ commandLine: 'true' })) === null);

        const bad = { ...createCommand({ commandLine: 'true' }), commandLine: '' };
        assertMatch(validateCommand(bad), /command line/i);
    });
});

suite('command lines', () => {
    test('a simple command line splits into argv', () => {
        assertDeepEquals(parseCommandLine('npm run dev'), ['npm', 'run', 'dev']);
    });

    test('quoted arguments stay together', () => {
        assertDeepEquals(parseCommandLine('ssh -L "8080:localhost:80" host'),
            ['ssh', '-L', '8080:localhost:80', 'host']);
        assertDeepEquals(parseCommandLine("git commit -m 'a message here'"),
            ['git', 'commit', '-m', 'a message here']);
    });

    test('extra whitespace is ignored', () => {
        assertDeepEquals(parseCommandLine('  docker   compose  up  '),
            ['docker', 'compose', 'up']);
    });

    // Shell metacharacters are the whole reason this is not passed to a shell: a stored string that
    // silently gained `; rm -rf ~` would otherwise run it. A command that genuinely needs a shell
    // has to say so explicitly.
    test('shell metacharacters are not interpreted', () => {
        assertDeepEquals(parseCommandLine('echo hi; rm -rf /'),
            ['echo', 'hi;', 'rm', '-rf', '/']);
        assertDeepEquals(parseCommandLine('cat a | wc -l'), ['cat', 'a', '|', 'wc', '-l']);
    });

    test('an unbalanced quote is an error, not a silent truncation', () => {
        assertThrows(() => parseCommandLine('ssh -L "8080:localhost'));
    });

    test('an empty command line has no argv', () => {
        assertDeepEquals(parseCommandLine('   '), []);
    });
});

suite('unit naming', () => {
    const taskUuid = '6f8b2c1e-0a4d-4f1b-9c3a-1d2e3f4a5b6c';

    test('a unit name identifies the task and the command', () => {
        const name = unitNameFor(taskUuid, 'c1d2e3f4-0000-4000-8000-000000000000');

        assertMatch(name, /^gnome-tasks-/);
        assert(name.endsWith('.scope'), 'a scope, so the command keeps its own cgroup');
        assert(name.includes('6f8b2c1e'), 'the task must be identifiable in the journal');
    });

    test('the same task and command always produce the same unit name', () => {
        assertEquals(unitNameFor(taskUuid, 'c1'), unitNameFor(taskUuid, 'c1'));
    });

    test('different commands of one task get different units', () => {
        assert(unitNameFor(taskUuid, 'c1') !== unitNameFor(taskUuid, 'c2'));
    });

    // systemd unit names allow a restricted character set; anything else has to be escaped or the
    // StartTransientUnit call fails with an unhelpful error.
    test('unit names contain only characters systemd accepts', () => {
        const name = unitNameFor(taskUuid, 'weird/id with spaces:and*stars');

        assertMatch(name, /^[a-zA-Z0-9:_.\\-]+\.scope$/);
    });
});

suite('commandsToStart', () => {
    const confirmed = { ...createCommand({ commandLine: 'true', label: 'ok' }), confirmed: true };
    const unconfirmed = createCommand({ commandLine: 'rm -rf /', label: 'scary' });
    const disabled = { ...confirmed, enabled: false };

    test('only confirmed commands are started', () => {
        const { start, needConfirmation } = commandsToStart([confirmed, unconfirmed]);

        assertDeepEquals(start.map(c => c.label), ['ok']);
        assertDeepEquals(needConfirmation.map(c => c.label), ['scary']);
    });

    test('a disabled command is neither started nor asked about', () => {
        const { start, needConfirmation } = commandsToStart([disabled]);

        assertEquals(start.length, 0);
        assertEquals(needConfirmation.length, 0);
    });

    test('an invalid command is skipped and reported', () => {
        const broken = { ...confirmed, commandLine: '' };
        const { start, invalid } = commandsToStart([broken]);

        assertEquals(start.length, 0);
        assertEquals(invalid.length, 1);
        assertMatch(invalid[0].problem, /command line/i);
    });

    test('no commands means nothing to do', () => {
        assertDeepEquals(commandsToStart([]), { start: [], needConfirmation: [], invalid: [] });
        assertDeepEquals(commandsToStart(undefined),
            { start: [], needConfirmation: [], invalid: [] });
    });
});
