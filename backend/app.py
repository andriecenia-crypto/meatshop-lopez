"""PrimeCut Flask application factory. Serves the API and the static frontend."""
import logging
import os

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from backend.config import Config
from backend.routes.admin_routes import admin_bp
from backend.routes.auth_routes import auth_bp
from backend.routes.order_routes import order_bp
from backend.routes.product_routes import product_bp

FRONTEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def create_app() -> Flask:
    app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="")
    app.config.from_object(Config)
    CORS(app, resources={r"/api/*": {"origins": Config.CORS_ORIGINS}})

    for bp in (auth_bp, product_bp, order_bp, admin_bp):
        app.register_blueprint(bp)

    @app.get("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "primecut"})

    @app.errorhandler(404)
    def not_found(_):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Endpoint not found."}), 404
        return send_from_directory(FRONTEND_DIR, "index.html"), 404

    @app.errorhandler(500)
    def server_error(exc):
        logging.getLogger("primecut").exception("Unhandled error: %s", exc)
        return jsonify({"error": "Something went wrong on our side. Try again."}), 500

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG") == "1")
