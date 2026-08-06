// Appended by scripts/screenshot.sh to the *installed copy* of extension.js in a
// throwaway session, never to the sources in upstream/. Drives the extension the
// way a user would -- open the menu, generate, open preferences -- and captures the
// result.
//
// The shot is taken from inside the shell through Shell.Screenshot rather than over
// D-Bus: org.gnome.Shell.Screenshot only answers a short allowlist of senders
// (gnome-screenshot, the portals) and replies "Screenshot is not allowed" to
// anything else, so a script on the outside cannot use it.
//
// Same import rule as upstream's ci/selftest-hook.js: bind what you use, under
// names extension.js does not, because appending puts both files in one module
// scope.
import ShotGio from 'gi://Gio';
import ShotGLib from 'gi://GLib';
import ShotShell from 'gi://Shell';
import * as ShotMain from 'resource:///org/gnome/shell/ui/main.js';

if (ShotGLib.getenv('PWGEN_SCREENSHOT')) {
    const shotDir = ShotGLib.getenv('PWGEN_SCREENSHOT_DIR');
    const shooter = new ShotShell.Screenshot();

    const capture = name => new Promise((resolve, reject) => {
        const file = ShotGio.File.new_for_path(`${shotDir}/${name}`);
        const stream = file.replace(null, false, ShotGio.FileCreateFlags.NONE, null);
        shooter.screenshot(false, stream, (source, result) => {
            try {
                source.screenshot_finish(result);
                stream.close(null);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });

    const sleep = seconds => new Promise(resolve => {
        ShotGLib.timeout_add_seconds(ShotGLib.PRIORITY_DEFAULT, seconds, () => {
            resolve();
            return ShotGLib.SOURCE_REMOVE;
        });
    });

    (async () => {
        try {
            // enable() has returned by now, but the panel takes a moment to lay
            // out, and an unfinished layout photographs badly.
            await sleep(4);
            const indicator = ShotMain.panel.statusArea['pwgen-generator@pwgen-gs.patxi'];
            if (!indicator) {
                console.log('PWGEN_SCREENSHOT result=no-indicator');
                return;
            }

            indicator.menu.open(false);
            await indicator._generatePassword();
            const items = indicator._historySection._getMenuItems().length;
            // Item 1 is the section header; the rest are generated passwords.
            if (items <= 1) {
                console.log('PWGEN_SCREENSHOT result=no-passwords');
                return;
            }
            // Let the notification banner settle in and the menu finish animating.
            await sleep(2);
            await capture('menu.png');
            console.log(`PWGEN_SCREENSHOT result=menu passwords=${items - 1}`);

            // Preferences is a separate process; launching it through the
            // extension is what the menu item does, and it inherits the right
            // environment for this nested compositor that way.
            indicator.menu.close(false);
            indicator._extension.openPreferences();
            await sleep(8);
            await capture('preferences.png');
            console.log('PWGEN_SCREENSHOT result=preferences');

            console.log('PWGEN_SCREENSHOT result=done');
        } catch (error) {
            console.log(`PWGEN_SCREENSHOT result=threw ${error}`);
        }
    })();
}
