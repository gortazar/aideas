// The native-messaging host, exercised the way a browser exercises it: framed JSON on stdin and
// stdout, with a real daemon on the other side.
//
// This is the only test that runs the host process at all, and it covers the two things that would
// otherwise only be discovered by a user with a browser open: that a report reaches the daemon, and
// that a restore request reaches the browser.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { frameMessage, readMessages } from '../../src/lib/browserState.js';
import { call, sleep, startDaemon, stopDaemon } from './helpers.js';

let session = null;

async function daemon() {
    if (!session || session.exited)
        session = await startDaemon();
    return session;
}

function repoRoot() {
    const here = GLib.filename_from_uri(import.meta.url)[0];
    return GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(here)));
}

/** Start the host the way a browser would: a child process with pipes on stdin and stdout. */
function startHost(browser = 'firefox') {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE,
    });
    launcher.setenv('GNOME_TASKS_BROWSER', browser, true);

    const host = launcher.spawnv([
        'gjs', '-m',
        GLib.build_filenamev([repoRoot(), 'src', 'native-host', 'gnome-tasks-browser-host.js']),
    ]);

    return {
        host,
        stdin: host.get_stdin_pipe(),
        stdout: host.get_stdout_pipe(),
    };
}

function write(stdin, message) {
    stdin.write_all(frameMessage(message), null);
    stdin.flush(null);
}

/** Read whatever the host has sent, if anything, without blocking for ever. */
async function readMessage(stdout, timeoutMs = 4000) {
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    let buffer = new Uint8Array(0);

    while (GLib.get_monotonic_time() < deadline) {
        const bytes = await new Promise(resolve => {
            stdout.read_bytes_async(65536, GLib.PRIORITY_DEFAULT, null, (stream, result) => {
                try {
                    resolve(stream.read_bytes_finish(result));
                } catch {
                    resolve(null);
                }
            });
        });

        if (!bytes || bytes.get_size() === 0)
            break;

        const chunk = bytes.get_data();
        const combined = new Uint8Array(buffer.length + chunk.length);
        combined.set(buffer, 0);
        combined.set(chunk, buffer.length);

        const { messages, rest } = readMessages(combined);
        buffer = rest;
        if (messages.length > 0)
            return messages[0];
    }

    return null;
}

const REPORT = {
    type: 'report',
    windows: [{
        id: 7,
        focused: true,
        tabs: [
            { url: 'https://example.com/', title: 'Example', active: true },
            { url: 'https://gnome.org/', title: 'GNOME', pinned: true },
        ],
    }],
};

suite('native messaging host', () => {
    test('a report from the browser reaches the daemon', async () => {
        await daemon();
        const [uuid] = await call('CreateTask', new GLib.Variant('(ss)', ['Browser task', '']), '(s)');
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(400);

        const { host, stdin } = startHost('firefox');
        try {
            write(stdin, REPORT);
            await sleep(1500);

            const [json] = await call('GetAppState',
                new GLib.Variant('(ss)', [uuid, 'firefox']), '(s)');
            const state = JSON.parse(json);

            assertEquals(state.adapter, 'firefox');
            assertEquals(state.windows.length, 1);
            assertDeepEquals(state.windows[0].tabs.map(tab => tab.url),
                ['https://example.com/', 'https://gnome.org/']);
        } finally {
            stdin.close(null);
            host.force_exit();
        }

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
    });

    test('the host answers a hello, so the extension can tell it is there', async () => {
        await daemon();
        const { host, stdin, stdout } = startHost('chrome');
        try {
            write(stdin, { type: 'hello' });
            const reply = await readMessage(stdout);

            assert(reply !== null, 'the host should have replied');
            assertEquals(reply.type, 'hello');
            assertEquals(reply.adapter, 'chrome');
        } finally {
            stdin.close(null);
            host.force_exit();
        }
    });

    // The direction that makes tier 2 work at all: tabs are not on disk, so the only way back is the
    // daemon asking the browser to rebuild them.
    test('a restore from the daemon reaches the browser', async () => {
        await daemon();
        const [uuid] = await call('CreateTask', new GLib.Variant('(ss)', ['Restores', '']), '(s)');
        const [other] = await call('CreateTask', new GLib.Variant('(ss)', ['Away', '']), '(s)');
        await call('ActivateTask', new GLib.Variant('(s)', [uuid]));
        await sleep(400);

        const { host, stdin, stdout } = startHost('firefox');
        try {
            write(stdin, REPORT);
            await sleep(1200);

            // Switch away and back: the daemon should ask for a restore on the way in.
            await call('ActivateTask', new GLib.Variant('(s)', [other]));
            await sleep(800);
            await call('ActivateTask', new GLib.Variant('(s)', [uuid]));

            const request = await readMessage(stdout, 6000);
            assert(request !== null, 'the host should have forwarded a restore request');
            assertEquals(request.type, 'restore');
            assertEquals(request.adapter, 'firefox');
            assertDeepEquals(request.windows[0].urls,
                ['https://example.com/', 'https://gnome.org/']);
        } finally {
            stdin.close(null);
            host.force_exit();
        }

        await call('StopTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [uuid]));
        await call('DeleteTask', new GLib.Variant('(s)', [other]));
    });

    test('the host exits when the browser closes the port', async () => {
        await daemon();
        const { host, stdin } = startHost('firefox');

        stdin.close(null);
        // A host that lingered would leak a process per browser start.
        const exited = await new Promise(resolve => {
            host.wait_async(null, (subprocess, result) => {
                try {
                    subprocess.wait_finish(result);
                    resolve(true);
                } catch {
                    resolve(false);
                }
            });
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
                resolve(false);
                return GLib.SOURCE_REMOVE;
            });
        });

        if (!exited)
            host.force_exit();
        assert(exited, 'the host should exit when its stdin closes');
    });
});

suite('native host teardown', () => {
    test('the daemon shuts down cleanly', async () => {
        await stopDaemon(await daemon());
        assert(session.exited);
    });
});
