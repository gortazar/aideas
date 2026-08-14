// Turning what someone typed into preferences into a URL.
//
// Forgiving on input, strict on output: people paste `http://10.8.0.1:8787/`, or the value of
// ORCHESTRATOR_HEARTBEAT_URL, or just `box`. All of those mean the same box, and none of them
// should produce a URL that quietly fails.

/** A host we could not make sense of, or none at all. */
export const NO_HOST = null;

/**
 * Normalise a host as typed: drop a scheme, a path, a query, and any port that came with it.
 *
 * The port is a separate preference, so a pasted `box:8787` keeps `box` and lets the port
 * setting decide — otherwise the two would silently disagree and the visible one would lose.
 * Returns null when there is nothing usable.
 */
export function normaliseHost(raw) {
    if (typeof raw !== 'string')
        return NO_HOST;

    let host = raw.trim();
    if (host === '')
        return NO_HOST;

    host = host.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
    host = host.replace(/[/?#].*$/, '');

    // A bracketed IPv6 literal keeps its brackets' contents and nothing else.
    const bracketed = host.match(/^\[([^\]]+)\]/);
    if (bracketed)
        host = bracketed[1];
    else if ((host.match(/:/g) ?? []).length === 1)
        host = host.split(':')[0]; // host:port — the port preference wins

    host = host.trim();
    if (host === '')
        return NO_HOST;

    // Whitespace or a control character means it was never a host name.
    if (/[\s]/.test(host))
        return NO_HOST;

    return host;
}

/** Is this an IPv6 literal, which has to be bracketed inside a URL? */
function isIPv6(host) {
    return host.includes(':');
}

/** `host:port` as it should be shown to a person — the thing the menu names when it fails. */
export function describeAddress(host, port) {
    const normalised = normaliseHost(host);
    if (normalised === NO_HOST)
        return null;
    return `${isIPv6(normalised) ? `[${normalised}]` : normalised}:${usablePort(port)}`;
}

/** The port, or 8787 when the setting is missing or nonsensical. */
export function usablePort(port) {
    const number = typeof port === 'number' && Number.isInteger(port) ? port : NaN;
    return number >= 1 && number <= 65535 ? number : 8787;
}

/**
 * The URL to read, or null when no host is configured.
 *
 * Always plain HTTP: `/state` is unauthenticated and protected by the server binding to a VPN
 * address, which is what the rest of the system already assumes. There is no secret to
 * protect in transit, and there is no TLS on the box to speak.
 */
export function stateUrl(host, port) {
    const address = describeAddress(host, port);
    return address === null ? null : `http://${address}/state`;
}
