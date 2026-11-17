// Progressive enhancement for the home page: the forms work without
// JavaScript (server-rendered), and this script upgrades them to use the
// JSON API so the page doesn't reload.
(() => {
    const MAX_ROWS = 20;
    const CODE_PATTERN = /^[A-Za-z0-9]{7}$/;

    const $ = (selector, root = document) => root.querySelector(selector);

    const formatClicks = (n) => (n === 1 ? '1 click' : `${n} clicks`);

    async function api(path, options = {}) {
        const res = await fetch(path, {
            ...options,
            headers: { Accept: 'application/json', ...options.headers },
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            throw new Error(body?.error?.message || `Request failed (${res.status}).`);
        }
        return body;
    }

    /** Copy values from a link resource into elements marked with data-field. */
    function fill(root, link, extras = {}) {
        const values = {
            ...link,
            shortLabel: link.shortUrl.replace(/^https?:\/\//, ''),
            visits: formatClicks(link.visits),
            visitsCount: String(link.visits),
            ...extras,
        };
        root.querySelectorAll('[data-field]').forEach((el) => {
            const value = values[el.dataset.field];
            if (value === undefined) return;
            el.textContent = value;
            if (el instanceof HTMLAnchorElement) {
                // data-href lets a link show one value but point at another.
                const href = values[el.dataset.href ?? el.dataset.field];
                el.href = href;
                if (el.hasAttribute('title')) el.title = href;
            }
        });
        root.querySelectorAll('[data-copy]').forEach((btn) => {
            btn.dataset.copy = link.shortUrl;
        });
        return root;
    }

    function fromTemplate(id) {
        return $(id).content.firstElementChild.cloneNode(true);
    }

    function showResult(statusEl, link, label) {
        statusEl.replaceChildren(fill(fromTemplate('#result-template'), link, { label }));
    }

    function showError(statusEl, message) {
        const p = document.createElement('p');
        p.className = 'alert';
        p.textContent = message;
        statusEl.replaceChildren(p);
    }

    function setBusy(form, busy, busyLabel) {
        const button = $('button[type="submit"]', form);
        button.dataset.label ??= button.textContent;
        button.disabled = busy;
        button.textContent = busy ? busyLabel : button.dataset.label;
        form.setAttribute('aria-busy', String(busy));
    }

    function upsertRow(link) {
        const body = $('#links-body');
        let row = body.querySelector(`tr[data-code="${link.code}"]`);
        if (!row) {
            row = fromTemplate('#row-template');
            row.dataset.code = link.code;
        }
        fill(row, link);
        body.prepend(row);

        while (body.rows.length > MAX_ROWS) body.lastElementChild.remove();

        $('#links-table').hidden = false;
        $('#empty-state').hidden = true;
        $('#link-count').textContent = String(body.rows.length);

        row.classList.add('is-new');
        setTimeout(() => row.classList.remove('is-new'), 1200);
    }

    // Shorten ----------------------------------------------------------------
    const shortenForm = $('#shorten-form');
    const shortenStatus = $('#shorten-status');

    shortenForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = shortenForm.elements.url;

        setBusy(shortenForm, true, 'Shortening…');
        try {
            const link = await api('/api/urls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: input.value }),
            });
            showResult(shortenStatus, link, 'Your short link');
            upsertRow(link);
            input.value = '';
        } catch (err) {
            showError(shortenStatus, err.message);
        } finally {
            setBusy(shortenForm, false);
            input.focus();
        }
    });

    // Look up ----------------------------------------------------------------
    const lookupForm = $('#lookup-form');
    const lookupStatus = $('#lookup-status');

    function extractCode(value) {
        const trimmed = value.trim();
        if (CODE_PATTERN.test(trimmed)) return trimmed;
        try {
            const last = new URL(trimmed).pathname.split('/').filter(Boolean).pop();
            return CODE_PATTERN.test(last ?? '') ? last : null;
        } catch {
            return null;
        }
    }

    lookupForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const code = extractCode(lookupForm.elements.lookup.value);
        if (!code) {
            showError(lookupStatus, 'Enter a short URL or its 7-character code.');
            return;
        }

        setBusy(lookupForm, true, 'Looking up…');
        try {
            const link = await api(`/api/urls/${encodeURIComponent(code)}`);
            showResult(lookupStatus, link, 'Found it');
        } catch (err) {
            showError(lookupStatus, err.message);
        } finally {
            setBusy(lookupForm, false);
        }
    });

    // Copy buttons -----------------------------------------------------------
    document.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-copy]');
        if (!button) return;

        const original = button.textContent;
        try {
            await navigator.clipboard.writeText(button.dataset.copy);
            button.textContent = 'Copied';
            button.classList.add('is-copied');
        } catch {
            button.textContent = 'Copy failed';
        }
        setTimeout(() => {
            button.textContent = original;
            button.classList.remove('is-copied');
        }, 1500);
    });
})();
