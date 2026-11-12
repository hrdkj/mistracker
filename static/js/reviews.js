// Review attempts stay separate from archiving. The server owns scheduling.
(() => {
    const SESSION_LIMIT = 5;
    let due = [];
    let queue = [];
    let nextDueDate = null;
    let sessionSize = 0;
    let completed = 0;
    let loading = false;
    let saving = false;
    let revealed = false;
    const $ = id => document.getElementById(id);
    const categoryFilter = $('review-category-filter');
    const subtopicFilter = $('review-subtopic-filter');
    const sessionButton = $('start-review-session');
    const labels = { solved: 'Solved', struggled: 'Struggled', missed: 'Missed' };
    const calendarDate = value => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric'
    });

    function categoryMatches(mistake) {
        return !categoryFilter.value || (mistake.category || mistake.topic || '').toLowerCase() === categoryFilter.value;
    }

    function matchingDue() {
        const subtopic = subtopicFilter.value;
        return due.filter(mistake => categoryMatches(mistake) &&
            (!subtopic || (mistake.subtopics || []).some(label => label.toLowerCase() === subtopic)));
    }

    function setFilterOptions(select, labels, retainSelection = true) {
        const selected = select.value;
        const choices = new Map();
        for (const label of labels.filter(Boolean)) choices.set(label.toLowerCase(), label);
        if (retainSelection && selected && !choices.has(selected)) {
            choices.set(selected, select.selectedOptions[0].textContent);
        }
        select.length = 1;
        for (const label of [...choices.values()].sort((a, b) => a.localeCompare(b))) {
            select.add(new Option(label, label.toLowerCase()));
        }
        select.value = choices.has(selected) ? selected : '';
    }

    function refreshSubtopics(retainSelection) {
        const labels = due.filter(categoryMatches).flatMap(mistake => mistake.subtopics || []);
        setFilterOptions(subtopicFilter, labels, retainSelection);
    }

    function syncControls() {
        const busy = loading || saving;
        $('refresh-reviews').disabled = busy;
        categoryFilter.disabled = busy || !due.length || categoryFilter.options.length === 1;
        subtopicFilter.disabled = busy || !due.length || subtopicFilter.options.length === 1;
        sessionButton.disabled = busy || !matchingDue().length || Boolean(sessionSize && queue.length);
    }

    function startSession(limit, focus = false) {
        const matches = matchingDue();
        queue = limit ? matches.slice(0, limit) : matches;
        sessionSize = limit ? queue.length : 0;
        completed = 0;
        $('review-error').textContent = '';
        renderCard(focus);
        syncControls();
    }

    function setImage(id, url) {
        const image = $(id);
        image.classList.toggle('hidden', !url);
        if (url) image.src = url;
        else image.removeAttribute('src');
    }

    function renderReviewNote(id, text, fallback) {
        const note = $(id);
        const blocks = (text?.trim() || fallback).replace(/\r\n?/g, '\n').split(/\n(?:[^\S\n]*\n)+/);
        const bullet = /^[-*•]\s+/;
        note.replaceChildren();
        for (const block of blocks) {
            const lines = block.split('\n').map(line => line.trim());
            if (lines.length === 1 && !bullet.test(lines[0])) {
                const paragraph = document.createElement('p');
                paragraph.textContent = lines[0];
                note.appendChild(paragraph);
                continue;
            }
            const list = document.createElement('ul');
            for (const line of lines) {
                const item = document.createElement('li');
                item.textContent = line.replace(bullet, '');
                list.appendChild(item);
            }
            note.appendChild(list);
        }
    }

    function renderCard(focus = false) {
        revealed = false;
        const mistake = queue[0];
        $('review-card').classList.toggle('hidden', !mistake);
        $('review-answer').classList.add('hidden');
        $('reveal-review').classList.remove('hidden');
        $('reveal-review').setAttribute('aria-expanded', 'false');
        $('review-history').open = false;
        $('review-history-list').replaceChildren();
        $('review-source').classList.add('hidden');
        $('review-source').removeAttribute('href');
        if (!mistake) {
            const status = $('review-status');
            const filtered = categoryFilter.value || subtopicFilter.value;
            if (sessionSize) {
                status.textContent = `Session complete. ${completed} of ${sessionSize} reviewed. ${matchingDue().length} still due in this selection.`;
            } else {
                status.textContent = completed
                    ? `All done for now. ${completed} attempt${completed === 1 ? '' : 's'} saved.`
                    : filtered ? 'No reviews due for this topic.' : 'No reviews due today.';
                if (!filtered) {
                    status.textContent += nextDueDate
                        ? ` Next review: ${calendarDate(nextDueDate)}.`
                        : ' Add an active mistake to start reviewing.';
                }
            }
            if (focus) status.focus();
            return;
        }
        $('review-status').textContent = sessionSize
            ? `Card ${completed + 1} of ${sessionSize} · ${matchingDue().length} due in this selection`
            : `${queue.length} due · ${completed} reviewed this session`;
        $('review-category').textContent = [mistake.category, ...(mistake.subtopics || [])].filter(Boolean).join(' / ');
        $('review-prompt').textContent = mistake.question_image
            ? 'Try this question again'
            : (mistake.concept || 'Recall this topic');
        $('review-previous').textContent = mistake.last_outcome
            ? `Last attempt: ${labels[mistake.last_outcome]}. Due ${calendarDate(mistake.next_review_date)}.`
            : 'First review';
        setImage('review-question', mistake.question_image);
        $('review-no-question').classList.toggle('hidden', Boolean(mistake.question_image));
        // Clear the previous answer so it cannot leak onto the next question.
        setImage('review-solution', '');
        for (const id of ['review-concept', 'review-why', 'review-avoid']) $(id).textContent = '';
        if (focus) $('review-prompt').focus();
    }

    window.loadReviewQueue = async () => {
        if (loading || saving) return;
        loading = true;
        syncControls();
        $('review-card').classList.add('hidden');
        $('review-status').textContent = 'Loading reviews…';
        $('review-error').textContent = '';
        try {
            const result = await requestJSON('/api/reviews/due');
            due = result.mistakes;
            nextDueDate = result.next_due_date;
            setFilterOptions(categoryFilter, due.map(mistake => mistake.category || mistake.topic));
            refreshSubtopics();
            startSession();
        } catch (error) {
            due = [];
            $('review-status').textContent = '';
            $('review-error').textContent = error.message;
        } finally {
            loading = false;
            syncControls();
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        $('refresh-reviews').addEventListener('click', loadReviewQueue);
        categoryFilter.addEventListener('change', () => {
            refreshSubtopics(false);
            startSession();
        });
        subtopicFilter.addEventListener('change', () => startSession());
        sessionButton.addEventListener('click', () => startSession(SESSION_LIMIT, true));
        $('reveal-review').addEventListener('click', async () => {
            const mistake = queue[0];
            if (!mistake || loading || saving) return;
            revealed = true;
            $('review-concept').textContent = mistake.concept || '';
            setImage('review-solution', mistake.solution_image);
            renderReviewNote('review-why', mistake.why_happened, 'No explanation saved.');
            renderReviewNote('review-avoid', mistake.how_to_avoid, 'No prevention notes saved.');
            const href = sourceHref(mistake.source_url);
            if (href) {
                $('review-source').href = href;
                $('review-source').classList.remove('hidden');
            }
            $('review-answer').classList.remove('hidden');
            $('reveal-review').classList.add('hidden');
            $('reveal-review').setAttribute('aria-expanded', 'true');
            $('review-answer-title').focus({ preventScroll: true });
            try {
                const history = await requestJSON(`/api/mistakes/${mistake.id}/reviews`);
                if (queue[0] !== mistake || !revealed) return;
                const entries = history.map(attempt => {
                    const item = document.createElement('li');
                    item.textContent = `${new Date(attempt.reviewed_at).toLocaleString()} — ${labels[attempt.outcome]}`;
                    return item;
                });
                if (!entries.length) {
                    const item = document.createElement('li');
                    item.textContent = 'No previous attempts.';
                    entries.push(item);
                }
                $('review-history-list').replaceChildren(...entries);
            } catch (error) {
                if (queue[0] === mistake && revealed) {
                    const item = document.createElement('li');
                    item.textContent = error.message;
                    $('review-history-list').replaceChildren(item);
                }
            }
        });
        document.querySelectorAll('[data-outcome]').forEach(button => {
            button.addEventListener('click', async () => {
                if (saving || loading || !revealed || !queue.length) return;
                const mistake = queue[0];
                saving = true;
                $('review-outcomes').disabled = true;
                syncControls();
                $('review-error').textContent = '';
                try {
                    const attempt = await requestJSON(`/api/mistakes/${mistake.id}/reviews`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ outcome: button.dataset.outcome })
                    });
                    nextDueDate = !nextDueDate || attempt.next_review_date < nextDueDate
                        ? attempt.next_review_date : nextDueDate;
                    due = due.filter(item => item.id !== mistake.id);
                    queue.shift();
                    completed++;
                    showToast(`Review saved. Next review: ${calendarDate(attempt.next_review_date)}.`);
                    renderCard(true);
                } catch (error) {
                    $('review-error').textContent = error.message;
                } finally {
                    saving = false;
                    $('review-outcomes').disabled = false;
                    syncControls();
                }
            });
        });
    });
})();
