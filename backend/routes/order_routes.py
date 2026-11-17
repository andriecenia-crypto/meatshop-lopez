"""Customer ordering. Stock is deducted atomically inside Postgres (place_order function)."""
import logging

from flask import Blueprint, g, jsonify, request

from backend.config import get_supabase
from backend.routes import db_message, error, number, require_auth
from backend.services import notification_service as notify

order_bp = Blueprint("orders", __name__, url_prefix="/api/orders")
log = logging.getLogger("primecut.orders")

ORDER_SELECT = "*, order_items(id, product_id, weight_kg, subtotal, products(name, image_url, price_per_kg))"


@order_bp.post("")
@require_auth()
def place_order():
    body = request.get_json(silent=True) or {}
    raw_items = body.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return error("Add at least one cut to your order.")
    if len(raw_items) > 50:
        return error("An order can have up to 50 lines.")

    items = []
    try:
        for it in raw_items:
            if not it.get("product_id"):
                raise ValueError("Each line needs a product.")
            items.append({"product_id": it["product_id"], "weight_kg": round(number(it.get("weight_kg"), "Weight"), 3)})
    except ValueError as exc:
        return error(str(exc))

    sb = get_supabase()
    try:
        order_id = sb.rpc("place_order", {"p_customer": g.user["id"], "p_items": items}).execute().data
    except Exception as exc:
        # Postgres RAISE EXCEPTION text (e.g. "Not enough stock for Ribeye: 1.2 kg left") passes through.
        return error(db_message(exc), 409)

    order = sb.table("orders").select(ORDER_SELECT).eq("id", order_id).limit(1).execute().data[0]
    try:
        notify.order_placed(order, g.user)
        ids = [i["product_id"] for i in items]
        products = sb.table("products").select("name, stock_weight_kg, low_stock_threshold_kg").in_("id", ids).execute().data
        low = [p for p in products if float(p["stock_weight_kg"]) <= float(p["low_stock_threshold_kg"])]
        if low:
            notify.low_stock_alert(low)
    except Exception:
        log.exception("Notification failed for order %s", order_id)
    return jsonify(order), 201


@order_bp.get("/mine")
@require_auth()
def my_orders():
    rows = (
        get_supabase()
        .table("orders")
        .select(ORDER_SELECT)
        .eq("customer_id", g.user["id"])
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data
    )
    return jsonify(rows)


@order_bp.post("/<order_id>/cancel")
@require_auth()
def cancel_order(order_id):
    sb = get_supabase()
    rows = sb.table("orders").select("id, customer_id, fulfillment_status").eq("id", order_id).limit(1).execute().data
    if not rows or rows[0]["customer_id"] != g.user["id"]:
        return error("Order not found.", 404)
    if rows[0]["fulfillment_status"] != "pending_packing":
        return error("Only orders that haven't been packed can be cancelled. Call the shop for help.", 409)
    try:
        sb.rpc("cancel_order", {"p_order": order_id}).execute()  # restores stock
    except Exception as exc:
        return error(db_message(exc), 409)
    order = sb.table("orders").select(ORDER_SELECT).eq("id", order_id).limit(1).execute().data[0]
    return jsonify(order)
