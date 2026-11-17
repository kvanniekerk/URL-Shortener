const MAX_URL_LENGTH = 2048;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parse user input as an absolute http(s) URL.
 * Returns the normalised URL string, or null if the input is not acceptable.
 *
 * Only http and https are allowed: schemes like `javascript:` or `data:` are
 * valid URLs but would be dangerous to render as links or redirect to.
 */
function parseHttpUrl(input) {
    if (typeof input !== 'string') return null;

    const value = input.trim();
    if (!value || value.length > MAX_URL_LENGTH) return null;

    let url;
    try {
        url = new URL(value);
    } catch {
        return null;
    }

    if (!ALLOWED_PROTOCOLS.has(url.protocol) || !url.hostname) return null;
    return url.href;
}

module.exports = { parseHttpUrl, MAX_URL_LENGTH };
