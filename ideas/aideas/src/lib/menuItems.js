// The menu as a flat list of items, in the order they appear, separators included.
//
// This is the seam between the pure model and the Shell: `indicator.js` walks this list and
// creates one widget per descriptor, mechanically, with no decisions of its own. That is what
// lets the menu somebody sees be asserted in a test that never opens a display — the only
// thing left untested headlessly is the widget construction itself, which the compositor
// smoke test covers.
//
// Rows are read-only, per the answered open question in PLAN.md: answering a blocked idea
// means editing PLAN.md on the box, which is not something a panel menu should do. The only
// item that does anything when clicked is `preferences`.

/**
 * Flatten a built menu into items.
 *
 * A failure message comes first — it is the headline, and the cycle line beneath it then reads
 * as the last thing we knew. A healthy reading leads with the cycle line, and its message ("the
 * queue is empty") follows the sections it is a footnote to.
 */
export function menuItems(built) {
    const header = { type: 'header', text: built.header.text, detail: built.header.detail };
    const message = built.message === null || built.message === undefined
        ? null
        : {
            type: 'message',
            kind: built.message.kind ?? 'failure',
            text: built.message.text,
            detail: built.message.detail,
        };
    const failure = message !== null && message.kind === 'failure';

    const blocks = failure ? [[message], [header]] : [[header]];

    for (const section of built.sections) {
        blocks.push([
            { type: 'title', text: section.title },
            ...section.rows.map(row => ({
                type: 'row',
                key: row.key,
                label: row.label,
                detail: row.detail,
                marker: row.marker,
                // A stale row came from the last good reading, shown because the current
                // attempt failed. The widget dims it; the header says how old it is.
                stale: built.stale === true,
            })),
        ]);
    }

    if (message !== null && !failure)
        blocks.push([message]);

    if (built.footer !== null && built.footer !== undefined)
        blocks.push([{ type: 'footer', text: built.footer }]);

    blocks.push([{ type: 'preferences', text: 'Preferences' }]);

    // One separator between blocks: never leading, never trailing, never doubled.
    const items = [];
    for (const block of blocks) {
        if (items.length > 0)
            items.push({ type: 'separator' });
        items.push(...block);
    }
    return items;
}
