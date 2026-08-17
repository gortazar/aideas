// The button itself: whether it is in the top bar at all, which icon it wears and what the
// badge counts. A pure function of the same reading the menu is built from, so "what does the
// panel look like right now" is a value a test can assert.
//
// The visibility rule is settled by an answered open question in PLAN.md: **the button is
// visible only while a cycle is running**, with an "always show" preference for people who
// would rather keep it. Blocked ideas do not summon it, which is why the Blocked section only
// appears to someone who has the button for another reason.
//
// One nuance that rule does not cover: what to do when an attempt fails while a cycle was
// running a moment ago. Hiding the button on a single dropped poll would make the panel blink
// out every time the laptop's VPN hiccups, and would make the "unreachable" icon unreachable
// itself. So the last good reading keeps the button up for a bounded while, wearing the
// unreachable icon — still "only while a cycle is running", just not forgetting between two
// readings. Past that window an old "it was running" is not evidence, and the button goes.

import { Status } from './state.js';

/** How long a good reading keeps speaking for the panel after contact is lost. */
export const DEFAULT_STALE_AFTER_SECONDS = 300;

/** Icons this extension ships are named with this prefix; everything else is a stock name. */
export const SHIPPED_ICON_PREFIX = 'aideas-';

/**
 * One icon per state.
 *
 * The *queue* states wear this idea's own bulb, so the button has an identity of its own
 * instead of looking like a gear, then a question mark, then a pause sign. They are shipped
 * SVGs drawn on the 16px grid with `fill="currentColor"` and a `-symbolic` name, which is what
 * makes GNOME recolour them to the panel foreground: grey with the rest of the top bar, in
 * light themes and dark, dimming when the panel dims. Nothing is *painted* grey — it is grey
 * because it is symbolic, and the state is therefore carried by the drawing, never by colour.
 *
 * The three states that are about the *connection* rather than the queue keep their stock
 * freedesktop glyphs. That is the answered open question: a network-offline or a warning sign
 * says more about a box that cannot be reached than any bulb could.
 */
export const ICONS = {
    running: `${SHIPPED_ICON_PREFIX}bulb-running-symbolic`,
    blocked: `${SHIPPED_ICON_PREFIX}bulb-blocked-symbolic`,
    idle: `${SHIPPED_ICON_PREFIX}bulb-idle-symbolic`,
    allBlocked: `${SHIPPED_ICON_PREFIX}bulb-all-blocked-symbolic`,
    unreachable: 'network-offline-symbolic',
    unavailable: 'dialog-warning-symbolic',
    unconfigured: 'preferences-system-symbolic',
};

/** Is this name a file this extension ships, rather than one the icon theme knows? */
export function isShippedIcon(name) {
    return typeof name === 'string' && name.startsWith(SHIPPED_ICON_PREFIX);
}

function countBlocked(reading) {
    return reading.rows.filter(row => row.state === 'blocked').length;
}

/** The last good reading, if there is one and it is recent enough to still mean something. */
function stillSpeaking(lastGood, now, staleAfterSeconds) {
    if (!lastGood || !lastGood.reading || lastGood.reading.status !== Status.OK)
        return null;
    const fetchedAt = lastGood.fetchedAt;
    if (typeof fetchedAt !== 'number' || !Number.isFinite(fetchedAt))
        return null;
    return now - fetchedAt <= staleAfterSeconds ? lastGood.reading : null;
}

/**
 * Describe the panel button.
 *
 * Returns `{ visible, state, icon, badge, accessibleName }`. `badge` is a string or null —
 * never "0", because a badge showing zero is a worse answer than no badge at all.
 */
export function buildIndicator({
    reading,
    now,
    lastGood = null,
    alwaysShow = false,
    staleAfterSeconds = DEFAULT_STALE_AFTER_SECONDS,
}) {
    const ok = reading.status === Status.OK;
    const blocked = ok ? countBlocked(reading) : 0;

    let state;
    if (ok)
        state = reading.running ? 'running' : (blocked > 0 ? 'blocked' : 'idle');
    else if (reading.status === Status.UNCONFIGURED)
        state = 'unconfigured';
    else if (reading.status === Status.UNAVAILABLE)
        state = 'unavailable';
    else
        state = 'unreachable';

    // Only a lost reading borrows from the past. An `available: false` box is answering: it is
    // telling us it cannot read its queue, which is not evidence that a cycle is running.
    const remembered = state === 'unreachable'
        ? stillSpeaking(lastGood, now, staleAfterSeconds)
        : null;
    const rememberedRunning = remembered !== null && remembered.running;

    const visible = alwaysShow || (ok && reading.running) || rememberedRunning;

    let badge = null;
    if (state === 'running' && reading.agents.length > 0)
        badge = String(reading.agents.length);
    else if (state === 'blocked')
        badge = String(blocked);
    else if (rememberedRunning && remembered.agents.length > 0)
        badge = String(remembered.agents.length);

    return {
        visible,
        state,
        icon: ICONS[state],
        badge,
        accessibleName: accessibleName(state, reading, blocked, remembered),
    };
}

/** A phrase for screen readers and the tooltip: the panel's whole meaning in one line. */
function accessibleName(state, reading, blocked, remembered) {
    switch (state) {
        case 'running':
            return reading.agents.length > 0
                ? `aideas: cycle running, ${reading.agents.length} ` +
                  `${reading.agents.length === 1 ? 'agent' : 'agents'}`
                : 'aideas: cycle running';
        case 'blocked':
            return `aideas: idle, ${blocked} blocked ${blocked === 1 ? 'idea' : 'ideas'}`;
        case 'idle':
            return 'aideas: idle';
        case 'unavailable':
            return 'aideas: the orchestrator cannot read its queue';
        case 'unconfigured':
            return 'aideas: no orchestrator address set';
        default:
            return remembered !== null
                ? 'aideas: orchestrator unreachable, showing the last reading'
                : 'aideas: orchestrator unreachable';
    }
}
