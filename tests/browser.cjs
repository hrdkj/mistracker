// Runs against a real Flask server and a disposable database. No user data is used.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mistracker-browser-'));
const server = spawn('uv', ['run', 'python', '-u', '-c',
    "from app import create_app; from werkzeug.serving import make_server; server = make_server('127.0.0.1', 0, create_app(), threaded=True); print('TEST_URL=http://127.0.0.1:' + str(server.server_port), flush=True); server.serve_forever()"], {
    cwd: root, env: { ...process.env, MISTRACKER_DATA_DIR: dataDir },
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe']
});
let browser;
let logs = '';
server.stderr.on('data', chunk => { logs += chunk; });
const pass = label => console.log(`PASS ${label}`);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';

(async () => {
    const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${logs}`)), 20000);
        server.once('error', reject);
        server.once('exit', () => { clearTimeout(timer); reject(new Error(logs)); });
        server.stdout.on('data', chunk => {
            const match = chunk.toString().match(/TEST_URL=(http:\/\/[^\s]+)/);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
    });
    browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // External fonts are irrelevant to offline functional tests.
    await page.route('https://fonts.**/*', route => route.abort());
    const api = async (endpoint, options) => {
        const response = await fetch(url + endpoint, options);
        assert.ok(response.ok, `${endpoint}: ${response.status}`);
        return response.json();
    };
    const post = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    await page.goto(url);
    await page.locator('[data-tab="review-tab"]').click();
    await page.waitForFunction(() => document.getElementById('review-status').textContent.includes('No reviews due'));
    pass('empty review queue');
    await page.locator('[data-tab="add-tab"]').click();
    await page.locator('#new-category').fill('Algebra');
    await page.locator('#new-concept').fill('Matrix rank');
    await page.locator('#new-why').fill('Forgot independence');
    await page.locator('#new-avoid').fill('Check rows first');

    // Hold a real image upload: saving must remain blocked until its URL exists.
    let releaseUpload;
    const uploadGate = new Promise(resolve => { releaseUpload = resolve; });
    await page.route('**/api/upload', async route => { await uploadGate; await route.continue(); });
    await page.evaluate(png => {
        const bytes = Uint8Array.from(atob(png), c => c.charCodeAt(0));
        void processImage(new File([bytes], 'question.png', { type: 'image/png' }), 'question', false);
    }, PNG);
    await page.waitForFunction(() => document.querySelector('#add-form [type="submit"]').disabled);
    await page.evaluate(() => document.getElementById('add-form').requestSubmit());
    assert.equal((await api('/api/mistakes')).length, 0);
    releaseUpload();
    await page.waitForFunction(() => Boolean(document.getElementById('new-image').value));
    await page.unroute('**/api/upload');
    const imageURL = await page.locator('#new-image').inputValue();
    pass('save waits for upload completion');

    const save = page.locator('#add-form [type="submit"]');
    for (const [kind, message] of [['json', 'Simulated save error'], ['html', 'unreadable response'], ['network', 'Could not reach']]) {
        await page.route('**/api/mistakes', async route => {
            if (route.request().method() !== 'POST') return route.continue();
            if (kind === 'network') return route.abort('failed');
            return route.fulfill({ status: kind === 'json' ? 400 : 500,
                contentType: kind === 'json' ? 'application/json' : 'text/html',
                body: kind === 'json' ? JSON.stringify({ error: message }) : '<h1>Server error</h1>' });
        });
        await save.click();
        await page.waitForFunction(text => document.querySelector('#add-form .form-error').textContent.includes(text), message);
        assert.equal(await page.locator('#new-why').inputValue(), 'Forgot independence');
        assert.equal(await page.locator('#new-image').inputValue(), imageURL);
        assert.equal((await api('/api/mistakes')).length, 0);
        assert.equal(await page.locator('.toast-success').count(), 0);
        await page.unroute('**/api/mistakes');
        pass(`${kind} save failure preserves text and image without success toast`);
    }

    let releaseSave;
    const saveGate = new Promise(resolve => { releaseSave = resolve; });
    let requests = 0;
    await page.route('**/api/mistakes', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        requests++;
        await saveGate;
        await route.continue();
    });
    await save.click();
    await page.waitForFunction(() => document.getElementById('add-form').dataset.busy === 'true');
    await page.evaluate(() => document.getElementById('add-form').requestSubmit());
    releaseSave();
    await page.waitForSelector('#mistakes-tbody tr');
    assert.equal(requests, 1);
    await page.unroute('**/api/mistakes');
    const mistake = (await api('/api/mistakes'))[0];
    assert.equal(mistake.question_image, imageURL);
    pass('retry saves exactly one entry and retains uploaded image');

    await page.locator('.edit-btn').first().click();
    await page.locator('#edit-why').fill('Updated explanation');
    await page.route(`**/api/mistakes/${mistake.id}`, route => route.fulfill({
        status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Edit failed' })
    }));
    await page.locator('#edit-form [type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#edit-form .form-error').textContent === 'Edit failed');
    assert.equal(await page.locator('#edit-why').inputValue(), 'Updated explanation');
    assert.ok(await page.locator('#edit-modal').isVisible());
    await page.unroute(`**/api/mistakes/${mistake.id}`);
    await page.locator('#edit-form [type="submit"]').click();
    await page.waitForSelector('#edit-modal', { state: 'hidden' });
    assert.equal((await api(`/api/mistakes/${mistake.id}`)).why_happened, 'Updated explanation');
    pass('failed edit stays open; retry persists changes');

    await page.locator('[data-tab="review-tab"]').click();
    await page.waitForSelector('#review-card', { state: 'visible' });
    assert.ok(!await page.locator('#review-answer').isVisible());
    assert.equal(await page.locator('#review-why').textContent(), '');
    assert.ok(await page.locator('#review-question').isVisible());
    await page.locator('#reveal-review').click();
    assert.equal(await page.locator('#review-why').textContent(), 'Updated explanation');
    await page.screenshot({ path: path.join(os.tmpdir(), 'mistracker-review-desktop.png'), fullPage: true });
    await page.route(`**/api/mistakes/${mistake.id}/reviews`, route => {
        if (route.request().method() === 'GET') return route.continue();
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Review failed"}' });
    });
    await page.locator('[data-outcome="solved"]').click();
    await page.waitForFunction(() => document.getElementById('review-error').textContent === 'Review failed');
    assert.ok(await page.locator('#review-answer').isVisible());
    assert.equal((await api(`/api/mistakes/${mistake.id}/reviews`)).length, 0);
    await page.unroute(`**/api/mistakes/${mistake.id}/reviews`);
    await page.locator('[data-outcome="solved"]').click();
    await page.waitForFunction(() => document.getElementById('review-status').textContent.includes('All done'));
    const history = await api(`/api/mistakes/${mistake.id}/reviews`);
    assert.equal(history.length, 1);
    assert.equal(history[0].interval_days, 7);
    await page.reload();
    await page.locator('[data-tab="review-tab"]').click();
    await page.waitForFunction(() => document.getElementById('review-status').textContent.includes('No reviews due'));
    pass('review reveals notes, retains card on failure, and persists schedule across reload');

    await api('/api/mistakes', post({ category: 'Geometry', concept: 'Recall angle rules', why_happened: 'Mixed rules', how_to_avoid: 'Sketch first' }));
    await api('/api/mistakes', post({ category: 'Calculus', concept: 'Chain rule', why_happened: 'Forgot inner derivative', how_to_avoid: 'Name inner function' }));
    await page.locator('#refresh-reviews').click();
    await page.waitForSelector('#review-card', { state: 'visible' });
    assert.ok(await page.locator('#review-no-question').isVisible());
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('#reveal-review').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(os.tmpdir(), 'mistracker-review-mobile.png'), fullPage: true });
    await page.locator('[data-outcome="missed"]').click();
    await page.waitForFunction(() => document.getElementById('review-status').textContent.includes('1 due'));
    assert.ok(!await page.locator('#review-answer').isVisible());
    assert.equal(await page.locator('#review-why').textContent(), '');
    pass('text-only cards work on mobile and next card hides the previous answer');

    // The shipped static build uses the same UI with the in-memory API.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(pathToFileURL(path.join(root, 'dist-demo', 'index.html')).href);
    await page.locator('[data-tab="review-tab"]').click();
    await page.waitForFunction(() => document.getElementById('review-status').textContent.includes('6 due'));
    assert.ok(!await page.locator('#review-answer').isVisible());
    await page.locator('#reveal-review').click();
    await page.waitForFunction(() => {
        const image = document.getElementById('review-question');
        return image.complete && image.naturalWidth > 0;
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(os.tmpdir(), 'mistracker-review-demo.png'), fullPage: true });
    await page.locator('[data-outcome="struggled"]').click();
    await page.waitForFunction(() => document.getElementById('review-status').textContent.includes('5 due'));
    await page.reload();
    await page.locator('[data-tab="review-tab"]').click();
    await page.waitForFunction(() => document.getElementById('review-status').textContent.includes('6 due'));
    pass('built static demo supports reviews and resets on reload');
    assert.deepEqual(errors, []);
    pass('no browser JavaScript errors');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(async () => {
    if (browser) await browser.close();
    if (server.exitCode === null) {
        const exited = once(server, 'exit');
        if (process.platform === 'win32') server.kill();
        else process.kill(-server.pid, 'SIGTERM');
        await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
});
