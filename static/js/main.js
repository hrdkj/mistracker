// ── Mistake Tracker – Main JavaScript ─────────────────────────────

// State
let mistakes = [];
let archivedMistakes = [];
let categories = [];
let subtopics = [];
let currentFilters = { category: '', subtopic: '', mistake_type: '' };
let searchQuery = '';
let archivedSearchQuery = '';
let deleteTargetId = null;
let restoreTopicName = null;

let didHydrateLastEntryFromMistakes = false;

const LAST_ENTRY_DETAILS_KEY = 'mistakeTracker.lastEntryDetails';

// ── DOM Elements ──────────────────────────────────────────────────
const mistakesTable = document.getElementById('mistakes-tbody');
const mistakeCount = document.getElementById('mistake-count');
const noDataMessage = document.getElementById('no-data');
const filterCategory = document.getElementById('filter-category');
const filterSubtopic = document.getElementById('filter-subtopic');
const filterType = document.getElementById('filter-type');
const clearFiltersBtn = document.getElementById('clear-filters');

const archivedFolders = document.getElementById('archived-folders');
const archivedCountEl = document.getElementById('archived-count');
const archivedNoData = document.getElementById('archived-no-data');
const archivedSearchInput = document.getElementById('archived-search-input');
const archiveTopicBtn = document.getElementById('archive-topic-btn');
const archiveTopicModal = document.getElementById('archive-topic-modal');
const restoreTopicModal = document.getElementById('restore-topic-modal');

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
    loadArchivedMistakes();
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
        toast.remove();
    }, 2800);
}

// ── API Functions ─────────────────────────────────────────────────
async function loadMistakes() {
    const params = new URLSearchParams();
    params.append('archived', 'false');
    if (currentFilters.category) params.append('category', currentFilters.category);
    if (currentFilters.subtopic) params.append('subtopic', currentFilters.subtopic);
    if (currentFilters.mistake_type) params.append('mistake_type', currentFilters.mistake_type);

    const response = await fetch(`/api/mistakes?${params}`);
    mistakes = await response.json();
    hydrateLastEntryDetailsFromMistakes();
    renderTable();
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
    const response = await fetch('/api/categories?archived=false');
    categories = await response.json();
    renderCategoryFilter();
    renderCategorySuggestions();
}

async function loadArchivedMistakes() {
    const params = new URLSearchParams();
    params.append('archived', 'true');

    const response = await fetch(`/api/mistakes?${params}`);
    archivedMistakes = await response.json();
    renderArchivedFolders();
}

async function loadSubtopics(category = '') {
    const params = new URLSearchParams();
    params.append('archived', 'false');
    if (category) params.append('category', category);
    const response = await fetch(`/api/subtopics?${params}`);
    subtopics = await response.json();
    renderSubtopicFilter();
}

