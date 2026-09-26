import base64
import json
import os
import sqlite3
import struct
import uuid
import zlib
from datetime import datetime, timedelta

DATA_DIR = os.environ.get("MISTRACKER_DATA_DIR") or os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "data"
)
DB_FILE = os.path.join(DATA_DIR, "mistracker.db")
# Legacy DB filename (misspelling) — migrated automatically if present and new file absent.
_LEGACY_DB_FILE = os.path.join(DATA_DIR, "mistraker.db")
IMAGES_DIR = os.path.join(DATA_DIR, "images")

# Migrate legacy DB file name on import (preserves user data after rename).
if os.path.exists(_LEGACY_DB_FILE) and not os.path.exists(DB_FILE):
    try:
        os.rename(_LEGACY_DB_FILE, DB_FILE)
    except OSError:
        # Fall back to using the legacy file if rename fails (e.g. different mount).
        DB_FILE = _LEGACY_DB_FILE

MISTAKE_TYPES = [
    "Conceptual",
    "Silly/Careless",
    "Calculation",
    "Time Pressure",
    "Misread Question",
    "Memory/Formula",
]

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS mistakes (
    id            TEXT PRIMARY KEY,
    category      TEXT NOT NULL DEFAULT '',
    subtopics     TEXT NOT NULL DEFAULT '[]',
    subtopic      TEXT NOT NULL DEFAULT '',
    concept       TEXT NOT NULL DEFAULT '',
    topic         TEXT NOT NULL DEFAULT '',
    question_image TEXT NOT NULL DEFAULT '',
    solution_image TEXT NOT NULL DEFAULT '',
    mistake_type  TEXT NOT NULL DEFAULT 'Conceptual',
    why_happened  TEXT NOT NULL DEFAULT '',
    how_to_avoid  TEXT NOT NULL DEFAULT '',
    date_added    TEXT NOT NULL DEFAULT '',
    date_modified TEXT NOT NULL DEFAULT '',
    archived      INTEGER NOT NULL DEFAULT 0
);
"""


def _get_conn() -> sqlite3.Connection:
    """Get a SQLite connection with row factory."""
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    """Create tables and directories if they don't exist."""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(IMAGES_DIR, exist_ok=True)
    conn = _get_conn()
    conn.execute(CREATE_TABLE)
    try:
        conn.execute(
            "ALTER TABLE mistakes ADD COLUMN archived INTEGER NOT NULL DEFAULT 0"
        )
    except sqlite3.OperationalError:
        pass
    # Secondary indexes for the read paths in get_all_mistakes(),
    # get_all_categories(), get_all_subtopics() and get_analytics().
    # IF NOT EXISTS keeps this idempotent on existing databases.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_mistakes_archived_date "
        "ON mistakes (archived, date_added)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_mistakes_category "
        "ON mistakes (archived, category)"
    )
    conn.commit()
    conn.close()


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a normalized dict."""
    d = dict(row)
    # Parse subtopics JSON string back to list
    try:
        d["subtopics"] = json.loads(d.get("subtopics", "[]"))
    except (json.JSONDecodeError, TypeError):
        d["subtopics"] = []
    return d


def _normalized_text(value: str | None) -> str:
    if not value:
        return ""
    return str(value).strip()


def _safe_mistake_type(value, fallback: str = "Conceptual") -> str:
    return value if value in MISTAKE_TYPES else fallback


def _parse_subtopics(value) -> list[str]:
    raw_items = []
    if isinstance(value, list):
        raw_items = [str(v) for v in value if v is not None]
    elif isinstance(value, str):
        raw_items = value.split(",")
    elif value is not None:
        raw_items = [str(value)]

    result = []
    seen = set()
    for item in raw_items:
        normalized = item.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def get_all_mistakes(
    category: str | None = None,
    subtopic: str | None = None,
    mistake_type: str | None = None,
    archived: bool | None = None,
) -> list[dict]:
    """Get all mistakes, optionally filtered.

    archived: None = all, False = active only, True = archived only
    """
    conn = _get_conn()
    query = "SELECT * FROM mistakes WHERE 1=1"
    params: list = []

    if archived is not None:
        query += " AND archived = ?"
        params.append(1 if archived else 0)

    if category:
        query += " AND LOWER(category) = LOWER(?)"
        params.append(category)

    if mistake_type:
        query += " AND LOWER(mistake_type) = LOWER(?)"
        params.append(mistake_type)

    query += " ORDER BY date_added DESC"

    rows = conn.execute(query, params).fetchall()
    conn.close()

    results = [_row_to_dict(r) for r in rows]

    if subtopic:
        subtopic_lower = subtopic.lower()
        results = [
            m
            for m in results
            if subtopic_lower in [s.lower() for s in m.get("subtopics", [])]
        ]

    return results


def get_mistake_by_id(mistake_id: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM mistakes WHERE id = ?", (mistake_id,)).fetchone()
    conn.close()
    if row:
        return _row_to_dict(row)
    return None


def add_mistake(data: dict) -> dict:
    category = _normalized_text(data.get("category"))
    if not category:
        category = _normalized_text(data.get("topic"))

    now = datetime.now().isoformat()
    subtopics = _parse_subtopics(data.get("subtopics"))
    if not subtopics:
        subtopics = _parse_subtopics(data.get("subtopic"))

    new_id = str(uuid.uuid4())
    concept = _normalized_text(data.get("concept"))

    conn = _get_conn()
    conn.execute(
        """INSERT INTO mistakes
           (id, category, subtopics, subtopic, concept, topic,
            question_image, solution_image, mistake_type,
            why_happened, how_to_avoid, date_added, date_modified)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            new_id,
            category,
            json.dumps(subtopics),
            ", ".join(subtopics),
            concept,
            category,
            _normalized_text(data.get("question_image")),
            _normalized_text(data.get("solution_image")),
            _safe_mistake_type(data.get("mistake_type", "Conceptual")),
            _normalized_text(data.get("why_happened")),
            _normalized_text(data.get("how_to_avoid")),
            now,
            now,
        ),
    )
    conn.commit()
    conn.close()

    return get_mistake_by_id(new_id)


