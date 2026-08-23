# Mistracker

Your mistakes, indexed and searchable.

## Live demo (instant, no install)

The hosted demo serves the full UI with sample data straight from a static site — it never sleeps, so there's no cold start:

**https://mistracker-demo.onrender.com**

Changes are session-only and reset on reload. Once you deploy it (below), replace that URL with your real one.

## Run for real (local)

```sh
git clone https://github.com/hrdkj/mistracker.git
cd mistracker
uv run python main.py
```

Opens at [http://127.0.0.1:8111](http://127.0.0.1:8111). The SQLite database is created automatically on first run.

Add sample data to an empty database:

```sh
SEED_DEMO=1 uv run python main.py
```

It never touches existing data — delete `data/mistracker.db` first to start fresh.

## Deploying / updating the hosted demo

The demo deploys as a **Render static site** from `render.yaml` — the build renders the real template via `build_demo.py` and bakes in sample data (`demo/demo-mode.js` mocks the API in-browser). Static sites on Render's free tier don't spin down, unlike Python web services.

1. Push this repo to GitHub.
2. In Render: **New → Blueprint**, point it at the repo (or sync the existing blueprint after deleting the old web service, if any).
3. Done — every push to `main` rebuilds the demo automatically.

Preview locally before pushing:

```sh
uv run python build_demo.py
python -m http.server -d dist-demo 8080
```

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/) (install: `curl -LsSf https://astral.sh/uv/install.sh | sh`)
- Node only for the static-demo test harness: `node demo/test_demo_mode.js`

## License

MIT
