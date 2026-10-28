"""Create and restore portable Mistracker data archives."""

import json
import os
import shutil
import sqlite3
import stat
import tempfile
import zipfile
from datetime import datetime
from pathlib import PurePosixPath
from urllib.parse import quote

from app import models

BACKUP_FORMAT = "mistracker-backup"
BACKUP_VERSION = 1
MAX_ARCHIVE_ENTRIES = 20_000
MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024
MAX_ENTRY_BYTES = 1024 * 1024 * 1024

_REQUIRED_COLUMNS = {
    "id",
    "category",
    "subtopics",
    "subtopic",
    "concept",
    "topic",
    "question_image",
    "solution_image",
    "mistake_type",
    "why_happened",
    "how_to_avoid",
    "date_added",
    "date_modified",
    "archived",
}


class BackupError(ValueError):
    """Raised when an uploaded backup cannot safely be restored."""


def create_backup_archive(destination: str) -> None:
    """Write a consistent SQLite snapshot and all image files into a ZIP."""
    os.makedirs(os.path.dirname(os.path.abspath(destination)), exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mistracker-backup-") as temp_dir:
        db_snapshot = os.path.join(temp_dir, "mistracker.db")
        source = sqlite3.connect(models.DB_FILE)
        target = sqlite3.connect(db_snapshot)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()

        manifest = {
            "format": BACKUP_FORMAT,
            "version": BACKUP_VERSION,
            "created_at": datetime.now().astimezone().isoformat(),
        }
        with zipfile.ZipFile(
            destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6
        ) as archive:
            archive.write(db_snapshot, "mistracker.db")
            archive.writestr("manifest.json", json.dumps(manifest, indent=2))
            if os.path.isdir(models.IMAGES_DIR):
                for name in sorted(os.listdir(models.IMAGES_DIR)):
                    path = os.path.join(models.IMAGES_DIR, name)
                    if os.path.isfile(path) and not os.path.islink(path):
                        archive.write(path, f"images/{name}")


def restore_backup_archive(source, backup_dir: str) -> str:
    """Validate and install a backup, retaining a pre-restore archive.

    Returns the name of the safety archive written before replacing current
    data. Extraction is staged beside the live files so the final renames stay
    on one filesystem.
    """
    data_dir = os.path.dirname(models.DB_FILE)
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(backup_dir, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix=".mistracker-restore-", dir=data_dir
    ) as stage:
        staged_db, staged_images = _extract_and_validate(source, stage)
        timestamp = datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")
        safety_name = f"mistracker-before-restore-{timestamp}.zip"
        safety_path = os.path.join(backup_dir, safety_name)
        suffix = 1
        while os.path.exists(safety_path):
            safety_name = f"mistracker-before-restore-{timestamp}-{suffix}.zip"
            safety_path = os.path.join(backup_dir, safety_name)
            suffix += 1
        create_backup_archive(safety_path)
        _install_staged_files(staged_db, staged_images, stage)
    return safety_name


def _extract_and_validate(source, stage: str) -> tuple[str, str]:
    staged_db = os.path.join(stage, "mistracker.db")
    staged_images = os.path.join(stage, "images")
    os.makedirs(staged_images)
    try:
        archive = zipfile.ZipFile(source)
    except (OSError, zipfile.BadZipFile) as exc:
        raise BackupError("That file is not a valid Mistracker backup ZIP.") from exc

    with archive:
        infos = archive.infolist()
        if len(infos) > MAX_ARCHIVE_ENTRIES:
            raise BackupError("The backup contains too many files.")

        names = set()
        total_size = 0
        db_info = None
        manifest_info = None
        image_infos = []
        for info in infos:
            name = info.filename
            if name in names:
                raise BackupError("The backup contains duplicate file names.")
            names.add(name)
            if info.is_dir() or stat.S_ISLNK(info.external_attr >> 16):
                raise BackupError("The backup contains an unsupported file entry.")
            if info.file_size > MAX_ENTRY_BYTES:
                raise BackupError("A file in the backup is too large.")
            total_size += info.file_size
            if total_size > MAX_UNPACKED_BYTES:
                raise BackupError("The uncompressed backup is too large.")

            if name == "mistracker.db":
                db_info = info
            elif name == "manifest.json":
                manifest_info = info
            elif name.startswith("images/"):
                relative = PurePosixPath(name)
                if (
                    len(relative.parts) != 2
                    or relative.parts[0] != "images"
                    or relative.as_posix() != name
                    or relative.parts[1] in {"", ".", ".."}
                    or "\\" in relative.parts[1]
                ):
                    raise BackupError("The backup contains an unsafe image path.")
                image_infos.append(info)
            else:
                raise BackupError("The backup contains an unsupported file.")

        if db_info is None or manifest_info is None:
            raise BackupError("The backup is missing its database or manifest.")
        if manifest_info.file_size > 64 * 1024:
            raise BackupError("The backup manifest is invalid.")
        try:
            manifest = json.loads(archive.read(manifest_info))
        except (
            UnicodeDecodeError,
            json.JSONDecodeError,
            OSError,
            zipfile.BadZipFile,
            RuntimeError,
        ) as exc:
            raise BackupError("The backup manifest is invalid.") from exc
        if (
            not isinstance(manifest, dict)
            or manifest.get("format") != BACKUP_FORMAT
            or manifest.get("version") != BACKUP_VERSION
        ):
            raise BackupError("This backup format is not supported.")

        for info, destination in [
            (db_info, staged_db),
            *[
                (info, os.path.join(staged_images, PurePosixPath(info.filename).name))
                for info in image_infos
            ],
        ]:
            try:
                with archive.open(info) as zipped, open(destination, "wb") as output:
                    shutil.copyfileobj(zipped, output)
            except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
                raise BackupError("A file in the backup could not be read.") from exc

    _validate_database(staged_db)
    return staged_db, staged_images


def _validate_database(path: str) -> None:
    uri = f"file:{quote(os.path.abspath(path))}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
        try:
            checks = conn.execute("PRAGMA quick_check").fetchall()
            if len(checks) != 1 or checks[0][0] != "ok":
                raise BackupError("The backup database failed its integrity check.")
            columns = {
                row[1] for row in conn.execute("PRAGMA table_info(mistakes)").fetchall()
            }
            if not _REQUIRED_COLUMNS.issubset(columns):
                raise BackupError("The backup database does not match this app.")
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        raise BackupError("The backup database could not be opened.") from exc


def _install_staged_files(staged_db: str, staged_images: str, stage: str) -> None:
    current_db = models.DB_FILE
    current_images = models.IMAGES_DIR
    previous_dir = os.path.join(stage, "previous")
    os.makedirs(previous_dir)
    moved = []
    installed = []

    # Checkpoint existing WAL writes before changing the database file.
    if os.path.exists(current_db):
        conn = sqlite3.connect(current_db)
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            conn.close()

    try:
        for path in (
            current_db,
            f"{current_db}-wal",
            f"{current_db}-shm",
            current_images,
        ):
            if os.path.exists(path):
                saved = os.path.join(previous_dir, os.path.basename(path))
                os.replace(path, saved)
                moved.append((path, saved))

        os.replace(staged_db, current_db)
        installed.append(current_db)
        os.replace(staged_images, current_images)
        installed.append(current_images)
    except OSError:
        for path in reversed(installed):
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            elif os.path.exists(path):
                os.remove(path)
        for original, saved in reversed(moved):
            if os.path.exists(saved):
                os.replace(saved, original)
        raise
