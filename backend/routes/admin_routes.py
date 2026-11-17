"""Back-office endpoints for staff and admins."""
import logging
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request

from backend.config import get_supabase
from backend.routes import STAFF, db_message, error, number, require_auth
from backend.services import notification_service as notify

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")
log = logging.getLogger("primecut.admin")

FULFILLMENT = ("pending_packing", "ready_for_pickup", "delivered", "cancelled")
PAYMENT = ("unpaid", "paid")
ROLES = ("admin", "staff", "customer")
ORDER_FULL = "*, users(full_name, email, phone), order_items(weight_kg, subtotal, products(name))"


@admin_bp.get("/stats")
@require_auth(*STAFF)
def stats():
    sb = get_supabase()
    products = sb.table("products").select("id, name, price_per_kg, stock_weight_kg, low_stock_threshold_kg, image_url").execute().data
    orders = sb.table("orders").select("id, total_amount, fulfillment_status, payment_status, created_at").execute().data
    lines = sb.table("order_items").select("weight_kg, subtotal, products(name), orders(fulfillment_status)").execute().data

    today = datetime.now(timezone.utc).date().isoformat()
    live = [o for o in orders if o["fulfillment_status"] != "cancelled"]
    low_stock = sorted(
        (p for p in products if float(p["stock_weight_kg"]) <= float(p["low_stock_threshold_kg"])),
        key=lambda p: float(p["stock_weight_kg"]),
    )

    sold = {}
    for line in lines:
        if (line.get("orders") or {}).get("fulfillment_status") == "cancelled":
            continue
        name = (line.get("products") or {}).get("name", "Unknown")
        sold[name] = sold.get(name, 0) + float(line["weight_kg"])
    top = [{"name": n, "kg": round(kg, 2)} for n, kg in sorted(sold.items(), key=lambda x: -x[1])[:5]]

    return jsonify(
        {
            "open_orders": sum(1 for o in orders if o["fulfillment_status"] == "pending_packing"),
            "ready_orders": sum(1 for o in orders if o["fulfillment_status"] == "ready_for_pickup"),
            "orders_today": sum(1 for o in live if o["created_at"].startswith(today)),
            "revenue_today": round(sum(float(o["total_amount"]) for o in live if o["payment_status"] == "paid" and o["created_at"].startswith(today)), 2),
            "unpaid_total": round(sum(float(o["total_amount"]) for o in live if o["payment_status"] == "unpaid"), 2),
            "product_count": len(products),
            "stock_value": round(sum(float(p["price_per_kg"]) * float(p["stock_weight_kg"]) for p in products), 2),
            "low_stock": low_stock,
            "top_cuts": top,
        }
    )


# ---------- Orders ----------
@admin_bp.get("/orders")
@require_auth(*STAFF)
def list_orders():
    query = get_supabase().table("orders").select(ORDER_FULL).order("created_at", desc=True).limit(200)
    if request.args.get("status") in FULFILLMENT:
        query = query.eq("fulfillment_status", request.args["status"])
    return jsonify(query.execute().data)


@admin_bp.patch("/orders/<order_id>")
@require_auth(*STAFF)
def update_order(order_id):
    body = request.get_json(silent=True) or {}
    sb = get_supabase()
    rows = sb.table("orders").select("*").eq("id", order_id).limit(1).execute().data
    if not rows:
        return error("Order not found.", 404)
    order = rows[0]

    fulfillment = body.get("fulfillment_status")
    payment = body.get("payment_status")
    if fulfillment and fulfillment not in FULFILLMENT:
        return error("Unknown fulfillment status.")
    if payment and payment not in PAYMENT:
        return error("Unknown payment status.")
    if order["fulfillment_status"] in ("cancelled", "delivered") and fulfillment and fulfillment != order["fulfillment_status"]:
        return error(f"This order is already {order['fulfillment_status']}.", 409)

    try:
        if fulfillment == "cancelled":
            sb.rpc("cancel_order", {"p_order": order_id}).execute()  # restores stock too
        elif fulfillment:
            sb.table("orders").update({"fulfillment_status": fulfillment}).eq("id", order_id).execute()
        if payment:
            sb.table("orders").update({"payment_status": payment}).eq("id", order_id).execute()
    except Exception as exc:
        return error(db_message(exc), 409)

    updated = sb.table("orders").select(ORDER_FULL).eq("id", order_id).limit(1).execute().data[0]
    if fulfillment and fulfillment != order["fulfillment_status"]:
        try:
            notify.status_changed(updated, updated.get("users") or {})
        except Exception:
            log.exception("Status notification failed")
    return jsonify(updated)


