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
  
## License

MIT
