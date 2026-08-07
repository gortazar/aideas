// Tier 2: what a browser reports about itself, and how it maps onto the compositor's windows.
//
// A browser is the case tier 1 cannot touch. Its command line says nothing, its open "documents" are
// tabs it never writes to disk, and the interesting state is per *window*. So the browser has to
// cooperate: a WebExtension (browser/) reports its windows and tabs, a native-messaging host
// (src/native-host/) relays that to the daemon, and this module holds every rule about the payload —
// pure, so all of it is unit tested without a browser anywhere.
//
// The hard part, named in PLAN.md: a WebExtension window id and a Meta.Window have no shared
// identifier, and Wayland gives no way to invent one. What they *do* share is the title, because a
// browser window's title is its active tab's. correlateBrowserWindows() uses that, and reports no
// match rather than a guess — the caller then falls back to restoring everything into one window,
// losing the per-window split, which is the documented degradation.

/** Adapters allowed to report state. An unknown id is refused rather than stored. */
export const BROWSER_ADAPTERS = new Set(['firefox', 'chrome', 'chromium']);

/** Desktop ids each adapter's windows can appear under. */
const ADAPTER_APP_IDS = {
    firefox: ['firefox.desktop', 'firefox_firefox.desktop', 'org.mozilla.firefox.desktop',
        'firefox-esr.desktop'],
    chrome: ['google-chrome.desktop', 'com.google.Chrome.desktop'],
    chromium: ['chromium.desktop', 'chromium_chromium.desktop', 'chromium-browser.desktop',
        'org.chromium.Chromium.desktop'],
};

/** Pages that belong to the browser rather than to the user. */
const INTERNAL_URL_PATTERN = /^(about:|chrome:|chrome-extension:|moz-extension:|edge:|view-source:)/;

/**
 * Normalise a report from the browser. Returns null for anything unusable — a report is untrusted
 * input arriving over a pipe, so the daemon must not store a half-understood one.
 */
export function parseBrowserState(json) {
    let report;
    try {
        report = JSON.parse(json);
    } catch {
        return null;
    }

    if (!report || typeof report !== 'object' || Array.isArray(report))
        return null;
    if (!BROWSER_ADAPTERS.has(report.adapter))
        return null;
    if (!Array.isArray(report.windows))
        return null;

    const windows = [];
    for (const window of report.windows) {
        // Private browsing is never recorded. A task that remembered incognito tabs would be a
        // privacy bug of exactly the kind docs/limitations.md warns about.
        if (window?.incognito)
            continue;

        const tabs = (window.tabs ?? [])
            .filter(tab => typeof tab?.url === 'string' && !INTERNAL_URL_PATTERN.test(tab.url))
            .map(tab => ({
                url: tab.url,
                title: typeof tab.title === 'string' ? tab.title : '',
                pinned: Boolean(tab.pinned),
                active: Boolean(tab.active),
            }));

        if (tabs.length === 0)
            continue;

        windows.push({
            browserWindowId: window.id,
            focused: Boolean(window.focused),
            // What the window manager will be showing as this window's title.
            activeTitle: (tabs.find(tab => tab.active) ?? tabs[0]).title,
            tabs,
        });
    }

    return { adapter: report.adapter, windows };
}

/**
 * Match compositor windows to browser windows by title, returning a Map of window id -> browser
 * window id. Absent entries mean "not correlated": no guessing.
 */
export function correlateBrowserWindows(state, windows) {
    const matches = new Map();
    if (!state || state.windows.length === 0)
        return matches;

    const appIds = new Set(ADAPTER_APP_IDS[state.adapter] ?? []);
    const claimed = new Set();

    for (const window of windows) {
        if (!appIds.has(window.appId))
            continue;

        const title = window.title ?? '';
        const candidate = state.windows.find(browser =>
            !claimed.has(browser.browserWindowId) &&
            browser.activeTitle.length > 0 &&
            titleMatches(title, browser.activeTitle));

        if (candidate) {
            claimed.add(candidate.browserWindowId);
            matches.set(window.id, candidate.browserWindowId);
        }
    }

    return matches;
}

/**
 * A window manager title is the tab title plus the browser's own suffix — "Example — Mozilla
 * Firefox", "Example - Google Chrome" — so a prefix match is the right test, not equality.
 */
function titleMatches(windowTitle, tabTitle) {
    if (windowTitle === tabTitle)
        return true;
    return windowTitle.startsWith(tabTitle) &&
        /^\s*[—–-]/.test(windowTitle.slice(tabTitle.length));
}

/** What to hand back to the browser on restore: one group of URLs per remembered window. */
export function restoreRequestFor(state) {
    if (!state || !Array.isArray(state.windows) || state.windows.length === 0)
        return null;

    return {
        adapter: state.adapter,
        windows: state.windows.map(window => ({
            urls: window.tabs.map(tab => tab.url),
            pinned: window.tabs.map(tab => tab.pinned),
        })),
    };
}

/** One line for the preferences window and the logs. */
export function summariseBrowserState(state) {
    if (!state || state.windows.length === 0)
        return 'nothing recorded';

    const tabs = state.windows.reduce((total, window) => total + window.tabs.length, 0);
    const windowWord = state.windows.length === 1 ? 'window' : 'windows';
    const tabWord = tabs === 1 ? 'tab' : 'tabs';
    return `${state.windows.length} ${windowWord}, ${tabs} ${tabWord}`;
}

// --- native messaging -------------------------------------------------------------------------
//
// Browsers speak a 4-byte little-endian length followed by that many bytes of JSON, on stdin and
// stdout. Getting it wrong does not produce an error, it deadlocks the host, so the framing lives
// here with tests rather than inline in the host script.

/** Encode one message the way a browser expects to read it. */
export function frameMessage(message) {
    const payload = new TextEncoder().encode(JSON.stringify(message));
    const framed = new Uint8Array(4 + payload.length);

    framed[0] = payload.length & 0xff;
    framed[1] = (payload.length >> 8) & 0xff;
    framed[2] = (payload.length >> 16) & 0xff;
    framed[3] = (payload.length >> 24) & 0xff;
    framed.set(payload, 4);

    return framed;
}

/**
 * Decode as many whole messages as `buffer` holds. Returns the messages and the bytes left over —
 * a read can easily stop in the middle of a message, and dropping the remainder loses everything
 * after it.
 */
export function readMessages(buffer) {
    const messages = [];
    const decoder = new TextDecoder();
    let offset = 0;

    while (buffer.length - offset >= 4) {
        const length = buffer[offset] |
            (buffer[offset + 1] << 8) |
            (buffer[offset + 2] << 16) |
            (buffer[offset + 3] << 24);

        if (length < 0 || buffer.length - offset - 4 < length)
            break;

        const payload = buffer.slice(offset + 4, offset + 4 + length);
        offset += 4 + length;

        try {
            messages.push(JSON.parse(decoder.decode(payload)));
        } catch {
            // A corrupt message is skipped; the stream stays framed, so the next one is still fine.
        }
    }

    return { messages, rest: buffer.slice(offset) };
}