# ---------- Suppliers ----------
def _clean_supplier(body: dict) -> dict:
    name = str(body.get("name", "")).strip()
    if not name:
        raise ValueError("Enter the supplier name.")
    return {
        "name": name,
        "contact_person": str(body.get("contact_person", "")).strip() or None,
        "phone": str(body.get("phone", "")).strip() or None,
        "email": str(body.get("email", "")).strip() or None,
        "address": str(body.get("address", "")).strip() or None,
    }


@admin_bp.get("/suppliers")
@require_auth(*STAFF)
def list_suppliers():
    return jsonify(get_supabase().table("suppliers").select("*").order("name").execute().data)


@admin_bp.post("/suppliers")
@require_auth(*STAFF)
def create_supplier():
    try:
        row = get_supabase().table("suppliers").insert(_clean_supplier(request.get_json(silent=True) or {})).execute().data[0]
    except ValueError as exc:
        return error(str(exc))
    except Exception as exc:
        return error(db_message(exc))
    return jsonify(row), 201


@admin_bp.put("/suppliers/<supplier_id>")
@require_auth(*STAFF)
def update_supplier(supplier_id):
    try:
        rows = get_supabase().table("suppliers").update(_clean_supplier(request.get_json(silent=True) or {})).eq("id", supplier_id).execute().data
    except ValueError as exc:
        return error(str(exc))
    except Exception as exc:
        return error(db_message(exc))
    if not rows:
        return error("Supplier not found.", 404)
    return jsonify(rows[0])


@admin_bp.delete("/suppliers/<supplier_id>")
@require_auth("admin")
def delete_supplier(supplier_id):
    try:
        get_supabase().table("suppliers").delete().eq("id", supplier_id).execute()
    except Exception as exc:
        return error(db_message(exc))
    return jsonify({"deleted": True})


# ---------- Inventory ----------
@admin_bp.get("/inventory")
@require_auth(*STAFF)
def inventory_logs():
    rows = (
        get_supabase()
        .table("inventory_logs")
        .select("*, products(name), suppliers(name)")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data
    )
    return jsonify(rows)


@admin_bp.post("/inventory")
@require_auth(*STAFF)
def receive_stock():
    body = request.get_json(silent=True) or {}
    try:
        if not body.get("product_id"):
            raise ValueError("Choose a cut.")
        payload = {
            "p_product": body["product_id"],
            "p_supplier": body.get("supplier_id") or None,
            "p_qty": number(body.get("quantity_added_kg"), "Quantity"),
            "p_cost": number(body.get("cost_price", 0), "Cost price", allow_zero=True),
            "p_date": body.get("received_date") or datetime.now(timezone.utc).date().isoformat(),
        }
        row = get_supabase().rpc("receive_stock", payload).execute().data
    except ValueError as exc:
        return error(str(exc))
    except Exception as exc:
        return error(db_message(exc), 400)
    return jsonify({"log_id": row}), 201


# ---------- Users ----------
@admin_bp.get("/users")
@require_auth("admin")
def list_users():
    return jsonify(get_supabase().table("users").select("*").order("created_at", desc=True).execute().data)


@admin_bp.patch("/users/<user_id>")
@require_auth("admin")
def set_role(user_id):
    role = (request.get_json(silent=True) or {}).get("role")
    if role not in ROLES:
        return error("Unknown role.")
    if user_id == g.user["id"] and role != "admin":
        return error("You can't remove your own admin access.", 409)
    rows = get_supabase().table("users").update({"role": role}).eq("id", user_id).execute().data
    if not rows:
        return error("User not found.", 404)
    return jsonify(rows[0])
