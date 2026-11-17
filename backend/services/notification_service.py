"""Order notifications. Sends email over SMTP when configured, otherwise writes to the log."""
import logging
import smtplib
import ssl
from email.message import EmailMessage

from backend.config import Config

log = logging.getLogger("primecut.notify")

STATUS_TEXT = {
    "pending_packing": "is waiting to be packed",
    "ready_for_pickup": "is packed and ready for pickup",
    "delivered": "has been delivered",
    "cancelled": "was cancelled",
}


def _money(value) -> str:
    return f"{Config.CURRENCY} {float(value):,.2f}"


def _send(to: str, subject: str, body: str) -> bool:
    if not to:
        return False
    if not Config.SMTP_HOST:
        log.info("[email not configured] to=%s | %s\n%s", to, subject, body)
        return False
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = Config.MAIL_FROM, to, subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=10) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            if Config.SMTP_USER:
                smtp.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
            smtp.send_message(msg)
        return True
    except Exception:
        log.exception("Could not send email to %s", to)
        return False


def order_placed(order: dict, customer: dict) -> bool:
    lines = "\n".join(
        f"  - {i['products']['name']}: {float(i['weight_kg']):.2f} kg  {_money(i['subtotal'])}"
        for i in order.get("order_items", [])
    )
    body = (
        f"Hi {customer.get('full_name') or 'there'},\n\n"
        f"We received your order #{order['id'][:8]}:\n{lines}\n\n"
        f"Total: {_money(order['total_amount'])}\n"
        f"We'll let you know when it's ready.\n\n{Config.SHOP_NAME}"
    )
    sent = _send(customer.get("email"), f"{Config.SHOP_NAME}: order #{order['id'][:8]} received", body)
    _send(Config.SHOP_NOTIFY_EMAIL, f"New order #{order['id'][:8]} ({_money(order['total_amount'])})", body)
    return sent


def status_changed(order: dict, customer: dict) -> bool:
    status = STATUS_TEXT.get(order["fulfillment_status"], order["fulfillment_status"])
    body = (
        f"Hi {customer.get('full_name') or 'there'},\n\n"
        f"Your order #{order['id'][:8]} {status}.\n\n{Config.SHOP_NAME}"
    )
    return _send(customer.get("email"), f"{Config.SHOP_NAME}: order #{order['id'][:8]} update", body)


def low_stock_alert(products: list) -> bool:
    lines = "\n".join(f"  - {p['name']}: {float(p['stock_weight_kg']):.2f} kg left" for p in products)
    return _send(Config.SHOP_NOTIFY_EMAIL, f"{Config.SHOP_NAME}: low stock", f"These cuts are running low:\n{lines}")