def update_mistake(mistake_id: str, data: dict) -> dict | None:
    existing = get_mistake_by_id(mistake_id)
    if not existing:
        return None

    # Build updated fields
    if "category" in data:
        category = _normalized_text(data["category"])
    elif "topic" in data:
        category = _normalized_text(data["topic"])
    else:
        category = existing["category"]

    if "subtopics" in data:
        subtopics = _parse_subtopics(data["subtopics"])
    elif "subtopic" in data:
        subtopics = _parse_subtopics(data["subtopic"])
    else:
        subtopics = existing["subtopics"]

    concept = (
        _normalized_text(data["concept"]) if "concept" in data else existing["concept"]
    )
    question_image = data.get("question_image", existing["question_image"])
    solution_image = data.get("solution_image", existing["solution_image"])
    if "mistake_type" in data:
        mistake_type = _safe_mistake_type(data["mistake_type"], existing["mistake_type"])
    else:
        mistake_type = existing["mistake_type"]
    why_happened = (
        _normalized_text(data["why_happened"])
        if "why_happened" in data
        else existing["why_happened"]
    )
    how_to_avoid = (
        _normalized_text(data["how_to_avoid"])
        if "how_to_avoid" in data
        else existing["how_to_avoid"]
    )

    conn = _get_conn()
    conn.execute(
        """UPDATE mistakes SET
           category = ?, subtopics = ?, subtopic = ?, concept = ?, topic = ?,
           question_image = ?, solution_image = ?, mistake_type = ?,
           why_happened = ?, how_to_avoid = ?, date_modified = ?
           WHERE id = ?""",
        (
            category,
            json.dumps(subtopics),
            ", ".join(subtopics),
            concept,
            category,
            question_image,
            solution_image,
            mistake_type,
            why_happened,
            how_to_avoid,
            datetime.now().isoformat(),
            mistake_id,
        ),
    )
    conn.commit()
    conn.close()
    return get_mistake_by_id(mistake_id)


