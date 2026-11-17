const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { createApp } = require('../src/app');
const { UrlStore } = require('../src/store');

let store;
let app;

beforeEach(() => {
    store = new UrlStore(':memory:');
    app = createApp({ store, baseUrl: 'https://sho.rt' });
});

afterEach(() => {
    store.close();
});

const shorten = (url) => request(app).post('/api/urls').send({ url });

// ---------------------------------------------------------------------------
// POST /api/urls
// ---------------------------------------------------------------------------

test('POST /api/urls creates a short link', async () => {
    const res = await shorten('https://example.com/some/long/path?q=1');

    assert.equal(res.status, 201);
    assert.match(res.type, /json/);
    assert.match(res.body.code, /^[A-Za-z0-9]{7}$/);
    assert.equal(res.body.originalUrl, 'https://example.com/some/long/path?q=1');
    assert.equal(res.body.shortUrl, `https://sho.rt/${res.body.code}`);
    assert.equal(res.body.visits, 0);
    assert.ok(Date.parse(res.body.createdAt));
    assert.equal(res.headers.location, `/api/urls/${res.body.code}`);
});

test('POST /api/urls accepts form-encoded bodies', async () => {
    const res = await request(app).post('/api/urls').type('form').send({ url: 'https://example.com' });
    assert.equal(res.status, 201);
});

test('POST /api/urls returns the existing link for a URL shortened twice', async () => {
    const first = await shorten('https://example.com');
    const second = await shorten('https://example.com');

    assert.equal(second.status, 200);
    assert.equal(second.body.code, first.body.code);
});

test('POST /api/urls rejects missing and invalid URLs', async () => {
    const inputs = [
        undefined,
        '',
        'not-a-url',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'ftp://example.com/file',
        `https://example.com/${'a'.repeat(2048)}`,
        42,
    ];

    for (const url of inputs) {
        const res = await shorten(url);
        assert.equal(res.status, 422, `expected 422 for ${String(url).slice(0, 40)}`);
        assert.equal(res.body.error.code, 'invalid_url');
    }
});

test('POST /api/urls refuses to shorten its own short links', async () => {
    const first = await shorten('https://example.com');
    const res = await shorten(first.body.shortUrl);

    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /already a short link/);
});

test('POST /api/urls returns a JSON error for malformed JSON', async () => {
    const res = await request(app)
        .post('/api/urls')
        .set('Content-Type', 'application/json')
        .send('{"url": ');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_body');
});

test('short links fall back to the request host when BASE_URL is not set', async () => {
    const unconfigured = createApp({ store });
    const res = await request(unconfigured).post('/api/urls').send({ url: 'https://example.com' });

    assert.equal(res.body.shortUrl, `http://${res.request.host}/${res.body.code}`);
});

test('BASE_URL trailing slashes are ignored', async () => {
    const configured = createApp({ store, baseUrl: 'https://sho.rt//' });
    const res = await request(configured).post('/api/urls').send({ url: 'https://example.com' });

    assert.equal(res.body.shortUrl, `https://sho.rt/${res.body.code}`);
});

// ---------------------------------------------------------------------------
// GET /api/urls and /api/urls/:code
// ---------------------------------------------------------------------------

test('GET /api/urls/:code returns the link', async () => {
    const created = await shorten('https://example.com');
    const res = await request(app).get(`/api/urls/${created.body.code}`);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, created.body);
});

test('GET /api/urls/:code returns 404 for unknown or malformed codes', async () => {
    for (const code of ['Unknown', 'bad', '%3Cscript%3E']) {
        const res = await request(app).get(`/api/urls/${code}`);
        assert.equal(res.status, 404);
        assert.equal(res.body.error.code, 'not_found');
    }
});

test('GET /api/urls lists recent links, newest first', async () => {
    await shorten('https://example.com/1');
    await shorten('https://example.com/2');
    await shorten('https://example.com/3');

    const res = await request(app).get('/api/urls?limit=2');

    assert.equal(res.status, 200);
    assert.deepEqual(
        res.body.data.map((link) => link.originalUrl),
        ['https://example.com/3', 'https://example.com/2']
    );
});

test('unknown API routes return a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
});

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

test('GET /:code redirects and counts the visit', async () => {
    const created = await shorten('https://example.com/target');

    const redirect = await request(app).get(`/${created.body.code}`).redirects(0);
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.location, 'https://example.com/target');

    const after = await request(app).get(`/api/urls/${created.body.code}`);
    assert.equal(after.body.visits, 1);
});

test('GET /:code returns a 404 page for unknown codes', async () => {
    const res = await request(app).get('/Missing');
    assert.equal(res.status, 404);
    assert.match(res.text, /doesn't exist/);
});

// ---------------------------------------------------------------------------
// Web UI
// ---------------------------------------------------------------------------

test('GET / renders the home page with recent links', async () => {
    await shorten('https://example.com/listed');
    const res = await request(app).get('/');

    assert.equal(res.status, 200);
    assert.match(res.type, /html/);
    assert.match(res.text, /https:\/\/example\.com\/listed/);
});

test('POST / shortens without JavaScript and rejects unsafe URLs', async () => {
    const ok = await request(app).post('/').type('form').send({ url: 'https://example.com/form' });
    assert.equal(ok.status, 200);
    assert.match(ok.text, /Your short link/);

    const bad = await request(app).post('/').type('form').send({ url: 'javascript:alert(1)' });
    assert.equal(bad.status, 422);
    assert.doesNotMatch(bad.text, /href="javascript:/);
    assert.equal(store.list().length, 1);
});

test('GET /?lookup= finds a link by short URL or code', async () => {
    const created = await shorten('https://example.com/lookup');

    const byUrl = await request(app).get('/').query({ lookup: created.body.shortUrl });
    assert.equal(byUrl.status, 200);
    assert.match(byUrl.text, /Found it/);

    const missing = await request(app).get('/').query({ lookup: 'Missing' });
    assert.equal(missing.status, 404);
});

test('view templates are not served as static files', async () => {
    const res = await request(app).get('/index.ejs');
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.text, /<%/);
});
