const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { generateCode } = require('./codes');

const MAX_CODE_ATTEMPTS = 5;

function toEntry(row) {
    if (!row) return null;
    return {
        code: row.code,
        originalUrl: row.original_url,
        createdAt: row.created_at,
        visits: row.visits,
    };
}

/**
 * SQLite-backed storage for shortened URLs.
 * Pass ':memory:' (the default) for an ephemeral database, e.g. in tests.
 */
class UrlStore {
    constructor(filename = ':memory:') {
        if (filename !== ':memory:') {
            fs.mkdirSync(path.dirname(filename), { recursive: true });
        }

        this.db = new Database(filename);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS urls (
                code         TEXT PRIMARY KEY,
                original_url TEXT NOT NULL UNIQUE,
                created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                visits       INTEGER NOT NULL DEFAULT 0
            )
        `);

        this.statements = {
            insert: this.db.prepare('INSERT INTO urls (code, original_url) VALUES (?, ?)'),
            byCode: this.db.prepare('SELECT * FROM urls WHERE code = ?'),
            byUrl: this.db.prepare('SELECT * FROM urls WHERE original_url = ?'),
            recordVisit: this.db.prepare('UPDATE urls SET visits = visits + 1 WHERE code = ?'),
            list: this.db.prepare('SELECT * FROM urls ORDER BY created_at DESC, rowid DESC LIMIT ?'),
        };
    }

    /**
     * Shorten a URL. If the URL was already shortened, the existing entry is
     * returned with `created: false`.
     */
    create(originalUrl) {
        const existing = this.findByUrl(originalUrl);
        if (existing) return { entry: existing, created: false };

        for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
            const code = generateCode();
            try {
                this.statements.insert.run(code, originalUrl);
                return { entry: this.findByCode(code), created: true };
            } catch (err) {
                if (err.code !== 'SQLITE_CONSTRAINT_PRIMARYKEY') throw err;
                // Code collision: try again with a new code.
            }
        }
        throw new Error('Could not generate a unique short code.');
    }

    findByCode(code) {
        return toEntry(this.statements.byCode.get(code));
    }

    findByUrl(originalUrl) {
        return toEntry(this.statements.byUrl.get(originalUrl));
    }

    recordVisit(code) {
        this.statements.recordVisit.run(code);
    }

    list({ limit = 20 } = {}) {
        return this.statements.list.all(limit).map(toEntry);
    }

    close() {
        this.db.close();
    }
}

module.exports = { UrlStore };
