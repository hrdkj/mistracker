from flask import Flask
import os


def create_app():
    app = Flask(__name__, template_folder="../templates", static_folder="../static")

    # Set max upload size to 16MB
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

    # Initialize database and directories
    from app.models import init_db
    init_db()

    from app.routes import bp
    app.register_blueprint(bp)

    return app
