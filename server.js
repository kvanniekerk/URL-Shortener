require('dotenv').config();

const path = require('node:path');
const { createApp } = require('./src/app');
const { UrlStore } = require('./src/store');

const port = Number(process.env.PORT) || 3000;
const databasePath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'urls.db');

const store = new UrlStore(databasePath);
const app = createApp({ store, baseUrl: process.env.BASE_URL });

if (process.env.TRUST_PROXY) {
    // Needed behind a reverse proxy so req.protocol reflects X-Forwarded-Proto.
    app.set('trust proxy', process.env.TRUST_PROXY);
}

const server = app.listen(port, () => {
    console.log(`URL Shortener running at http://localhost:${port}/`);
});

function shutdown() {
    server.close(() => {
        store.close();
        process.exit(0);
    });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
