import os

from app import create_app

app = create_app()

PORT = int(os.environ.get("PORT") or 8111)

# Debug + auto-reloader on by default for `uv run python main.py`.
# The systemd auto-start service sets MISTRACKER_DEBUG=0 so it runs as a
# single process (~half the RAM, no reloader) instead of two.
DEBUG = os.environ.get("MISTRACKER_DEBUG", "1").lower() not in {"0", "false", "no"}


def main():
    if os.environ.get("SEED_DEMO", "").lower() in {"1", "true", "yes"}:
        from app.models import seed_demo

        if seed_demo():
            print("Seeded demo data.")

    print("Starting Mistake Tracker...")
    print(f"Open http://127.0.0.1:{PORT} in your browser")
    app.run(debug=DEBUG, host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()
