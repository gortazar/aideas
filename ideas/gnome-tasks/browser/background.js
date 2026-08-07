// The browser half of gnome-tasks' tier-2 support.
//
// Reports this browser's windows and tabs to the native-messaging host, and rebuilds them when the
// host asks. Written to work unchanged on Firefox (manifest v2, `browser`) and Chrome (manifest v3,
// `chrome`): the two APIs agree on everything used here except the global's name and whether it
// returns promises.
//
// Deliberately small. It has the `tabs` permission, which is a lot of trust, so there is nothing in
// here but reporting what is open and reopening it.

const api = typeof browser !== 'undefined' ? browser : chrome;
const HOST = 'org.gnome.tasks.browser_host';

/** How long to wait after a tab change before reporting: browsing generates a lot of events. */
const REPORT_DEBOUNCE_MS = 2500;

let port = null;
let reportTimer = null;

function connect() {
    try {
        port = api.runtime.connectNative(HOST);
    } catch (error) {
        console.warn(`gnome-tasks: cannot reach the native host: ${error}`);
        return;
    }

    port.onMessage.addListener(message => {
        if (message?.type === 'restore')
            restore(message).catch(error => console.warn(`gnome-tasks: restore failed: ${error}`));
    });

    // The host exits with the browser, and the port dies with it; reconnecting on demand keeps the
    // extension working across a daemon or host restart without a reload.
    port.onDisconnect.addListener(() => {
        port = null;
    });

    report();
}

function ensurePort() {
    if (!port)
        connect();
    return port;
}

/** Report every normal window's tabs. Private windows are filtered by the daemon as well. */
async function report() {
    const channel = ensurePort();
    if (!channel)
        return;

    const windows = await api.windows.getAll({ populate: true });

    channel.postMessage({
        type: 'report',
        windows: windows
            .filter(window => window.type === 'normal' && !window.incognito)
            .map(window => ({
                id: window.id,
                focused: Boolean(window.focused),
                incognito: Boolean(window.incognito),
                tabs: (window.tabs ?? []).map(tab => ({
                    url: tab.url,
                    title: tab.title ?? '',
                    pinned: Boolean(tab.pinned),
                    active: Boolean(tab.active),
                })),
            })),
    });
}

function scheduleReport() {
    if (reportTimer)
        clearTimeout(reportTimer);
    reportTimer = setTimeout(() => {
        reportTimer = null;
        report().catch(error => console.warn(`gnome-tasks: report failed: ${error}`));
    }, REPORT_DEBOUNCE_MS);
}

/**
 * Rebuild what a task remembered: one browser window per remembered window, tabs in order.
 *
 * Windows already showing exactly these URLs are left alone, so switching back to a task twice does
 * not open the same tabs twice.
 */
async function restore(request) {
    const existing = await api.windows.getAll({ populate: true });
    const openSets = new Set(existing
        .filter(window => window.type === 'normal' && !window.incognito)
        .map(window => (window.tabs ?? []).map(tab => tab.url).join('\n')));

    for (const group of request.windows ?? []) {
        const urls = group.urls ?? [];
        if (urls.length === 0 || openSets.has(urls.join('\n')))
            continue;

        const created = await api.windows.create({ url: urls });

        // Pinning has to happen after creation: windows.create takes no pinned flag.
        const pinned = group.pinned ?? [];
        const tabs = created?.tabs ?? [];
        for (let index = 0; index < tabs.length; index++) {
            if (pinned[index])
                await api.tabs.update(tabs[index].id, { pinned: true });
        }
    }
}

for (const event of [
    api.tabs.onCreated, api.tabs.onRemoved, api.tabs.onUpdated, api.tabs.onMoved,
    api.tabs.onAttached, api.tabs.onDetached, api.tabs.onActivated,
    api.windows.onCreated, api.windows.onRemoved, api.windows.onFocusChanged,
]) {
    event?.addListener(() => scheduleReport());
}

api.runtime.onStartup?.addListener(() => connect());
api.runtime.onInstalled?.addListener(() => connect());

connect();
