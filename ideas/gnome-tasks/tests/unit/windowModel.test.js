import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import {
    canCapture,
    describeWindow,
    isIdentifiedAppId,
    maximizedState,
    normalizeGeometry,
} from '../../src/lib/windowModel.js';

// The raw shape the extension extracts from a Meta.Window before any interpretation. Keeping the
// interpretation here, away from Meta, is what makes these findings testable without a compositor.
function raw(overrides = {}) {
    return {
        id: '763757057',
        appId: 'org.gnome.TextEditor.desktop',
        title: 'notes.txt (~/docs) - Text Editor',
        wmClass: 'org.gnome.TextEditor',
        pid: 267684,
        windowType: 'NORMAL',
        clientType: 'wayland',
        gtkApplicationId: 'org.gnome.TextEditor',
        gtkWindowObjectPath: '/org/gnome/TextEditor/window/1',
        sandboxedAppId: null,
        frameRect: { x: 66, y: 32, width: 814, height: 577 },
        workspaceIndex: 0,
        monitorIndex: 0,
        monitorConnector: 'eDP-1',
        maximized: 0,
        fullscreen: false,
        onAllWorkspaces: false,
        skipTaskbar: false,
        ...overrides,
    };
}

suite('window identification', () => {
    // The probe found that Shell.WindowTracker hands out synthetic "window:N" ids for a window it
    // has not matched to an app yet — which is the state every window is in at window-created.
    test('synthetic window:N app ids do not count as identified', () => {
        assertEquals(isIdentifiedAppId('window:1'), false);
        assertEquals(isIdentifiedAppId('window:42'), false);
        assertEquals(isIdentifiedAppId(''), false);
        assertEquals(isIdentifiedAppId(null), false);
        assertEquals(isIdentifiedAppId(undefined), false);
    });

    test('a real desktop id counts as identified', () => {
        assertEquals(isIdentifiedAppId('org.gnome.TextEditor.desktop'), true);
        assertEquals(isIdentifiedAppId('firefox_firefox.desktop'), true);
        // Not the synthetic form, despite the prefix.
        assertEquals(isIdentifiedAppId('window:manager.desktop'), true);
    });
});

suite('geometry', () => {
    // Also from the probe: frame rects are 0x0 until the client commits a buffer, anywhere from
    // 52 ms to 1.3 s after the window appears. Zero must mean "not known yet", never "at the
    // origin with no size", or a restore would place windows into a corner.
    test('a zero-sized rect is unknown, not a position', () => {
        assertEquals(normalizeGeometry({ x: 0, y: 0, width: 0, height: 0 }), null);
        assertEquals(normalizeGeometry({ x: 10, y: 10, width: 0, height: 500 }), null);
        assertEquals(normalizeGeometry({ x: 10, y: 10, width: 500, height: 0 }), null);
        assertEquals(normalizeGeometry(null), null);
        assertEquals(normalizeGeometry(undefined), null);
    });

    test('a real rect is passed through as plain numbers', () => {
        assertDeepEquals(normalizeGeometry({ x: 66, y: 32, width: 814, height: 577 }),
            { x: 66, y: 32, width: 814, height: 577 });
    });

    test('a rect at the origin with a real size is valid', () => {
        assertDeepEquals(normalizeGeometry({ x: 0, y: 0, width: 800, height: 600 }),
            { x: 0, y: 0, width: 800, height: 600 });
    });

    test('maximized bitmask becomes a name', () => {
        assertEquals(maximizedState(0), 'none');
        assertEquals(maximizedState(1), 'horizontal');
        assertEquals(maximizedState(2), 'vertical');
        assertEquals(maximizedState(3), 'both');
    });
});

suite('describeWindow', () => {
    test('a settled window becomes a capture record', () => {
        const record = describeWindow(raw());

        assertEquals(record.appId, 'org.gnome.TextEditor.desktop');
        assertEquals(record.identified, true);
        assertEquals(record.pid, 267684);
        assertEquals(record.clientType, 'wayland');
        assertEquals(record.maximized, 'none');
        assertDeepEquals(record.geometry, { x: 66, y: 32, width: 814, height: 577 });
        assertEquals(record.workspaceIndex, 0);
        assertEquals(record.monitorConnector, 'eDP-1');
        assertEquals(record.gtk.applicationId, 'org.gnome.TextEditor');
        assertEquals(record.gtk.windowObjectPath, '/org/gnome/TextEditor/window/1');
    });

    test('an unidentified window is described but flagged', () => {
        const record = describeWindow(raw({
            appId: 'window:3', wmClass: null, frameRect: { x: 0, y: 0, width: 0, height: 0 },
        }));

        assertEquals(record.identified, false);
        assertEquals(record.geometry, null);
        assertEquals(record.appId, 'window:3',
            'the raw id is kept, so a later capture can tell it is the same window');
    });

    test('the gtk block is omitted rather than filled with nulls', () => {
        const record = describeWindow(raw({
            gtkApplicationId: null, gtkWindowObjectPath: null,
        }));

        assertEquals(record.gtk, null);
    });
});

suite('canCapture', () => {
    test('a normal identified window with geometry is capturable', () => {
        assert(canCapture(describeWindow(raw())));
    });

    test('windows without an identified app are not capturable yet', () => {
        assert(!canCapture(describeWindow(raw({ appId: 'window:1' }))));
    });

    test('windows with no geometry yet are not capturable yet', () => {
        assert(!canCapture(describeWindow(raw({
            frameRect: { x: 0, y: 0, width: 0, height: 0 },
        }))));
    });

    // Dialogs, tooltips, docks and panels are not part of a task's layout: restoring them is
    // either impossible or the app's own job.
    test('only NORMAL windows are capturable', () => {
        for (const windowType of ['DIALOG', 'MODAL_DIALOG', 'DOCK', 'MENU', 'TOOLTIP', 'SPLASHSCREEN'])
            assert(!canCapture(describeWindow(raw({ windowType }))), `${windowType} should be skipped`);
    });

    test('windows hidden from the taskbar are skipped', () => {
        assert(!canCapture(describeWindow(raw({ skipTaskbar: true }))));
    });
});
