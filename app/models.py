import json
import os
import sqlite3
import uuid
from datetime import datetime
from typing import Optional

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_FILE = os.path.join(DATA_DIR, "mistraker.db")
IMAGES_DIR = os.path.join(DATA_DIR, "images")

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
    date_modified TEXT NOT NULL DEFAULT ''
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


def _normalized_text(value: Optional[str]) -> str:
    if not value:
        return ""
    return str(value).strip()


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
    category: Optional[str] = None,
    subtopic: Optional[str] = None,
    mistake_type: Optional[str] = None,
) -> list[dict]:
    """Get all mistakes, optionally filtered."""
    conn = _get_conn()
    query = "SELECT * FROM mistakes WHERE 1=1"
    params: list = []

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

    # Subtopic filtering needs JSON list parsing, do in Python
    if subtopic:
        subtopic_lower = subtopic.lower()
        results = [
            m
            for m in results
            if subtopic_lower in [s.lower() for s in m.get("subtopics", [])]
        ]

    return results


def get_mistake_by_id(mistake_id: str) -> Optional[dict]:
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
            data.get("question_image", ""),
            data.get("solution_image", ""),
            data.get("mistake_type", "Conceptual"),
            data.get("why_happened", "").strip(),
            data.get("how_to_avoid", "").strip(),
            now,
            now,
        ),
    )
    conn.commit()
    conn.close()

    return get_mistake_by_id(new_id)


def update_mistake(mistake_id: str, data: dict) -> Optional[dict]:
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

    concept = _normalized_text(data["concept"]) if "concept" in data else existing["concept"]
    question_image = data.get("question_image", existing["question_image"])
    solution_image = data.get("solution_image", existing["solution_image"])
    mistake_type = data.get("mistake_type", existing["mistake_type"])
    why_happened = data["why_happened"].strip() if "why_happened" in data else existing["why_happened"]
    how_to_avoid = data["how_to_avoid"].strip() if "how_to_avoid" in data else existing["how_to_avoid"]

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


def get_all_categories() -> list[str]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT DISTINCT category FROM mistakes WHERE category != '' ORDER BY category"
    ).fetchall()
    conn.close()
    return [r["category"] for r in rows]


def get_all_subtopics(category: Optional[str] = None) -> list[str]:
    conn = _get_conn()
    if category:
        rows = conn.execute(
            "SELECT subtopics FROM mistakes WHERE LOWER(category) = LOWER(?)",
            (category,),
        ).fetchall()
    else:
        rows = conn.execute("SELECT subtopics FROM mistakes").fetchall()
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

    return sorted(list(all_subtopics))


def get_analytics() -> dict:
    conn = _get_conn()
    rows = conn.execute("SELECT * FROM mistakes").fetchall()
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

    sorted_categories = sorted(category_counts.items(), key=lambda x: x[1], reverse=True)
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
