// Support for the D-Bus integration tests. These run under `dbus-run-session`, so the bus they
// talk to is private and empty: nothing here can reach the developer's real session.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { DAEMON_NAME, DAEMON_OBJECT_PATH } from '../../src/lib/protocol.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call');
Gio._promisify(Gio.Subprocess.prototype, 'wait_check');

export function sleep(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

function repoRoot() {
    // …/tests/dbus/helpers.js -> …
    const here = GLib.filename_from_uri(import.meta.url)[0];
    return GLib.path_get_dirname(GLib.path_get_dirname(GLib.path_get_dirname(here)));
}

async function nameHasOwner(name) {
    const reply = await Gio.DBus.session.call(
        'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
        'NameHasOwner', new GLib.Variant('(s)', [name]), new GLib.VariantType('(b)'),
        Gio.DBusCallFlags.NONE, -1, null);
    return reply.deepUnpack()[0];
}

/**
 * Start the daemon on the current (private) bus with a scratch data directory, and resolve once it
 * owns its name.
 */
export async function startDaemon({ dataDir = GLib.dir_make_tmp('gnome-tasks-dbus-XXXXXX') } = {}) {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_SILENCE,
    });
    launcher.setenv('GNOME_TASKS_DATA_DIR', dataDir, true);

    const daemon = launcher.spawnv([
        'gjs', '-m', GLib.build_filenamev([repoRoot(), 'src', 'daemon', 'main.js']),
    ]);

    // Gio.Subprocess.get_if_exited() may only be called once the child has been reaped, so the
    // exit is tracked through wait_async. It is a promise rather than a flag because tests replace
    // the session object wholesale when they restart the daemon, and a copied boolean would never
    // be updated again.
    let exited = false;
    const exit = new Promise(resolve => {
        daemon.wait_async(null, (subprocess, result) => {
            try {
                subprocess.wait_finish(result);
            } catch {
                // the exit status is inspected by the caller, not here
            }
            exited = true;
            resolve();
        });
    });

    const state = { daemon, dataDir, exit, get exited() {
        return exited;
    } };

    for (let attempt = 0; attempt < 100; attempt++) {
        if (await nameHasOwner(DAEMON_NAME))
            return state;
        if (exited)
            throw new Error(`the daemon exited before owning ${DAEMON_NAME}`);
        await sleep(50);
    }

    daemon.force_exit();
    throw new Error(`the daemon never took ${DAEMON_NAME}`);
}

export async function stopDaemon(state) {
    if (!state?.daemon || state.exited)
        return;

    state.daemon.send_signal(15); // SIGTERM

    const timedOut = Symbol('timed out');
    const raced = await Promise.race([
        state.exit.then(() => 'exited'),
        sleep(2000).then(() => timedOut),
    ]);
    if (raced === timedOut) {
        state.daemon.force_exit();
        await state.exit;
    }
}

/** Call a method on org.gnome.Tasks and return the unpacked reply. */
export async function call(method, parameters = null, replyType = null) {
    const reply = await Gio.DBus.session.call(
        DAEMON_NAME, DAEMON_OBJECT_PATH, DAEMON_NAME, method, parameters,
        replyType ? new GLib.VariantType(replyType) : null,
        Gio.DBusCallFlags.NONE, 5000, null);
    return reply.deepUnpack();
}

export async function getProperty(name) {
    const reply = await Gio.DBus.session.call(
        DAEMON_NAME, DAEMON_OBJECT_PATH, 'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', [DAEMON_NAME, name]), new GLib.VariantType('(v)'),
        Gio.DBusCallFlags.NONE, 5000, null);
    return reply.deepUnpack()[0].recursiveUnpack();
}

export async function setProperty(name, variant) {
    await Gio.DBus.session.call(
        DAEMON_NAME, DAEMON_OBJECT_PATH, 'org.freedesktop.DBus.Properties', 'Set',
        new GLib.Variant('(ssv)', [DAEMON_NAME, name, variant]), null,
        Gio.DBusCallFlags.NONE, 5000, null);
}

/**
 * Collect signals emitted by the daemon while `body` runs. Resolves to an array of
 * [signalName, unpackedArgs].
 */
export async function recordSignals(body, { settleMs = 300 } = {}) {
    const seen = [];
    const id = Gio.DBus.session.signal_subscribe(
        null, DAEMON_NAME, null, DAEMON_OBJECT_PATH, null, Gio.DBusSignalFlags.NONE,
        (connection, sender, path, iface, signal, parameters) => {
            seen.push([signal, parameters.deepUnpack()]);
        });

    try {
        await body();
        await sleep(settleMs);
    } finally {
        Gio.DBus.session.signal_unsubscribe(id);
    }

    return seen;
}
