import { suite, test, assert, assertEquals, assertDeepEquals } from '../harness.js';
import { parkingWorkspace, remapPlacement } from '../../src/lib/monitorRemap.js';

const LAPTOP = { connector: 'eDP-1', x: 0, y: 0, width: 1920, height: 1080, primary: true };
const EXTERNAL = { connector: 'DP-2', x: 1920, y: 0, width: 2560, height: 1440, primary: false };

suite('remapPlacement', () => {
    test('a placement whose monitor is still there is untouched', () => {
        const placement = {
            workspace: 1,
            monitorConnector: 'DP-2',
            geometry: { x: 2000, y: 100, width: 800, height: 600 },
        };

        const remapped = remapPlacement(placement, [LAPTOP, EXTERNAL]);

        assertDeepEquals(remapped, placement);
    });

    // The case this exists for: a laptop that was docked when the layout was saved and is not now.
    test('a placement on a monitor that is gone moves onto the primary one', () => {
        const remapped = remapPlacement({
            workspace: 0,
            monitorConnector: 'DP-2',
            geometry: { x: 2000, y: 100, width: 800, height: 600 },
        }, [LAPTOP]);

        assertEquals(remapped.monitorConnector, 'eDP-1');
        assert(remapped.geometry.x >= 0 && remapped.geometry.x < 1920,
            `expected the window on screen, got x=${remapped.geometry.x}`);
        assertEquals(remapped.geometry.width, 800, 'the size is kept when it fits');
        assertEquals(remapped.geometry.height, 600);
    });

    // Capture records the monitor the window was on, which is what makes a proportional move possible
    // — the old monitor is gone by definition, so its size has to have been written down.
    test('the position within the old monitor is preserved proportionally', () => {
        const remapped = remapPlacement({
            monitorConnector: 'DP-2',
            monitorGeometry: { x: 1920, y: 0, width: 2560, height: 1440 },
            // A quarter across and a quarter down the external screen.
            geometry: { x: 1920 + 640, y: 360, width: 800, height: 600 },
        }, [LAPTOP]);

        // A quarter across and a quarter down the 1920x1080 laptop screen.
        assertEquals(remapped.geometry.x, 480);
        assertEquals(remapped.geometry.y, 270);
    });

    // Layouts written before the monitor geometry was recorded still have to restore sensibly.
    test('without the old monitor recorded, the window still lands on screen', () => {
        const remapped = remapPlacement({
            monitorConnector: 'DP-2',
            geometry: { x: 1920 + 640, y: 360, width: 800, height: 600 },
        }, [LAPTOP]);

        assert(remapped.geometry.x >= 0 && remapped.geometry.x + 800 <= 1920);
        assert(remapped.geometry.y >= 0 && remapped.geometry.y + 600 <= 1080);
    });

    test('a window larger than the new monitor is shrunk to fit', () => {
        const remapped = remapPlacement({
            monitorConnector: 'DP-2',
            geometry: { x: 1920, y: 0, width: 2560, height: 1400 },
        }, [LAPTOP]);

        assertEquals(remapped.geometry.width, 1920);
        assertEquals(remapped.geometry.height, 1080);
        assertEquals(remapped.geometry.x, 0);
        assertEquals(remapped.geometry.y, 0);
    });

    test('a window is never left hanging off the right or bottom edge', () => {
        const remapped = remapPlacement({
            monitorConnector: 'DP-2',
            geometry: { x: 1920 + 2400, y: 1300, width: 600, height: 400 },
        }, [LAPTOP]);

        assert(remapped.geometry.x + remapped.geometry.width <= 1920,
            `${remapped.geometry.x} + ${remapped.geometry.width} should fit in 1920`);
        assert(remapped.geometry.y + remapped.geometry.height <= 1080,
            `${remapped.geometry.y} + ${remapped.geometry.height} should fit in 1080`);
    });

    test('a placement with no monitor recorded is left alone', () => {
        const placement = { workspace: 2, geometry: { x: 10, y: 10, width: 100, height: 100 } };

        assertDeepEquals(remapPlacement(placement, [LAPTOP]), placement);
    });

    test('a placement with no geometry only loses its stale connector', () => {
        const remapped = remapPlacement({ workspace: 2, monitorConnector: 'DP-2' }, [LAPTOP]);

        assertEquals(remapped.workspace, 2);
        assertEquals(remapped.monitorConnector, 'eDP-1');
    });

    // Without a monitor list there is nothing to remap against, and guessing would be worse than
    // letting the compositor place the window itself.
    test('an unknown monitor set means no remapping', () => {
        const placement = {
            monitorConnector: 'DP-2', geometry: { x: 2000, y: 0, width: 800, height: 600 },
        };

        assertDeepEquals(remapPlacement(placement, []), placement);
        assertDeepEquals(remapPlacement(placement, null), placement);
    });

    test('the first monitor is used when none is marked primary', () => {
        const remapped = remapPlacement({
            monitorConnector: 'HDMI-9',
            geometry: { x: 5000, y: 0, width: 400, height: 300 },
        }, [{ ...EXTERNAL, primary: false }]);

        assertEquals(remapped.monitorConnector, 'DP-2');
    });
});

suite('parkingWorkspace', () => {
    // The 'hide' policy needs somewhere out of sight to put a task's windows.
    test('the last workspace is the parking spot', () => {
        assertEquals(parkingWorkspace({ count: 4, dynamic: false }), 3);
    });

    test('with dynamic workspaces there is always a spare at the end', () => {
        // GNOME keeps one empty workspace at the end when workspaces are dynamic, and that is exactly
        // the one to park on: it does not displace anything the user arranged.
        assertEquals(parkingWorkspace({ count: 3, dynamic: true }), 2);
    });

    test('a single workspace means there is nowhere to hide', () => {
        assertEquals(parkingWorkspace({ count: 1, dynamic: false }), null);
    });

    test('nonsense workspace counts do not produce a nonsense answer', () => {
        assertEquals(parkingWorkspace({ count: 0, dynamic: false }), null);
        assertEquals(parkingWorkspace(null), null);
    });
});
