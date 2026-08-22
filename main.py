import os

from app import create_app

app = create_app()

PORT = int(os.environ.get("PORT") or 8111)


def main():
    if os.environ.get("SEED_DEMO", "").lower() in {"1", "true", "yes"}:
        from app.models import seed_demo

        if seed_demo():
            print("Seeded demo data.")

    print("Starting Mistake Tracker...")
    print(f"Open http://127.0.0.1:{PORT} in your browser")
    app.run(debug=True, host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()
