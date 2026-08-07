#!/usr/bin/env -S gjs -m
// The bridge between a browser extension and org.gnome.Tasks.
//
// A WebExtension cannot speak D-Bus, and the daemon cannot speak to a browser: native messaging is
// the only channel between them, and it is *browser-initiated* — the browser launches this process
// and talks to it over stdin/stdout. So the host stays alive for as long as the browser keeps the
// port open, forwarding in both directions:
//
//   browser -> host -> org.gnome.Tasks.ReportAppState   (here are my windows and tabs)
//   daemon  -> host -> browser                          (rebuild this state, please)
//
// The framing (4-byte little-endian length + JSON) lives in src/lib/browserState.js with tests,
// because getting it wrong does not error — it deadlocks.
//
// Installed by `make install-browser-host`; see docs/browser-adapters.md.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { DAEMON_NAME, DAEMON_OBJECT_PATH } from '../lib/protocol.js';
import { BROWSER_ADAPTERS, frameMessage, readMessages } from '../lib/browserState.js';

const loop = new GLib.MainLoop(null, false);

// Which browser is on the other end. Passed by the wrapper script, because Firefox and Chrome hand
// the host different arguments and neither reliably identifies itself.
const adapter = GLib.getenv('GNOME_TASKS_BROWSER') ?? 'firefox';
if (!BROWSER_ADAPTERS.has(adapter)) {
    printerr(`gnome-tasks-browser-host: unknown browser "${adapter}"`);
    imports.system.exit(2);
}

const stdin = new Gio.DataInputStream({
    base_stream: new Gio.UnixInputStream({ fd: 0, close_fd: false }),
});
const stdout = new Gio.UnixOutputStream({ fd: 1, close_fd: false });

let pending = new Uint8Array(0);

function send(message) {
    try {
        const framed = frameMessage(message);
        stdout.write_all(framed, null);
        stdout.flush(null);
    } catch (error) {
        // The browser has gone; so should we.
        printerr(`gnome-tasks-browser-host: write failed: ${error.message}`);
        loop.quit();
    }
}

/** Forward a report from the browser to the daemon. */
function reportToDaemon(json) {
    Gio.DBus.session.call(
        DAEMON_NAME, DAEMON_OBJECT_PATH, DAEMON_NAME, 'ReportAppState',
        new GLib.Variant('(ss)', [adapter, json]), null,
        Gio.DBusCallFlags.NONE, 5000, null,
        (connection, result) => {
            try {
                connection.call_finish(result);
            } catch (error) {
                // A daemon that is not running is a normal state, not a reason to die: the browser
                // may well outlive it.
                printerr(`gnome-tasks-browser-host: ReportAppState failed: ${error.message}`);
            }
        });
}

function handleMessage(message) {
    switch (message?.type) {
        case 'report':
            // The extension sends the whole document; the daemon validates it.
            reportToDaemon(JSON.stringify({ adapter, windows: message.windows ?? [] }));
            break;

        case 'hello':
            send({ type: 'hello', adapter, host: 'gnome-tasks' });
            break;

        default:
            printerr(`gnome-tasks-browser-host: ignoring message of type ${message?.type}`);
    }
}

function onRead(stream, result) {
    let bytes;
    try {
        bytes = stream.read_bytes_finish(result);
    } catch (error) {
        printerr(`gnome-tasks-browser-host: read failed: ${error.message}`);
        loop.quit();
        return;
    }

    // Zero bytes means the browser closed the port: the extension was disabled, or the browser quit.
    if (bytes.get_size() === 0) {
        loop.quit();
        return;
    }

    const chunk = bytes.get_data();
    const combined = new Uint8Array(pending.length + chunk.length);
    combined.set(pending, 0);
    combined.set(chunk, pending.length);

    const { messages, rest } = readMessages(combined);
    pending = rest;
    for (const message of messages)
        handleMessage(message);

    readMore();
}

function readMore() {
    stdin.read_bytes_async(65536, GLib.PRIORITY_DEFAULT, null, onRead);
}

// The daemon asks for a restore by signal, since it has no idea whether a browser is listening.
const subscription = Gio.DBus.session.signal_subscribe(
    null, DAEMON_NAME, 'RestoreAppState', DAEMON_OBJECT_PATH, null, Gio.DBusSignalFlags.NONE,
    (connection, sender, path, iface, signal, parameters) => {
        const [adapterId, json] = parameters.deepUnpack();
        if (adapterId !== adapter)
            return;

        try {
            send({ type: 'restore', ...JSON.parse(json) });
        } catch (error) {
            printerr(`gnome-tasks-browser-host: bad restore request: ${error.message}`);
        }
    });

readMore();
loop.run();

Gio.DBus.session.signal_unsubscribe(subscription);
