#!/usr/bin/env -S gjs -m
// What would aideas say about this orchestrator?
//
//   gjs -m tools/probe-state.js <host> [port]
//
// Reads /state once with the extension's own transport, client and wording modules, and prints
// what the preferences window's "Test connection" would report, followed by the menu the panel
// would build. Nothing here is a mock: it is the same code path, so a disagreement between this
// and the panel is a bug in one of them.
//
// Useful in three places: diagnosing a real setup from a terminal, checking the box's serving
// unit after a change to it, and as the thing that verifies the connection test end to end
// without a compositor.

import GLib from 'gi://GLib';

import { SoupTransport } from '../src/lib/soupTransport.js';
import { StateClient } from '../src/lib/stateClient.js';
import { describeTestResult } from '../src/lib/testConnection.js';
import { describeAddress } from '../src/lib/address.js';
import { buildMenu } from '../src/lib/menuModel.js';
import { menuItems } from '../src/lib/menuItems.js';
import { buildIndicator } from '../src/lib/indicatorModel.js';

const [host, rawPort] = ARGV;

if (!host) {
    printerr('usage: gjs -m tools/probe-state.js <host> [port]');
    imports.system.exit(2);
}

const port = rawPort ? Number.parseInt(rawPort, 10) : 8787;
const nowSeconds = () => GLib.get_real_time() / 1e6;

const transport = new SoupTransport();
const client = new StateClient({ transport, clock: nowSeconds, timeoutSeconds: 10 });

const loop = new GLib.MainLoop(null, false);
let status = 0;

client.read({ host, port }).then(snapshot => {
    const address = describeAddress(host, port);

    // 1. What "Test connection" in the preferences window would say.
    const result = describeTestResult(snapshot.reading, address);
    print(`[${result.severity}] ${result.text}`);
    if (result.detail)
        print(`        ${result.detail}`);
    if (result.severity === 'error')
        status = 1;

    // 2. What the panel button would look like.
    const panel = buildIndicator({
        reading: snapshot.reading,
        now: nowSeconds(),
        lastGood: snapshot.lastGood,
    });
    print('');
    print(`panel: ${panel.visible ? 'visible' : 'hidden'}  icon ${panel.icon}` +
        `${panel.badge === null ? '' : `  badge ${panel.badge}`}`);
    print(`       ${panel.accessibleName}`);

    // 3. The menu, as a person would read it.
    print('');
    const built = buildMenu({
        reading: snapshot.reading,
        now: nowSeconds(),
        fetchedAt: snapshot.fetchedAt,
        lastGood: snapshot.lastGood,
        host: address,
    });
    for (const item of menuItems(built)) {
        if (item.type === 'separator') {
            print('  ---');
            continue;
        }
        const marker = item.marker ? `  [${item.marker}]` : '';
        print(`  ${item.text ?? item.label}${marker}`);
        if (item.detail)
            print(`      ${item.detail}`);
    }
}).catch(error => {
    printerr(`the probe itself failed: ${error}`);
    status = 2;
}).finally(() => {
    transport.destroy();
    loop.quit();
});

loop.run();
imports.system.exit(status);
