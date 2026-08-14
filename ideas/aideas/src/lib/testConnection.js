// What "Test connection" says.
//
// The button exists because the failure it diagnoses is almost always one of three things, and
// they need different fixes: the wrong address (nothing answers), the right address but the
// wrong port (something answers, but not /state), or a box whose serving unit has no
// IDEAS_REPO_PATH (it answers, and says so). The reading already distinguishes all three; this
// module just puts each into a sentence, and is pure so those sentences are tested.

import { Status } from './state.js';

/**
 * Describe the outcome of one test read.
 *
 * @param {object} reading  from lib/state.js
 * @param {?string} host  the address that was tried, e.g. `10.8.0.1:8787`
 * @returns {{severity: 'ok'|'warning'|'error', text: string, detail: ?string}}
 */
export function describeTestResult(reading, host = null) {
    const where = host ?? 'the orchestrator';

    switch (reading?.status) {
        case Status.OK:
            return {
                severity: 'ok',
                text: `Connected to ${where}`,
                detail: summarise(reading),
            };

        case Status.UNAVAILABLE:
            return {
                // A warning, not an error: the address is right and this is the box talking.
                severity: 'warning',
                text: `${where} answered, but cannot read its queue`,
                detail: reading.reason,
            };

        case Status.UNCONFIGURED:
            return {
                severity: 'error',
                text: 'No address to test',
                detail: 'Enter the host name or IP of the orchestrator box first',
            };

        default:
            return {
                severity: 'error',
                text: `Could not reach ${where}`,
                detail: reading?.reason ?? 'no reason given',
            };
    }
}

/** "Cycle running, 2 agents · 5 ideas queued" — proof it is the right box, not just a box. */
function summarise(reading) {
    const parts = [];

    if (reading.running) {
        parts.push(reading.agents.length > 0
            ? `cycle running, ${count(reading.agents.length, 'agent')}`
            : 'cycle running');
    } else {
        parts.push('idle');
    }

    parts.push(reading.rows.length === 0
        ? 'nothing in the queue'
        : count(reading.rows.length, 'idea') + ' queued');

    const blocked = reading.rows.filter(row => row.state === 'blocked').length;
    if (blocked > 0)
        parts.push(`${count(blocked, 'idea')} blocked`);

    return parts.join(' · ');
}

function count(n, noun) {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
