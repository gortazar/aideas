import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { layoutFromWindows, restorePlan, sameLayout } from '../../src/lib/layout.js';
import { describeWindow } from '../../src/lib/windowModel.js';

function win(appId, { x = 0, y = 0, width = 800, height = 600, workspace = 0, ...rest } = {}) {
    return describeWindow({
        id: `${appId}-${x}-${y}`,
        appId,
        pid: 100,
        windowType: 'NORMAL',
        frameRect: { x, y, width, height },
        workspaceIndex: workspace,
        monitorConnector: 'eDP-1',
        ...rest,
    });
}

suite('layoutFromWindows', () => {
    test('one entry per window, carrying the placement worth restoring', () => {
        const layout = layoutFromWindows([
            win('org.gnome.TextEditor.desktop', { x: 10, y: 20, width: 700, height: 500, workspace: 1 }),
        ]);

        assertEquals(layout.length, 1);
        assertDeepEquals(layout[0], {
            appId: 'org.gnome.TextEditor.desktop',
            title: '',
            documents: [],
            placement: {
                workspace: 1,
                geometry: { x: 10, y: 20, width: 700, height: 500 },
                maximized: 'none',
                fullscreen: false,
                monitorConnector: 'eDP-1',
            },
        });
    });

    test('two windows of the same app are two entries, so both come back', () => {
        const layout = layoutFromWindows([
            win('org.gnome.Nautilus.desktop', { x: 0 }),
            win('org.gnome.Nautilus.desktop', { x: 500 }),
        ]);

        assertEquals(layout.length, 2);
        assertEquals(layout[0].appId, 'org.gnome.Nautilus.desktop');
        assertEquals(layout[1].appId, 'org.gnome.Nautilus.desktop');
    });

    // Windows that are not capturable yet (unidentified, unsized, dialogs) must not be recorded:
    // capture runs continuously, so it constantly sees windows mid-birth.
    test('windows that are not capturable are skipped', () => {
        const layout = layoutFromWindows([
            win('window:3'),
            win('org.gnome.Calculator.desktop', { width: 0, height: 0 }),
            win('org.gnome.Calculator.desktop', { windowType: 'DIALOG' }),
            win('org.gnome.Calculator.desktop', { skipTaskbar: true }),
            win('org.gnome.Calculator.desktop', { x: 42 }),
        ]);

        assertEquals(layout.length, 1);
        assertEquals(layout[0].placement.geometry.x, 42);
    });

    test('excluded apps are never recorded', () => {
        const layout = layoutFromWindows(
            [win('org.gnome.Calculator.desktop'), win('org.keepassxc.KeePassXC.desktop')],
            { excludedAppIds: ['org.keepassxc.KeePassXC.desktop'] });

        assertEquals(layout.length, 1);
        assertEquals(layout[0].appId, 'org.gnome.Calculator.desktop');
    });

    // Capture is compared against the stored layout to decide whether to write; an order that
    // depends on stacking would make every focus change look like a change.
    test('the order is stable regardless of the order windows are reported in', () => {
        const windows = [
            win('b.desktop', { workspace: 1, x: 10 }),
            win('a.desktop', { workspace: 0, x: 50 }),
            win('a.desktop', { workspace: 0, x: 10 }),
        ];

        const first = layoutFromWindows(windows);
        const second = layoutFromWindows([...windows].reverse());

        assertDeepEquals(first, second);
        assertEquals(first.map(entry => `${entry.appId}@${entry.placement.geometry.x}`).join(' '),
            'a.desktop@10 a.desktop@50 b.desktop@10');
    });
});

suite('browser window correlation in a layout', () => {
    test('a correlated browser window records which one it is', () => {
        const layout = layoutFromWindows([win('firefox.desktop', { x: 10 })], {
            browserWindowId: () => 11,
        });

        assertEquals(layout[0].browserWindowId, 11);
    });

    // An uncorrelated window must not carry a null id that later code could mistake for a real one.
    test('an uncorrelated window has no browser window id at all', () => {
        const layout = layoutFromWindows([win('firefox.desktop')], {
            browserWindowId: () => null,
        });

        assert(!('browserWindowId' in layout[0]));
    });

    test('nothing is annotated when no hook is given', () => {
        const layout = layoutFromWindows([win('firefox.desktop')]);
        assert(!('browserWindowId' in layout[0]));
    });
});

suite('sameLayout', () => {
    test('a layout equals itself', () => {
        const layout = layoutFromWindows([win('a.desktop')]);
        assert(sameLayout(layout, layoutFromWindows([win('a.desktop')])));
    });

    test('a moved window is a different layout', () => {
        assert(!sameLayout(
            layoutFromWindows([win('a.desktop', { x: 0 })]),
            layoutFromWindows([win('a.desktop', { x: 100 })])));
    });

    // Titles change constantly (a text editor shows the cursor position, a browser the page) and
    // must not each trigger a write.
    test('a changed title alone is not a layout change', () => {
        assert(sameLayout(
            layoutFromWindows([win('a.desktop', { title: 'one' })]),
            layoutFromWindows([win('a.desktop', { title: 'two' })])));
    });
});

suite('restorePlan', () => {
    const layout = [
        {
            appId: 'org.gnome.TextEditor.desktop',
            documents: ['file:///home/u/notes.txt'],
            placement: { workspace: 1, geometry: { x: 10, y: 20, width: 700, height: 500 } },
        },
        {
            appId: 'org.gnome.Calculator.desktop',
            documents: [],
            placement: { workspace: 0, geometry: { x: 0, y: 0, width: 360, height: 500 } },
        },
    ];

    test('an empty desktop means launching everything', () => {
        const plan = restorePlan(layout, []);

        assertEquals(plan.launches.length, 2);
        assertEquals(plan.places.length, 0);
        assertDeepEquals(plan.launches[0], {
            appId: 'org.gnome.TextEditor.desktop',
            uris: ['file:///home/u/notes.txt'],
            placement: layout[0].placement,
        });
    });

    // Re-activating a task that is already up must not open a second copy of everything.
    test('a window that is already open is placed, not launched again', () => {
        const existing = [win('org.gnome.Calculator.desktop', { x: 999 })];
        const plan = restorePlan(layout, existing);

        assertEquals(plan.launches.length, 1);
        assertEquals(plan.launches[0].appId, 'org.gnome.TextEditor.desktop');
        assertEquals(plan.places.length, 1);
        assertEquals(plan.places[0].windowId, existing[0].id);
        assertDeepEquals(plan.places[0].placement, layout[1].placement);
    });

    test('two saved windows of one app with one open means one launch and one placement', () => {
        const twoNautilus = [
            { appId: 'org.gnome.Nautilus.desktop', documents: [], placement: { workspace: 0 } },
            { appId: 'org.gnome.Nautilus.desktop', documents: [], placement: { workspace: 1 } },
        ];
        const plan = restorePlan(twoNautilus, [win('org.gnome.Nautilus.desktop')]);

        assertEquals(plan.places.length, 1);
        assertEquals(plan.launches.length, 1);
    });

    test('windows of apps the task does not know about are left alone', () => {
        const plan = restorePlan(layout, [win('org.gnome.Terminal.desktop')]);

        assertEquals(plan.launches.length, 2);
        assertEquals(plan.places.length, 0);
        assertDeepEquals(plan.untouched.map(w => w.appId), ['org.gnome.Terminal.desktop']);
    });

    test('a layout with no placement still launches the app', () => {
        const plan = restorePlan([{ appId: 'a.desktop', documents: [] }], []);

        assertEquals(plan.launches.length, 1);
        assertDeepEquals(plan.launches[0].placement, {});
    });
});
