# Mistracker

Your mistakes, indexed and searchable.

## Live demo 

**https://mistracker-demo.onrender.com**

## Run for real (local)

```sh
git clone https://github.com/hrdkj/mistracker.git
cd mistracker
uv run python main.py
```

Opens at [http://127.0.0.1:8111](http://127.0.0.1:8111). The SQLite database is created automatically on first run.

### Review your mistakes

Open **Review today** to practice active mistakes that are due. Try the question,
then reveal the solution and notes and record **Solved**, **Struggled**, or
**Missed**. Entries without question images use their concept as a recall prompt.
Filter the due queue by category and subtopic. **Start 5-card session** reviews
up to five matching cards and leaves the remaining cards due.

- Missed: review tomorrow.
- Struggled: review in 3 days.
- Solved: review in 7 days; consecutive solved reviews increase to 14, 28, then 30 days.

Review dates use the local server's calendar. New and existing unreviewed active
mistakes are due immediately. Each attempt is saved in the database and can be
seen under **Previous attempts** after revealing a card. Archiving pauses reviews
without erasing their history; deleting a mistake deletes its history too.
The static demo supports reviews, but its changes reset on reload.

Saving an entry requires a category, an explanation, and prevention notes.
Add an optional HTTP or HTTPS source link to reopen the original problem from
the mistakes list or after revealing a review card. Press **Ctrl+Enter** while
in the add or edit form to save.
Failed saves keep the form and uploaded images available for retry. Submission
is disabled while a save or image upload is in progress.

### Back up and restore

Open **Insights** in the app to download a ZIP backup containing your mistakes
and uploaded images, including review history in the database, or restore from a previous backup. Before replacing data,
the app saves the current database and images under `data/backups/`.
Backups from before review mode are supported and start with empty review history.

### Auto-start on login (Linux with systemd)

Tired of running the server manually? This is opt-in — cloning the repo
never starts anything on its own:

```sh
./install-autostart.sh
```

This installs a systemd user service (starts on login, restarts on failure)
plus a "Mistracker" entry in your app launcher that opens the page. To remove:

```sh
./install-autostart.sh --uninstall
```

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/)

### Development checks

```sh
uv run python -m unittest discover -s tests -v
uv run python build_demo.py
node demo/test_demo_mode.js
uvx ruff check --no-cache --isolated .
```

Browser regression tests use Playwright and a temporary Flask database. They
exercise failed saves, upload and submission races, edits, review persistence,
mobile layout, and the built static demo:

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

To use an installed Chromium instead, set `CHROMIUM_PATH=/path/to/chromium` when
running `npm run test:browser`. Build the static demo before running these tests.
  
## License

MIT
