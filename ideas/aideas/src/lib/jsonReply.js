// Getting a JSON object out of an HTTP reply, or saying why there isn't one.
//
// Shared by the two writes — `POST /cycle` and `POST /stop` — because the ways a reply can fail
// to be an answer are the same ways for both: too large to be one, not JSON at all, JSON that is
// not an object. What each client does *about* that differs (the sentences name what was being
// asked for), so this module decides nothing about wording.

/** A reply larger than this is not a small JSON object; parsing it is a waste of a main loop. */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * `{ object }` when the body is a usable JSON object, `{ problem }` when it is not.
 *
 * `problem` is `'too-large'` or `'unusable'` — a word for the caller to branch on, never a
 * sentence. Arrays count as unusable: every reply in this contract is an object.
 */
export function replyObject(rawBody) {
    const body = typeof rawBody === 'string' ? rawBody : '';
    if (body.length > MAX_BODY_BYTES)
        return { problem: 'too-large' };

    let parsed = null;
    try {
        parsed = JSON.parse(body);
    } catch {
        return { problem: 'unusable' };
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return { problem: 'unusable' };

    return { object: parsed };
}

/** A non-empty string with its whitespace folded to single spaces, or null. */
export function sentence(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim().replace(/\s+/g, ' ');
    return trimmed === '' ? null : trimmed;
}
