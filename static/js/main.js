// ── Mistake Tracker – Main JavaScript ─────────────────────────────

// State
let mistakes = [];
let categories = [];
let subtopics = [];
let currentFilters = { category: '', subtopic: '', mistake_type: '' };
let searchQuery = '';
let deleteTargetId = null;
let typeChart = null;
let categoryChart = null;
let didHydrateLastEntryFromMistakes = false;

const LAST_ENTRY_DETAILS_KEY = 'mistakeTracker.lastEntryDetails';

// ── DOM Elements ──────────────────────────────────────────────────
const cardsGrid = document.getElementById('cards-grid');
const noDataMessage = document.getElementById('no-data');
const filterCategory = document.getElementById('filter-category');
const filterSubtopic = document.getElementById('filter-subtopic');
const filterType = document.getElementById('filter-type');
const clearFiltersBtn = document.getElementById('clear-filters');
const toggleAnalyticsBtn = document.getElementById('toggle-analytics');
const analyticsSection = document.getElementById('analytics-section');
const searchInput = document.getElementById('search-input');
const addForm = document.getElementById('add-form');
const editForm = document.getElementById('edit-form');
const editModal = document.getElementById('edit-modal');
const deleteModal = document.getElementById('delete-modal');
const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');

// Tab elements
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// Paste zones - Question (add)
const pasteZone = document.getElementById('paste-zone');
const previewImage = document.getElementById('preview-image');
const clearImageBtn = document.getElementById('clear-image');
const newImageInput = document.getElementById('new-image');
const pasteHint = pasteZone.querySelector('.paste-hint');

// Paste zones - Solution (add)
const solutionPasteZone = document.getElementById('solution-paste-zone');
const solutionPreviewImage = document.getElementById('solution-preview-image');
const clearSolutionImageBtn = document.getElementById('clear-solution-image');
const newSolutionImageInput = document.getElementById('new-solution-image');
const solutionPasteHint = solutionPasteZone.querySelector('.paste-hint');

// Paste zones - Question (edit)
const editPasteZone = document.getElementById('edit-paste-zone');
const editPreviewImage = document.getElementById('edit-preview-image');
const editClearImageBtn = document.getElementById('edit-clear-image');
const editImageInput = document.getElementById('edit-image');
const editPasteHint = editPasteZone.querySelector('.paste-hint');

// Paste zones - Solution (edit)
const editSolutionPasteZone = document.getElementById('edit-solution-paste-zone');
const editSolutionPreviewImage = document.getElementById('edit-solution-preview-image');
const editClearSolutionImageBtn = document.getElementById('edit-clear-solution-image');
const editSolutionImageInput = document.getElementById('edit-solution-image');
const editSolutionPasteHint = editSolutionPasteZone.querySelector('.paste-hint');

// ── Initialise ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    loadMistakes();
    loadCategories();
    loadSubtopics();
    setupEventListeners();
    setupClipboardPaste();
    setupTabs();
    applySavedEntryDetails();
});

// ── Toast System ──────────────────────────────────────────────────
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 2800);
}

// ── API Functions ─────────────────────────────────────────────────
async function loadMistakes() {
    const params = new URLSearchParams();
    if (currentFilters.category) params.append('category', currentFilters.category);
    if (currentFilters.subtopic) params.append('subtopic', currentFilters.subtopic);
    if (currentFilters.mistake_type) params.append('mistake_type', currentFilters.mistake_type);

    const response = await fetch(`/api/mistakes?${params}`);
    mistakes = await response.json();
    hydrateLastEntryDetailsFromMistakes();
    renderCards();
    loadQuickStats();
}

async function loadQuickStats() {
    try {
        const response = await fetch('/api/analytics');
        const data = await response.json();
        document.getElementById('stat-total').querySelector('.stat-pill-value').textContent = data.total_mistakes;
        document.getElementById('stat-common-type').querySelector('.stat-pill-value').textContent = data.most_common_type || '—';
    } catch (e) { /* ignore */ }
}

