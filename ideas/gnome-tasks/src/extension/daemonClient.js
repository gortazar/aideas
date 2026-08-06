// A thin proxy onto org.gnome.Tasks.
//
// The daemon may not be running when the Shell starts, may be restarted under us, and may not be
// installed at all — the extension has to stay useful (or at least quiet) in all three cases, so
// nothing here throws at construction time and every call is async.

import Gio from 'gi://Gio';

import { DAEMON_NAME, DAEMON_OBJECT_PATH } from './lib/protocol.js';

const TasksProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.gnome.Tasks">
    <method name="Ping">
      <arg type="s" name="message" direction="in"/>
      <arg type="s" name="reply" direction="out"/>
    </method>
    <method name="ListTasks">
      <arg type="aa{sv}" name="tasks" direction="out"/>
    </method>
    <method name="CreateTask">
      <arg type="s" name="name" direction="in"/>
      <arg type="s" name="icon" direction="in"/>
      <arg type="s" name="uuid" direction="out"/>
    </method>
    <method name="DeleteTask">
      <arg type="s" name="uuid" direction="in"/>
    </method>
    <method name="ActivateTask">
      <arg type="s" name="uuid" direction="in"/>
    </method>
    <method name="StopTask">
      <arg type="s" name="uuid" direction="in"/>
    </method>
    <signal name="TaskAdded"><arg type="s" name="uuid"/></signal>
    <signal name="TaskRemoved"><arg type="s" name="uuid"/></signal>
    <signal name="TaskChanged"><arg type="s" name="uuid"/></signal>
    <signal name="CurrentTaskChanged"><arg type="s" name="uuid"/></signal>
    <property name="ApiVersion" type="u" access="read"/>
    <property name="CurrentTask" type="s" access="read"/>
    <property name="CaptureEnabled" type="b" access="readwrite"/>
  </interface>
</node>`);

export class DaemonClient {
    /** @param onChanged called whenever the task list or the current task may have changed */
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._proxy = null;
        this._signalIds = [];
        this._propertiesId = 0;
        this._available = false;

        // G_DBUS_PROXY_FLAGS_NONE would auto-start the daemon through D-Bus activation the moment
        // the Shell loads us. Waiting until the user actually opens the menu is friendlier, so the
        // proxy is created with DO_NOT_AUTO_START and the name is watched instead.
        this._watchId = Gio.bus_watch_name(
            Gio.BusType.SESSION, DAEMON_NAME, Gio.BusNameWatcherFlags.NONE,
            () => this._onNameAppeared(),
            () => this._onNameVanished());
    }

    get available() {
        return this._available;
    }

    destroy() {
        // D-Bus signal subscriptions and plain GObject signals are disconnected by different
        // methods, so they cannot share one list.
        for (const id of this._signalIds)
            this._proxy?.disconnectSignal(id);
        this._signalIds = [];
        if (this._propertiesId) {
            this._proxy?.disconnect(this._propertiesId);
            this._propertiesId = 0;
        }
        this._proxy = null;
        if (this._watchId) {
            Gio.bus_unwatch_name(this._watchId);
            this._watchId = 0;
        }
    }

    /** Tasks as plain objects, or [] if the daemon is not reachable. */
    async listTasks() {
        if (!this._proxy)
            return [];
        try {
            const [tasks] = await this._proxy.ListTasksAsync();
            return tasks.map(task => ({
                uuid: task.uuid.deepUnpack(),
                name: task.name.deepUnpack(),
                icon: task.icon.deepUnpack(),
                state: task.state.deepUnpack(),
            }));
        } catch (error) {
            console.warn(`gnome-tasks: ListTasks failed: ${error}`);
            return [];
        }
    }

    get currentTask() {
        return this._proxy?.CurrentTask ?? '';
    }

    async activate(uuid) {
        await this._call('ActivateTaskAsync', uuid);
    }

    async stop(uuid) {
        await this._call('StopTaskAsync', uuid);
    }

    async create(name, icon = '') {
        if (!this._proxy)
            return '';
        try {
            const [uuid] = await this._proxy.CreateTaskAsync(name, icon);
            return uuid;
        } catch (error) {
            console.warn(`gnome-tasks: CreateTask failed: ${error}`);
            return '';
        }
    }

    async _call(method, ...args) {
        if (!this._proxy)
            return;
        try {
            await this._proxy[method](...args);
        } catch (error) {
            console.warn(`gnome-tasks: ${method} failed: ${error}`);
        }
    }

    _onNameAppeared() {
        if (this._proxy) {
            this._available = true;
            this._onChanged();
            return;
        }

        // new_for_bus is async; the callback style avoids a floating promise inside the compositor.
        TasksProxy(Gio.DBus.session, DAEMON_NAME, DAEMON_OBJECT_PATH, (proxy, error) => {
            if (error) {
                console.warn(`gnome-tasks: cannot reach the daemon: ${error}`);
                return;
            }

            this._proxy = proxy;
            this._available = true;

            for (const signal of ['TaskAdded', 'TaskRemoved', 'TaskChanged', 'CurrentTaskChanged'])
                this._signalIds.push(proxy.connectSignal(signal, () => this._onChanged()));
            this._propertiesId = proxy.connect('g-properties-changed', () => this._onChanged());

            this._onChanged();
        }, null, Gio.DBusProxyFlags.DO_NOT_AUTO_START);
    }

    _onNameVanished() {
        this._available = false;
        this._onChanged();
    }
}
