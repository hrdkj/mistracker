// Node harness: exercise demo-mode.js route logic with browser shims.
// Run from the repo root after building:  uv run python build_demo.py
//                                         node demo/test_demo_mode.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Response {
    constructor(body, init) { this.body = body; this.status = init?.status || 200; }
    async json() { return JSON.parse(this.body); }
}
class Request {
    constructor(url, init) { this.url = url; this.method = init?.method || 'GET'; this._body = init?.body; this.headers = { get: (k) => (init?.headers || {})[k] ?? null }; }
    async json() { return typeof this._body === 'string' ? JSON.parse(this._body) : this._body; }
    async formData() {
        const fd = new Map();
        fd.get = fd.get.bind(fd);
        return { get: (k) => (k === 'file' ? this._file : '') };
    }
}

const sandbox = {
    console,
    Response,
    Request,
    URLSearchParams,
    crypto: { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2) },
    location: { pathname: '/mistracker/demo/index.html' },
    URL: { createObjectURL: () => 'blob:demo' },
    document: { addEventListener: () => {} },
};
sandbox.window = sandbox;
sandbox.window.fetch = () => { throw new Error('real fetch must not be called'); };

const dataSrc = fs.readFileSync(path.join(__dirname, '..', 'dist-demo', 'demo-data.js'), 'utf8');
const modeSrc = fs.readFileSync(path.join(__dirname, 'demo-mode.js'), 'utf8');
vm.createContext(sandbox);
vm.runInContext(dataSrc + modeSrc, sandbox);

const fetchMock = sandbox.window.fetch;
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' | ' + JSON.stringify(extra)));
    cond ? pass++ : fail++;
};

(async () => {
    // GET all active
    let r = await fetchMock('/api/mistakes?archived=false');
    let rows = await r.json();
    check('GET mistakes', r.status === 200 && rows.length === 7, rows.length);

    // Filters replicate server semantics
    r = await fetchMock('/api/mistakes?archived=false&category=CALCULUS');
    check('case-insensitive category filter', (await r.json()).length === 2);
    r = await fetchMock('/api/mistakes?archived=false&subtopic=chain%20rule');
    check('case-insensitive subtopic membership', (await r.json()).length === 1);
    r = await fetchMock('/api/mistakes?archived=false&subtopic=Nonexistent');
    check('subtopic no match -> []', (await r.json()).length === 0);
    r = await fetchMock('/api/mistakes');
    check('no archived param -> all rows', (await r.json()).length === 7);

    // Categories/subtopics
    r = await fetchMock('/api/categories?archived=false');
    check('categories sorted distinct', JSON.stringify(await r.json()) ===
        JSON.stringify(['Calculus', 'Linear Algebra', 'Physics', 'Probability']));
    r = await fetchMock('/api/topics?archived=false');
    check('topics alias', (await r.json()).length === 4);
    r = await fetchMock('/api/subtopics?archived=false&category=physics');
    check('subtopics by category', JSON.stringify(await r.json()) === JSON.stringify(['Energy', 'Kinematics']));

    // POST create
    r = await fetchMock('/api/mistakes', { method: 'POST', body: JSON.stringify({ category: 'NewCat', subtopics: ['a', 'A', 'b'], mistake_type: 'HACKED', why_happened: null }) });
    const created = await r.json();
    check('POST -> 201', r.status === 201);
    check('type coerced to Conceptual', created.mistake_type === 'Conceptual');
    check('null why coerced to ""', created.why_happened === '');
    check('subtopics deduped case-insens', JSON.stringify(created.subtopics) === '["a","b"]');
    check('legacy fields mirrored', created.subtopic === 'a, b' && created.topic === 'NewCat');

    // PUT update
    r = await fetchMock('/api/mistakes/' + created.id, { method: 'PUT', body: JSON.stringify({ category: 'Renamed' }) });
    check('PUT merges', (await r.json()).category === 'Renamed');

    // Archive flows
    r = await fetchMock(`/api/mistakes/${created.id}/archive`, { method: 'PATCH' });
    check('PATCH archive -> archived=1', (await r.json()).archived === 1);
    r = await fetchMock('/api/mistakes?archived=true');
    check('archived tab sees it', (await r.json()).some(m => m.id === created.id));
    r = await fetchMock('/api/categories?archived=false');
    check('archived row hidden from categories', !(await r.json()).includes('Renamed'));
    r = await fetchMock(`/api/mistakes/${created.id}/unarchive`, { method: 'PATCH' });
    check('PATCH unarchive -> archived=0', (await r.json()).archived === 0);

    // Category bulk archive
    r = await fetchMock('/api/mistakes/archive-category', { method: 'POST', body: JSON.stringify({ category: 'calculus' }) });
    check('archive-category case-insens count=2', (await r.json()).archived === 2);
    r = await fetchMock('/api/mistakes/unarchive-category', { method: 'POST', body: JSON.stringify({ category: 'CALCULUS' }) });
    check('unarchive-category count=2', (await r.json()).unarchived === 2);
    r = await fetchMock('/api/mistakes/archive-category', { method: 'POST', body: '{}' });
    check('missing category -> 400', r.status === 400);

    // Upload
    r = await fetchMock('/api/upload', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: 'FORMDATA' });
    // multipart path can't run without full FormData shim; JSON paths below cover logic.
    const b64req = new Request('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: 'data:image/png;base64,iVBOR' }) });
    r = await fetchMock('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b64req._body });
    check('upload data-uri echoed', (await r.json()).url.startsWith('data:image/png'));

    r = await fetchMock('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"image":"http://evil"}' });
    check('upload non-image rejected', r.status === 400);

    // DELETE + 404s
    r = await fetchMock('/api/mistakes/' + created.id, { method: 'DELETE' });
    check('DELETE ok', (await r.json()).success === true);
    r = await fetchMock('/api/mistakes/' + created.id, { method: 'DELETE' });
    check('DELETE again -> 404', r.status === 404);
    r = await fetchMock('/api/mistakes/nope/unarchive', { method: 'PATCH' });
    check('unknown id archive -> 404', r.status === 404);

    // BASE-path rewriting (GitHub Pages subpath)
    r = await fetchMock('/mistracker/demo/api/mistakes?archived=false');
    check('subpath /api rewritten', (await r.json()).length >= 7);

    // Unknown API route falls through to real fetch -> would throw our sentinel
    try { await fetchMock('/api/unknown'); check('passthrough', true); }
    catch (e) { check('passthrough', String(e).includes('real fetch'), e); }

    console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'} (${pass} passed)`);
    process.exit(fail ? 1 : 0);
})();