function getSavedEntryDetails() {
    try {
        const raw = localStorage.getItem(LAST_ENTRY_DETAILS_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return {
            category: (parsed.category || '').trim(),
            subtopics: (parsed.subtopics || parsed.subtopic || '').trim()
        };
    } catch { return null; }
}

function saveEntryDetails(category, subtopics) {
    try {
        localStorage.setItem(LAST_ENTRY_DETAILS_KEY, JSON.stringify({
            category: (category || '').trim(),
            subtopics: (subtopics || '').trim()
        }));
    } catch { /* ignore */ }
}

function applySavedEntryDetails() {
    const saved = getSavedEntryDetails();
    if (!saved) return;
    const catInput = document.getElementById('new-category');
    const subInput = document.getElementById('new-subtopics');
    if (catInput && !catInput.value && saved.category) catInput.value = saved.category;
    if (subInput && !subInput.value && saved.subtopics) subInput.value = saved.subtopics;
    if (saved.category) loadSubtopicsForAddForm(saved.category);
}

function hydrateLastEntryDetailsFromMistakes() {
    if (didHydrateLastEntryFromMistakes) return;
    const saved = getSavedEntryDetails();
    if (saved && saved.category) { didHydrateLastEntryFromMistakes = true; return; }
    const latest = mistakes[0];
    if (!latest) return;
    const category = (latest.category || latest.topic || '').trim();
    const subtopic = (latest.subtopics || []).join(', ') || (latest.subtopic || '').trim();
    if (!category) return;
    saveEntryDetails(category, subtopic);
    applySavedEntryDetails();
    didHydrateLastEntryFromMistakes = true;
}

async function loadCategories() {
    const response = await fetch('/api/categories');
    categories = await response.json();
    renderCategoryFilter();
    renderCategorySuggestions();
}

async function loadSubtopics(category = '') {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    const response = await fetch(`/api/subtopics?${params}`);
    subtopics = await response.json();
    renderSubtopicFilter();
}

async function fetchSubtopicsByCategory(category = '') {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    const response = await fetch(`/api/subtopics?${params}`);
    return response.json();
}

function renderSubtopicDropdown(selectId, items) {
    const dropdown = document.getElementById(selectId);
    if (!dropdown) return;
    dropdown.innerHTML = '<option value="">Select subtopic to add</option>';
    items.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item;
        opt.textContent = item;
        dropdown.appendChild(opt);
    });
}

async function loadSubtopicsForAddForm(category = '') {
    const items = await fetchSubtopicsByCategory(category);
    renderSubtopicDropdown('new-subtopic-dropdown', items);
}

async function loadSubtopicsForEditForm(category = '') {
    const items = await fetchSubtopicsByCategory(category);
    renderSubtopicDropdown('edit-subtopic-dropdown', items);
}

function normalizeSubtopicsInput(value) {
    const raw = String(value || '').split(',');
    const normalized = [];
    const seen = new Set();
    raw.forEach(item => {
        const s = item.trim();
        if (!s) return;
        const key = s.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        normalized.push(s);
    });
    return normalized;
}

function appendSubtopicToInput(inputId, subtopic) {
    const input = document.getElementById(inputId);
    if (!input || !subtopic) return;
    const current = normalizeSubtopicsInput(input.value);
    if (!current.some(i => i.toLowerCase() === subtopic.toLowerCase())) current.push(subtopic);
    input.value = current.join(', ');
}

async function loadAnalytics() {
    const response = await fetch('/api/analytics');
    const data = await response.json();
    renderAnalytics(data);
}

