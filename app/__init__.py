from urllib.parse import urlsplit

from flask import Flask, jsonify, request


def _forbidden():
    return jsonify({"error": "Cross-site requests are not allowed."}), 403


def create_app():
    app = Flask(__name__, template_folder="../templates", static_folder="../static")

    # Backups can contain the database plus many uploaded images. Image
    # uploads have their own 16 MB limit in the upload route.
    app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024

    @app.errorhandler(413)
    def request_too_large(error):
        if request.path.startswith("/api/"):
            return jsonify({"error": "The uploaded file is too large."}), 413
        return "The uploaded file is too large.", 413

    @app.before_request
    def reject_cross_site_writes():
        # Multipart POSTs (upload, restore) are "simple" CORS requests, so any
        # website could otherwise send them to this local server.
        if request.method in {"GET", "HEAD", "OPTIONS"}:
            return None
        if request.headers.get("Sec-Fetch-Site") == "cross-site":
            return _forbidden()
        origin = request.headers.get("Origin")
        if origin and urlsplit(origin).netloc != request.host:
            return _forbidden()
        return None

    # Initialize database and directories
    from app.models import init_db
    init_db()

    from app.routes import bp
    app.register_blueprint(bp)

    return app