def _delete_image_file(url: str) -> None:
    """Delete an image file from disk given its serving URL."""
    if not url or not url.startswith("/api/images/"):
        return
    filename = url.split("/")[-1]
    filepath = os.path.join(IMAGES_DIR, filename)
    if os.path.exists(filepath):
        os.remove(filepath)


def delete_mistake(mistake_id: str) -> bool:
    existing = get_mistake_by_id(mistake_id)
    if not existing:
        return False

    # Delete associated images
    _delete_image_file(existing.get("question_image", ""))
    _delete_image_file(existing.get("solution_image", ""))

    conn = _get_conn()
    conn.execute("DELETE FROM mistakes WHERE id = ?", (mistake_id,))
    conn.commit()
    conn.close()
    return True


def get_all_categories(archived: bool | None = None) -> list[str]:
    conn = _get_conn()
    query = "SELECT DISTINCT category FROM mistakes WHERE category != ''"
    params: list = []
    if archived is not None:
        query += " AND archived = ?"
        params.append(1 if archived else 0)
    query += " ORDER BY category"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [r["category"] for r in rows]


def get_all_subtopics(
    category: str | None = None, archived: bool | None = None
) -> list[str]:
    conn = _get_conn()
    query = "SELECT subtopics FROM mistakes WHERE 1=1"
    params: list = []
    if category:
        query += " AND LOWER(category) = LOWER(?)"
        params.append(category)
    if archived is not None:
        query += " AND archived = ?"
        params.append(1 if archived else 0)
    rows = conn.execute(query, params).fetchall()
    conn.close()

    all_subtopics = set()
    for row in rows:
        try:
            subs = json.loads(row["subtopics"])
            for s in subs:
                if s:
                    all_subtopics.add(s)
        except (json.JSONDecodeError, TypeError):
            pass

    return sorted(all_subtopics)


def archive_mistake(mistake_id: str) -> dict | None:
    existing = get_mistake_by_id(mistake_id)
    if not existing:
        return None
    conn = _get_conn()
    conn.execute(
        "UPDATE mistakes SET archived = 1, date_modified = ? WHERE id = ?",
        (datetime.now().isoformat(), mistake_id),
    )
    conn.commit()
    conn.close()
    return get_mistake_by_id(mistake_id)


def unarchive_mistake(mistake_id: str) -> dict | None:
    existing = get_mistake_by_id(mistake_id)
    if not existing:
        return None
    conn = _get_conn()
    conn.execute(
        "UPDATE mistakes SET archived = 0, date_modified = ? WHERE id = ?",
        (datetime.now().isoformat(), mistake_id),
    )
    conn.commit()
    conn.close()
    return get_mistake_by_id(mistake_id)


def archive_category(category: str) -> int:
    conn = _get_conn()
    now = datetime.now().isoformat()
    cursor = conn.execute(
        "UPDATE mistakes SET archived = 1, date_modified = ? WHERE LOWER(category) = LOWER(?) AND archived = 0",
        (now, category),
    )
    conn.commit()
    count = cursor.rowcount
    conn.close()
    return count


def unarchive_category(category: str) -> int:
    conn = _get_conn()
    now = datetime.now().isoformat()
    cursor = conn.execute(
        "UPDATE mistakes SET archived = 0, date_modified = ? WHERE LOWER(category) = LOWER(?) AND archived = 1",
        (now, category),
    )
    conn.commit()
    count = cursor.rowcount
    conn.close()
    return count


