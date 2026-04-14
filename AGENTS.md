# Mistraker

Local Flask web app for tracking study mistakes. Single-package Python app using SQLite.

## Commands

```sh
# Run the dev server
uv run python main.py
# → Serves on http://127.0.0.1:5000

# Run the one-time JSON→SQLite migration (only if data/mistakes.json exists)
uv run python migrate.py
```

There are no tests, lint, typecheck, or CI configs.

## Architecture

- **Entry point**: `main.py` → `app.create_app()` → Flask app with blueprint from `app/routes.py`
- **Data layer**: `app/models.py` — raw `sqlite3` (no ORM). DB lives at `data/mistraker.db`
- **Images**: Uploaded to `data/images/`, served via `/api/images/<filename>`
- **Frontend**: Single-page app in `templates/index.html` + `static/js/main.js` + `static/css/style.css`

## Key details

- Python ≥3.10, dependency managed by **uv** (`uv.lock` present)
- Only runtime dependency: `flask>=3.0.0`
- `subtopics` column stores JSON arrays as text; parsed back to lists via `_row_to_dict`
- Max upload size: 16 MB (`MAX_CONTENT_LENGTH`)
- SQLite uses WAL journal mode (`PRAGMA journal_mode=WAL`)
- `data/*.db` and `data/images/` are gitignored; DB is created on first run by `init_db()`
- `/api/topics` is a backward-compatible alias for `/api/categories`