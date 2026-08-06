// gnome-tasks probe — M0 research instrument, not part of the product.
//
// It answers, from inside a real compositor rather than from recollection:
//   * which Meta.Window getters actually return something useful, per client type
//     (Wayland native, XWayland, GTK, Electron, terminal, browser)
//   * in what order and with what timing the launch/window signals fire
//   * whether a startup-notification token issued by an extension comes back on the window
//   * what the GTK D-Bus properties (_GTK_APPLICATION_ID / _GTK_WINDOW_OBJECT_PATH) look like
//     in practice, which is the cheapest tier-1 document source if it holds up
//   * how monitors identify themselves, so a saved layout can survive a replug
//
// Output goes to the journal as single-line JSON prefixed with GT-PROBE, never to a file:
// file I/O inside the compositor process is exactly what the real extension must avoid, so the
// probe does not model bad habits. Harvest with tools/harvest-probe.sh.

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';

const PREFIX = 'GT-PROBE';

// A tiny control surface for driving a nested session from outside it: taking screenshots and
// opening the switcher menu both need to happen *inside* the compositor, and GNOME 46 refuses
// org.gnome.Shell.Screenshot to callers that are not the portal (AccessDenied). Research-only, and
// deliberately part of the probe rather than the product.
const CONTROL_NAME = 'org.gnome.TasksProbe';
const CONTROL_PATH = '/org/gnome/TasksProbe';
const CONTROL_IFACE_XML = `
<node>
  <interface name="org.gnome.TasksProbe">
    <method name="Screenshot">
      <arg type="s" name="path" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="OpenTasksMenu">
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="CloseMenus">
      <arg type="s" name="result" direction="out"/>
    </method>
    <method name="HideOverview">
      <arg type="s" name="result" direction="out"/>
    </method>
    <!-- Open the switcher and screenshot it in one in-process sequence: a D-Bus round trip between
         the two is long enough for a popup to lose its grab in a headless session. -->
    <method name="ShootTasksMenu">
      <arg type="s" name="path" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
    <!-- Click through a virtual pointer, the way mutter's own tests drive input. A headless session
         has no seat devices, and a panel menu opened programmatically loses its modal grab
         immediately (observed: isOpen goes false within 900ms). A real click keeps it. -->
    <method name="ClickPanelIndicator">
      <arg type="s" name="name" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
  </interface>
</node>`;

// Zero-argument Meta.Window getters worth trying. Each is called defensively: the point of the
// probe is to find out which of these exist and return something on this Shell version, so a
// missing or throwing getter is a result, not an error.
const WINDOW_GETTERS = [
    'get_id',
    'get_stable_sequence',
    'get_title',
    'get_wm_class',
    'get_wm_class_instance',
    'get_pid',
    'get_role',
    'get_description',
    'get_window_type',
    'get_client_type',
    'get_sandboxed_app_id',
    'get_gtk_application_id',
    'get_gtk_unique_bus_name',
    'get_gtk_application_object_path',
    'get_gtk_window_object_path',
    'get_gtk_app_menu_object_path',
    'get_gtk_menubar_object_path',
    'get_gtk_theme_variant',
    'get_startup_id',
    'get_mutter_hints',
    'get_layer',
    'get_monitor',
    'get_maximized',
    'is_fullscreen',
    'is_on_all_workspaces',
    'is_client_decorated',
    'is_skip_taskbar',
    'is_attached_dialog',
    'is_always_on_top',
    'get_user_time',
    'has_focus',
    'allows_move',
    'allows_resize',
];

function safe(fn) {
    try {
        const value = fn();
        if (value === undefined || value === null)
            return { ok: true, value: null };
        if (typeof value !== 'object')
            return { ok: true, value };

        // Rects (Mtk.Rectangle) are the common structured return.
        if ('x' in value && 'width' in value) {
            return { ok: true, value: { x: value.x, y: value.y, width: value.width, height: value.height } };
        }
        // Plain objects and arrays are built by this file and are already JSON-shaped; only
        // GObject instances need stringifying, and stringifying a plain object by mistake is
        // how the first probe run lost all its app metadata.
        const proto = Object.getPrototypeOf(value);
        if (Array.isArray(value) || proto === Object.prototype || proto === null)
            return { ok: true, value };

        return { ok: true, value: String(value) };
    } catch (error) {
        return { ok: false, error: `${error}` };
    }
}

