import base64
import os
import uuid

from flask import Blueprint, render_template, request, jsonify, send_from_directory

from app import models

bp = Blueprint("main", __name__)

IMAGES_DIR = models.IMAGES_DIR


@bp.route("/")
def index():
    """Serve the main page."""
    return render_template("index.html", mistake_types=models.MISTAKE_TYPES)


@bp.route("/api/mistakes", methods=["GET"])
def get_mistakes():
    """Get all mistakes with optional filters."""
    category = request.args.get("category") or request.args.get("topic")
    subtopic = request.args.get("subtopic")
    mistake_type = request.args.get("mistake_type")
    archived_param = request.args.get("archived")

    archived = None
    if archived_param == "true":
        archived = True
    elif archived_param == "false":
        archived = False

    mistakes = models.get_all_mistakes(
        category=category,
        subtopic=subtopic,
        mistake_type=mistake_type,
        archived=archived,
    )
    return jsonify(mistakes)


@bp.route("/api/mistakes", methods=["POST"])
def add_mistake():
    """Add a new mistake."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    mistake = models.add_mistake(data)
    return jsonify(mistake), 201


@bp.route("/api/mistakes/<mistake_id>", methods=["GET"])
def get_mistake(mistake_id):
    """Get a single mistake by ID."""
    mistake = models.get_mistake_by_id(mistake_id)
    if mistake:
        return jsonify(mistake)
    return jsonify({"error": "Mistake not found"}), 404


@bp.route("/api/mistakes/<mistake_id>", methods=["PUT"])
def update_mistake(mistake_id):
    """Update an existing mistake."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    mistake = models.update_mistake(mistake_id, data)
    if mistake:
        return jsonify(mistake)
    return jsonify({"error": "Mistake not found"}), 404


@bp.route("/api/mistakes/<mistake_id>", methods=["DELETE"])
def delete_mistake(mistake_id):
    """Delete a mistake and its associated images."""
    if models.delete_mistake(mistake_id):
        return jsonify({"success": True})
    return jsonify({"error": "Mistake not found"}), 404


@bp.route("/api/mistakes/<mistake_id>/archive", methods=["PATCH"])
def archive_mistake(mistake_id):
    """Archive a mistake."""
    mistake = models.archive_mistake(mistake_id)
    if mistake:
        return jsonify(mistake)
    return jsonify({"error": "Mistake not found"}), 404


@bp.route("/api/mistakes/<mistake_id>/unarchive", methods=["PATCH"])
def unarchive_mistake(mistake_id):
    """Unarchive a mistake."""
    mistake = models.unarchive_mistake(mistake_id)
    if mistake:
        return jsonify(mistake)
    return jsonify({"error": "Mistake not found"}), 404


@bp.route("/api/mistakes/archive-category", methods=["POST"])
def archive_category():
    """Archive all mistakes in a category."""
    data = request.get_json()
    if not data or not data.get("category"):
        return jsonify({"error": "Category is required"}), 400
    count = models.archive_category(data["category"])
    return jsonify({"archived": count})


@bp.route("/api/mistakes/unarchive-category", methods=["POST"])
def unarchive_category():
    """Unarchive all mistakes in a category."""
    data = request.get_json()
    if not data or not data.get("category"):
        return jsonify({"error": "Category is required"}), 400
    count = models.unarchive_category(data["category"])
    return jsonify({"unarchived": count})


@bp.route("/api/categories", methods=["GET"])
def get_categories():
    """Get all unique categories."""
    archived_param = request.args.get("archived")
    archived = None
    if archived_param == "true":
        archived = True
    elif archived_param == "false":
        archived = False
    categories = models.get_all_categories(archived=archived)
    return jsonify(categories)


@bp.route("/api/subtopics", methods=["GET"])
def get_subtopics():
    """Get all unique subtopics, optionally filtered by category."""
    category = request.args.get("category") or request.args.get("topic")
    archived_param = request.args.get("archived")
    archived = None
    if archived_param == "true":
        archived = True
    elif archived_param == "false":
        archived = False
    subtopics = models.get_all_subtopics(category=category, archived=archived)
    return jsonify(subtopics)


@bp.route("/api/topics", methods=["GET"])
def get_topics():
    """Backward-compatible alias for categories."""
    archived_param = request.args.get("archived")
    archived = None
    if archived_param == "true":
        archived = True
    elif archived_param == "false":
        archived = False
    topics = models.get_all_categories(archived=archived)
    return jsonify(topics)


@bp.route("/api/analytics", methods=["GET"])
def get_analytics():
    """Get analytics data."""
    analytics = models.get_analytics()
    return jsonify(analytics)


@bp.route("/api/mistake-types", methods=["GET"])
def get_mistake_types():
    """Get all predefined mistake types."""
    return jsonify(models.MISTAKE_TYPES)


# ── Image upload / serve ─────────────────────────────────────────────


@bp.route("/api/upload", methods=["POST"])
def upload_image():
    """Upload an image via file upload or base64 JSON payload.

    Accepts either:
      - multipart/form-data with 'file' field
      - JSON body with {"image": "data:image/png;base64,..."}

    Returns: {"url": "/api/images/<filename>"}
    """
    os.makedirs(IMAGES_DIR, exist_ok=True)

    # Method 1: File upload (multipart)
    if "file" in request.files:
        file = request.files["file"]
        if file.filename == "":
            return jsonify({"error": "No file selected"}), 400

        ext = _get_extension(file.content_type or "image/png")
        filename = f"{uuid.uuid4().hex[:16]}.{ext}"
        filepath = os.path.join(IMAGES_DIR, filename)
        file.save(filepath)
        return jsonify({"url": f"/api/images/{filename}"})

    # Method 2: Base64 JSON payload
    data = request.get_json(silent=True)
    if data and data.get("image"):
        image_data = data["image"]
        if not image_data.startswith("data:image"):
            return jsonify({"error": "Invalid image data"}), 400

        header, payload = image_data.split(",", 1)
        ext = _get_extension_from_header(header)
        filename = f"{uuid.uuid4().hex[:16]}.{ext}"
        filepath = os.path.join(IMAGES_DIR, filename)

        with open(filepath, "wb") as f:
            f.write(base64.b64decode(payload))

        return jsonify({"url": f"/api/images/{filename}"})

    return jsonify({"error": "No image provided"}), 400


@bp.route("/api/images/<filename>", methods=["GET"])
def serve_image(filename):
    """Serve an image file from the images directory."""
    return send_from_directory(IMAGES_DIR, filename)


def _get_extension(content_type: str) -> str:
    mapping = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    return mapping.get(content_type, "png")


def _get_extension_from_header(header: str) -> str:
    if "jpeg" in header or "jpg" in header:
        return "jpg"
    if "webp" in header:
        return "webp"
    if "gif" in header:
        return "gif"
    return "png"
