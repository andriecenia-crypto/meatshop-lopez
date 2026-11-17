"""Categories and products. Reads are public; writes need staff/admin."""
from flask import Blueprint, jsonify, request

from backend.config import get_supabase
from backend.routes import STAFF, db_message, error, number, require_auth

product_bp = Blueprint("products", __name__, url_prefix="/api")


def _clean_product(body: dict, partial: bool = False) -> dict:
    data = {}
    if not partial or "name" in body:
        name = str(body.get("name", "")).strip()
        if not name:
            raise ValueError("Enter a name for the cut.")
        data["name"] = name
    if not partial or "category_id" in body:
        if not body.get("category_id"):
            raise ValueError("Choose a category.")
        data["category_id"] = body["category_id"]
    if not partial or "price_per_kg" in body:
        data["price_per_kg"] = number(body.get("price_per_kg"), "Price per kg")
    if not partial or "stock_weight_kg" in body:
        data["stock_weight_kg"] = number(body.get("stock_weight_kg", 0), "Stock", allow_zero=True)
    if "low_stock_threshold_kg" in body:
        data["low_stock_threshold_kg"] = number(body["low_stock_threshold_kg"], "Low-stock alert", allow_zero=True)
    if "description" in body:
        data["description"] = str(body["description"]).strip() or None
    if "image_url" in body:
        data["image_url"] = str(body["image_url"]).strip() or None
    return data


@product_bp.get("/categories")
def list_categories():
    rows = get_supabase().table("categories").select("*").order("name").execute().data
    return jsonify(rows)


@product_bp.post("/categories")
@require_auth(*STAFF)
def create_category():
    body = request.get_json(silent=True) or {}
    name = str(body.get("name", "")).strip()
    if not name:
        return error("Enter a category name.")
    try:
        row = (
            get_supabase()
            .table("categories")
            .insert({"name": name, "description": str(body.get("description", "")).strip() or None})
            .execute()
            .data[0]
        )
    except Exception as exc:
        return error(db_message(exc), 400)
    return jsonify(row), 201


@product_bp.get("/products")
def list_products():
    query = get_supabase().table("products").select("*, categories(id, name)").order("name")
    if request.args.get("category"):
        query = query.eq("category_id", request.args["category"])
    if request.args.get("available") == "1":
        query = query.gt("stock_weight_kg", 0)
    if request.args.get("q"):
        term = request.args["q"].strip().replace(",", " ").replace("%", "")
        query = query.ilike("name", f"%{term}%")
    return jsonify(query.execute().data)


@product_bp.get("/products/<product_id>")
def get_product(product_id):
    rows = get_supabase().table("products").select("*, categories(id, name)").eq("id", product_id).limit(1).execute().data
    if not rows:
        return error("Cut not found.", 404)
    return jsonify(rows[0])


@product_bp.post("/products")
@require_auth(*STAFF)
def create_product():
    try:
        data = _clean_product(request.get_json(silent=True) or {})
        row = get_supabase().table("products").insert(data).execute().data[0]
    except ValueError as exc:
        return error(str(exc))
    except Exception as exc:
        return error(db_message(exc), 400)
    return jsonify(row), 201


@product_bp.put("/products/<product_id>")
@require_auth(*STAFF)
def update_product(product_id):
    try:
        data = _clean_product(request.get_json(silent=True) or {}, partial=True)
        if not data:
            return error("Nothing to update.")
        rows = get_supabase().table("products").update(data).eq("id", product_id).execute().data
    except ValueError as exc:
        return error(str(exc))
    except Exception as exc:
        return error(db_message(exc), 400)
    if not rows:
        return error("Cut not found.", 404)
    return jsonify(rows[0])


@product_bp.delete("/products/<product_id>")
@require_auth("admin")
def delete_product(product_id):
    try:
        get_supabase().table("products").delete().eq("id", product_id).execute()
    except Exception as exc:
        msg = db_message(exc)
        if "violates foreign key" in msg:
            return error("This cut appears in past orders, so it can't be deleted. Set its stock to 0 instead.", 409)
        return error(msg, 400)
    return jsonify({"deleted": True})
