// Spawns tests/stub-state-server.py and waits for it to say which port it bound to.
//
// Loopback only, and the kernel picks the port, so this is hermetic enough to run inside the
// Nix sandbox — which has a private network namespace with nothing in it but `lo`.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/** The directory holding tests/, whatever the working directory is. */
function testsDir() {
    const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
    return GLib.path_get_dirname(here);
}

export class StubServer {
    /**
     * @param {object} [options]
     * @param {number} [options.slow]  seconds /state-slow waits before answering
     * @param {string} [options.body]  exact body for /state
     */
    constructor({ slow = 30, body = null } = {}) {
        const argv = ['python3', GLib.build_filenamev([testsDir(), 'stub-state-server.py']),
            '--slow', String(slow)];
        if (body !== null)
            argv.push('--body', body);

        this._process = new Gio.Subprocess({
            argv,
            flags: Gio.SubprocessFlags.STDOUT_PIPE,
        });
        this._process.init(null);

        this._stdout = new Gio.DataInputStream({
            base_stream: this._process.get_stdout_pipe(),
        });

        // The server prints its port on the first line, before serving. Reading it
        // synchronously is exactly the handshake we want: when this returns, it is listening.
        const [line] = this._stdout.read_line(null);
        if (line === null)
            throw new Error('the stub server exited before naming a port');

        this.port = Number.parseInt(new TextDecoder().decode(line), 10);
        if (!Number.isInteger(this.port) || this.port <= 0)
            throw new Error(`the stub server named a nonsense port: ${line}`);
    }

    /** `http://127.0.0.1:<port><path>` */
    url(path = '/state') {
        return `http://127.0.0.1:${this.port}${path}`;
    }

    /** The host and port as the extension's own preferences would hold them. */
    address() {
        return { host: '127.0.0.1', port: this.port };
    }

    destroy() {
        this._process?.force_exit();
        this._process?.wait(null);
        this._process = null;
    }
}

/** Run `fn` against a freshly spawned server, and always take it down again. */
export async function withServer(options, fn) {
    const server = new StubServer(options);
    try {
        return await fn(server);
    } finally {
        server.destroy();
    }
}
