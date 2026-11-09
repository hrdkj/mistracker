// Review attempts stay separate from archiving. The server owns scheduling.
(() => {
    let queue = [];
    let nextDueDate = null;
    let completed = 0;
    let loading = false;
    let saving = false;
    let revealed = false;
    const $ = id => document.getElementById(id);
    const labels = { solved: 'Solved', struggled: 'Struggled', missed: 'Missed' };
    const calendarDate = value => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric'
    });

    function setImage(id, url) {
        const image = $(id);
        image.classList.toggle('hidden', !url);
        if (url) image.src = url;
        else image.removeAttribute('src');
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
        if (!mistake) {
            $('review-status').textContent = completed
                ? `All done for now. ${completed} attempt${completed === 1 ? '' : 's'} saved.`
                : 'No reviews due today.';
            $('review-status').textContent += nextDueDate
                ? ` Next review: ${calendarDate(nextDueDate)}.`
                : ' Add an active mistake to start reviewing.';
            return;
        }
        $('review-status').textContent = `${queue.length} due · ${completed} reviewed this session`;
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
        $('refresh-reviews').disabled = true;
        $('review-card').classList.add('hidden');
        $('review-status').textContent = 'Loading reviews…';
        $('review-error').textContent = '';
        try {
            const result = await requestJSON('/api/reviews/due');
            queue = result.mistakes;
            nextDueDate = result.next_due_date;
            completed = 0;
            renderCard();
        } catch (error) {
            $('review-status').textContent = '';
            $('review-error').textContent = error.message;
        } finally {
            loading = false;
            $('refresh-reviews').disabled = false;
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        $('refresh-reviews').addEventListener('click', loadReviewQueue);
        $('reveal-review').addEventListener('click', async () => {
            const mistake = queue[0];
            if (!mistake || loading || saving) return;
            revealed = true;
            $('review-concept').textContent = mistake.concept || '';
            setImage('review-solution', mistake.solution_image);
            $('review-why').textContent = mistake.why_happened || 'No explanation saved.';
            $('review-avoid').textContent = mistake.how_to_avoid || 'No prevention notes saved.';
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
                $('refresh-reviews').disabled = true;
                $('review-error').textContent = '';
                try {
                    const attempt = await requestJSON(`/api/mistakes/${mistake.id}/reviews`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ outcome: button.dataset.outcome })
                    });
                    nextDueDate = !nextDueDate || attempt.next_review_date < nextDueDate
                        ? attempt.next_review_date : nextDueDate;
                    queue.shift();
                    completed++;
                    showToast(`Review saved. Next review: ${calendarDate(attempt.next_review_date)}.`);
                    renderCard(true);
                } catch (error) {
                    $('review-error').textContent = error.message;
                } finally {
                    saving = false;
                    $('review-outcomes').disabled = false;
                    $('refresh-reviews').disabled = false;
                }
            });
        });
    });
})();