async function fetchSubtopicsByCategory(category = '') {
    const params = new URLSearchParams();
    params.append('archived', 'false');
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

async function apiArchiveMistake(id) {
    const response = await fetch(`/api/mistakes/${id}/archive`, { method: 'PATCH' });
    return response.json();
}

async function apiUnarchiveMistake(id) {
    const response = await fetch(`/api/mistakes/${id}/unarchive`, { method: 'PATCH' });
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
function renderTable() {
    mistakesTable.innerHTML = '';
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
        if(mistakeCount) mistakeCount.textContent = '0';
        return;
    }
    noDataMessage.classList.add('hidden');
    if(mistakeCount) mistakeCount.textContent = filtered.length;

    filtered.forEach(m => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td data-label="Date">${formatDate(m.date_added)}</td>
            <td data-label="Category">${escapeHtml(m.category || m.topic || '')}</td>
            <td data-label="Subtopic">${escapeHtml(m.subtopic || '')}</td>
            <td data-label="Question">${renderThumbnail(m.question_image, m.id, 'question')}</td>
            <td data-label="Solution">${renderThumbnail(m.solution_image, m.id, 'solution')}</td>
            <td data-label="Type">${renderMistakeType(m.mistake_type)}</td>
            <td data-label="Why It Happened">${escapeHtml(m.why_happened)}</td>
            <td data-label="How to Avoid">${escapeHtml(m.how_to_avoid)}</td>
            <td data-label="Actions">
                <div class="action-btns">
                    <button class="card-action-btn edit-btn" data-id="${m.id}" title="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                    <button class="card-action-btn archive-btn" data-id="${m.id}" title="Archive"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg></button>
                    <button class="card-action-btn delete-btn" data-id="${m.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                </div>
            </td>
        `;
        mistakesTable.appendChild(row);
    });

    mistakesTable.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', () => openEditModal(btn.dataset.id));
    });

    mistakesTable.querySelectorAll('.archive-btn').forEach(btn => {
        btn.addEventListener('click', () => handleArchive(btn.dataset.id));
    });

    mistakesTable.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
    });

    mistakesTable.querySelectorAll('.card-thumb').forEach(img => {
        img.addEventListener('click', () => openImageModal(img.dataset.src));
    });
}

function renderThumbnail(imageData, id, type) {
    if (!imageData) {
        return '<span class="no-image">—</span>';
    }
    return `<img src="${imageData}" class="card-thumb" data-src="${imageData}" alt="${type}">`;
}

function renderMistakeType(type) {
    const className = (type || 'conceptual').toLowerCase().replace(/[\/\s]/g, '-');
    return `<span class="badge badge-${className}">${escapeHtml(type)}</span>`;
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

function renderArchivedFolders() {
    archivedFolders.innerHTML = '';

    let grouped = {};
    archivedMistakes.forEach(m => {
        const cat = m.category || m.topic || 'Uncategorized';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(m);
    });

    if (archivedSearchQuery) {
        const q = archivedSearchQuery.toLowerCase();
        const filtered = {};
        for (const [cat, items] of Object.entries(grouped)) {
            const matching = items.filter(m =>
                (m.category || '').toLowerCase().includes(q) ||
                (m.subtopic || '').toLowerCase().includes(q) ||
                (m.concept || '').toLowerCase().includes(q) ||
                (m.why_happened || '').toLowerCase().includes(q) ||
                (m.how_to_avoid || '').toLowerCase().includes(q) ||
                (m.mistake_type || '').toLowerCase().includes(q)
            );
            if (matching.length > 0) filtered[cat] = matching;
        }
        grouped = filtered;
    }

    const categoryNames = Object.keys(grouped).sort();

    if (categoryNames.length === 0) {
        archivedNoData.classList.remove('hidden');
        if (archivedCountEl) archivedCountEl.textContent = '0';
        return;
    }
    archivedNoData.classList.add('hidden');
    const totalArchived = Object.values(grouped).reduce((sum, arr) => sum + arr.length, 0);
    if (archivedCountEl) archivedCountEl.textContent = totalArchived;

    categoryNames.forEach(cat => {
        const items = grouped[cat];
        const folder = document.createElement('div');
        folder.className = 'archive-folder';

        const header = document.createElement('div');
        header.className = 'archive-folder-header';
        header.innerHTML = `
            <div class="archive-folder-info">
                <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                <span class="archive-folder-name">${escapeHtml(cat)}</span>
                <span class="count-badge">${items.length}</span>
            </div>
            <div class="archive-folder-actions">
                <button class="btn btn-sm btn-restore" data-category="${escapeHtml(cat)}" title="Restore all mistakes in this topic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                    Restore All
                </button>
                <svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
        `;

        const content = document.createElement('div');
        content.className = 'archive-folder-content hidden';
        const tableContainer = document.createElement('div');
        tableContainer.className = 'table-container';

        const table = document.createElement('table');
        table.className = 'archive-folder-table';
        table.innerHTML = `
            <colgroup>
                <col class="col-date">
                <col class="col-subtopic">
                <col class="col-question">
                <col class="col-solution">
                <col class="col-type">
                <col class="col-why">
                <col class="col-avoid">
                <col class="col-actions">
            </colgroup>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Subtopic</th>
                    <th>Question</th>
                    <th>Solution</th>
                    <th>Type</th>
                    <th>Why</th>
                    <th>Avoid</th>
                    <th>Actions</th>
                </tr>
            </thead>
        `;

        const tbody = document.createElement('tbody');
        items.forEach(m => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td data-label="Date">${formatDate(m.date_added)}</td>
                <td data-label="Subtopic">${escapeHtml(m.subtopic || '')}</td>
                <td data-label="Question">${renderThumbnail(m.question_image, m.id, 'question')}</td>
                <td data-label="Solution">${renderThumbnail(m.solution_image, m.id, 'solution')}</td>
                <td data-label="Type">${renderMistakeType(m.mistake_type)}</td>
                <td data-label="Why">${escapeHtml(m.why_happened)}</td>
                <td data-label="Avoid">${escapeHtml(m.how_to_avoid)}</td>
                <td data-label="Actions">
                    <div class="action-btns">
                        <button class="card-action-btn unarchive-btn" data-id="${m.id}" title="Restore"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg></button>
                        <button class="card-action-btn delete-btn" data-id="${m.id}" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
        });

        table.appendChild(tbody);
        tableContainer.appendChild(table);
        content.appendChild(tableContainer);
        folder.appendChild(header);
        folder.appendChild(content);
        archivedFolders.appendChild(folder);

        header.addEventListener('click', (e) => {
            if (e.target.closest('.btn-restore')) return;
            content.classList.toggle('hidden');
            const chevron = header.querySelector('.folder-chevron');
            chevron.style.transform = content.classList.contains('hidden') ? '' : 'rotate(180deg)';
        });

        header.querySelector('.btn-restore').addEventListener('click', (e) => {
            e.stopPropagation();
            openRestoreTopicModal(cat);
        });

        tbody.querySelectorAll('.unarchive-btn').forEach(btn => {
            btn.addEventListener('click', () => handleUnarchive(btn.dataset.id));
        });

        tbody.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
        });

        tbody.querySelectorAll('.card-thumb').forEach(img => {
            img.addEventListener('click', () => openImageModal(img.dataset.src));
        });
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
            renderTable();
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

    // Archived tab search
    let archivedSearchTimer;
    archivedSearchInput.addEventListener('input', () => {
        clearTimeout(archivedSearchTimer);
        archivedSearchTimer = setTimeout(() => {
            archivedSearchQuery = archivedSearchInput.value.trim();
            renderArchivedFolders();
        }, 200);
    });

    // Archive topic modal
    archiveTopicBtn.addEventListener('click', openArchiveTopicModal);


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
            loadArchivedMistakes();
        }
    });
    document.getElementById('cancel-delete').addEventListener('click', closeDeleteModal);

    document.getElementById('confirm-restore-topic').addEventListener('click', () => {
        if (restoreTopicName) {
            handleRestoreTopic(restoreTopicName);
        }
    });
    document.getElementById('cancel-restore-topic').addEventListener('click', closeRestoreTopicModal);

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

// ── Archive / Unarchive ────────────────────────────────────────────
async function handleArchive(id) {
    await apiArchiveMistake(id);
    showToast('Mistake archived', 'info');
    loadMistakes();
    loadCategories();
    loadSubtopics();
    loadArchivedMistakes();
}

async function handleUnarchive(id) {
    await apiUnarchiveMistake(id);
    showToast('Mistake restored', 'success');
    loadMistakes();
    loadCategories();
    loadSubtopics();
    loadArchivedMistakes();
}

async function handleArchiveTopic(category) {
    await fetch('/api/mistakes/archive-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category })
    });
    showToast(`"${category}" archived`, 'info');
    closeArchiveTopicModal();
    loadMistakes();
    loadCategories();
    loadSubtopics();
    loadArchivedMistakes();
}

async function handleRestoreTopic(category) {
    await fetch('/api/mistakes/unarchive-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category })
    });
    showToast(`"${category}" restored`, 'success');
    closeRestoreTopicModal();
    loadMistakes();
    loadCategories();
    loadSubtopics();
    loadArchivedMistakes();
}

function openArchiveTopicModal() {
    const list = document.getElementById('archive-topic-list');
    list.innerHTML = '';
    if (categories.length === 0) {
        list.innerHTML = '<p class="modal-desc">No active topics to archive.</p>';
    } else {
        categories.forEach(cat => {
            const count = mistakes.filter(m => (m.category || m.topic || '').toLowerCase() === cat.toLowerCase()).length;
            const item = document.createElement('div');
            item.className = 'archive-topic-item';
            item.innerHTML = `
                <div class="archive-topic-item-info">
                    <svg class="folder-icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    <span class="archive-topic-item-name">${escapeHtml(cat)}</span>
                    <span class="count-badge">${count}</span>
                </div>
                <button class="btn btn-sm btn-archive-topic" data-category="${escapeHtml(cat)}">Archive</button>
            `;
            list.appendChild(item);
            item.querySelector('.btn-archive-topic').addEventListener('click', () => {
                handleArchiveTopic(cat);
            });
        });
    }
    archiveTopicModal.classList.remove('hidden');
}

function closeArchiveTopicModal() {
    archiveTopicModal.classList.add('hidden');
}

function openRestoreTopicModal(category) {
    restoreTopicName = category;
    document.getElementById('restore-topic-msg').textContent = `All mistakes in "${category}" will be moved back to active.`;
    restoreTopicModal.classList.remove('hidden');
}

function closeRestoreTopicModal() {
    restoreTopicName = null;
    restoreTopicModal.classList.add('hidden');
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
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
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
    if (tabId === 'archived-tab') {
        loadArchivedMistakes();
    }
}
