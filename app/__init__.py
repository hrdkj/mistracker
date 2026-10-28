from flask import Flask, jsonify, request


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

    # Initialize database and directories
    from app.models import init_db
    init_db()

    from app.routes import bp
    app.register_blueprint(bp)

    return app