def get_analytics() -> dict:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM mistakes WHERE archived = 0").fetchall()
    conn.close()

    mistakes = [_row_to_dict(r) for r in rows]

    type_counts = {mt: 0 for mt in MISTAKE_TYPES}
    category_counts = {}
    subtopic_counts = {}

    for m in mistakes:
        mt = m.get("mistake_type", "Conceptual")
        if mt in type_counts:
            type_counts[mt] += 1
        else:
            type_counts[mt] = 1

        category = m.get("category", "").strip() or "Uncategorized"
        category_counts[category] = category_counts.get(category, 0) + 1

        subs = m.get("subtopics", [])
        if subs:
            for sub in subs:
                key = f"{category} - {sub}"
                subtopic_counts[key] = subtopic_counts.get(key, 0) + 1
        else:
            key = f"{category} - Unspecified"
            subtopic_counts[key] = subtopic_counts.get(key, 0) + 1

    sorted_categories = sorted(
        category_counts.items(), key=lambda x: x[1], reverse=True
    )
    sorted_subtopics = sorted(subtopic_counts.items(), key=lambda x: x[1], reverse=True)

    return {
        "total_mistakes": len(mistakes),
        "type_distribution": type_counts,
        "category_distribution": dict(sorted_categories[:10]),
        "subtopic_distribution": dict(sorted_subtopics[:10]),
        "most_common_type": max(type_counts.items(), key=lambda x: x[1])[0]
        if type_counts
        else None,
    }


# ── Demo seed data ───────────────────────────────────────────────────
#
# Real anonymized examples (text cleaned up for public display). The
# question/solution images live in demo/assets/ so both `seed_demo()`
# and the static demo build (build_demo.py) can use them without a DB.

DEMO_ASSETS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "demo", "assets"
)

_DEMO_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def demo_asset_bytes(filename: str | None) -> bytes | None:
    """Read a demo asset file, or None if it is missing."""
    if not filename:
        return None
    path = os.path.join(DEMO_ASSETS_DIR, os.path.basename(filename))
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def demo_asset_data_url(filename: str | None, fallback: bytes) -> str:
    """Return a data: URL for a demo asset, falling back to given bytes."""
    raw = demo_asset_bytes(filename)
    if raw is None:
        raw = fallback
        mime = "image/png"
    else:
        ext = os.path.splitext(filename or "")[1].lower()
        mime = _DEMO_MIME_TYPES.get(ext, "image/png")
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


