import os

from app import create_app

app = create_app()

PORT = int(os.environ.get("PORT", 5000))


def main():
    print("Starting Mistake Tracker...")
    print(f"Open http://127.0.0.1:{PORT} in your browser")
    app.run(debug=True, host="127.0.0.1", port=PORT)


if __name__ == "__main__":
    main()
