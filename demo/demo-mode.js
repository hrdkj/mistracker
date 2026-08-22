// ── Mistake Tracker – Static Demo Mode ────────────────────────────
// Overrides window.fetch so the app runs entirely in the browser with
// no backend (GitHub Pages / any static host). Writes are session-only.
// Generated data comes from demo-data.js (window.DEMO_DATA).
(function () {
    'use strict';

    const realFetch = window.fetch.bind(window);
    const DEMO_TYPES = (window.DEMO_DATA && window.DEMO_DATA.mistakeTypes) || [];
    let db = JSON.parse(JSON.stringify((window.DEMO_DATA && window.DEMO_DATA.mistakes) || []));
    let fallbackCounter = 0;

    const lc = (s) => String(s == null ? '' : s).toLowerCase();
    const text = (v) => (typeof v === 'string' ? v.trim() : '');
    const uid = () =>
        (window.crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : 'demo-' + (++fallbackCounter) + '-' + Date.now();

    // GitHub Pages serves under a subpath; rewrite root-absolute API paths.
    const BASE = location.pathname.replace(/[^/]*$/, '');

    function jsonResponse(data, status) {
        return new Response(JSON.stringify(data), {
            status: status || 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    function notFound() {
        return jsonResponse({ error: 'Mistake not found' }, 404);
    }

    // Minimal request-like wrapper: avoids `new Request()` (which requires
    // an absolute URL outside browsers) while supporting both plain-init
    // fetches and pre-built Request objects.
    function toReq(input, init) {
        const headers = {
            get: (name) => {
                const src = (init && init.headers) || (input && input.headers);
                if (!src || typeof src.get !== 'function') return null;
                const v = typeof src.get === 'function' ? src.get(name) : src[name];
                return v === undefined ? null : v;
            },
        };
        const rawBody = init && 'body' in init ? init.body : undefined;
        if (rawBody === undefined || rawBody === null) {
            if (input && typeof input.json === 'function') return input;
            return { headers, json: async () => null, formData: async () => ({ get: () => '' }) };
        }
        if (typeof FormData !== 'undefined' && rawBody instanceof FormData) {
            return { headers, json: async () => null, formData: async () => rawBody };
        }
        return {
            headers,
            json: async () => JSON.parse(String(rawBody)),
            formData: async () => ({ get: () => '' }),
        };
    }

    function normalizeSubtopics(value) {
        let raw = [];
        if (Array.isArray(value)) raw = value.map(String);
        else if (typeof value === 'string') raw = value.split(',');
        else if (value != null) raw = [String(value)];

        const out = [];
        const seen = new Set();
        for (const item of raw) {
            const s = item.trim();
            if (!s) continue;
            const key = lc(s);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(s);
        }
        return out;
    }

    const byDateDesc = (a, b) => String(b.date_added).localeCompare(String(a.date_added));

    function filterMistakes(q) {
        const archivedParam = q.get('archived');
        const category = q.get('category') || q.get('topic');
        const subtopic = q.get('subtopic');
        const mistakeType = q.get('mistake_type');

        let rows = db.slice();
        if (archivedParam === 'true') rows = rows.filter((m) => m.archived === 1);
        else if (archivedParam === 'false') rows = rows.filter((m) => m.archived !== 1);

        if (category) rows = rows.filter((m) => lc(m.category) === lc(category));
        if (mistakeType) rows = rows.filter((m) => lc(m.mistake_type) === lc(mistakeType));
        if (subtopic) {
            rows = rows.filter((m) =>
                (m.subtopics || []).some((s) => lc(s) === lc(subtopic))
            );
        }
        return rows.sort(byDateDesc);
    }

    function applyWrite(id, data, existing) {
        const src = data || {};
        const category =
            'category' in src ? text(src.category)
            : 'topic' in src ? text(src.topic)
            : existing.category;

        let subtopics;
        if ('subtopics' in src) subtopics = normalizeSubtopics(src.subtopics);
        else if ('subtopic' in src) subtopics = normalizeSubtopics(src.subtopic);
        else subtopics = existing.subtopics;

        const mistakeTypeRaw =
            'mistake_type' in src ? src.mistake_type : existing.mistake_type;
        const mistakeType = DEMO_TYPES.indexOf(mistakeTypeRaw) >= 0
            ? mistakeTypeRaw
            : (DEMO_TYPES.indexOf(existing.mistake_type) >= 0 ? existing.mistake_type : 'Conceptual');

        return {
            id: id,
            category: category,
            subtopics: subtopics,
            subtopic: subtopics.join(', '),
            concept: 'concept' in src ? text(src.concept) : existing.concept,
            topic: category,
            question_image: 'question_image' in src ? text(src.question_image) : existing.question_image,
            solution_image: 'solution_image' in src ? text(src.solution_image) : existing.solution_image,
            mistake_type: mistakeType,
            why_happened: 'why_happened' in src ? text(src.why_happened) : existing.why_happened,
            how_to_avoid: 'how_to_avoid' in src ? text(src.how_to_avoid) : existing.how_to_avoid,
            date_added: existing.date_added,
            date_modified: new Date().toISOString(),
            archived: existing.archived,
        };
    }

    async function handle(method, path, query, req) {
        let match;

        if (method === 'GET' && path === '/api/mistakes') {
            return jsonResponse(filterMistakes(query));
        }

        if (method === 'GET' && (path === '/api/categories' || path === '/api/topics')) {
            const archivedParam = query.get('archived');
            let rows = db;
            if (archivedParam === 'true') rows = rows.filter((m) => m.archived === 1);
            else if (archivedParam === 'false') rows = rows.filter((m) => m.archived !== 1);
            const cats = [...new Set(rows.map((m) => m.category).filter(Boolean))].sort();
            return jsonResponse(cats);
        }

        if (method === 'GET' && path === '/api/subtopics') {
            const archivedParam = query.get('archived');
            const category = query.get('category') || query.get('topic');
            let rows = db;
            if (category) rows = rows.filter((m) => lc(m.category) === lc(category));
            if (archivedParam === 'true') rows = rows.filter((m) => m.archived === 1);
            else if (archivedParam === 'false') rows = rows.filter((m) => m.archived !== 1);
            const subs = [...new Set(rows.flatMap((m) => m.subtopics || []).filter(Boolean))].sort();
            return jsonResponse(subs);
        }

        if (method === 'POST' && path === '/api/mistakes') {
            const body = await req.json();
            const blank = {
                id: null,
                category: '',
                subtopics: [],
                subtopic: '',
                concept: '',
                topic: '',
                question_image: '',
                solution_image: '',
                mistake_type: 'Conceptual',
                why_happened: '',
                how_to_avoid: '',
                date_added: new Date().toISOString(),
                archived: 0,
            };
            const row = applyWrite(uid(), body, blank);
            row.date_modified = row.date_added;
            db.push(row);
            return jsonResponse(row, 201);
        }

        if ((match = path.match(/^\/api\/mistakes\/([^/]+)\/(un)?archive$/)) && method === 'PATCH') {
            const id = decodeURIComponent(match[1]);
            const row = db.find((m) => m.id === id);
            if (!row) return notFound();
            row.archived = match[2] ? 0 : 1;
            row.date_modified = new Date().toISOString();
            return jsonResponse(row);
        }

        if (
            method === 'POST' &&
            (match = path.match(/^\/api\/mistakes\/(un)?archive-category$/))
        ) {
            const body = await req.json().catch(() => ({}));
            if (!body.category) return jsonResponse({ error: 'Category is required' }, 400);
            const target = match[1] ? 0 : 1;
            let count = 0;
            for (const m of db) {
                if (lc(m.category) === lc(body.category) && m.archived !== target) {
                    m.archived = target;
                    m.date_modified = new Date().toISOString();
                    count++;
                }
            }
            return jsonResponse(match[1] ? { unarchived: count } : { archived: count });
        }

        // Generic <id> route must come after the reserved-word routes above.
        if ((match = path.match(/^\/api\/mistakes\/([^/]+)$/))) {
            const id = decodeURIComponent(match[1]);
            const idx = db.findIndex((m) => m.id === id);
            if (idx < 0) return notFound();

            if (method === 'GET') return jsonResponse(db[idx]);
            if (method === 'PUT') {
                db[idx] = applyWrite(id, await req.json(), db[idx]);
                return jsonResponse(db[idx]);
            }
            if (method === 'DELETE') {
                db.splice(idx, 1);
                return jsonResponse({ success: true });
            }
        }

        if (method === 'POST' && path === '/api/upload') {
            const ct = req.headers.get('Content-Type') || '';
            if (ct.includes('multipart/form-data')) {
                const form = await req.formData();
                const file = form.get('file');
                if (!file || file === '') return jsonResponse({ error: 'No file selected' }, 400);
                return jsonResponse({ url: URL.createObjectURL(file) });
            }
            const body = await req.json().catch(() => null);
            if (body && typeof body.image === 'string' && body.image.startsWith('data:image')) {
                return jsonResponse({ url: body.image });
            }
            return jsonResponse({ error: 'No image provided' }, 400);
        }

        return undefined; // not handled
    }

    window.fetch = async function (input, init) {
        try {
            const url = typeof input === 'string' ? input : input.url;
            const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();

            if (url.startsWith('/api/') || url.startsWith(BASE + 'api/')) {
                const relative = url.startsWith(BASE) ? '/' + url.slice(BASE.length) : url;
                const qIndex = relative.indexOf('?');
                const path = qIndex >= 0 ? relative.slice(0, qIndex) : relative;
                const query = new URLSearchParams(qIndex >= 0 ? relative.slice(qIndex + 1) : '');
                const request = toReq(input, init);

                const result = await handle(method, path, query, request);
                if (result !== undefined) return result;
            }
        } catch (err) {
            console.error('[demo-mode]', err);
            return jsonResponse({ error: 'Demo mode error' }, 500);
        }
        return realFetch(input, init);
    };

    // Banner so nobody mistakes the static demo for persistent storage.
    document.addEventListener('DOMContentLoaded', () => {
        const bar = document.createElement('div');
        bar.textContent = 'Static demo — changes reset when you reload.';
        bar.style.cssText = [
            'position:fixed', 'left:50%', 'bottom:14px', 'transform:translateX(-50%)',
            'z-index:9999', 'padding:8px 16px', 'border-radius:999px',
            'background:#1f2937', 'color:#f9fafb', 'font:600 12px/1.4 Inter,sans-serif',
            'box-shadow:0 4px 16px rgba(0,0,0,.35)', 'pointer-events:none',
        ].join(';');
        document.body.appendChild(bar);
    });
})();
