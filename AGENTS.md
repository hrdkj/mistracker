# Mistraker

Local Flask web app for tracking study mistakes. Single-package Python app using SQLite.

## Commands

```sh
# Run the dev server
uv run python main.py
# → Serves on http://127.0.0.1:8111 (PORT env var overrides)

# Seed sample data into an empty DB
SEED_DEMO=1 uv run python main.py

# Build the static browser-only demo into dist-demo/
uv run python build_demo.py
node demo/test_demo_mode.js   # static-demo test harness (needs Node)

# Lint (no repo config; isolated run)
uvx ruff check --no-cache --isolated .
```

There are no pytest/typecheck/CI configs.

## Architecture

- **Entry point**: `main.py` → `app.create_app()` → Flask app with blueprint from `app/routes.py`
- **Data layer**: `app/models.py` — raw `sqlite3` (no ORM). DB lives at `data/mistraker.db`; override the location with `MISTRACKER_DATA_DIR`
- **Images**: Uploaded to `data/images/`, served via `/api/images/<filename>`
- **Frontend**: Single-page app in `templates/index.html` + `static/js/main.js` + `static/css/style.css`
- **Static demo**: `demo/demo-mode.js` mocks the whole API in-memory via a `fetch` override; `build_demo.py` renders the real template + copies assets into self-contained `dist-demo/`

## Key details

- Python ≥3.12, dependency managed by **uv** (`uv.lock` present)
- Runtime dependencies: `flask>=3.0.0`, `gunicorn>=21.0.0` (gunicorn is currently unused — kept in case a Python deployment returns; the hosted demo is now a Render *static* site via `render.yaml`)
- `subtopics` column stores JSON arrays as text; parsed back to lists via `_row_to_dict`. Legacy duplicate columns (`topic`, `subtopic`) are still written alongside `category`/`subtopics`
- Max upload size: 16 MB (`MAX_CONTENT_LENGTH`)
- SQLite uses WAL journal mode (`PRAGMA journal_mode=WAL`)
- `data/*.db` and `data/images/` are gitignored; DB is created on first run by `init_db()`
- `/api/topics` is a backward-compatible alias for `/api/categories`