def _placeholder_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Build a minimal solid-color PNG (no external dependencies)."""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    row = b"\x00" + bytes(rgb) * width
    raw = row * height
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


DEMO_MISTAKES = [
    {
        "category": "Linear Algebra",
        "subtopics": [],
        "concept": "det(A+B) ≠ det(A) + det(B)",
        "mistake_type": "Conceptual",
        "why_happened": "Assumed det(A+B) = det(A) + det(B), writing det(A+A) = 2·det(A). But for a 3×3 matrix, det(2A) = 2³·det(A) = 8·det(A).",
        "how_to_avoid": "The determinant splits linearly across one column at a time — expand column by column instead of splitting the whole matrix.",
        "demo_q": "det-linearity-q.png",
        "demo_s": "det-linearity-s.png",
    },
    {
        "category": "Linear Algebra",
        "subtopics": ["Rank"],
        "concept": "Rank of a matrix product",
        "mistake_type": "Conceptual",
        "why_happened": "New type of question — did not know that the rank of a product is bounded by the ranks of the factors.",
        "how_to_avoid": "Visualize rank loss through a product: rank(AB) ≤ min(rank(A), rank(B)).",
        "demo_q": "rank-product-q.png",
        "demo_s": "rank-product-s.png",
    },
    {
        "category": "Linear Algebra",
        "subtopics": ["Rank"],
        "concept": "Rank vs free parameter k",
        "mistake_type": "Silly/Careless",
        "why_happened": "Rushed the rank check — missed that two rows are clearly not multiples of each other, so the rank is at least 2 for any k.",
        "how_to_avoid": "Check for obviously independent rows first to pin down a minimum rank before chasing the parameter.",
        "demo_q": "rank-param-q.png",
        "demo_s": "rank-param-s.png",
    },
    {
        "category": "MLT",
        "subtopics": ["Perceptron"],
        "concept": "Reading sign patterns for separability",
        "mistake_type": "Misread Question",
        "why_happened": "Answered without analysing the sign conditions on the data points (x1·x2 > 0 and x1·y > 0).",
        "how_to_avoid": "Translate sign conditions into geometry first: x1·x2 > 0 puts points in quadrants I/III, and x1·y > 0 ties the label to the sign of x1.",
        "demo_q": "perceptron-signs-q.png",
        "demo_s": "perceptron-signs-s.png",
    },
    {
        "category": "MLF",
        "subtopics": ["Error"],
        "concept": "SSE for a constant predictor",
        "mistake_type": "Conceptual",
        "why_happened": "With the predicted line y = 2, SSE is the sum of (y − ŷ)² — computed the mean instead of the sum.",
        "how_to_avoid": "Check what is fitted (here only y, x is irrelevant) and whether the question asks for SSE or mean SSE.",
        "demo_q": "sse-constant-q.png",
        "demo_s": "sse-constant-s.png",
    },
    {
        "category": "MLT",
        "subtopics": ["Clustering K-Means"],
        "concept": "Splitting variance across principal axes",
        "mistake_type": "Conceptual",
        "why_happened": "Did not know how to split variance to minimize it.",
        "how_to_avoid": "Minimum variance spreads variance equally across the principal axes, so the corresponding eigenvalues should be equal.",
        "demo_q": "kmeans-variance-q.png",
        "demo_s": "kmeans-variance-s.png",
    },
]


def seed_demo(force: bool = False) -> bool:
    """Populate an empty database with sample mistakes for demos.

    Returns True if demo data was inserted.
    """
    conn = _get_conn()
    try:
        count = conn.execute("SELECT COUNT(*) AS n FROM mistakes").fetchone()["n"]
        if count and not force:
            return False

        os.makedirs(IMAGES_DIR, exist_ok=True)
        base_time = datetime.now()

        for i, entry in enumerate(DEMO_MISTAKES):
            # Prefer the real demo images; fall back to solid-color
            # placeholders when the assets are missing.
            q_bytes = demo_asset_bytes(entry.get("demo_q")) or _placeholder_png(
                320, 180, (59, 130, 246)
            )
            s_bytes = demo_asset_bytes(entry.get("demo_s")) or _placeholder_png(
                320, 180, (16, 185, 129)
            )
            q_ext = os.path.splitext(entry.get("demo_q") or "")[1] or ".png"
            s_ext = os.path.splitext(entry.get("demo_s") or "")[1] or ".png"
            q_name = f"{uuid.uuid4().hex[:16]}{q_ext}"
            s_name = f"{uuid.uuid4().hex[:16]}{s_ext}"
            with open(os.path.join(IMAGES_DIR, q_name), "wb") as f:
                f.write(q_bytes)
            with open(os.path.join(IMAGES_DIR, s_name), "wb") as f:
                f.write(s_bytes)

            subtopics = _parse_subtopics(entry["subtopics"])
            added_at = (base_time - timedelta(days=len(DEMO_MISTAKES) - i)).isoformat()
            conn.execute(
                """INSERT INTO mistakes
                   (id, category, subtopics, subtopic, concept, topic,
                    question_image, solution_image, mistake_type,
                    why_happened, how_to_avoid, date_added, date_modified)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(uuid.uuid4()),
                    entry["category"],
                    json.dumps(subtopics),
                    ", ".join(subtopics),
                    entry["concept"],
                    entry["category"],
                    f"/api/images/{q_name}",
                    f"/api/images/{s_name}",
                    entry["mistake_type"],
                    entry["why_happened"],
                    entry["how_to_avoid"],
                    added_at,
                    added_at,
                ),
            )
        conn.commit()
        return True
    finally:
        conn.close()
