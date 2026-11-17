const path = require('node:path');
const express = require('express');
const { isValidCode } = require('./codes');
const { parseHttpUrl, MAX_URL_LENGTH } = require('./validate');

const ROOT = path.join(__dirname, '..');
const RECENT_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

class HttpError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/**
 * Build the Express application.
 *
 * @param {object} options
 * @param {import('./store').UrlStore} options.store - storage backend
 * @param {string} [options.baseUrl] - public origin used for short links,
 *   e.g. "https://sho.rt". Defaults to the origin of each incoming request.
 */
function createApp({ store, baseUrl } = {}) {
    if (!store) throw new Error('createApp requires a store');
    const configuredBase = baseUrl ? baseUrl.replace(/\/+$/, '') : null;

    const app = express();
    app.disable('x-powered-by');
    app.set('view engine', 'ejs');
    app.set('views', path.join(ROOT, 'views'));

    app.use(express.static(path.join(ROOT, 'public')));
    app.use(express.json({ limit: '10kb' }));
    app.use(express.urlencoded({ extended: false, limit: '10kb' }));

    const publicBase = (req) => configuredBase ?? `${req.protocol}://${req.get('host')}`;

    const toResource = (req, entry) => ({
        code: entry.code,
        shortUrl: `${publicBase(req)}/${entry.code}`,
        originalUrl: entry.originalUrl,
        createdAt: entry.createdAt,
        visits: entry.visits,
    });

    /** Validate input and store it. Throws HttpError on bad input. */
    function shorten(req, input) {
        const originalUrl = parseHttpUrl(input);
        if (!originalUrl) {
            throw new HttpError(
                422,
                'invalid_url',
                `Please provide a valid http(s) URL (max ${MAX_URL_LENGTH} characters).`
            );
        }
        if (new URL(originalUrl).host === new URL(publicBase(req)).host) {
            throw new HttpError(422, 'invalid_url', 'That URL is already a short link.');
        }
        return store.create(originalUrl);
    }

    /** Accept either a bare code or a full short URL and return the code. */
    function extractCode(input) {
        if (typeof input !== 'string') return null;
        const value = input.trim();
        if (isValidCode(value)) return value;
        try {
            const last = new URL(value).pathname.split('/').filter(Boolean).pop();
            return isValidCode(last) ? last : null;
        } catch {
            return null;
        }
    }

    // ---------------------------------------------------------------------
    // JSON API
    // ---------------------------------------------------------------------
    const api = express.Router();

    // Create a short link
    api.post('/urls', (req, res) => {
        const { entry, created } = shorten(req, req.body?.url);
        res.status(created ? 201 : 200)
            .location(`/api/urls/${entry.code}`)
            .json(toResource(req, entry));
    });

    // List recently created short links
    api.get('/urls', (req, res) => {
        const requested = Number.parseInt(req.query.limit, 10);
        const limit = Number.isInteger(requested) && requested > 0
            ? Math.min(requested, MAX_LIST_LIMIT)
            : RECENT_LIMIT;
        res.json({ data: store.list({ limit }).map((entry) => toResource(req, entry)) });
    });

    // Look up a short link by its code
    api.get('/urls/:code', (req, res) => {
        const entry = isValidCode(req.params.code) ? store.findByCode(req.params.code) : null;
        if (!entry) throw new HttpError(404, 'not_found', 'Short link not found.');
        res.json(toResource(req, entry));
    });

    api.use((req, res) => {
        throw new HttpError(404, 'not_found', `No API route for ${req.method} ${req.originalUrl}.`);
    });

    app.use('/api', api);

    // ---------------------------------------------------------------------
    // Web UI (server-rendered; public/app.js enhances it with fetch calls)
    // ---------------------------------------------------------------------
    const renderHome = (req, res, state = {}) => {
        res.render('index', {
            links: store.list({ limit: RECENT_LIMIT }).map((entry) => toResource(req, entry)),
            shorten: state.shorten ?? {},
            lookup: state.lookup ?? {},
        });
    };

    app.get('/', (req, res) => {
        const input = req.query.lookup;
        if (input === undefined) return renderHome(req, res);

        const code = extractCode(input);
        const entry = code ? store.findByCode(code) : null;
        const lookup = entry
            ? { value: input, result: toResource(req, entry) }
            : { value: input, error: 'No short link matches that URL or code.' };
        res.status(entry ? 200 : 404);
        renderHome(req, res, { lookup });
    });

    app.post('/', (req, res) => {
        const input = req.body?.url;
        try {
            const { entry } = shorten(req, input);
            renderHome(req, res, { shorten: { result: toResource(req, entry) } });
        } catch (err) {
            if (!(err instanceof HttpError)) throw err;
            res.status(err.status);
            renderHome(req, res, { shorten: { value: input, error: err.message } });
        }
    });

    // ---------------------------------------------------------------------
    // Short link redirect
    // ---------------------------------------------------------------------
    app.get('/:code', (req, res, next) => {
        if (!isValidCode(req.params.code)) return next();
        const entry = store.findByCode(req.params.code);
        if (!entry) return next();

        store.recordVisit(entry.code);
        // 302 rather than 301 so browsers don't cache the redirect and every
        // visit is counted.
        res.redirect(302, entry.originalUrl);
    });

    // ---------------------------------------------------------------------
    // Fallbacks
    // ---------------------------------------------------------------------
    app.use((req, res) => {
        res.status(404).render('not-found');
    });

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        let { status = 500, code = 'internal_error', message } = err;

        if (err.type === 'entity.parse.failed') {
            [status, code, message] = [400, 'invalid_body', 'Request body is not valid JSON.'];
        } else if (err.type === 'entity.too.large') {
            [status, code, message] = [413, 'payload_too_large', 'Request body is too large.'];
        } else if (!(err instanceof HttpError)) {
            console.error(err);
            [status, code, message] = [500, 'internal_error', 'Something went wrong.'];
        }

        if (req.path.startsWith('/api/') || req.accepts(['html', 'json']) === 'json') {
            return res.status(status).json({ error: { code, message } });
        }
        res.status(status).type('text').send(message);
    });

    return app;
}

module.exports = { createApp };