async function apiAddMistake(data) {
    const response = await fetch('/api/mistakes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return response.json();
}

async function apiUpdateMistake(id, data) {
    const response = await fetch(`/api/mistakes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return response.json();
}

async function apiDeleteMistake(id) {
    const response = await fetch(`/api/mistakes/${id}`, { method: 'DELETE' });
    return response.json();
}

// ── Upload image via /api/upload ──────────────────────────────────
async function uploadImageFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    const result = await response.json();
    return result.url || '';
}

// ── Render Functions ──────────────────────────────────────────────
function renderCards() {
    cardsGrid.innerHTML = '';
    let filtered = mistakes;

    // Client-side search filter
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(m =>
            (m.category || '').toLowerCase().includes(q) ||
            (m.subtopic || '').toLowerCase().includes(q) ||
            (m.concept || '').toLowerCase().includes(q) ||
            (m.why_happened || '').toLowerCase().includes(q) ||
            (m.how_to_avoid || '').toLowerCase().includes(q) ||
            (m.mistake_type || '').toLowerCase().includes(q)
        );
    }

    if (filtered.length === 0) {
        noDataMessage.classList.remove('hidden');
        return;
    }
    noDataMessage.classList.add('hidden');

    filtered.forEach(m => {
        const card = document.createElement('div');
        card.className = 'mistake-card';
        const badgeClass = (m.mistake_type || 'conceptual').toLowerCase().replace(/[\/\s]/g, '-');
        const expandId = `expand-${m.id}`;

        card.innerHTML = `
            <div class="card-header">
                <div class="card-meta">
                    <div class="card-category">${escapeHtml(m.category || m.topic || '')}</div>
                    <div class="card-subtopic">${escapeHtml(m.subtopic || '')}</div>
                </div>
                <div class="card-date">${formatDate(m.date_added)}</div>
            </div>
            <div class="card-body">
                <div class="card-images">
                    ${m.question_image ? `<img src="${m.question_image}" class="card-thumb" data-src="${m.question_image}" alt="Question" loading="lazy">` : ''}
                    ${m.solution_image ? `<img src="${m.solution_image}" class="card-thumb" data-src="${m.solution_image}" alt="Solution" loading="lazy">` : ''}
                </div>
                <div class="card-badges">
                    <span class="badge badge-${badgeClass}">${escapeHtml(m.mistake_type)}</span>
                </div>
                ${m.concept ? `<div class="card-concept">${escapeHtml(m.concept)}</div>` : ''}
                <div class="card-detail">
                    <div class="card-detail-label">Why it happened</div>
                    <div class="card-detail-text">${escapeHtml(truncate(m.why_happened, 100))}</div>
                </div>
            </div>
            <div class="card-expanded" id="${expandId}">
                <div class="card-detail">
                    <div class="card-detail-label">Full explanation</div>
                    <div class="card-detail-text">${escapeHtml(m.why_happened)}</div>
                </div>
                <div class="card-detail">
                    <div class="card-detail-label">How to avoid</div>
                    <div class="card-detail-text">${escapeHtml(m.how_to_avoid)}</div>
                </div>
            </div>
            <button class="card-expand-toggle" data-target="${expandId}">▼ Show more</button>
            <div class="card-actions">
                <button class="card-action-btn edit-btn" data-id="${m.id}">✏️ Edit</button>
                <button class="card-action-btn delete-btn" data-id="${m.id}">🗑️ Delete</button>
            </div>
        `;
        cardsGrid.appendChild(card);
    });

    // Event listeners
    cardsGrid.querySelectorAll('.card-expand-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.dataset.target);
            if (target.classList.contains('show')) {
                target.classList.remove('show');
                btn.textContent = '▼ Show more';
            } else {
                target.classList.add('show');
                btn.textContent = '▲ Show less';
            }
        });
    });

    cardsGrid.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });

    cardsGrid.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
    });

    cardsGrid.querySelectorAll('.card-thumb').forEach(img => {
        img.addEventListener('click', () => openImageModal(img.dataset.src));
    });
}

function renderCategoryFilter() {
    filterCategory.innerHTML = '<option value="">All Categories</option>';
    categories.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        filterCategory.appendChild(opt);
    });
    if (currentFilters.category) filterCategory.value = currentFilters.category;
}

function renderSubtopicFilter() {
    filterSubtopic.innerHTML = '<option value="">All Subtopics</option>';
    subtopics.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        filterSubtopic.appendChild(opt);
    });
    if (currentFilters.subtopic && subtopics.includes(currentFilters.subtopic)) {
        filterSubtopic.value = currentFilters.subtopic;
    } else {
        filterSubtopic.value = '';
    }
}

function renderCategorySuggestions() {
    ['category-options', 'edit-category-options'].forEach(id => {
        const list = document.getElementById(id);
        if (!list) return;
        list.innerHTML = '';
        categories.forEach(c => {
            const option = document.createElement('option');
            option.value = c;
            list.appendChild(option);
        });
    });
}

function renderAnalytics(data) {
    const typeCtx = document.getElementById('type-chart').getContext('2d');
    const typeLabels = Object.keys(data.type_distribution);
    const typeValues = Object.values(data.type_distribution);

    if (typeChart) typeChart.destroy();
    typeChart = new Chart(typeCtx, {
        type: 'doughnut',
        data: {
            labels: typeLabels,
            datasets: [{
                data: typeValues,
                backgroundColor: ['#fbbf24', '#f87171', '#6366f1', '#a78bfa', '#f472b6', '#34d399'],
                borderColor: '#141926',
                borderWidth: 3
            }]
        },
        options: {
            responsive: true,
            cutout: '60%',
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11, family: 'Inter' }, padding: 16 } }
            }
        }
    });

    const categoryCtx = document.getElementById('category-chart').getContext('2d');
    const categoryLabels = Object.keys(data.category_distribution || {});
    const categoryValues = Object.values(data.category_distribution || {});

    if (categoryChart) categoryChart.destroy();
    categoryChart = new Chart(categoryCtx, {
        type: 'bar',
        data: {
            labels: categoryLabels,
            datasets: [{
                label: 'Mistakes',
                data: categoryValues,
                backgroundColor: '#6366f1',
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { beginAtZero: true, ticks: { stepSize: 1, color: '#5a6a85' }, grid: { color: '#1c2233' } },
                y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false } }
            }
        }
    });
}

// ── Event Listeners ───────────────────────────────────────────────
function setupEventListeners() {
    // Search
    let searchTimer;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            searchQuery = searchInput.value.trim();
            renderCards();
        }, 200);
    });

    // Filters
    filterCategory.addEventListener('change', async () => {
        currentFilters.category = filterCategory.value;
        currentFilters.subtopic = '';
        await loadSubtopics(currentFilters.category);
        loadMistakes();
    });

    document.getElementById('new-category').addEventListener('change', async (e) => {
        await loadSubtopicsForAddForm(e.target.value);
    });

    document.getElementById('edit-category').addEventListener('change', async (e) => {
        await loadSubtopicsForEditForm(e.target.value);
    });

    document.getElementById('new-subtopic-dropdown').addEventListener('change', (e) => {
        if (!e.target.value) return;
        appendSubtopicToInput('new-subtopics', e.target.value);
        e.target.value = '';
    });

    document.getElementById('edit-subtopic-dropdown').addEventListener('change', (e) => {
        if (!e.target.value) return;
        appendSubtopicToInput('edit-subtopics', e.target.value);
        e.target.value = '';
    });

    filterSubtopic.addEventListener('change', () => {
        currentFilters.subtopic = filterSubtopic.value;
        loadMistakes();
    });

    filterType.addEventListener('change', () => {
        currentFilters.mistake_type = filterType.value;
        loadMistakes();
    });

    clearFiltersBtn.addEventListener('click', () => {
        filterCategory.value = '';
        filterSubtopic.value = '';
        filterType.value = '';
        searchInput.value = '';
        searchQuery = '';
        currentFilters = { category: '', subtopic: '', mistake_type: '' };
        loadSubtopics();
        loadMistakes();
    });

    // Analytics
    toggleAnalyticsBtn.addEventListener('click', () => {
        analyticsSection.classList.toggle('hidden');
        const text = document.getElementById('analytics-toggle-text');
        if (!analyticsSection.classList.contains('hidden')) {
            text.textContent = 'Hide Analytics';
            loadAnalytics();
        } else {
            text.textContent = 'Show Analytics';
        }
    });

    // Add form
    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const categoryValue = document.getElementById('new-category').value;
        const subtopicValue = document.getElementById('new-subtopics').value;
        const subtopicList = normalizeSubtopicsInput(subtopicValue);

        const data = {
            category: categoryValue,
            subtopics: subtopicList,
            concept: document.getElementById('new-concept').value.trim(),
            mistake_type: document.getElementById('new-type').value,
            question_image: newImageInput.value,
            solution_image: newSolutionImageInput.value,
            why_happened: document.getElementById('new-why').value,
            how_to_avoid: document.getElementById('new-avoid').value
        };

        await apiAddMistake(data);
        saveEntryDetails(categoryValue, subtopicValue);
        showToast('Mistake added successfully!', 'success');

        addForm.reset();
        clearPastedImage();
        clearPastedSolutionImage();
        applySavedEntryDetails();
        loadMistakes();
        loadCategories();
        loadSubtopics(document.getElementById('new-category').value);
        if (!analyticsSection.classList.contains('hidden')) loadAnalytics();
        switchTab('mistakes-tab');
    });

    // Edit form
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-id').value;
        const data = {
            category: document.getElementById('edit-category').value,
            subtopics: normalizeSubtopicsInput(document.getElementById('edit-subtopics').value),
            concept: document.getElementById('edit-concept').value.trim(),
            mistake_type: document.getElementById('edit-type').value,
            question_image: editImageInput.value,
            solution_image: editSolutionImageInput.value,
            why_happened: document.getElementById('edit-why').value,
            how_to_avoid: document.getElementById('edit-avoid').value
        };
        await apiUpdateMistake(id, data);
        closeEditModal();
        showToast('Mistake updated!', 'success');
        loadMistakes();
        loadCategories();
        loadSubtopics();
        if (!analyticsSection.classList.contains('hidden')) loadAnalytics();
    });

    // Cancel edit
    document.getElementById('cancel-edit').addEventListener('click', closeEditModal);

    // Delete
    document.getElementById('confirm-delete').addEventListener('click', async () => {
        if (deleteTargetId) {
            await apiDeleteMistake(deleteTargetId);
            deleteTargetId = null;
            closeDeleteModal();
            showToast('Mistake deleted', 'info');
            loadMistakes();
            loadCategories();
            loadSubtopics();
            if (!analyticsSection.classList.contains('hidden')) loadAnalytics();
        }
    });
    document.getElementById('cancel-delete').addEventListener('click', closeDeleteModal);

    // Modal close buttons + overlay clicks
    document.querySelectorAll('.modal-close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').classList.add('hidden');
        });
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', () => {
            overlay.closest('.modal').classList.add('hidden');
        });
    });

    // Clear image buttons
    clearImageBtn.addEventListener('click', clearPastedImage);
    editClearImageBtn.addEventListener('click', clearEditPastedImage);
    clearSolutionImageBtn.addEventListener('click', clearPastedSolutionImage);
    editClearSolutionImageBtn.addEventListener('click', clearEditPastedSolutionImage);
}

// ── Clipboard Paste Handling ──────────────────────────────────────
function setupClipboardPaste() {
    const zones = [
        { el: pasteZone,             type: 'question', edit: false },
        { el: solutionPasteZone,     type: 'solution', edit: false },
        { el: editPasteZone,         type: 'question', edit: true  },
        { el: editSolutionPasteZone, type: 'solution', edit: true  },
    ];

    zones.forEach(({ el, type, edit }) => {
        el.addEventListener('click', () => { el.focus(); el.classList.add('active'); });
        el.addEventListener('focus', () => { el.classList.add('active'); updatePasteHint(el, 'Ready! Press Ctrl+V'); });
        el.addEventListener('blur',  () => { el.classList.remove('active'); updatePasteHint(el, 'Ctrl+V or drag an image'); });
        el.addEventListener('paste', (e) => handlePaste(e, type, edit));
        el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('active'); updatePasteHint(el, 'Drop image here'); });
        el.addEventListener('dragleave', () => { el.classList.remove('active'); updatePasteHint(el, 'Ctrl+V or drag an image'); });
        el.addEventListener('drop', (e) => handleDrop(e, type, edit));
    });

    // Global paste fallback
    document.addEventListener('paste', (e) => {
        if (document.getElementById('add-tab').classList.contains('active') && document.activeElement === pasteZone) {
            handlePaste(e, 'question', false);
        }
    });
}

function updatePasteHint(zone, text) {
    const hint = zone.querySelector('.paste-hint');
    if (hint && !hint.classList.contains('hidden')) hint.textContent = text;
}

function getZoneByType(imageType, isEdit) {
    return imageType === 'solution'
        ? (isEdit ? editSolutionPasteZone : solutionPasteZone)
        : (isEdit ? editPasteZone : pasteZone);
}

function handlePaste(e, imageType, isEdit) {
    e.preventDefault();
    e.stopPropagation();
    const zone = getZoneByType(imageType, isEdit);
    updatePasteHint(zone, 'Processing…');

    const clipboardData = e.clipboardData || e.originalEvent?.clipboardData || window.clipboardData;
    if (!clipboardData) { showPasteError(zone, 'Could not access clipboard'); return; }

    let imageFound = false;

    if (clipboardData.items) {
        for (let i = 0; i < clipboardData.items.length; i++) {
            if (clipboardData.items[i].type.indexOf('image') !== -1) {
                const file = clipboardData.items[i].getAsFile();
                if (file) { imageFound = true; processImage(file, imageType, isEdit); break; }
            }
        }
    }

    if (!imageFound && clipboardData.files && clipboardData.files.length > 0) {
        for (let i = 0; i < clipboardData.files.length; i++) {
            if (clipboardData.files[i].type.indexOf('image') !== -1) {
                imageFound = true;
                processImage(clipboardData.files[i], imageType, isEdit);
                break;
            }
        }
    }

    if (!imageFound) showPasteError(zone, 'No image found. Copy one first!');
}

function handleDrop(e, imageType, isEdit) {
    e.preventDefault();
    e.stopPropagation();
    const zone = getZoneByType(imageType, isEdit);
    zone.classList.remove('active');
    updatePasteHint(zone, 'Processing…');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        let found = false;
        for (let i = 0; i < files.length; i++) {
            if (files[i].type.startsWith('image/')) { found = true; processImage(files[i], imageType, isEdit); break; }
        }
        if (!found) showPasteError(zone, 'Please drop an image file');
    } else {
        showPasteError(zone, 'No file dropped');
    }
}

async function processImage(file, imageType, isEdit) {
    if (!file) return;
    const zone = getZoneByType(imageType, isEdit);

    if (file.size > 10 * 1024 * 1024) { showPasteError(zone, 'Image too large (max 10MB)'); return; }

    try {
        updatePasteHint(zone, 'Uploading…');
        const url = await uploadImageFile(file);
        if (url) {
            displayImage(url, imageType, isEdit);
        } else {
            showPasteError(zone, 'Upload failed');
        }
    } catch (err) {
        console.error('Upload error:', err);
        showPasteError(zone, 'Upload failed');
    }
}

function displayImage(imageUrl, imageType, isEdit) {
    if (imageType === 'solution') {
        if (isEdit) {
            editSolutionImageInput.value = imageUrl;
            editSolutionPreviewImage.src = imageUrl;
            editSolutionPreviewImage.classList.remove('hidden');
            editClearSolutionImageBtn.classList.remove('hidden');
            editSolutionPasteHint.classList.add('hidden');
        } else {
            newSolutionImageInput.value = imageUrl;
            solutionPreviewImage.src = imageUrl;
            solutionPreviewImage.classList.remove('hidden');
            clearSolutionImageBtn.classList.remove('hidden');
            solutionPasteHint.classList.add('hidden');
        }
    } else {
        if (isEdit) {
            editImageInput.value = imageUrl;
            editPreviewImage.src = imageUrl;
            editPreviewImage.classList.remove('hidden');
            editClearImageBtn.classList.remove('hidden');
            editPasteHint.classList.add('hidden');
        } else {
            newImageInput.value = imageUrl;
            previewImage.src = imageUrl;
            previewImage.classList.remove('hidden');
            clearImageBtn.classList.remove('hidden');
            pasteHint.classList.add('hidden');
        }
    }
}

function showPasteError(zone, message) {
    const hint = zone.querySelector('.paste-hint');
    if (hint) {
        hint.textContent = message;
        hint.style.color = '#f87171';
        setTimeout(() => { hint.textContent = 'Ctrl+V or drag an image'; hint.style.color = ''; }, 3000);
    }
}

function clearPastedImage() {
    newImageInput.value = '';
    previewImage.src = '';
    previewImage.classList.add('hidden');
    clearImageBtn.classList.add('hidden');
    pasteHint.classList.remove('hidden');
}

function clearEditPastedImage() {
    editImageInput.value = '';
    editPreviewImage.src = '';
    editPreviewImage.classList.add('hidden');
    editClearImageBtn.classList.add('hidden');
    editPasteHint.classList.remove('hidden');
}

function clearPastedSolutionImage() {
    newSolutionImageInput.value = '';
    solutionPreviewImage.src = '';
    solutionPreviewImage.classList.add('hidden');
    clearSolutionImageBtn.classList.add('hidden');
    solutionPasteHint.classList.remove('hidden');
}

function clearEditPastedSolutionImage() {
    editSolutionImageInput.value = '';
    editSolutionPreviewImage.src = '';
    editSolutionPreviewImage.classList.add('hidden');
    editClearSolutionImageBtn.classList.add('hidden');
    editSolutionPasteHint.classList.remove('hidden');
}

// ── Modal Functions ───────────────────────────────────────────────
function openEditModal(id) {
    const m = mistakes.find(x => x.id === id);
    if (!m) return;

    document.getElementById('edit-id').value = m.id;
    document.getElementById('edit-category').value = m.category || m.topic || '';
    document.getElementById('edit-subtopics').value = (m.subtopics || []).join(', ') || m.subtopic || '';
    document.getElementById('edit-concept').value = m.concept || '';
    document.getElementById('edit-type').value = m.mistake_type;
    document.getElementById('edit-why').value = m.why_happened;
    document.getElementById('edit-avoid').value = m.how_to_avoid;
    loadSubtopicsForEditForm(m.category || m.topic || '');

    if (m.question_image) {
        editImageInput.value = m.question_image;
        editPreviewImage.src = m.question_image;
        editPreviewImage.classList.remove('hidden');
        editClearImageBtn.classList.remove('hidden');
        editPasteHint.classList.add('hidden');
    } else { clearEditPastedImage(); }

    if (m.solution_image) {
        editSolutionImageInput.value = m.solution_image;
        editSolutionPreviewImage.src = m.solution_image;
        editSolutionPreviewImage.classList.remove('hidden');
        editClearSolutionImageBtn.classList.remove('hidden');
        editSolutionPasteHint.classList.add('hidden');
    } else { clearEditPastedSolutionImage(); }

    editModal.classList.remove('hidden');
}

function closeEditModal() {
    editModal.classList.add('hidden');
    editForm.reset();
    clearEditPastedImage();
    clearEditPastedSolutionImage();
}

function openDeleteModal(id) {
    deleteTargetId = id;
    deleteModal.classList.remove('hidden');
}

function closeDeleteModal() {
    deleteTargetId = null;
    deleteModal.classList.add('hidden');
}

function openImageModal(src) {
    modalImage.src = src;
    imageModal.classList.remove('hidden');
}

// ── Utility ───────────────────────────────────────────────────────
function formatDate(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncate(text, max) {
    if (!text) return '';
    return text.length > max ? text.slice(0, max) + '…' : text;
}

// ── Tab Navigation ────────────────────────────────────────────────
function setupTabs() {
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function switchTab(tabId) {
    tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    tabContents.forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });
}