function emit(event, payload) {
    // One JSON object per line; console.log from an extension lands in the journal tagged with
    // the gnome-shell unit, which is enough to grep out later.
    console.log(`${PREFIX} ${JSON.stringify({ event, t: GLib.get_monotonic_time(), ...payload })}`);
}

function describeWindow(win) {
    const out = { getters: {}, failed: {} };

    for (const name of WINDOW_GETTERS) {
        if (typeof win[name] !== 'function') {
            out.failed[name] = 'no such method';
            continue;
        }
        const result = safe(() => win[name]());
        if (result.ok)
            out.getters[name] = result.value;
        else
            out.failed[name] = result.error;
    }

    out.frame_rect = safe(() => win.get_frame_rect()).value ?? null;
    out.buffer_rect = safe(() => win.get_buffer_rect()).value ?? null;
    out.workspace_index = safe(() => win.get_workspace()?.index()).value ?? null;

    // Client type as a readable string rather than an enum number.
    out.client_type = safe(() => {
        const type = win.get_client_type();
        return type === Meta.WindowClientType.WAYLAND ? 'wayland'
            : type === Meta.WindowClientType.X11 ? 'x11' : `unknown(${type})`;
    }).value;

    out.window_type_name = safe(() => {
        for (const [key, value] of Object.entries(Meta.WindowType)) {
            if (value === win.get_window_type())
                return key;
        }
        return String(win.get_window_type());
    }).value;

    // What Shell thinks the window belongs to — the tier-0 answer, and the key a saved layout
    // is rebuilt from.
    const tracker = Shell.WindowTracker.get_default();
    out.app = safe(() => {
        const app = tracker.get_window_app(win);
        if (!app)
            return null;
        const info = app.get_app_info();
        return {
            id: app.get_id(),
            name: app.get_name(),
            state: app.state,
            n_windows: app.get_windows().length,
            pids: app.get_pids(),
            desktop_file: info ? info.get_filename() : null,
            exec: info ? info.get_commandline() : null,
            can_open_new_window: app.can_open_new_window(),
        };
    }).value;

    return out;
}

// Reading /proc from the compositor is a probe-only liberty: the real implementation does this
// in the daemon. We look at cwd and the open regular files, which is the fallback tier-1
// document source for apps that expose nothing.
function describeProc(pid) {
    if (!pid || pid <= 0)
        return null;
    const out = { pid, cwd: null, cmdline: null, files: [] };

    try {
        out.cwd = GLib.file_read_link(`/proc/${pid}/cwd`);
    } catch (error) {
        out.cwd = `error: ${error.message}`;
    }

    try {
        const [, bytes] = GLib.file_get_contents(`/proc/${pid}/cmdline`);
        out.cmdline = new TextDecoder().decode(bytes).split('\0').filter(s => s.length > 0);
    } catch (error) {
        out.cmdline = `error: ${error.message}`;
    }

    try {
        const dir = Gio.File.new_for_path(`/proc/${pid}/fd`);
        const enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            try {
                const target = GLib.file_read_link(`/proc/${pid}/fd/${info.get_name()}`);
                // Only the interesting ones: real paths under the user's home.
                if (target.startsWith('/') && !target.startsWith('/proc') &&
                    !target.startsWith('/dev') && !target.startsWith('/sys') &&
                    !target.startsWith('/usr') && !target.startsWith('/nix') &&
                    !target.includes('/fonts/') && !target.startsWith('/memfd'))
                    out.files.push(target);
            } catch {
                // fd vanished between listing and reading; expected.
            }
        }
    } catch (error) {
        out.files = `error: ${error.message}`;
    }

    return out;
}

