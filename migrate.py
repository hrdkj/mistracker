"""One-time migration: mistakes.json → SQLite + file-based images."""

import base64
import json
import os
import sqlite3
import uuid

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
JSON_FILE = os.path.join(DATA_DIR, "mistakes.json")
DB_FILE = os.path.join(DATA_DIR, "mistraker.db")
IMAGES_DIR = os.path.join(DATA_DIR, "images")

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS mistakes (
    id            TEXT PRIMARY KEY,
    category      TEXT NOT NULL DEFAULT '',
    subtopics     TEXT NOT NULL DEFAULT '',
    subtopic      TEXT NOT NULL DEFAULT '',
    concept       TEXT NOT NULL DEFAULT '',
    topic         TEXT NOT NULL DEFAULT '',
    question_image TEXT NOT NULL DEFAULT '',
    solution_image TEXT NOT NULL DEFAULT '',
    mistake_type  TEXT NOT NULL DEFAULT 'Conceptual',
    why_happened  TEXT NOT NULL DEFAULT '',
    how_to_avoid  TEXT NOT NULL DEFAULT '',
    date_added    TEXT NOT NULL DEFAULT '',
    date_modified TEXT NOT NULL DEFAULT ''
);
"""


def extract_image(data_uri: str, prefix: str) -> str:
    """Save a base64 data-URI to disk, return the serving URL path."""
    if not data_uri or not data_uri.startswith("data:image"):
        return data_uri  # Already a URL or empty — keep as-is

    # Parse header  → data:image/png;base64,<payload>
    header, payload = data_uri.split(",", 1)
    ext = "png"
    if "image/jpeg" in header or "image/jpg" in header:
        ext = "jpg"
    elif "image/webp" in header:
        ext = "webp"
    elif "image/gif" in header:
        ext = "gif"

    filename = f"{prefix}_{uuid.uuid4().hex[:12]}.{ext}"
    filepath = os.path.join(IMAGES_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(base64.b64decode(payload))

    return f"/api/images/{filename}"


def migrate():
    if not os.path.exists(JSON_FILE):
        print("No mistakes.json found — nothing to migrate.")
        return

    if os.path.exists(DB_FILE):
        print(f"Database already exists at {DB_FILE}.")
        resp = input("Overwrite? (y/N): ").strip().lower()
        if resp != "y":
            print("Aborted.")
            return
        os.remove(DB_FILE)

    os.makedirs(IMAGES_DIR, exist_ok=True)

    with open(JSON_FILE, "r", encoding="utf-8") as f:
        mistakes = json.load(f)

    print(f"Loaded {len(mistakes)} mistakes from JSON.")

    conn = sqlite3.connect(DB_FILE)
    conn.execute(CREATE_TABLE)

    inserted = 0
    images_saved = 0

    for m in mistakes:
        mid = m.get("id", str(uuid.uuid4()))

        # Extract images
        q_img = extract_image(m.get("question_image", ""), "q")
        if q_img != m.get("question_image", ""):
            images_saved += 1

        s_img = extract_image(m.get("solution_image", ""), "s")
        if s_img != m.get("solution_image", ""):
            images_saved += 1

        subtopics_raw = m.get("subtopics", [])
        if isinstance(subtopics_raw, list):
            subtopics_json = json.dumps(subtopics_raw)
        else:
            subtopics_json = json.dumps([subtopics_raw] if subtopics_raw else [])

        conn.execute(
            """INSERT OR REPLACE INTO mistakes
               (id, category, subtopics, subtopic, concept, topic,
                question_image, solution_image, mistake_type,
                why_happened, how_to_avoid, date_added, date_modified)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                mid,
                m.get("category", m.get("topic", "")),
                subtopics_json,
                m.get("subtopic", ""),
                m.get("concept", ""),
                m.get("category", m.get("topic", "")),
                q_img,
                s_img,
                m.get("mistake_type", "Conceptual"),
                m.get("why_happened", ""),
                m.get("how_to_avoid", ""),
                m.get("date_added", ""),
                m.get("date_modified", ""),
            ),
        )
        inserted += 1

    conn.commit()
    conn.close()

    # Backup original JSON
    backup = JSON_FILE + ".bak"
    os.rename(JSON_FILE, backup)
    print(f"✓ Migrated {inserted} mistakes to SQLite.")
    print(f"✓ Extracted {images_saved} images to {IMAGES_DIR}/")
    print(f"✓ Original JSON backed up to {backup}")


if __name__ == "__main__":
    migrate()
