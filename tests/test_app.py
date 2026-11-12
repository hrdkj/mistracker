"""Real Flask/SQLite regression tests. Run: uv run python -m unittest discover -s tests -v"""

import base64
import io
import json
import os
import sqlite3
import tempfile
import unittest
import zipfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from app import create_app


class AppTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {"MISTRACKER_DATA_DIR": str(self.root)}).start()
        from app import models, routes

        self.models = models
        for name, value in {
            "DATA_DIR": str(self.root),
            "DB_FILE": str(self.root / "mistracker.db"),
            "IMAGES_DIR": str(self.root / "images"),
        }.items():
            patch.object(models, name, value).start()
        patch.object(routes, "IMAGES_DIR", models.IMAGES_DIR).start()
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def add(self, **fields):
        data = {
            "category": "Math",
            "why_happened": "Skipped a step",
            "how_to_avoid": "Check each step",
            **fields,
        }
        response = self.client.post("/api/mistakes", json=data)
        self.assertEqual(response.status_code, 201, response.json)
        return response.json

    def review(self, mistake, outcome="solved"):
        return self.client.post(
            f"/api/mistakes/{mistake['id']}/reviews", json={"outcome": outcome}
        )

    def due(self):
        response = self.client.get("/api/reviews/due")
        self.assertEqual(response.status_code, 200)
        return response.json

    def history(self, mistake):
        return self.client.get(f"/api/mistakes/{mistake['id']}/reviews").json

    def backup(self):
        with self.client.get("/api/backup") as response:
            self.assertEqual(response.status_code, 200)
            return response.data

    def restore(self, content):
        return self.client.post(
            "/api/restore", data={"backup": (io.BytesIO(content), "backup.zip")}
        )

    def test_validation_rejects_bad_shapes_and_required_fields(self):
        invalid = [
            None,
            [],
            ["bad"],
            "bad",
            1,
            {},
            {"category": " "},
            {"category": "Math", "why_happened": "", "how_to_avoid": "x"},
            {"category": "Math", "why_happened": "x", "how_to_avoid": " "},
        ]
        for value in invalid:
            with self.subTest(value=value):
                response = self.client.post("/api/mistakes", json=value)
                self.assertEqual(response.status_code, 400)
                self.assertIn("error", response.json)
        self.assertEqual(self.client.get("/api/mistakes").json, [])

    def test_validation_types_and_failed_update_preserve_row(self):
        mistake = self.add()
        for fields in [
            {"why_happened": None},
            {"question_image": []},
            {"category": " "},
            {"subtopics": [1]},
            {"subtopics": {}},
            {"mistake_type": "unknown"},
        ]:
            with self.subTest(fields=fields):
                response = self.client.put(
                    f"/api/mistakes/{mistake['id']}", json=fields
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(
                    self.client.get(f"/api/mistakes/{mistake['id']}").json, mistake
                )

    def test_malformed_json_and_bulk_archive_shape(self):
        for path in [
            "/api/mistakes",
            "/api/mistakes/archive-category",
            "/api/mistakes/unarchive-category",
        ]:
            response = self.client.post(path, data="{", content_type="application/json")
            self.assertEqual(response.status_code, 400)
            response = self.client.post(path, json=["bad"])
            self.assertEqual(response.status_code, 400)

    def test_crud_filters_and_archive(self):
        mistake = self.add(subtopics=["Rank", "rank", " Basis "], concept="Matrix")
        self.assertEqual(mistake["subtopics"], ["Rank", "Basis"])
        self.assertEqual(
            len(self.client.get("/api/mistakes?category=math&subtopic=RANK").json), 1
        )
        self.assertEqual(self.client.get("/api/mistakes?subtopic=none").json, [])
        result = self.client.put(
            f"/api/mistakes/{mistake['id']}", json={"concept": "New concept"}
        )
        self.assertEqual(result.json["why_happened"], mistake["why_happened"])
        self.assertEqual(result.json["concept"], "New concept")
        self.client.post("/api/mistakes/archive-category", json={"category": "math"})
        self.assertEqual(self.client.get("/api/mistakes?archived=false").json, [])
        self.client.post("/api/mistakes/unarchive-category", json={"category": "MATH"})
        self.assertEqual(len(self.client.get("/api/mistakes?archived=false").json), 1)
        self.assertEqual(
            self.client.delete(f"/api/mistakes/{mistake['id']}").status_code, 200
        )
        self.assertEqual(
            self.client.get(f"/api/mistakes/{mistake['id']}").status_code, 404
        )

    def test_legacy_topic_alias(self):
        response = self.client.post(
            "/api/mistakes",
            json={
                "topic": "Algebra",
                "subtopic": "Rank",
                "why_happened": "Forgot",
                "how_to_avoid": "Practice",
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json["category"], "Algebra")
        self.assertEqual(self.client.get("/api/topics").json, ["Algebra"])

    def test_optional_source_link_can_be_updated_and_cleared(self):
        url = "http://127.0.0.1:3000/session/1?tab=notes#problem"
        mistake = self.add(source_url=f"  {url}  ")
        endpoint = f"/api/mistakes/{mistake['id']}"
        self.assertEqual(mistake["source_url"], url)
        self.assertEqual(self.due()["mistakes"][0]["source_url"], url)
        for invalid in (None, "javascript:alert(1)", "file:///notes.html", "https://"):
            self.assertEqual(self.client.put(endpoint, json={"source_url": invalid}).status_code, 400)
        self.assertEqual(
            self.client.put(endpoint, json={"concept": "Revised"}).json["source_url"], url
        )
        self.assertEqual(self.client.put(endpoint, json={"source_url": ""}).json["source_url"], "")

    def test_upload_serve_and_delete(self):
        raw = self.models._placeholder_png(2, 2, (0, 0, 0))
        response = self.client.post(
            "/api/upload", data={"file": (io.BytesIO(raw), "test.png")}
        )
        self.assertEqual(response.status_code, 200)
        url = response.json["url"]
        with self.client.get(url) as served:
            self.assertEqual(served.data, raw)
        mistake = self.add(question_image=url)
        self.client.delete(f"/api/mistakes/{mistake['id']}")
        self.assertEqual(self.client.get(url).status_code, 404)
        encoded = "data:image/png;base64," + base64.b64encode(raw).decode()
        self.assertEqual(
            self.client.post("/api/upload", json={"image": encoded}).status_code, 200
        )
        for body in [[], {"image": 1}, {"image": "data:image/png;base64,!!!"}]:
            self.assertEqual(
                self.client.post("/api/upload", json=body).status_code, 400
            )

    def test_upload_size_limit(self):
        response = self.client.post(
            "/api/upload",
            data={"file": (io.BytesIO(b"x" * (16 * 1024 * 1024)), "big.png")},
        )
        response.request.environ["wsgi.input"].close()
        self.assertEqual(response.status_code, 413)
        self.assertIn("error", response.json)

    def test_reviews_schedule_all_outcomes_and_persist(self):
        for outcome, interval in [("missed", 1), ("struggled", 3), ("solved", 7)]:
            mistake = self.add(concept=outcome)
            self.assertIn(mistake["id"], [m["id"] for m in self.due()["mistakes"]])
            response = self.review(mistake, outcome)
            self.assertEqual(response.status_code, 201)
            self.assertEqual(
                response.json["next_review_date"],
                (date.today() + timedelta(days=interval)).isoformat(),
            )
            self.assertEqual(self.history(mistake)[0]["outcome"], outcome)
            self.assertNotIn(mistake["id"], [m["id"] for m in self.due()["mistakes"]])
        self.assertEqual(
            self.due()["next_due_date"], (date.today() + timedelta(days=1)).isoformat()
        )
        self.assertEqual(
            len(
                create_app()
                .test_client()
                .get(f"/api/mistakes/{mistake['id']}/reviews")
                .json
            ),
            1,
        )

    def test_review_due_boundary_growth_and_reset(self):
        mistake = self.add()
        today = date.today()
        for index, (outcome, interval) in enumerate(
            [
                ("solved", 7),
                ("solved", 14),
                ("solved", 28),
                ("solved", 30),
                ("missed", 1),
                ("solved", 7),
                ("struggled", 3),
            ]
        ):

            with patch("app.reviews.date") as review_clock:
                review_clock.today.return_value = today
                self.assertEqual(len(self.due()["mistakes"]), 1)
                response = self.review(mistake, outcome)
                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json["interval_days"], interval)
                self.assertEqual(self.review(mistake, outcome).status_code, 409)
            today += timedelta(days=interval)
        self.assertEqual(len(self.history(mistake)), index + 1)

    def test_archiving_is_separate_from_review_history(self):
        mistake = self.add()
        self.client.patch(f"/api/mistakes/{mistake['id']}/archive")
        self.assertEqual(self.due()["mistakes"], [])
        self.assertEqual(self.review(mistake).status_code, 409)
        self.client.patch(f"/api/mistakes/{mistake['id']}/unarchive")
        self.assertEqual(len(self.due()["mistakes"]), 1)
        self.review(mistake)
        self.client.patch(f"/api/mistakes/{mistake['id']}/archive")
        self.assertEqual(len(self.history(mistake)), 1)
        self.client.patch(f"/api/mistakes/{mistake['id']}/unarchive")
        self.assertEqual(self.due()["mistakes"], [])
        self.client.delete(f"/api/mistakes/{mistake['id']}")
        with closing(sqlite3.connect(self.models.DB_FILE)) as conn:
            self.assertEqual(
                conn.execute("SELECT COUNT(*) FROM reviews").fetchone()[0], 0
            )

    def test_review_validation_and_missing_ids(self):
        mistake = self.add()
        for data in [None, [], {}, {"outcome": "bad"}, {"outcome": {}}]:
            response = self.client.post(
                f"/api/mistakes/{mistake['id']}/reviews", json=data
            )
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.review({"id": "missing"}).status_code, 404)
        self.assertEqual(
            self.client.get("/api/mistakes/missing/reviews").status_code, 404
        )

    def test_concurrent_reviews_only_record_once(self):
        mistake = self.add()

        def submit(_):
            with self.app.test_client() as client:
                return client.post(
                    f"/api/mistakes/{mistake['id']}/reviews", json={"outcome": "solved"}
                ).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(submit, range(2))), [201, 409])
        self.assertEqual(len(self.history(mistake)), 1)

    def test_backup_round_trip_includes_images_and_review_history(self):
        image = self.root / "images" / "example.png"
        image.write_bytes(self.models._placeholder_png(2, 2, (0, 0, 0)))
        source_url = "https://example.com/assignment#problem-2"
        mistake = self.add(question_image="/api/images/example.png", source_url=source_url)
        attempt = self.review(mistake).json
        content = self.backup()
        self.client.delete(f"/api/mistakes/{mistake['id']}")
        replacement = self.add(concept="new")
        result = self.restore(content)
        self.assertEqual(result.status_code, 200, result.json)
        self.assertTrue(image.exists())
        self.assertEqual(self.history(mistake), [attempt])
        self.assertEqual(self.client.get(f"/api/mistakes/{mistake['id']}").json["source_url"], source_url)
        self.assertEqual(
            self.client.get(f"/api/mistakes/{replacement['id']}").status_code, 404
        )
        safety = self.root / "backups" / result.json["safety_backup"]
        self.assertTrue(safety.exists())
        self.assertEqual(self.restore(safety.read_bytes()).status_code, 200)
        self.assertEqual(
            self.client.get(f"/api/mistakes/{replacement['id']}").status_code, 200
        )

    def test_legacy_backup_gets_new_schema_without_restart(self):
        mistake = self.add()
        self.review(mistake)
        original = self.backup()
        legacy_db = self.root / "legacy.db"
        with zipfile.ZipFile(io.BytesIO(original)) as source:
            legacy_db.write_bytes(source.read("mistracker.db"))
        with closing(sqlite3.connect(legacy_db)) as conn:
            conn.execute("DROP TABLE reviews")
            conn.execute("ALTER TABLE mistakes DROP COLUMN source_url")
            conn.commit()
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            archive.write(legacy_db, "mistracker.db")
            archive.writestr(
                "manifest.json",
                json.dumps({"format": "mistracker-backup", "version": 1}),
            )
        self.assertEqual(self.restore(out.getvalue()).status_code, 200)
        self.assertEqual(len(self.due()["mistakes"]), 1)
        self.assertEqual(self.due()["mistakes"][0]["source_url"], "")
        source_url = "https://example.com/lesson"
        result = self.client.put(f"/api/mistakes/{mistake['id']}", json={"source_url": source_url})
        self.assertEqual(result.json["source_url"], source_url)
        self.assertEqual(self.history(mistake), [])
        self.assertEqual(self.review(mistake).status_code, 201)

    def test_rejected_restore_preserves_database_and_history(self):
        mistake = self.add()
        self.review(mistake)
        for content in [b"not a zip", self.unsafe_archive()]:
            response = self.restore(content)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(
                self.client.get(f"/api/mistakes/{mistake['id']}").json, mistake
            )
            self.assertEqual(len(self.history(mistake)), 1)

    def unsafe_archive(self):
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as archive:
            archive.writestr("images/../../bad", "bad")
        return out.getvalue()

    def test_failed_restore_install_rolls_back(self):
        original = self.add(concept="backup")
        content = self.backup()
        current = self.add(concept="current")
        self.review(current)
        real_replace = os.replace

        def fail_on_images(source, destination):
            if (
                str(source).endswith("/images")
                and "/.mistracker-restore-" in str(source)
                and "/previous/" not in str(source)
            ):
                raise OSError("simulated disk failure")
            return real_replace(source, destination)

        with patch("app.backup.os.replace", side_effect=fail_on_images):
            response = self.restore(content)
        self.assertEqual(response.status_code, 500)
        self.assertEqual(len(self.history(current)), 1)
        self.assertEqual(
            self.client.get(f"/api/mistakes/{original['id']}").status_code, 200
        )
        self.assertEqual(
            self.client.get(f"/api/mistakes/{current['id']}").status_code, 200
        )


if __name__ == "__main__":
    unittest.main()
