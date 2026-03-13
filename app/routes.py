from flask import Blueprint, render_template, request, jsonify
from app import models

bp = Blueprint("main", __name__)


@bp.route("/")
def index():
    """Serve the main page."""
    return render_template("index.html", mistake_types=models.MISTAKE_TYPES)


@bp.route("/api/mistakes", methods=["GET"])
def get_mistakes():
    """Get all mistakes with optional filters."""
    category = request.args.get("category")
    if not category:
        category = request.args.get("topic")
    subtopic = request.args.get("subtopic")
    mistake_type = request.args.get("mistake_type")

    mistakes = models.get_all_mistakes(
        category=category, subtopic=subtopic, mistake_type=mistake_type
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
    """Delete a mistake."""
    if models.delete_mistake(mistake_id):
        return jsonify({"success": True})
    return jsonify({"error": "Mistake not found"}), 404


@bp.route("/api/categories", methods=["GET"])
def get_categories():
    """Get all unique categories."""
    categories = models.get_all_categories()
    return jsonify(categories)


@bp.route("/api/subtopics", methods=["GET"])
def get_subtopics():
    """Get all unique subtopics, optionally filtered by category."""
    category = request.args.get("category")
    if not category:
        category = request.args.get("topic")
    subtopics = models.get_all_subtopics(category=category)
    return jsonify(subtopics)


@bp.route("/api/topics", methods=["GET"])
def get_topics():
    """Backward-compatible alias for categories."""
    topics = models.get_all_categories()
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
