"""Shared helpers for route modules: auth decorator, errors, input parsing."""
import logging
from functools import wraps

from flask import g, jsonify, request

from backend.config import get_supabase

log = logging.getLogger("primecut.auth")

STAFF = ("admin", "staff")


def error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def db_message(exc: Exception) -> str:
    """Pull a readable message out of a PostgREST/Postgres exception."""
    return getattr(exc, "message", None) or str(exc)


def number(value, field: str, allow_zero: bool = False) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a number.")
    if parsed < 0 or (parsed == 0 and not allow_zero):
        raise ValueError(f"{field} must be {'0 or more' if allow_zero else 'greater than 0'}.")
    return parsed


def require_auth(*roles):
    """Verify the Supabase JWT, load the profile into g.user, optionally restrict by role."""

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            header = request.headers.get("Authorization", "")
            if not header.startswith("Bearer "):
                return error("Sign in to continue.", 401)
            token = header[7:].strip()
            sb = get_supabase()
            try:
                auth_user = sb.auth.get_user(token).user
            except Exception:
                auth_user = None
            if not auth_user:
                return error("Your session expired. Sign in again.", 401)

            rows = sb.table("users").select("*").eq("id", auth_user.id).limit(1).execute().data
            if rows:
                profile = rows[0]
            else:  # trigger missed (e.g. user created before schema); create the profile now
                meta = auth_user.user_metadata or {}
                profile = (
                    sb.table("users")
                    .insert(
                        {
                            "id": auth_user.id,
                            "email": auth_user.email,
                            "full_name": meta.get("full_name", ""),
                            "phone": meta.get("phone"),
                        }
                    )
                    .execute()
                    .data[0]
                )
            if roles and profile["role"] not in roles:
                return error("You don't have access to this.", 403)
            g.user = profile
            return fn(*args, **kwargs)

        return wrapper

    return decorator
