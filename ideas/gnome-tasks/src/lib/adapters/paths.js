// Path and URI helpers for the adapters. Kept free of Gio so the adapter rules stay pure — the
// daemon does the file I/O and passes the results in.

/** Schemes we accept as a document reference straight from a command line. */
const URI_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//;

/** The argument as a URI, if it already is one. Returns null for plain paths. */
export function uriFor(argument) {
    return URI_PATTERN.test(argument) ? argument : null;
}

/** An absolute path for `argument`, resolved against `cwd` when it is relative. */
export function resolvePath(argument, cwd) {
    if (!argument)
        return null;
    if (argument.startsWith('/'))
        return normalize(argument);
    if (!cwd)
        return null;
    return normalize(`${cwd.replace(/\/$/, '')}/${argument}`);
}

/** file:// URI for an absolute path, percent-encoding what has to be encoded. */
export function pathToUri(path) {
    // encodeURI leaves '#' and '?' alone, which are legal in file names and would otherwise be read
    // as a fragment or a query.
    return `file://${encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')}`;
}

function normalize(path) {
    const parts = [];
    for (const part of path.split('/')) {
        if (part === '' || part === '.')
            continue;
        if (part === '..')
            parts.pop();
        else
            parts.push(part);
    }
    return `/${parts.join('/')}`;
}