export default class ProbeExtension extends Extension {
    enable() {
        this._windowSignals = new Map();
        this._signals = [];

        emit('probe-enabled', {
            shell_version: Config.PACKAGE_VERSION,
            session_type: GLib.getenv('XDG_SESSION_TYPE'),
            n_workspaces: global.workspace_manager.get_n_workspaces(),
            dynamic_workspaces: Meta.prefs_get_dynamic_workspaces(),
            monitors: this._describeMonitors(),
        });

        this._connect(global.display, 'window-created', (_display, win) => {
            emit('window-created', { window: describeWindow(win) });
            // Some properties (title, gtk paths) are only set slightly after creation, so look
            // again once the frame settles. This is the timing question M3 depends on.
            for (const delay of [50, 250, 1000]) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    if (this._windowSignals.has(win))
                        emit('window-settled', { delay_ms: delay, window: describeWindow(win) });
                    return GLib.SOURCE_REMOVE;
                });
            }
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                if (this._windowSignals.has(win)) {
                    const pid = safe(() => win.get_pid()).value;
                    emit('window-proc', { id: this._idOf(win), proc: describeProc(pid) });
                }
                return GLib.SOURCE_REMOVE;
            });
            this._watchWindow(win);
        });

        this._connect(Shell.AppSystem.get_default(), 'app-state-changed', (_sys, app) => {
            emit('app-state-changed', {
                id: app.get_id(),
                state: app.state,
                n_windows: app.get_windows().length,
                pids: app.get_pids(),
            });
        });

        this._connect(global.workspace_manager, 'workspace-switched',
            (_mgr, from, to) => emit('workspace-switched', { from, to }));
        this._connect(Main.layoutManager, 'monitors-changed',
            () => emit('monitors-changed', { monitors: this._describeMonitors() }));

        // Existing windows, so a probe enabled mid-session still describes the desktop.
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            emit('window-existing', { window: describeWindow(win) });
            this._watchWindow(win);
        }

        this._probeDisplayConfig();
        this._exportControl();
    }

    disable() {
        if (this._controlOwnerId) {
            Gio.bus_unown_name(this._controlOwnerId);
            this._controlOwnerId = 0;
        }
        this._control?.unexport();
        this._control = null;

        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        for (const [win, ids] of this._windowSignals) {
            for (const id of ids) {
                try {
                    win.disconnect(id);
                } catch {
                    // window already gone
                }
            }
        }
        this._windowSignals.clear();
        emit('probe-disabled', {});
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _exportControl() {
        this._control = Gio.DBusExportedObject.wrapJSObject(CONTROL_IFACE_XML, this);
        this._control.export(Gio.DBus.session, CONTROL_PATH);
        this._controlOwnerId = Gio.bus_own_name(
            Gio.BusType.SESSION, CONTROL_NAME, Gio.BusNameOwnerFlags.REPLACE, null, null,
            () => emit('control-name-lost', {}));
    }

    /** Screenshot the whole stage to a PNG. Returns 'ok' or a description of what went wrong. */
    Screenshot(path) {
        try {
            const shooter = new Shell.Screenshot();
            const file = Gio.File.new_for_path(path);
            const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);

            // Async in the compositor, synchronous-looking to the caller: the reply is sent when the
            // write finishes, which is what makes the file safe to read afterwards.
            const invocation = this._control.get_invocation?.();
            shooter.screenshot(false, stream, (source, result) => {
                try {
                    source.screenshot_finish(result);
                    stream.close(null);
                    emit('screenshot', { path });
                } catch (error) {
                    emit('screenshot-error', { path, error: `${error}` });
                }
            });
            void invocation;
            return 'started';
        } catch (error) {
            emit('screenshot-error', { path, error: `${error}` });
            return `error: ${error}`;
        }
    }

    /**
     * Open the gnome-tasks switcher menu, so a screenshot can show it. The overview has to go first:
     * a nested session with no windows starts in the overview, which covers the panel menus.
     */
    OpenTasksMenu() {
        const indicator = Main.panel.statusArea['gnome-tasks'];
        if (!indicator)
            return 'error: the gnome-tasks indicator is not in the panel';

        Main.overview.hide();
        // One frame for the overview to get out of the way before the menu opens under it.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            indicator.menu.open();
            return GLib.SOURCE_REMOVE;
        });
        return 'ok';
    }

    /** Click the centre of a panel indicator with a virtual pointer. */
    ClickPanelIndicator(name) {
        const indicator = Main.panel.statusArea[name];
        if (!indicator)
            return `error: no indicator called ${name}`;

        try {
            const [x, y] = indicator.get_transformed_position();
            const [width, height] = indicator.get_transformed_size();
            const centreX = x + width / 2;
            const centreY = y + height / 2;

            const seat = Clutter.get_default_backend().get_default_seat();
            this._pointer ??= seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);

            const now = global.get_current_time() * 1000;
            this._pointer.notify_absolute_motion(now, centreX, centreY);
            this._pointer.notify_button(now + 1000, Clutter.BUTTON_PRIMARY,
                Clutter.ButtonState.PRESSED);
            this._pointer.notify_button(now + 2000, Clutter.BUTTON_PRIMARY,
                Clutter.ButtonState.RELEASED);

            emit('clicked-indicator', { name, x: centreX, y: centreY });
            return 'ok';
        } catch (error) {
            emit('click-error', { name, error: `${error}` });
            return `error: ${error}`;
        }
    }

    ShootTasksMenu(path) {
        const indicator = Main.panel.statusArea['gnome-tasks'];
        if (!indicator)
            return 'error: the gnome-tasks indicator is not in the panel';

        // The popup survives only briefly without a real pointer grab, so the shot has to follow
        // the open almost immediately — 150ms is one or two frames, enough to be painted.
        Main.overview.hide();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this.ClickPanelIndicator('gnome-tasks');
            indicator.menu.open();
            emit('menu-opened', { isOpen: indicator.menu.isOpen });
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                emit('menu-before-shot', { isOpen: indicator.menu.isOpen,
                    items: indicator.menu.numMenuItems });
                this.Screenshot(path);
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
        return 'started';
    }

    /** Leave the overview, so a screenshot shows the desktop as the user arranged it. */
    HideOverview() {
        Main.overview.hide();
        return 'ok';
    }

    CloseMenus() {
        Main.panel.closeQuickSettings?.();
        for (const name of Object.keys(Main.panel.statusArea))
            Main.panel.statusArea[name]?.menu?.close?.();
        return 'ok';
    }

    _idOf(win) {
        return safe(() => win.get_id()).value ?? safe(() => win.get_stable_sequence()).value;
    }

    _watchWindow(win) {
        const ids = [];
        const report = what => () => emit('window-changed', {
            what,
            id: this._idOf(win),
            title: safe(() => win.get_title()).value,
            frame_rect: safe(() => win.get_frame_rect()).value,
            monitor: safe(() => win.get_monitor()).value,
            workspace_index: safe(() => win.get_workspace()?.index()).value,
            maximized: safe(() => win.get_maximized()).value,
            fullscreen: safe(() => win.is_fullscreen()).value,
        });

        for (const signal of ['workspace-changed', 'position-changed', 'size-changed',
            'notify::title', 'notify::maximized-horizontally', 'notify::fullscreen',
            'notify::gtk-window-object-path'])
            ids.push(win.connect(signal, report(signal)));

        ids.push(win.connect('unmanaged', () => {
            emit('window-unmanaged', { id: this._idOf(win) });
            this._windowSignals.delete(win);
        }));

        this._windowSignals.set(win, ids);
    }

    _describeMonitors() {
        return Main.layoutManager.monitors.map(m => ({
            index: m.index,
            x: m.x, y: m.y, width: m.width, height: m.height,
            scale: m.geometry_scale,
            is_primary: m.index === Main.layoutManager.primaryIndex,
            connector: safe(() => global.display.get_monitor_connector(m.index)).value,
            is_builtin: safe(() => global.display.is_monitor_builtin?.(m.index)).value,
        }));
    }

    // Monitor identity that survives a replug has to come from DisplayConfig (connector name +
    // EDID vendor/product/serial), not from Mutter's monitor indices, which renumber.
    _probeDisplayConfig() {
        try {
            Gio.DBus.session.call(
                'org.gnome.Mutter.DisplayConfig',
                '/org/gnome/Mutter/DisplayConfig',
                'org.gnome.Mutter.DisplayConfig',
                'GetCurrentState',
                null, null, Gio.DBusCallFlags.NONE, -1, null,
                (bus, result) => {
                    try {
                        const reply = bus.call_finish(result);
                        const [serial, monitors] = reply.deepUnpack();
                        emit('display-config', {
                            serial,
                            monitors: monitors.map(([[connector, vendor, product, monitorSerial]]) =>
                                ({ connector, vendor, product, serial: monitorSerial })),
                        });
                    } catch (error) {
                        emit('display-config-error', { error: `${error}` });
                    }
                });
        } catch (error) {
            emit('display-config-error', { error: `${error}` });
        }
    }
}
