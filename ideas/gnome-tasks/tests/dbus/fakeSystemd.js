// A stand-in for the systemd user manager, on the test's private bus.
//
// The daemon puts each task command into a transient scope. Testing that against the developer's real
// user manager would leave units behind and could not assert on the arguments; owning
// org.freedesktop.systemd1 on the private bus instead makes the test hermetic and exact.
//
// Only the two methods the daemon uses are implemented, with systemd's real signatures.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SYSTEMD_NAME = 'org.freedesktop.systemd1';
const SYSTEMD_PATH = '/org/freedesktop/systemd1';

const IFACE_XML = `
<node>
  <interface name="org.freedesktop.systemd1.Manager">
    <method name="StartTransientUnit">
      <arg type="s" name="name" direction="in"/>
      <arg type="s" name="mode" direction="in"/>
      <arg type="a(sv)" name="properties" direction="in"/>
      <arg type="a(sa(sv))" name="aux" direction="in"/>
      <arg type="o" name="job" direction="out"/>
    </method>
    <method name="StopUnit">
      <arg type="s" name="name" direction="in"/>
      <arg type="s" name="mode" direction="in"/>
      <arg type="o" name="job" direction="out"/>
    </method>
  </interface>
</node>`;

export class FakeSystemd {
    constructor() {
        this.calls = [];
        this._jobs = 0;
        this._impl = Gio.DBusExportedObject.wrapJSObject(IFACE_XML, this);
        this._ownerId = 0;
    }

    export() {
        this._impl.export(Gio.DBus.session, SYSTEMD_PATH);
        return new Promise(resolve => {
            this._ownerId = Gio.bus_own_name(
                Gio.BusType.SESSION, SYSTEMD_NAME, Gio.BusNameOwnerFlags.REPLACE,
                null, () => resolve(), () => resolve());
        });
    }

    destroy() {
        if (this._ownerId) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }
        this._impl.unexport();
    }

    callsTo(method) {
        return this.calls.filter(call => call.method === method);
    }

    reset() {
        this.calls = [];
    }

    // --- the manager interface, as far as gnome-tasks uses it -------------------------------

    StartTransientUnit(name, mode, properties, aux) {
        // a(sv) reaches a wrapJSObject method either as [name, variant] pairs or as tuple variants,
        // depending on how deeply gjs unpacked it; normalise before recording.
        const pairs = properties.map(entry =>
            entry instanceof GLib.Variant ? entry.deepUnpack() : entry);

        this.calls.push({
            method: 'StartTransientUnit',
            unit: name,
            mode,
            // Property names only: the values include a pid that changes per run, and the names are
            // what the assertions care about.
            properties: pairs.map(([key]) => key),
            pids: pidsFrom(pairs),
        });
        return this._job();
    }

    StopUnit(name, mode) {
        this.calls.push({ method: 'StopUnit', unit: name, mode });
        return this._job();
    }

    _job() {
        return `/org/freedesktop/systemd1/job/${++this._jobs}`;
    }
}

function pidsFrom(properties) {
    for (const [key, value] of properties) {
        if (key === 'PIDs')
            return value instanceof GLib.Variant ? value.deepUnpack() : value;
    }
    return [];
}
