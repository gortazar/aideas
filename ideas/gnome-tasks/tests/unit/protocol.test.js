import Gio from 'gi://Gio';

import { suite, test, assert, assertEquals } from '../harness.js';
import {
    API_VERSION,
    DAEMON_IFACE_XML,
    DAEMON_NAME,
    DAEMON_OBJECT_PATH,
    SHELL_IFACE_XML,
    SHELL_NAME,
    SHELL_OBJECT_PATH,
} from '../../src/lib/protocol.js';

function ifaceOf(xml) {
    return Gio.DBusNodeInfo.new_for_xml(xml).interfaces[0];
}

suite('protocol', () => {
    test('bus names and paths are consistent', () => {
        assertEquals(DAEMON_NAME, 'org.gnome.Tasks');
        assertEquals(DAEMON_OBJECT_PATH, '/org/gnome/Tasks');
        assertEquals(SHELL_NAME, 'org.gnome.Tasks.Shell');
        assertEquals(SHELL_OBJECT_PATH, '/org/gnome/Tasks/Shell');
        assert(Gio.DBusUtils ?? true, 'gio loaded');
    });

    test('API_VERSION is a positive integer', () => {
        assert(Number.isInteger(API_VERSION) && API_VERSION > 0,
            `API_VERSION should be a positive integer, got ${API_VERSION}`);
    });

    // A malformed interface XML fails at runtime the moment the daemon exports it, which under
    // a Shell extension means a broken desktop. Parsing both documents here turns that into a
    // CI failure instead.
    test('daemon interface XML parses and declares its interface name', () => {
        const iface = ifaceOf(DAEMON_IFACE_XML);
        assertEquals(iface.name, DAEMON_NAME);
    });

    test('shell interface XML parses and declares its interface name', () => {
        const iface = ifaceOf(SHELL_IFACE_XML);
        assertEquals(iface.name, SHELL_NAME);
    });

    test('daemon interface exposes the M1 skeleton surface', () => {
        const iface = ifaceOf(DAEMON_IFACE_XML);
        const methods = iface.methods.map(m => m.name);
        for (const expected of ['Ping', 'ListTasks', 'CreateTask', 'DeleteTask', 'ActivateTask'])
            assert(methods.includes(expected), `missing method ${expected} in ${methods}`);

        const properties = iface.properties.map(p => p.name);
        for (const expected of ['ApiVersion', 'CurrentTask'])
            assert(properties.includes(expected), `missing property ${expected} in ${properties}`);
    });

    test('Ping takes a string and returns a string', () => {
        const ping = ifaceOf(DAEMON_IFACE_XML).methods.find(m => m.name === 'Ping');
        assertEquals(ping.in_args.map(a => a.signature).join(''), 's');
        assertEquals(ping.out_args.map(a => a.signature).join(''), 's');
    });
});
