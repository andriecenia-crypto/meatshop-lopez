"""Auth-related endpoints. Signup/login run client-side through Supabase Auth."""
from flask import Blueprint, g, jsonify, request

from backend.config import Config, get_supabase
from backend.routes import db_message, error, require_auth

auth_bp = Blueprint("auth", __name__, url_prefix="/api")


@auth_bp.get("/config")
def public_config():
    """Public values the browser needs to initialise the Supabase JS SDK (anon key only)."""
    return jsonify(
        {
            "supabase_url": Config.SUPABASE_URL,
            "supabase_anon_key": Config.SUPABASE_ANON_KEY,
            "currency": Config.CURRENCY,
            "shop_name": Config.SHOP_NAME,
        }
    )


@auth_bp.get("/auth/me")
@require_auth()
def me():
    return jsonify(g.user)


@auth_bp.put("/auth/profile")
@require_auth()
def update_profile():
    body = request.get_json(silent=True) or {}
    updates = {}
    if "full_name" in body:
        name = str(body["full_name"]).strip()
        if not name:
            return error("Enter your full name.")
        updates["full_name"] = name
    if "phone" in body:
        updates["phone"] = str(body["phone"]).strip() or None
    if not updates:
        return error("Nothing to update.")
    try:
        row = get_supabase().table("users").update(updates).eq("id", g.user["id"]).execute().data[0]
    except Exception as exc:
        return error(db_message(exc), 400)
    return jsonify(row)
