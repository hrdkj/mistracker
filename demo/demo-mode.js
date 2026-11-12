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
    let reviews = [];
    let reviewId = 0;
    const outcomes = ['solved', 'struggled', 'missed'];
    function reviewDate(days = 0) {
        const value = new Date();
        value.setDate(value.getDate() + days);
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    }

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
                const src = (init && init.headers) || (input && input.headers) || null;
                if (!src || typeof src.get !== 'function') return null;
                const v = src.get(name);
                return v === undefined ? null : v;
            },
        };
        const rawBody = init && 'body' in init ? init.body : undefined;
        if (rawBody === undefined || rawBody === null) {
            if (input && typeof input.json === 'function') return input;
            return { isFormData: false, headers, json: async () => null, formData: async () => ({ get: () => '' }) };
        }
        if (typeof FormData !== 'undefined' && rawBody instanceof FormData) {
            // Browsers set multipart Content-Type automatically; init may not
            // carry it, so detect FormData directly instead of via headers.
            return { isFormData: true, headers, json: async () => null, formData: async () => rawBody };
        }
        return {
            isFormData: false,
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

    function validateMistake(data, partial = false) {
        if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) {
            return 'Provide a JSON object with mistake details.';
        }
        for (const field of ['category', 'topic', 'subtopic', 'concept', 'question_image', 'solution_image', 'source_url', 'mistake_type', 'why_happened', 'how_to_avoid']) {
            if (field in data && typeof data[field] !== 'string') return `${field} must be text.`;
        }
        const source = text(data.source_url);
        if (source) {
            try {
                if (!/^https?:\/\/[^/]/i.test(source) || /[\s\\\p{C}]/u.test(source) || new URL(source).port === '0') {
                    return 'Enter an HTTP or HTTPS source link.';
                }
            } catch {
                return 'Enter an HTTP or HTTPS source link.';
            }
        }
        for (const [field, label] of [['category', 'Category'], ['why_happened', 'Why it happened'], ['how_to_avoid', 'How to avoid it']]) {
            const value = data[field] ?? (field === 'category' ? data.topic : '') ?? '';
            const supplied = field in data || (field === 'category' && 'topic' in data);
            if ((!partial || supplied) && !value.trim()) return `${label} is required.`;
        }
        if ('subtopics' in data && typeof data.subtopics !== 'string' &&
            (!Array.isArray(data.subtopics) || data.subtopics.some(item => typeof item !== 'string'))) {
            return 'Subtopics must be text or a list of text values.';
        }
        if ('mistake_type' in data && !DEMO_TYPES.includes(data.mistake_type)) return 'Choose a valid mistake type.';
        return null;
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
            source_url: 'source_url' in src ? text(src.source_url) : (existing.source_url || ''),
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

        if (method === 'GET' && path === '/api/reviews/due') {
            const active = db.filter(m => m.archived !== 1).map(m => {
                const history = reviews.filter(r => r.mistake_id === m.id);
                const latest = history[history.length - 1];
                return { ...m, last_outcome: latest?.outcome || null,
                    next_review_date: latest?.next_review_date || null, review_count: history.length };
            });
            const due = active.filter(m => !m.next_review_date || m.next_review_date <= reviewDate());
            due.sort((a, b) => (a.next_review_date || '').localeCompare(b.next_review_date || '') ||
                a.date_added.localeCompare(b.date_added) || a.id.localeCompare(b.id));
            const upcoming = active.map(m => m.next_review_date).filter(d => d && d > reviewDate()).sort();
            return jsonResponse({ mistakes: due, next_due_date: upcoming[0] || null });
        }

        if ((match = path.match(/^\/api\/mistakes\/([^/]+)\/reviews$/))) {
            const id = decodeURIComponent(match[1]);
            const row = db.find(m => m.id === id);
            const history = reviews.filter(r => r.mistake_id === id);
            if (method === 'GET') return row ? jsonResponse(history.reverse()) : notFound();
            if (method === 'POST') {
                const body = await req.json();
                if (!body || !outcomes.includes(body.outcome)) return jsonResponse({ error: 'Choose solved, struggled, or missed.' }, 400);
                if (!row) return notFound();
                if (row.archived) return jsonResponse({ error: 'This mistake is archived. Refresh the review queue.' }, 409);
                const previous = history[history.length - 1];
                if (previous && previous.next_review_date > reviewDate()) return jsonResponse({ error: 'This review is already saved. Refresh the review queue.' }, 409);
                let interval = { missed: 1, struggled: 3, solved: 7 }[body.outcome];
                if (body.outcome === 'solved' && previous?.outcome === 'solved') interval = Math.min(30, previous.interval_days * 2);
                const attempt = { id: ++reviewId, mistake_id: id, outcome: body.outcome,
                    reviewed_at: new Date().toISOString(), next_review_date: reviewDate(interval), interval_days: interval };
                reviews.push(attempt);
                return jsonResponse(attempt, 201);
            }
        }

        if (method === 'GET' && path === '/api/analytics') {
            const active = db.filter((m) => m.archived !== 1);
            const typeCounts = Object.fromEntries(DEMO_TYPES.map((type) => [type, 0]));
            const categoryCounts = {};
            const subtopicCounts = {};
            for (const mistake of active) {
                const type = mistake.mistake_type || 'Conceptual';
                typeCounts[type] = (typeCounts[type] || 0) + 1;
                const category = text(mistake.category) || 'Uncategorized';
                categoryCounts[category] = (categoryCounts[category] || 0) + 1;
                const subtopics = (mistake.subtopics || []).filter(Boolean);
                const labels = subtopics.length ? subtopics : ['Unspecified'];
                for (const subtopic of labels) {
                    const key = `${category} - ${subtopic}`;
                    subtopicCounts[key] = (subtopicCounts[key] || 0) + 1;
                }
            }
            const topTen = (counts) => Object.fromEntries(
                Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10)
            );
            const mostCommon = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
            return jsonResponse({
                total_mistakes: active.length,
                type_distribution: typeCounts,
                category_distribution: topTen(categoryCounts),
                subtopic_distribution: topTen(subtopicCounts),
                most_common_type: active.length && mostCommon ? mostCommon[0] : null,
            });
        }

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
            const error = validateMistake(body);
            if (error) return jsonResponse({ error }, 400);
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
            if (!body || typeof body.category !== 'string' || !body.category.trim()) return jsonResponse({ error: 'Category is required' }, 400);
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
                const body = await req.json();
                const error = validateMistake(body, true);
                if (error) return jsonResponse({ error }, 400);
                db[idx] = applyWrite(id, body, db[idx]);
                return jsonResponse(db[idx]);
            }
            if (method === 'DELETE') {
                db.splice(idx, 1);
                reviews = reviews.filter(r => r.mistake_id !== id);
                return jsonResponse({ success: true });
            }
        }

        if (method === 'POST' && path === '/api/upload') {
            const ct = req.headers.get('Content-Type') || '';
            if (req.isFormData || ct.includes('multipart/form-data')) {
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
            if (err instanceof SyntaxError) return jsonResponse({ error: 'Provide valid JSON.' }, 400);
            console.error('[demo-mode]', err);
            return jsonResponse({ error: 'Demo mode error' }, 500);
        }
        return realFetch(input, init);
    };

    // Banner so nobody mistakes the static demo for persistent storage.
    // Rendered in-flow at the top of .app-main: always visible on every
    // tab, dismissible, and — unlike the old fixed bottom pill — it can
    // never overlap the footer clone CTA.
    document.addEventListener('DOMContentLoaded', () => {
        try {
            if (window.sessionStorage && sessionStorage.getItem('demo-banner-dismissed') === '1') return;
        } catch { /* storage unavailable — still show banner */ }
        const main = document.querySelector('.app-main');
        if (!main || main.querySelector('.demo-banner')) return;
        const bar = document.createElement('div');
        bar.className = 'demo-banner';
        bar.setAttribute('role', 'status');
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('width', '16');
        icon.setAttribute('height', '16');
        icon.setAttribute('fill', 'none');
        icon.setAttribute('stroke', 'currentColor');
        icon.setAttribute('stroke-width', '2');
        icon.setAttribute('stroke-linecap', 'round');
        icon.setAttribute('stroke-linejoin', 'round');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
        const msg = document.createElement('span');
        msg.innerHTML = '<strong>Static demo</strong> — changes reset when you reload. Clone the repo below to keep your data.';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'demo-banner-dismiss';
        close.setAttribute('aria-label', 'Dismiss demo notice');
        close.textContent = '✕';
        close.addEventListener('click', () => {
            try { if (window.sessionStorage) sessionStorage.setItem('demo-banner-dismissed', '1'); } catch { /* ignore */ }
            bar.remove();
        });
        bar.append(icon, msg, close);
        main.prepend(bar);
        document.body.classList.add('demo-mode');
    });
})();
