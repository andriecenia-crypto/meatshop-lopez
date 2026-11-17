"""Central configuration and Supabase client factory for PrimeCut."""
import os

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv()


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
    CURRENCY = os.getenv("CURRENCY", "PHP")
    SHOP_NAME = os.getenv("SHOP_NAME", "PrimeCut")

    # Optional email notifications (falls back to logging when SMTP_HOST is empty)
    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    MAIL_FROM = os.getenv("MAIL_FROM", "orders@primecut.example")
    SHOP_NOTIFY_EMAIL = os.getenv("SHOP_NOTIFY_EMAIL", "")


_client: Client | None = None


def get_supabase() -> Client:
    """Return a cached service-role client. It bypasses RLS, so only use it server-side."""
    global _client
    if _client is None:
        if not Config.SUPABASE_URL or not Config.SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.")
        _client = create_client(Config.SUPABASE_URL, Config.SUPABASE_SERVICE_ROLE_KEY)
    return _client
