"""Review history and a calendar-day review queue for active mistakes."""

from datetime import UTC, date, datetime, timedelta

from app import models

OUTCOMES = ("solved", "struggled", "missed")


def init_schema(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mistake_id TEXT NOT NULL REFERENCES mistakes(id) ON DELETE CASCADE,
            outcome TEXT NOT NULL CHECK (outcome IN ('solved', 'struggled', 'missed')),
            reviewed_at TEXT NOT NULL,
            next_review_date TEXT NOT NULL,
            interval_days INTEGER NOT NULL
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_reviews_mistake ON reviews (mistake_id, id)"
    )


def get_due():
    today = date.today().isoformat()
    conn = models._get_conn()
    try:
        rows = conn.execute("""
            SELECT m.*, r.outcome AS last_outcome, r.next_review_date,
                   (SELECT COUNT(*) FROM reviews WHERE mistake_id = m.id) AS review_count
            FROM mistakes m
            LEFT JOIN reviews r ON r.id = (
                SELECT MAX(id) FROM reviews WHERE mistake_id = m.id
            )
            WHERE m.archived = 0
            ORDER BY COALESCE(r.next_review_date, ''), m.date_added, m.id
        """).fetchall()
        due = [
            models._row_to_dict(r)
            for r in rows
            if not r["next_review_date"] or r["next_review_date"] <= today
        ]
        upcoming = [
            r["next_review_date"]
            for r in rows
            if r["next_review_date"] and r["next_review_date"] > today
        ]
        return {"mistakes": due, "next_due_date": min(upcoming, default=None)}
    finally:
        conn.close()


def get_history(mistake_id):
    conn = models._get_conn()
    try:
        return [
            dict(row)
            for row in conn.execute(
                "SELECT * FROM reviews WHERE mistake_id = ? ORDER BY id DESC",
                (mistake_id,),
            )
        ]
    finally:
        conn.close()


def record(mistake_id, outcome):
    """Commit an attempt once; reject archived or already-scheduled cards."""
    conn = models._get_conn()
    try:
        # Serialize the due check and insertion, including across browser tabs.
        conn.execute("BEGIN IMMEDIATE")
        mistake = conn.execute(
            "SELECT archived FROM mistakes WHERE id = ?", (mistake_id,)
        ).fetchone()
        if mistake is None:
            return None
        if mistake["archived"]:
            raise ValueError("This mistake is archived. Refresh the review queue.")
        previous = conn.execute(
            "SELECT * FROM reviews WHERE mistake_id = ? ORDER BY id DESC LIMIT 1",
            (mistake_id,),
        ).fetchone()
        today = date.today()
        if previous and previous["next_review_date"] > today.isoformat():
            raise ValueError("This review is already saved. Refresh the review queue.")
        interval = {"missed": 1, "struggled": 3, "solved": 7}[outcome]
        if outcome == "solved" and previous and previous["outcome"] == "solved":
            interval = min(30, previous["interval_days"] * 2)
        cursor = conn.execute(
            """INSERT INTO reviews
               (mistake_id, outcome, reviewed_at, next_review_date, interval_days)
               VALUES (?, ?, ?, ?, ?)""",
            (
                mistake_id,
                outcome,
                datetime.now(UTC).isoformat(),
                (today + timedelta(days=interval)).isoformat(),
                interval,
            ),
        )
        result = dict(
            conn.execute(
                "SELECT * FROM reviews WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
        )
        conn.commit()
        return result
    finally:
        conn.close()
