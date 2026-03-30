import json
import os
import sqlite3
import threading
import time
import uuid
import html
from datetime import datetime, timedelta, timezone
from pathlib import Path

import telebot
from telebot import types
from flask import Flask, jsonify, request
from flask_cors import CORS

from db import ConnectionProxy, connect_database, is_postgres_url


def resolve_writable_path(configured_path: str, fallback_group: str) -> Path:
    preferred = Path(configured_path)
    fallback = Path("/tmp") / "limitless-runtime" / fallback_group / preferred.name
    last_error: OSError | None = None

    for candidate in (preferred, fallback):
        try:
            candidate.parent.mkdir(parents=True, exist_ok=True)
            probe = candidate.parent / f".write-test-{os.getpid()}"
            probe.write_text("", encoding="utf-8")
            probe.unlink(missing_ok=True)
            if candidate != preferred:
                print(
                    f"[limitless-bot] Falling back from {preferred} to {candidate} because the original path is not writable.",
                    flush=True,
                )
            return candidate
        except OSError as exc:
            last_error = exc

    if last_error is not None:
        raise last_error
    return preferred


BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
API_PORT = int(os.getenv("API_PORT", os.getenv("PORT", "3001")))
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DB_FILE = (
    resolve_writable_path(os.getenv("AUTH_DB_PATH", str(Path(__file__).with_name("auth.db"))), "telegram-bot")
    if not is_postgres_url(DATABASE_URL)
    else Path(os.getenv("AUTH_DB_PATH", str(Path(__file__).with_name("auth.db"))))
)
LEGACY_JSON_FILE = resolve_writable_path(
    os.getenv("LEGACY_JSON_PATH", str(Path(__file__).with_name("tokens_db.json"))),
    "telegram-bot",
)
PAY_SUPPORT_CONTACT = os.getenv("PAY_SUPPORT_CONTACT", "").strip()
BOT_INTERNAL_API_KEY = os.getenv("BOT_INTERNAL_API_KEY", "limitless-bridge-key").strip()

if not BOT_TOKEN:
    raise RuntimeError("TELEGRAM_BOT_TOKEN is required")

PLANS = [
    {
        "id": "subscription_30d",
        "callback_data": "buy_subscription_30d",
        "days": 30,
        "stars": 25,
        "title": "Limitless на 30 дней",
        "description": "Доступ Limitless на 30 дней",
        "button_text": "30 дней · 25 stars",
        "subscription_plan": "subscription_30d",
        "permanent": False,
    },
    {
        "id": "subscription_90d",
        "callback_data": "buy_subscription_90d",
        "days": 90,
        "stars": 75,
        "title": "Limitless на 90 дней",
        "description": "Доступ Limitless на 90 дней",
        "button_text": "90 дней · 75 stars",
        "subscription_plan": "subscription_90d",
        "permanent": False,
    },
    {
        "id": "lifetime_access",
        "callback_data": "buy_lifetime_access",
        "days": 0,
        "stars": 150,
        "title": "Limitless навсегда",
        "description": "Постоянный доступ к Limitless",
        "button_text": "Навсегда · 150 stars",
        "subscription_plan": "lifetime",
        "permanent": True,
    },
]
PLANS_BY_ID = {plan["id"]: plan for plan in PLANS}
PLANS_BY_CALLBACK = {plan["callback_data"]: plan for plan in PLANS}

bot = telebot.TeleBot(BOT_TOKEN)
app = Flask(__name__)
CORS(app)

db_lock = threading.Lock()


def parse_admin_chat_ids() -> set[int]:
    admin_ids: set[int] = set()
    raw_value = os.getenv("TELEGRAM_ADMIN_IDS", "1839845039")
    for item in raw_value.split(","):
        value = item.strip()
        if not value:
            continue
        try:
            admin_ids.add(int(value))
        except ValueError:
            continue
    return admin_ids


ADMIN_CHAT_IDS = parse_admin_chat_ids()


def is_internal_api_request_authorized() -> bool:
    received_key = request.headers.get("X-Limitless-Bridge-Key", "").strip()
    return bool(received_key) and received_key == BOT_INTERNAL_API_KEY


def unauthorized_internal_api_response():
    return jsonify({"success": False, "error": "ADMIN_BRIDGE_UNAUTHORIZED"}), 401


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso_datetime(value: str | None):
    if not value:
        return None

    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def is_subscription_expired(expires_at: str | None) -> bool:
    expires_at_dt = parse_iso_datetime(expires_at)
    if expires_at_dt is None:
        return False
    return expires_at_dt <= datetime.now(timezone.utc)


def get_connection() -> ConnectionProxy:
    return connect_database(DATABASE_URL, DB_FILE)


def is_postgres_connection(connection: ConnectionProxy) -> bool:
    return getattr(connection, "backend", "sqlite") == "postgres"


def ensure_column(connection: ConnectionProxy, table_name: str, column_name: str, definition: str) -> None:
    if is_postgres_connection(connection):
        connection.execute(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_name} {definition}")
        return

    columns = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    existing_columns = {column[1] for column in columns}
    if column_name not in existing_columns:
        connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def init_db() -> None:
    if not is_postgres_url(DATABASE_URL):
        DB_FILE.parent.mkdir(parents=True, exist_ok=True)

    with get_connection() as connection:
        if is_postgres_connection(connection):
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_users (
                    user_id BIGINT PRIMARY KEY,
                    username TEXT,
                    added_by BIGINT,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_tokens (
                    token TEXT PRIMARY KEY,
                    chat_id BIGINT NOT NULL UNIQUE,
                    username TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    activated_device_id TEXT UNIQUE,
                    activated_ip TEXT,
                    activated_at TEXT,
                    subscription_plan TEXT NOT NULL DEFAULT 'inactive',
                    subscription_status TEXT NOT NULL DEFAULT 'inactive',
                    subscription_expires_at TEXT,
                    revoked_at TEXT,
                    last_seen_at TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS star_payments (
                    telegram_payment_charge_id TEXT PRIMARY KEY,
                    provider_payment_charge_id TEXT,
                    chat_id BIGINT NOT NULL,
                    token TEXT NOT NULL,
                    plan_id TEXT NOT NULL,
                    invoice_payload TEXT NOT NULL,
                    currency TEXT NOT NULL,
                    total_amount INTEGER NOT NULL,
                    days INTEGER NOT NULL,
                    processed_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS license_keys (
                    key TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL,
                    subscription_plan TEXT NOT NULL,
                    days INTEGER NOT NULL DEFAULT 0,
                    permanent INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'unused',
                    created_at TEXT NOT NULL,
                    created_by BIGINT,
                    redeemed_at TEXT,
                    redeemed_by_chat_id BIGINT,
                    redeemed_token TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS promo_codes (
                    code TEXT PRIMARY KEY,
                    discount_percent INTEGER NOT NULL,
                    target_plan_id TEXT NOT NULL DEFAULT 'all',
                    max_uses INTEGER NOT NULL DEFAULT 0,
                    used_count INTEGER NOT NULL DEFAULT 0,
                    active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    created_by BIGINT,
                    expires_at TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_promos (
                    chat_id BIGINT PRIMARY KEY,
                    promo_code TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS plan_prices (
                    plan_id TEXT PRIMARY KEY,
                    stars INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    updated_by BIGINT
                )
                """
            )
        else:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_users (
                    user_id INTEGER PRIMARY KEY,
                    username TEXT,
                    added_by INTEGER,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS auth_tokens (
                    token TEXT PRIMARY KEY,
                    chat_id INTEGER NOT NULL UNIQUE,
                    username TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    activated_device_id TEXT UNIQUE,
                    activated_ip TEXT,
                    activated_at TEXT,
                    subscription_plan TEXT NOT NULL DEFAULT 'inactive',
                    subscription_status TEXT NOT NULL DEFAULT 'inactive',
                    subscription_expires_at TEXT,
                    revoked_at TEXT,
                    last_seen_at TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS star_payments (
                    telegram_payment_charge_id TEXT PRIMARY KEY,
                    provider_payment_charge_id TEXT,
                    chat_id INTEGER NOT NULL,
                    token TEXT NOT NULL,
                    plan_id TEXT NOT NULL,
                    invoice_payload TEXT NOT NULL,
                    currency TEXT NOT NULL,
                    total_amount INTEGER NOT NULL,
                    days INTEGER NOT NULL,
                    processed_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS license_keys (
                    key TEXT PRIMARY KEY,
                    plan_id TEXT NOT NULL,
                    subscription_plan TEXT NOT NULL,
                    days INTEGER NOT NULL DEFAULT 0,
                    permanent INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'unused',
                    created_at TEXT NOT NULL,
                    created_by INTEGER,
                    redeemed_at TEXT,
                    redeemed_by_chat_id INTEGER,
                    redeemed_token TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS promo_codes (
                    code TEXT PRIMARY KEY,
                    discount_percent INTEGER NOT NULL,
                    target_plan_id TEXT NOT NULL DEFAULT 'all',
                    max_uses INTEGER NOT NULL DEFAULT 0,
                    used_count INTEGER NOT NULL DEFAULT 0,
                    active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    created_by INTEGER,
                    expires_at TEXT
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_promos (
                    chat_id INTEGER PRIMARY KEY,
                    promo_code TEXT NOT NULL,
                    applied_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS plan_prices (
                    plan_id TEXT PRIMARY KEY,
                    stars INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    updated_by INTEGER
                )
                """
            )
        ensure_column(connection, "auth_tokens", "activated_ip", "TEXT")
        ensure_column(connection, "star_payments", "plan_id", "TEXT NOT NULL DEFAULT ''")
        ensure_column(connection, "star_payments", "promo_code", "TEXT")
        connection.commit()


def migrate_sqlite_db_to_postgres() -> None:
    if not is_postgres_url(DATABASE_URL) or not DB_FILE.exists():
        return

    source = sqlite3.connect(DB_FILE)
    source.row_factory = sqlite3.Row

    table_columns = {
        "admin_users": ["user_id", "username", "added_by", "created_at"],
        "auth_tokens": [
            "token",
            "chat_id",
            "username",
            "created_at",
            "activated_device_id",
            "activated_ip",
            "activated_at",
            "subscription_plan",
            "subscription_status",
            "subscription_expires_at",
            "revoked_at",
            "last_seen_at",
        ],
        "star_payments": [
            "telegram_payment_charge_id",
            "provider_payment_charge_id",
            "chat_id",
            "token",
            "plan_id",
            "promo_code",
            "invoice_payload",
            "currency",
            "total_amount",
            "days",
            "processed_at",
        ],
        "license_keys": [
            "key",
            "plan_id",
            "subscription_plan",
            "days",
            "permanent",
            "status",
            "created_at",
            "created_by",
            "redeemed_at",
            "redeemed_by_chat_id",
            "redeemed_token",
        ],
        "promo_codes": [
            "code",
            "discount_percent",
            "target_plan_id",
            "max_uses",
            "used_count",
            "active",
            "created_at",
            "created_by",
            "expires_at",
        ],
        "chat_promos": ["chat_id", "promo_code", "applied_at"],
        "plan_prices": ["plan_id", "stars", "updated_at", "updated_by"],
    }

    def source_values(table_name: str, columns: list[str]) -> list[tuple]:
        available_rows = source.execute(f"PRAGMA table_info({table_name})").fetchall()
        available_columns = {row[1] for row in available_rows}
        selected_columns = [column for column in columns if column in available_columns]
        if not selected_columns:
            return []

        rows = source.execute(f"SELECT {', '.join(selected_columns)} FROM {table_name}").fetchall()
        hydrated_rows: list[tuple] = []
        for row in rows:
            hydrated_rows.append(tuple(row[column] if column in available_columns else None for column in columns))
        return hydrated_rows

    try:
        with get_connection() as target:
            existing_tokens = int(target.execute("SELECT COUNT(*) FROM auth_tokens").fetchone()[0])
            if existing_tokens > 0:
                return

            for table_name, columns in table_columns.items():
                column_list = ", ".join(columns)
                placeholders = ", ".join("?" for _ in columns)
                for values in source_values(table_name, columns):
                    target.execute(
                        f"INSERT INTO {table_name} ({column_list}) VALUES ({placeholders}) ON CONFLICT DO NOTHING",
                        values,
                    )
            target.commit()
            print("[limitless-bot] Migrated SQLite auth data into PostgreSQL.", flush=True)
    finally:
        source.close()


def migrate_legacy_json() -> None:
    if not LEGACY_JSON_FILE.exists():
        return

    try:
        legacy_data = json.loads(LEGACY_JSON_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return

    if not isinstance(legacy_data, dict):
        return

    with get_connection() as connection:
        existing_count = connection.execute("SELECT COUNT(*) FROM auth_tokens").fetchone()[0]
        if existing_count > 0:
            return

        for token, token_data in legacy_data.items():
            if not isinstance(token_data, dict):
                continue

            connection.execute(
                """
                INSERT OR IGNORE INTO auth_tokens (
                    token,
                    chat_id,
                    username,
                    created_at,
                    activated_device_id,
                    activated_ip,
                    activated_at,
                    subscription_plan,
                    subscription_status,
                    subscription_expires_at,
                    revoked_at,
                    last_seen_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    token,
                    int(token_data.get("chatId", 0)),
                    str(token_data.get("username", "User")),
                    str(token_data.get("createdAt", now_iso())),
                    token_data.get("activatedDeviceId"),
                    token_data.get("activatedIp"),
                    token_data.get("activatedAt"),
                    str(token_data.get("subscriptionPlan", "inactive")),
                    str(token_data.get("subscriptionStatus", "inactive")),
                    token_data.get("subscriptionExpiresAt"),
                    token_data.get("revokedAt"),
                    token_data.get("lastSeenAt"),
                ),
            )

        connection.commit()


def row_to_token_dict(row: sqlite3.Row | None):
    if row is None:
        return None
    return dict(row)


def generate_token() -> str:
    ts = str(int(time.time() * 1000))
    random_str = uuid.uuid4().hex[:16]
    return f"LMT-{ts}-{random_str}"


def generate_license_key() -> str:
    return f"KEY-{uuid.uuid4().hex[:5].upper()}-{uuid.uuid4().hex[:5].upper()}-{uuid.uuid4().hex[:5].upper()}"


def normalize_promo_code(code: str) -> str:
    return code.strip().upper()


def parse_discount_percent(raw_value: str) -> int:
    normalized = raw_value.strip().replace("%", "")
    return int(normalized)


def get_admin_user(connection: sqlite3.Connection, user_id: int):
    row = connection.execute(
        "SELECT * FROM admin_users WHERE user_id = ? LIMIT 1",
        (user_id,),
    ).fetchone()
    return dict(row) if row else None


def list_admin_users(connection: sqlite3.Connection) -> list[dict]:
    rows = connection.execute(
        "SELECT * FROM admin_users ORDER BY created_at ASC, user_id ASC"
    ).fetchall()
    return [dict(row) for row in rows]


def add_admin_user(connection: sqlite3.Connection, user_id: int, username: str | None, added_by: int) -> dict:
    connection.execute(
        """
        INSERT INTO admin_users (user_id, username, added_by, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            username = excluded.username,
            added_by = excluded.added_by
        """,
        (user_id, username, added_by, now_iso()),
    )
    return get_admin_user(connection, user_id)


def remove_admin_user(connection: sqlite3.Connection, user_id: int) -> None:
    connection.execute("DELETE FROM admin_users WHERE user_id = ?", (user_id,))


def is_admin(user_id: int) -> bool:
    if user_id in ADMIN_CHAT_IDS:
        return True
    with db_lock:
        with get_connection() as connection:
            return get_admin_user(connection, user_id) is not None


def get_token_by_chat_id(connection: sqlite3.Connection, chat_id: int):
    row = connection.execute(
        "SELECT * FROM auth_tokens WHERE chat_id = ? LIMIT 1",
        (chat_id,),
    ).fetchone()
    return row_to_token_dict(row)


def get_token_by_value(connection: sqlite3.Connection, token: str):
    row = connection.execute(
        "SELECT * FROM auth_tokens WHERE token = ? LIMIT 1",
        (token,),
    ).fetchone()
    return row_to_token_dict(row)


def get_token_by_device_id(connection: sqlite3.Connection, device_id: str):
    row = connection.execute(
        """
        SELECT * FROM auth_tokens
        WHERE activated_device_id = ?
        LIMIT 1
        """,
        (device_id,),
    ).fetchone()
    return row_to_token_dict(row)


def generate_license_chat_id(key_value: str) -> int:
    key_uuid = uuid.uuid5(uuid.NAMESPACE_DNS, f"limitless-license:{key_value.upper()}")
    return -((key_uuid.int % 2_000_000_000) + 1)


def get_star_payment_by_charge_id(connection: sqlite3.Connection, charge_id: str):
    row = connection.execute(
        """
        SELECT * FROM star_payments
        WHERE telegram_payment_charge_id = ?
        LIMIT 1
        """,
        (charge_id,),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


def build_custom_plan(days: int) -> dict:
    return {
        "id": f"manual_{days}d",
        "callback_data": "",
        "days": days,
        "stars": 0,
        "title": f"Limitless на {days} дней",
        "description": f"Доступ Limitless на {days} дней",
        "button_text": f"{days} дней",
        "subscription_plan": "manual_key",
        "permanent": False,
    }


def get_plan_price_override(connection: sqlite3.Connection, plan_id: str):
    row = connection.execute(
        "SELECT * FROM plan_prices WHERE plan_id = ? LIMIT 1",
        (plan_id,),
    ).fetchone()
    return dict(row) if row else None


def set_plan_price_override(connection: sqlite3.Connection, plan_id: str, stars: int, updated_by: int):
    connection.execute(
        """
        INSERT INTO plan_prices (plan_id, stars, updated_at, updated_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(plan_id) DO UPDATE SET
            stars = excluded.stars,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        """,
        (plan_id, int(stars), now_iso(), updated_by),
    )
    return get_plan_price_override(connection, plan_id)


def get_effective_plan(connection: sqlite3.Connection, plan_or_plan_id: dict | str):
    base_plan = PLANS_BY_ID.get(plan_or_plan_id) if isinstance(plan_or_plan_id, str) else plan_or_plan_id
    if not base_plan:
        return None

    effective_plan = dict(base_plan)
    if effective_plan["id"] in PLANS_BY_ID:
        price_override = get_plan_price_override(connection, effective_plan["id"])
        if price_override:
            effective_plan["stars"] = int(price_override["stars"])

    effective_plan["button_text"] = f"{format_plan_label(effective_plan)} · {int(effective_plan['stars'])} stars"
    return effective_plan


def list_effective_plans(connection: sqlite3.Connection) -> list[dict]:
    return [get_effective_plan(connection, plan) for plan in PLANS]


def build_price_list_message(connection: sqlite3.Connection, title: str) -> str:
    lines = [f"<b>{title}</b>", ""]
    for plan in list_effective_plans(connection):
        lines.append(f"• {format_plan_label(plan)} — <code>{plan['id']}</code> — {int(plan['stars'])} stars")
    lines.extend(["", "/setprice &lt;30|90|lifetime&gt; &lt;stars&gt;"])
    return "\n".join(lines)


def resolve_plan_spec(plan_spec: str):
    normalized = plan_spec.strip().lower()
    if normalized in {"30", "30d", "subscription_30d", "month"}:
        return dict(PLANS_BY_ID["subscription_30d"])
    if normalized in {"90", "90d", "subscription_90d"}:
        return dict(PLANS_BY_ID["subscription_90d"])
    if normalized in {"lifetime", "life", "forever", "permanent", "lifetime_access"}:
        return dict(PLANS_BY_ID["lifetime_access"])
    if normalized.startswith("days:"):
        try:
            custom_days = int(normalized.split(":", 1)[1])
        except ValueError:
            return None
        if custom_days <= 0:
            return None
        return build_custom_plan(custom_days)
    return None


def get_license_key_by_value(connection: sqlite3.Connection, key: str):
    row = connection.execute(
        "SELECT * FROM license_keys WHERE key = ? LIMIT 1",
        (key,),
    ).fetchone()
    return dict(row) if row else None


def list_license_keys(connection: sqlite3.Connection, status_filter: str = "unused", limit: int = 10):
    query = "SELECT * FROM license_keys"
    params: list = []
    if status_filter != "all":
        query += " WHERE status = ?"
        params.append(status_filter)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = connection.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def create_license_keys(connection: sqlite3.Connection, plan: dict, created_by: int, count: int):
    created_keys: list[dict] = []
    for _ in range(count):
        key_value = generate_license_key()
        connection.execute(
            """
            INSERT INTO license_keys (
                key,
                plan_id,
                subscription_plan,
                days,
                permanent,
                status,
                created_at,
                created_by
            ) VALUES (?, ?, ?, ?, ?, 'unused', ?, ?)
            """,
            (
                key_value,
                plan["id"],
                plan["subscription_plan"],
                int(plan["days"]),
                1 if plan["permanent"] else 0,
                now_iso(),
                created_by,
            ),
        )
        created_keys.append(get_license_key_by_value(connection, key_value))
    return created_keys


def build_plan_from_license_key(license_key: dict) -> dict:
    if license_key.get("permanent"):
        return dict(PLANS_BY_ID["lifetime_access"])
    return {
        "id": license_key["plan_id"],
        "callback_data": "",
        "days": int(license_key["days"]),
        "stars": 0,
        "title": f"Limitless на {license_key['days']} дней",
        "description": f"Доступ Limitless на {license_key['days']} дней",
        "button_text": f"{license_key['days']} дней",
        "subscription_plan": license_key.get("subscription_plan") or "manual_key",
        "permanent": False,
    }


def redeem_license_key(chat_id: int, username: str, key_value: str):
    normalized_key = key_value.strip().upper()
    with db_lock:
        with get_connection() as connection:
            license_key = get_license_key_by_value(connection, normalized_key)
            if not license_key:
                return {"ok": False, "error": "KEY_NOT_FOUND"}

            if license_key["status"] != "unused":
                return {"ok": False, "error": "KEY_ALREADY_USED", "license_key": license_key}

            token_data = get_or_create_token_record(connection, chat_id, username)
            updated_token = apply_plan_to_token_record(connection, token_data, build_plan_from_license_key(license_key))
            connection.execute(
                """
                UPDATE license_keys
                SET status = 'redeemed',
                    redeemed_at = ?,
                    redeemed_by_chat_id = ?,
                    redeemed_token = ?
                WHERE key = ?
                """,
                (now_iso(), chat_id, updated_token["token"], normalized_key),
            )
            connection.commit()
            return {"ok": True, "token": updated_token, "license_key": get_license_key_by_value(connection, normalized_key)}


def get_promo_code(connection: sqlite3.Connection, code: str):
    row = connection.execute(
        "SELECT * FROM promo_codes WHERE code = ? LIMIT 1",
        (normalize_promo_code(code),),
    ).fetchone()
    return dict(row) if row else None


def get_chat_promo(connection: sqlite3.Connection, chat_id: int):
    row = connection.execute(
        """
        SELECT promo_codes.*
        FROM chat_promos
        JOIN promo_codes ON promo_codes.code = chat_promos.promo_code
        WHERE chat_promos.chat_id = ?
        LIMIT 1
        """,
        (chat_id,),
    ).fetchone()
    return dict(row) if row else None


def set_chat_promo(connection: sqlite3.Connection, chat_id: int, promo_code: str) -> None:
    connection.execute(
        """
        INSERT INTO chat_promos (chat_id, promo_code, applied_at)
        VALUES (?, ?, ?)
        ON CONFLICT(chat_id) DO UPDATE SET
            promo_code = excluded.promo_code,
            applied_at = excluded.applied_at
        """,
        (chat_id, normalize_promo_code(promo_code), now_iso()),
    )


def clear_chat_promo(connection: sqlite3.Connection, chat_id: int) -> None:
    connection.execute("DELETE FROM chat_promos WHERE chat_id = ?", (chat_id,))


def list_promo_codes(connection: sqlite3.Connection, include_inactive: bool = False, limit: int = 10):
    query = "SELECT * FROM promo_codes"
    params: list = []
    if not include_inactive:
        query += " WHERE active = 1"
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = connection.execute(query, params).fetchall()
    return [dict(row) for row in rows]


def delete_promo_code(connection: sqlite3.Connection, code: str):
    normalized_code = normalize_promo_code(code)
    promo = get_promo_code(connection, normalized_code)
    if not promo:
        return None

    connection.execute("DELETE FROM chat_promos WHERE promo_code = ?", (normalized_code,))
    connection.execute("DELETE FROM promo_codes WHERE code = ?", (normalized_code,))
    return promo


def has_chat_used_promo(connection: sqlite3.Connection, chat_id: int, promo_code: str) -> bool:
    row = connection.execute(
        """
        SELECT 1
        FROM star_payments
        WHERE chat_id = ? AND promo_code = ?
        LIMIT 1
        """,
        (chat_id, normalize_promo_code(promo_code)),
    ).fetchone()
    return row is not None


def is_promo_expired(promo_code: dict) -> bool:
    expires_at = promo_code.get("expires_at")
    expires_at_dt = parse_iso_datetime(expires_at)
    if expires_at_dt is None:
        return False
    return expires_at_dt <= datetime.now(timezone.utc)


def is_promo_valid_for_plan(connection: sqlite3.Connection, promo_code: dict | None, plan: dict, chat_id: int | None = None) -> bool:
    if not promo_code:
        return False
    if not int(promo_code.get("active", 0)):
        return False
    if is_promo_expired(promo_code):
        return False
    max_uses = int(promo_code.get("max_uses", 0))
    used_count = int(promo_code.get("used_count", 0))
    if max_uses > 0 and used_count >= max_uses:
        return False
    target_plan_id = promo_code.get("target_plan_id", "all")
    if target_plan_id not in {"all", plan["id"]}:
        return False
    if chat_id is not None and has_chat_used_promo(connection, chat_id, promo_code["code"]):
        return False
    return True


def get_active_chat_promo(connection: sqlite3.Connection, chat_id: int, plan: dict | None = None):
    promo_code = get_chat_promo(connection, chat_id)
    if not promo_code:
        return None

    is_generally_valid = (
        int(promo_code.get("active", 0))
        and not is_promo_expired(promo_code)
        and (int(promo_code.get("max_uses", 0)) == 0 or int(promo_code.get("used_count", 0)) < int(promo_code.get("max_uses", 0)))
        and not has_chat_used_promo(connection, chat_id, promo_code["code"])
    )
    if not is_generally_valid:
        clear_chat_promo(connection, chat_id)
        return None

    if plan is None:
        return promo_code

    return promo_code if promo_code.get("target_plan_id", "all") in {"all", plan["id"]} else None


def calculate_discounted_stars(plan: dict, promo_code: dict | None) -> int:
    base_amount = int(plan["stars"])
    if not promo_code:
        return base_amount
    discount_percent = max(0, min(95, int(promo_code.get("discount_percent", 0))))
    discounted = round(base_amount * (100 - discount_percent) / 100)
    return max(1, discounted)


def format_discount_badge(promo_code: dict | None) -> str:
    if not promo_code:
        return ""
    return f"-{int(promo_code.get('discount_percent', 0))}%"


def create_promo_code_record(
    connection: sqlite3.Connection,
    code: str,
    discount_percent: int,
    target_plan_id: str,
    max_uses: int,
    created_by: int,
) -> dict:
    normalized_code = normalize_promo_code(code)
    connection.execute(
        """
        INSERT INTO promo_codes (
            code,
            discount_percent,
            target_plan_id,
            max_uses,
            used_count,
            active,
            created_at,
            created_by
        ) VALUES (?, ?, ?, ?, 0, 1, ?, ?)
        """,
        (
            normalized_code,
            discount_percent,
            target_plan_id,
            max_uses,
            now_iso(),
            created_by,
        ),
    )
    return get_promo_code(connection, normalized_code)


def build_admin_keyboard() -> types.InlineKeyboardMarkup:
    keyboard = types.InlineKeyboardMarkup()
    keyboard.row(
        types.InlineKeyboardButton(text="Ключ 30 дней", callback_data="admin_key_subscription_30d"),
        types.InlineKeyboardButton(text="Ключ 90 дней", callback_data="admin_key_subscription_90d"),
    )
    keyboard.row(
        types.InlineKeyboardButton(text="Ключ навсегда", callback_data="admin_key_lifetime_access"),
    )
    keyboard.row(
        types.InlineKeyboardButton(text="Последние ключи", callback_data="admin_list_keys"),
        types.InlineKeyboardButton(text="Промокоды", callback_data="admin_list_promos"),
    )
    keyboard.row(
        types.InlineKeyboardButton(text="Открыть магазин", callback_data="admin_open_shop"),
    )
    return keyboard


def create_token_record(connection: sqlite3.Connection, chat_id: int, username: str) -> dict:
    token = generate_token()
    connection.execute(
        """
        INSERT INTO auth_tokens (
            token,
            chat_id,
            username,
            created_at,
            subscription_plan,
            subscription_status
        ) VALUES (?, ?, ?, ?, 'inactive', 'inactive')
        """,
        (token, chat_id, username, now_iso()),
    )
    return get_token_by_value(connection, token)


def create_token_record_for_license_key(connection: sqlite3.Connection, license_key: dict) -> dict:
    synthetic_chat_id = generate_license_chat_id(license_key["key"])
    existing_token = get_token_by_chat_id(connection, synthetic_chat_id)
    if existing_token:
        return existing_token

    username = f"License {license_key['key'][-5:]}"
    return create_token_record(connection, synthetic_chat_id, username)


def get_or_create_token_record(connection: sqlite3.Connection, chat_id: int, username: str) -> dict:
    token_data = get_token_by_chat_id(connection, chat_id)
    if token_data:
        return token_data
    return create_token_record(connection, chat_id, username)


def ensure_admin_lifetime_token(connection: sqlite3.Connection, chat_id: int, username: str) -> dict:
    token_data = get_or_create_token_record(connection, chat_id, username)
    return apply_plan_to_token_record(connection, token_data, dict(PLANS_BY_ID["lifetime_access"]))


def ensure_primary_admin_tokens() -> None:
    with db_lock:
        with get_connection() as connection:
            for admin_id in ADMIN_CHAT_IDS:
                ensure_admin_lifetime_token(connection, admin_id, f"admin_{admin_id}")
            connection.commit()


def format_subscription_status(token_data: dict) -> str:
    if token_data.get("revoked_at"):
        return f"Токен отозван: {token_data['revoked_at']}"

    if token_data.get("subscription_plan") == "lifetime" and token_data.get("subscription_status") == "active":
        return "Доступ: навсегда"

    if token_data.get("subscription_status") != "active":
        return "Подписка: неактивна"

    if token_data.get("subscription_expires_at"):
        return f"Подписка до: {token_data['subscription_expires_at']}"

    return "Подписка: активна"


def build_token_summary(token_data: dict) -> str:
    activation_status = (
        f"Активирован: {token_data.get('activated_at', 'неизвестно')}"
        if token_data.get("activated_at") or token_data.get("activated_ip") or token_data.get("activated_device_id")
        else "Еще не активирован"
    )
    return (
        f"<code>{token_data['token']}</code>\n\n"
        f"Создан: {token_data['created_at']}\n"
        f"{activation_status}\n"
        f"{format_subscription_status(token_data)}\n\n"
        "Токен постоянный: после первой покупки он создается один раз и дальше только продлевается."
    )


def calculate_extended_expiry(current_expiry: str | None, days: int) -> str:
    now = datetime.now(timezone.utc)
    current_expiry_dt = parse_iso_datetime(current_expiry)
    if current_expiry_dt is None or current_expiry_dt <= now:
        base_date = now
    else:
        base_date = current_expiry_dt
    return (base_date + timedelta(days=days)).isoformat()


def apply_plan_to_token_record(connection: sqlite3.Connection, token_data: dict, plan: dict) -> dict:
    if plan["permanent"]:
        connection.execute(
            """
            UPDATE auth_tokens
            SET subscription_plan = 'lifetime',
                subscription_status = 'active',
                subscription_expires_at = NULL,
                revoked_at = NULL
            WHERE token = ?
            """,
            (token_data["token"],),
        )
        return get_token_by_value(connection, token_data["token"])

    if token_data.get("subscription_plan") == "lifetime" and token_data.get("subscription_status") == "active":
        return token_data

    new_expiry = calculate_extended_expiry(token_data.get("subscription_expires_at"), int(plan["days"]))
    connection.execute(
        """
        UPDATE auth_tokens
        SET subscription_plan = ?,
            subscription_status = 'active',
            subscription_expires_at = ?,
            revoked_at = NULL
        WHERE token = ?
        """,
        (plan["subscription_plan"], new_expiry, token_data["token"]),
    )
    return get_token_by_value(connection, token_data["token"])


def extend_token_subscription(token: str, days: int):
    with db_lock:
        with get_connection() as connection:
            token_data = get_token_by_value(connection, token)
            if not token_data:
                return None

            if token_data.get("subscription_plan") == "lifetime" and token_data.get("subscription_status") == "active":
                return token_data

            new_expiry = calculate_extended_expiry(token_data.get("subscription_expires_at"), days)
            connection.execute(
                """
                UPDATE auth_tokens
                SET subscription_plan = 'manual_extend',
                    subscription_status = 'active',
                    subscription_expires_at = ?,
                    revoked_at = NULL
                WHERE token = ?
                """,
                (new_expiry, token),
            )
            connection.commit()
            return get_token_by_value(connection, token)


def format_admin_user_record(token_data: dict) -> dict:
    return {
        "token": token_data["token"],
        "chatId": int(token_data["chat_id"]),
        "username": token_data.get("username") or "User",
        "createdAt": token_data.get("created_at"),
        "activatedDeviceId": token_data.get("activated_device_id"),
        "activatedIp": token_data.get("activated_ip"),
        "activatedAt": token_data.get("activated_at"),
        "subscriptionPlan": token_data.get("subscription_plan"),
        "subscriptionStatus": token_data.get("subscription_status"),
        "subscriptionExpiresAt": token_data.get("subscription_expires_at"),
        "revokedAt": token_data.get("revoked_at"),
        "lastSeenAt": token_data.get("last_seen_at"),
        "isBanned": bool(token_data.get("revoked_at")),
        "isBound": bool(token_data.get("activated_at") or token_data.get("activated_ip") or token_data.get("activated_device_id")),
    }


def list_admin_users(connection: sqlite3.Connection, search: str = "", limit: int = 200) -> list[dict]:
    normalized_search = search.strip()
    params: list[object] = []
    query = "SELECT * FROM auth_tokens"

    if normalized_search:
        like_value = f"%{normalized_search}%"
        query += " WHERE username LIKE ? OR token LIKE ? OR CAST(chat_id AS TEXT) LIKE ?"
        params.extend([like_value, like_value, like_value])

    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    rows = connection.execute(query, params).fetchall()
    return [format_admin_user_record(dict(row)) for row in rows]


def get_admin_user_summary(connection: sqlite3.Connection) -> dict:
    total_users = int(connection.execute("SELECT COUNT(*) FROM auth_tokens").fetchone()[0])
    active_users = int(
        connection.execute(
            """
            SELECT COUNT(*)
            FROM auth_tokens
            WHERE revoked_at IS NULL
              AND subscription_status = 'active'
            """
        ).fetchone()[0]
    )
    banned_users = int(
        connection.execute(
            "SELECT COUNT(*) FROM auth_tokens WHERE revoked_at IS NOT NULL"
        ).fetchone()[0]
    )
    bound_devices = int(
        connection.execute(
            "SELECT COUNT(*) FROM auth_tokens WHERE activated_ip IS NOT NULL OR activated_device_id IS NOT NULL"
        ).fetchone()[0]
    )
    return {
        "totalUsers": total_users,
        "activeUsers": active_users,
        "bannedUsers": banned_users,
        "boundDevices": bound_devices,
    }


def set_admin_ban_state(connection: sqlite3.Connection, token: str, banned: bool):
    token_data = get_token_by_value(connection, token)
    if not token_data:
        return None

    connection.execute(
        "UPDATE auth_tokens SET revoked_at = ? WHERE token = ?",
        (now_iso() if banned else None, token),
    )
    connection.commit()
    return get_token_by_value(connection, token)


def record_star_payment(
    connection: sqlite3.Connection,
    telegram_payment_charge_id: str,
    provider_payment_charge_id: str,
    chat_id: int,
    token: str,
    plan_id: str,
    promo_code: str | None,
    invoice_payload: str,
    currency: str,
    total_amount: int,
    days: int,
) -> None:
    connection.execute(
        """
        INSERT INTO star_payments (
            telegram_payment_charge_id,
            provider_payment_charge_id,
            chat_id,
            token,
            plan_id,
            promo_code,
            invoice_payload,
            currency,
            total_amount,
            days,
            processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            telegram_payment_charge_id,
            provider_payment_charge_id,
            chat_id,
            token,
            plan_id,
            normalize_promo_code(promo_code) if promo_code else None,
            invoice_payload,
            currency,
            total_amount,
            days,
            now_iso(),
        ),
    )


def build_purchase_keyboard() -> types.InlineKeyboardMarkup:
    return build_purchase_keyboard_for_chat(None)


def build_purchase_keyboard_for_chat(chat_id: int | None) -> types.InlineKeyboardMarkup:
    keyboard = types.InlineKeyboardMarkup()
    with db_lock:
        with get_connection() as connection:
            for base_plan in PLANS:
                plan = get_effective_plan(connection, base_plan)
                promo_code = get_active_chat_promo(connection, chat_id, plan) if chat_id is not None else None
                button_text = plan["button_text"]
                discounted_stars = None
                if promo_code:
                    discounted_stars = calculate_discounted_stars(plan, promo_code)
                    button_text = f"{button_text} → {calculate_discounted_stars(plan, promo_code)} stars"
                if discounted_stars is not None:
                    button_text = f"{plan['button_text']} • {format_discount_badge(promo_code)} • {discounted_stars} stars"
                keyboard.add(
                    types.InlineKeyboardButton(
                        text=button_text,
                        callback_data=plan["callback_data"],
                    )
                )
    return keyboard


def make_invoice_payload(plan_id: str, chat_id: int) -> str:
    return make_invoice_payload_with_promo(plan_id, chat_id, None)


def make_invoice_payload_with_promo(plan_id: str, chat_id: int, promo_code: str | None) -> str:
    promo_part = normalize_promo_code(promo_code) if promo_code else "-"
    return f"{plan_id}|{chat_id}|{promo_part}|{uuid.uuid4().hex[:8]}"


def parse_invoice_payload(invoice_payload: str):
    parts = invoice_payload.split("|")
    if len(parts) < 2:
        return None

    plan_id = parts[0]
    if plan_id not in PLANS_BY_ID:
        return None

    try:
        expected_chat_id = int(parts[1])
    except ValueError:
        return None

    promo_code = None
    if len(parts) >= 3 and parts[2] != "-":
        promo_code = normalize_promo_code(parts[2])

    return {
        "plan_id": plan_id,
        "expected_chat_id": expected_chat_id,
        "promo_code": promo_code,
    }


def format_plan_label(plan: dict) -> str:
    return "Навсегда" if plan["permanent"] else f"{plan['days']} дней"


def format_promo_summary(promo_code: dict) -> str:
    target_plan_id = promo_code.get("target_plan_id", "all")
    target_label = "все тарифы" if target_plan_id == "all" else target_plan_id
    max_uses = int(promo_code.get("max_uses", 0))
    usage_label = "без лимита" if max_uses == 0 else f"{promo_code['used_count']}/{max_uses}"
    return (
        f"<code>{promo_code['code']}</code> — скидка {promo_code['discount_percent']}% "
        f"({target_label}, использовано {usage_label})"
    )


def format_license_key_summary(license_key: dict) -> str:
    access_label = "навсегда" if int(license_key.get("permanent", 0)) else f"{license_key['days']} дней"
    suffix = ""
    if license_key.get("status") == "redeemed":
        suffix = f" → chat {license_key.get('redeemed_by_chat_id', 'unknown')}"
    return f"<code>{license_key['key']}</code> — {access_label} [{license_key['status']}]{suffix}"


def build_plans_message(chat_id: int | None = None) -> str:
    active_promo = None
    effective_plans = [dict(plan) for plan in PLANS]
    with db_lock:
        with get_connection() as connection:
            effective_plans = list_effective_plans(connection)
            if chat_id is not None:
                active_promo = get_active_chat_promo(connection, chat_id)

    lines = [
        "<b>Магазин Limitless</b>",
        "",
        "Токен создается только после первой успешной оплаты или активации ключа и затем остается вашим основным токеном.",
        "",
    ]
    for plan in effective_plans:
        applicable_promo = None
        if active_promo and active_promo.get("target_plan_id", "all") in {"all", plan["id"]}:
            applicable_promo = active_promo

        if applicable_promo:
            discounted = calculate_discounted_stars(plan, applicable_promo)
            discount_label = format_discount_badge(applicable_promo)
            lines.append(f"• {format_plan_label(plan)} — <s>{plan['stars']}</s> {discounted} stars")
            lines[-1] = f"• {format_plan_label(plan)} — <s>{plan['stars']}</s> {discounted} stars ({discount_label})"
        else:
            lines.append(f"• {format_plan_label(plan)} — {plan['stars']} stars")
    if active_promo:
        lines.extend(["", f"Активный промокод: {format_promo_summary(active_promo)}"])
    lines.extend([
        "",
        "Команды:",
        "/promo &lt;код&gt; — применить промокод",
        "/redeem &lt;ключ&gt; — активировать выданный ключ",
    ])
    return "\n".join(lines)


def send_subscription_offer(chat_id: int) -> None:
    bot.send_message(
        chat_id,
        build_plans_message(chat_id),
        parse_mode="HTML",
        reply_markup=build_purchase_keyboard_for_chat(chat_id),
    )


def send_subscription_invoice(chat_id: int, plan: dict) -> None:
    promo_code = None
    effective_plan = dict(plan)
    amount = int(effective_plan["stars"])
    with db_lock:
        with get_connection() as connection:
            effective_plan = get_effective_plan(connection, plan)
            amount = int(effective_plan["stars"])
            active_promo = get_active_chat_promo(connection, chat_id, effective_plan)
            if active_promo:
                promo_code = active_promo["code"]
                amount = calculate_discounted_stars(effective_plan, active_promo)

    bot.send_invoice(
        chat_id=chat_id,
        title=effective_plan["title"],
        description=effective_plan["description"],
        invoice_payload=make_invoice_payload_with_promo(effective_plan["id"], chat_id, promo_code),
        provider_token="",
        currency="XTR",
        prices=[types.LabeledPrice(label=effective_plan["description"], amount=amount)],
        start_parameter=f"limitless-{effective_plan['id']}",
    )


def build_support_message() -> str:
    if PAY_SUPPORT_CONTACT:
        return (
            "По вопросам оплаты и подписки напишите в поддержку: "
            f"{PAY_SUPPORT_CONTACT}\n"
            "Telegram Support и Bot Support не обрабатывают покупки внутри этого бота."
        )
    return (
        "По вопросам оплаты напишите владельцу этого бота или в ваш основной канал поддержки.\n"
        "Telegram Support и Bot Support не обрабатывают покупки внутри этого бота."
    )


def build_admin_panel_text() -> str:
    return (
        "<b>Админ-панель Limitless</b>\n\n"
        "Быстрые команды:\n"
        "/createkey &lt;30|90|lifetime|days:N&gt; [count] — создать ключи\n"
        "/createpromo &lt;CODE&gt; &lt;discount%&gt; [all|subscription_30d|subscription_90d|lifetime_access] [max_uses] — создать промокод\n"
        "/keylist [unused|redeemed|all] [limit] — список ключей\n"
        "/promolist [active|all] [limit] — список промокодов\n"
        "/extend &lt;token&gt; &lt;days&gt; — вручную продлить токен\n\n"
        "Пользовательские команды:\n"
        "/shop — магазин\n"
        "/promo &lt;код&gt; — применить промокод\n"
        "/redeem &lt;ключ&gt; — активировать ключ"
    )


def build_license_key_list_message(keys: list[dict], title: str) -> str:
    if not keys:
        return f"<b>{title}</b>\n\nКлючей пока нет."
    return "<b>{}</b>\n\n{}".format(
        title,
        "\n".join(format_license_key_summary(key) for key in keys),
    )


def build_promo_list_message(promos: list[dict], title: str) -> str:
    if not promos:
        return f"<b>{title}</b>\n\nПромокодов пока нет."
    return "<b>{}</b>\n\n{}".format(
        title,
        "\n".join(format_promo_summary(promo) for promo in promos),
    )


def build_admin_list_message(connection: sqlite3.Connection) -> str:
    persistent_admins = list_admin_users(connection)
    env_admins = sorted(ADMIN_CHAT_IDS)

    lines = ["<b>Администраторы Limitless</b>", ""]

    if env_admins:
        lines.append("<b>Основные админы:</b>")
        for admin_id in env_admins:
            lines.append(f"• <code>{admin_id}</code> — основной админ")
        lines.append("")

    lines.append("<b>Добавленные через бота:</b>")
    if not persistent_admins:
        lines.append("• Пока нет")
    else:
        for admin in persistent_admins:
            username = html.escape(str(admin.get("username") or "без username"))
            added_by = admin.get("added_by")
            suffix = f", добавил {added_by}" if added_by else ""
            lines.append(f"• <code>{admin['user_id']}</code> — {username}{suffix}")

    lines.extend([
        "",
        "Команды:",
        "/addadmin &lt;id&gt; [username]",
        "/removeadmin &lt;id&gt;",
        "/adminlist",
    ])
    return "\n".join(lines)


def activate_token(token: str, device_id: str, client_ip: str | None = None) -> dict:
    token = token.strip()
    device_id = device_id.strip()
    client_ip = (client_ip or "").strip()

    if not token or not device_id:
        return {"valid": False, "error": "INVALID_REQUEST"}

    with db_lock:
        with get_connection() as connection:
            if token.upper().startswith("KEY-"):
                normalized_key = token.upper()
                license_key = get_license_key_by_value(connection, normalized_key)
                if not license_key:
                    return {"valid": False, "error": "KEY_NOT_FOUND", "token": None}

                if license_key["status"] == "unused":
                    token_data = create_token_record_for_license_key(connection, license_key)
                    updated_token = apply_plan_to_token_record(connection, token_data, build_plan_from_license_key(license_key))
                    connection.execute(
                        """
                        UPDATE license_keys
                        SET status = 'redeemed',
                            redeemed_at = ?,
                            redeemed_by_chat_id = ?,
                            redeemed_token = ?
                        WHERE key = ?
                        """,
                        (now_iso(), generate_license_chat_id(normalized_key), updated_token["token"], normalized_key),
                    )
                    connection.commit()
                    token = updated_token["token"]
                else:
                    redeemed_token = license_key.get("redeemed_token")
                    if not redeemed_token:
                        return {"valid": False, "error": "KEY_ALREADY_USED", "token": None}
                    token = redeemed_token

            token_data = get_token_by_value(connection, token)
            if not token_data:
                return {"valid": False, "error": "TOKEN_NOT_FOUND", "token": None}

            if token_data.get("revoked_at"):
                return {"valid": False, "error": "TOKEN_REVOKED", "token": None}

            if token_data.get("subscription_status") != "active":
                return {"valid": False, "error": "SUBSCRIPTION_INACTIVE", "token": None}

            if is_subscription_expired(token_data.get("subscription_expires_at")):
                return {"valid": False, "error": "SUBSCRIPTION_EXPIRED", "token": None}

            activated_ip = (token_data.get("activated_ip") or "").strip()
            if activated_ip and client_ip and activated_ip != client_ip:
                return {"valid": False, "error": "TOKEN_ALREADY_BOUND", "token": None}

            if not token_data.get("activated_at"):
                connection.execute(
                    """
                    UPDATE auth_tokens
                    SET activated_ip = ?, activated_at = ?, last_seen_at = ?
                    WHERE token = ?
                    """,
                    (client_ip or None, now_iso(), now_iso(), token),
                )
            elif not activated_ip and client_ip:
                connection.execute(
                    """
                    UPDATE auth_tokens
                    SET activated_ip = ?, last_seen_at = ?
                    WHERE token = ?
                    """,
                    (client_ip, now_iso(), token),
                )
            else:
                connection.execute(
                    "UPDATE auth_tokens SET last_seen_at = ? WHERE token = ?",
                    (now_iso(), token),
                )

            connection.commit()

            return {
                "valid": True,
                "username": token_data.get("username"),
                "error": None,
                "token": token,
            }


def build_admin_panel_text() -> str:
    return (
        "<b>Админ-панель Limitless</b>\n\n"
        "Быстрые команды:\n"
        "/addadmin &lt;id&gt; [username] — добавить админа\n"
        "/removeadmin &lt;id&gt; — убрать админа\n"
        "/adminlist — список админов\n"
        "/createkey &lt;30|90|lifetime|days:N&gt; [count] — создать ключи\n"
        "/createpromo &lt;CODE&gt; &lt;discount%&gt; [all|subscription_30d|subscription_90d|lifetime_access] [max_uses] — создать промокод\n"
        "/deletepromo &lt;CODE&gt; — удалить промокод\n"
        "/prices — текущие цены магазина\n"
        "/setprice &lt;30|90|lifetime&gt; &lt;stars&gt; — изменить цену\n"
        "/keylist [unused|redeemed|all] [limit] — список ключей\n"
        "/promolist [active|all] [limit] — список промокодов\n"
        "/extend &lt;token&gt; &lt;days&gt; — вручную продлить токен\n\n"
        "Пользовательские команды:\n"
        "/shop — магазин\n"
        "/promo &lt;код&gt; — применить промокод\n"
        "/redeem &lt;ключ&gt; — активировать ключ"
    )


def parse_admin_target_id(raw_value: str) -> int:
    return int(raw_value.strip())


@bot.message_handler(commands=["start", "help"])
def send_welcome(message):
    username = html.escape(message.from_user.username or message.from_user.first_name or "User")
    text = (
        f"<b>Limitless Auth Bot</b>\n\n"
        f"Привет, {username}!\n\n"
        "У пользователя нет токена до первой покупки.\n"
        "После первой успешной оплаты бот создает один постоянный токен, который потом только продлевается.\n\n"
        "Команды:\n"
        "/shop - открыть магазин и оплату через Telegram Stars\n"
        "/buy - открыть магазин и оплату через Telegram Stars\n"
        "/token - показать токен, если он уже создан\n"
        "/mytoken - показать токен и статус доступа\n"
        "/promo &lt;код&gt; - применить промокод\n"
        "/redeem &lt;ключ&gt; - активировать выданный ключ\n"
        "/paysupport - контакты по оплате\n"
        "/help - эта справка\n"
    )
    if is_admin(message.from_user.id):
        text += (
            "\n\n/admin - админ-панель\n"
            "/createkey &lt;30|90|lifetime|days:N&gt; [count] - создать ключи\n"
            "/createpromo &lt;CODE&gt; &lt;discount%&gt; [plan] [max_uses] - создать промокод\n"
            "/keylist [unused|redeemed|all] [limit] - список ключей\n"
            "/promolist [active|all] [limit] - список промокодов\n"
            "/extend &lt;token&gt; &lt;days&gt; - вручную продлить существующий токен"
        )
    bot.send_message(message.chat.id, text, parse_mode="HTML", reply_markup=build_purchase_keyboard_for_chat(message.chat.id))


@bot.message_handler(commands=["buy", "plans", "shop"])
def handle_buy(message):
    send_subscription_offer(message.chat.id)


@bot.message_handler(commands=["myid", "id"])
def handle_my_id(message):
    bot.send_message(
        message.chat.id,
        f"Ваш Telegram ID: <code>{message.from_user.id}</code>",
        parse_mode="HTML",
    )


@bot.message_handler(commands=["promo"])
def handle_promo(message):
    parts = message.text.split(maxsplit=1)
    if len(parts) != 2:
        bot.send_message(message.chat.id, "Использование: /promo <код>")
        return

    promo_code_input = parts[1].strip()
    with db_lock:
        with get_connection() as connection:
            promo_code = get_promo_code(connection, promo_code_input)
            if not promo_code:
                bot.send_message(message.chat.id, "Промокод не найден.")
                return

            if not int(promo_code.get("active", 0)):
                bot.send_message(message.chat.id, "Промокод отключен.")
                return

            if is_promo_expired(promo_code):
                bot.send_message(message.chat.id, "Срок действия промокода закончился.")
                return

            max_uses = int(promo_code.get("max_uses", 0))
            if max_uses > 0 and int(promo_code.get("used_count", 0)) >= max_uses:
                bot.send_message(message.chat.id, "У этого промокода закончились активации.")
                return

            if has_chat_used_promo(connection, message.chat.id, promo_code["code"]):
                bot.send_message(message.chat.id, "Этот промокод уже был использован на вашем аккаунте.")
                return

            set_chat_promo(connection, message.chat.id, promo_code["code"])
            connection.commit()

    bot.send_message(
        message.chat.id,
        (
            "<b>Промокод применен</b>\n\n"
            f"{format_promo_summary(promo_code)}\n\n"
            "Теперь откройте /shop и оплатите нужный тариф со скидкой."
        ),
        parse_mode="HTML",
        reply_markup=build_purchase_keyboard_for_chat(message.chat.id),
    )


@bot.message_handler(commands=["redeem"])
def handle_redeem(message):
    parts = message.text.split(maxsplit=1)
    if len(parts) != 2:
        bot.send_message(message.chat.id, "Использование: /redeem <ключ>")
        return

    username = message.from_user.username or message.from_user.first_name or "User"
    result = redeem_license_key(message.chat.id, username, parts[1])
    if not result["ok"]:
        if result["error"] == "KEY_ALREADY_USED":
            bot.send_message(message.chat.id, "Этот ключ уже был использован.")
        else:
            bot.send_message(message.chat.id, "Ключ не найден.")
        return

    bot.send_message(
        message.chat.id,
        (
            "<b>Ключ активирован</b>\n\n"
            f"{format_license_key_summary(result['license_key'])}\n\n"
            f"Ваш токен:\n{build_token_summary(result['token'])}"
        ),
        parse_mode="HTML",
    )


@bot.message_handler(commands=["token", "mytoken"])
def handle_token(message):
    chat_id = message.chat.id
    admin_access = is_admin(message.from_user.id)
    username = message.from_user.username or message.from_user.first_name or "User"

    with db_lock:
        with get_connection() as connection:
            token_data = get_token_by_chat_id(connection, chat_id)
            if admin_access:
                token_data = ensure_admin_lifetime_token(connection, chat_id, username)
                connection.commit()

    if not token_data:
        bot.send_message(
            chat_id,
            (
                "<b>Токена пока нет</b>\n\n"
                "Токен создается только после первой успешной оплаты.\n"
                "Выберите тариф ниже."
            ),
            parse_mode="HTML",
            reply_markup=build_purchase_keyboard_for_chat(chat_id),
        )
        return

    bot.send_message(
        chat_id,
        f"<b>Ваш основной токен:</b>\n\n{build_token_summary(token_data)}",
        parse_mode="HTML",
        reply_markup=build_purchase_keyboard_for_chat(chat_id),
    )


@bot.message_handler(commands=["paysupport", "support"])
def handle_pay_support(message):
    bot.send_message(message.chat.id, build_support_message())


@bot.message_handler(commands=["revoke"])
def handle_revoke(message):
    bot.send_message(
        message.chat.id,
        "Замена и отзыв токена отключены. Токен создается один раз после покупки и затем только продлевается.",
    )


@bot.message_handler(commands=["extend"])
def handle_extend(message):
    chat_id = message.chat.id
    if not is_admin(message.from_user.id):
        bot.send_message(chat_id, "Эта команда доступна только администратору.")
        return

    parts = message.text.split()
    if len(parts) != 3:
        bot.send_message(chat_id, "Использование: /extend <token> <days>")
        return

    token = parts[1].strip()
    try:
        days = int(parts[2])
    except ValueError:
        bot.send_message(chat_id, "Количество дней должно быть целым числом.")
        return

    if days <= 0:
        bot.send_message(chat_id, "Количество дней должно быть больше нуля.")
        return

    updated_token = extend_token_subscription(token, days)
    if not updated_token:
        bot.send_message(chat_id, "Токен не найден.")
        return

    bot.send_message(
        chat_id,
        (
            "<b>Подписка продлена</b>\n\n"
            f"<code>{updated_token['token']}</code>\n\n"
            f"{format_subscription_status(updated_token)}"
        ),
        parse_mode="HTML",
    )


@bot.message_handler(commands=["admin"])
def handle_admin(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    bot.send_message(
        message.chat.id,
        build_admin_panel_text(),
        parse_mode="HTML",
        reply_markup=build_admin_keyboard(),
    )


@bot.message_handler(commands=["addadmin"])
def handle_add_admin(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    parts = message.text.split(maxsplit=2)
    if len(parts) < 2:
        bot.send_message(message.chat.id, "Использование: /addadmin <id> [username]")
        return

    try:
        target_user_id = parse_admin_target_id(parts[1])
    except ValueError:
        bot.send_message(message.chat.id, "ID администратора должен быть числом.")
        return

    username = parts[2].strip() if len(parts) == 3 else None
    username = username or None

    if target_user_id in ADMIN_CHAT_IDS:
        bot.send_message(message.chat.id, f"<code>{target_user_id}</code> уже является основным админом.", parse_mode="HTML")
        return

    with db_lock:
        with get_connection() as connection:
            existing_admin = get_admin_user(connection, target_user_id)
            admin_record = add_admin_user(connection, target_user_id, username, message.from_user.id)
            admin_token = ensure_admin_lifetime_token(
                connection,
                target_user_id,
                username or f"admin_{target_user_id}",
            )
            connection.commit()

    status_text = "обновлен" if existing_admin else "добавлен"
    display_name = html.escape(str(admin_record.get("username") or "без username"))
    bot.send_message(
        message.chat.id,
        f"<b>Админ {status_text}</b>\n\nID: <code>{target_user_id}</code>\nUsername: {display_name}",
        parse_mode="HTML",
    )
    bot.send_message(
        message.chat.id,
        f"<b>Вечный токен админа</b>\n\n{build_token_summary(admin_token)}",
        parse_mode="HTML",
    )


@bot.message_handler(commands=["removeadmin"])
def handle_remove_admin(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    parts = message.text.split(maxsplit=1)
    if len(parts) != 2:
        bot.send_message(message.chat.id, "Использование: /removeadmin <id>")
        return

    try:
        target_user_id = parse_admin_target_id(parts[1])
    except ValueError:
        bot.send_message(message.chat.id, "ID администратора должен быть числом.")
        return

    if target_user_id in ADMIN_CHAT_IDS:
        bot.send_message(message.chat.id, "Основного админа из TELEGRAM_ADMIN_IDS удалить через бота нельзя.")
        return

    with db_lock:
        with get_connection() as connection:
            existing_admin = get_admin_user(connection, target_user_id)
            if not existing_admin:
                bot.send_message(message.chat.id, "Такой добавленный админ не найден.")
                return
            remove_admin_user(connection, target_user_id)
            connection.commit()

    bot.send_message(message.chat.id, f"Админ <code>{target_user_id}</code> удален.", parse_mode="HTML")


@bot.message_handler(commands=["adminlist"])
def handle_admin_list(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    with db_lock:
        with get_connection() as connection:
            text = build_admin_list_message(connection)

    bot.send_message(message.chat.id, text, parse_mode="HTML")


@bot.message_handler(commands=["createkey"])
def handle_create_key(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    parts = message.text.split()
    if len(parts) < 2 or len(parts) > 3:
        bot.send_message(message.chat.id, "Использование: /createkey <30|90|lifetime|days:N> [count]")
        return

    plan = resolve_plan_spec(parts[1])
    if not plan:
        bot.send_message(message.chat.id, "Не удалось определить срок ключа.")
        return

    count = 1
    if len(parts) == 3:
        try:
            count = int(parts[2])
        except ValueError:
            bot.send_message(message.chat.id, "Количество ключей должно быть числом.")
            return
    if count <= 0 or count > 20:
        bot.send_message(message.chat.id, "За раз можно создать от 1 до 20 ключей.")
        return

    with db_lock:
        with get_connection() as connection:
            created_keys = create_license_keys(connection, plan, message.from_user.id, count)
            connection.commit()

    bot.send_message(
        message.chat.id,
        build_license_key_list_message(created_keys, f"Создано ключей: {count}"),
        parse_mode="HTML",
    )


@bot.message_handler(commands=["createpromo"])
def handle_create_promo(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    parts = message.text.split()
    if len(parts) < 3 or len(parts) > 5:
        bot.send_message(
            message.chat.id,
            "Использование: /createpromo <CODE> <discount%> [all|subscription_30d|subscription_90d|lifetime_access] [max_uses]",
        )
        return

    code = normalize_promo_code(parts[1])
    try:
        discount_percent = parse_discount_percent(parts[2])
    except ValueError:
        bot.send_message(message.chat.id, "Размер скидки должен быть целым числом.")
        return

    target_plan_id = parts[3].strip() if len(parts) >= 4 else "all"
    if target_plan_id != "all":
        plan = resolve_plan_spec(target_plan_id)
        if not plan:
            bot.send_message(message.chat.id, "Неизвестный тариф для промокода.")
            return
        target_plan_id = plan["id"]

    max_uses = 0
    if len(parts) == 5:
        try:
            max_uses = int(parts[4])
        except ValueError:
            bot.send_message(message.chat.id, "Лимит использований должен быть числом.")
            return

    if discount_percent <= 0 or discount_percent > 95:
        bot.send_message(message.chat.id, "Скидка должна быть в диапазоне от 1 до 95 процентов.")
        return
    if max_uses < 0:
        bot.send_message(message.chat.id, "Лимит использований не может быть отрицательным.")
        return

    with db_lock:
        with get_connection() as connection:
            if get_promo_code(connection, code):
                bot.send_message(message.chat.id, "Промокод с таким именем уже существует.")
                return
            promo_code = create_promo_code_record(connection, code, discount_percent, target_plan_id, max_uses, message.from_user.id)
            connection.commit()

    bot.send_message(
        message.chat.id,
        f"<b>Промокод создан</b>\n\n{format_promo_summary(promo_code)}",
        parse_mode="HTML",
    )


@bot.message_handler(commands=["keylist"])
def handle_key_list(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    parts = message.text.split()
    status_filter = parts[1].strip().lower() if len(parts) >= 2 else "unused"
    if status_filter not in {"unused", "redeemed", "all"}:
        bot.send_message(message.chat.id, "Использование: /keylist [unused|redeemed|all] [limit]")
        return

    limit = 10
    if len(parts) >= 3:
        try:
            limit = int(parts[2])
        except ValueError:
            bot.send_message(message.chat.id, "Лимит должен быть числом.")
            return
    limit = max(1, min(limit, 30))

    with db_lock:
        with get_connection() as connection:
            keys = list_license_keys(connection, status_filter=status_filter, limit=limit)

    bot.send_message(
        message.chat.id,
        build_license_key_list_message(keys, f"Ключи: {status_filter}"),
        parse_mode="HTML",
    )


@bot.message_handler(commands=["promolist"])
def handle_promo_list(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    parts = message.text.split()
    mode = parts[1].strip().lower() if len(parts) >= 2 else "active"
    if mode not in {"active", "all"}:
        bot.send_message(message.chat.id, "Использование: /promolist [active|all] [limit]")
        return

    limit = 10
    if len(parts) >= 3:
        try:
            limit = int(parts[2])
        except ValueError:
            bot.send_message(message.chat.id, "Лимит должен быть числом.")
            return
    limit = max(1, min(limit, 30))

    with db_lock:
        with get_connection() as connection:
            promos = list_promo_codes(connection, include_inactive=(mode == "all"), limit=limit)

    bot.send_message(
        message.chat.id,
        build_promo_list_message(promos, f"Промокоды: {mode}"),
        parse_mode="HTML",
    )


@bot.message_handler(commands=["prices"])
def handle_prices(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    with db_lock:
        with get_connection() as connection:
            text = build_price_list_message(connection, "Текущие цены")

    bot.send_message(message.chat.id, text, parse_mode="HTML")


@bot.message_handler(commands=["setprice"])
def handle_set_price(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    parts = message.text.split()
    if len(parts) != 3:
        bot.send_message(message.chat.id, "Использование: /setprice <30|90|lifetime> <stars>")
        return

    plan = resolve_plan_spec(parts[1])
    if not plan or plan["id"] not in PLANS_BY_ID:
        bot.send_message(message.chat.id, "Неизвестный тариф. Доступно: 30, 90, lifetime.")
        return

    try:
        stars = int(parts[2])
    except ValueError:
        bot.send_message(message.chat.id, "Новая цена должна быть целым числом.")
        return

    if stars <= 0 or stars > 100000:
        bot.send_message(message.chat.id, "Цена должна быть в диапазоне от 1 до 100000 stars.")
        return

    with db_lock:
        with get_connection() as connection:
            set_plan_price_override(connection, plan["id"], stars, message.from_user.id)
            effective_plan = get_effective_plan(connection, plan["id"])
            text = build_price_list_message(connection, "Цена обновлена")
            connection.commit()

    bot.send_message(
        message.chat.id,
        f"{text}\n\nОбновлено: {format_plan_label(effective_plan)} — {int(effective_plan['stars'])} stars",
        parse_mode="HTML",
    )


@bot.message_handler(commands=["deletepromo"])
def handle_delete_promo(message):
    if not is_admin(message.from_user.id):
        bot.send_message(message.chat.id, "Эта команда доступна только администратору.")
        return

    parts = message.text.split(maxsplit=1)
    if len(parts) != 2:
        bot.send_message(message.chat.id, "Использование: /deletepromo <CODE>")
        return

    with db_lock:
        with get_connection() as connection:
            deleted_promo = delete_promo_code(connection, parts[1])
            if not deleted_promo:
                bot.send_message(message.chat.id, "Промокод не найден.")
                return
            connection.commit()

    bot.send_message(
        message.chat.id,
        f"<b>Промокод удален</b>\n\n{format_promo_summary(deleted_promo)}",
        parse_mode="HTML",
    )


@bot.callback_query_handler(func=lambda call: call.data in PLANS_BY_CALLBACK)
def handle_buy_callback(call):
    plan = PLANS_BY_CALLBACK[call.data]
    try:
        send_subscription_invoice(call.message.chat.id, plan)
        bot.answer_callback_query(call.id)
    except Exception:
        bot.answer_callback_query(call.id, "Не удалось открыть оплату. Попробуйте позже.")


@bot.callback_query_handler(func=lambda call: call.data.startswith("admin_"))
def handle_admin_callback(call):
    if not is_admin(call.from_user.id):
        bot.answer_callback_query(call.id, "Недостаточно прав.")
        return

    if call.data.startswith("admin_key_"):
        plan_id = call.data.replace("admin_key_", "", 1)
        plan = resolve_plan_spec(plan_id)
        if not plan:
            bot.answer_callback_query(call.id, "Не удалось создать ключ.")
            return
        with db_lock:
            with get_connection() as connection:
                created_keys = create_license_keys(connection, plan, call.from_user.id, 1)
                connection.commit()
        bot.send_message(
            call.message.chat.id,
            build_license_key_list_message(created_keys, "Быстрый ключ создан"),
            parse_mode="HTML",
        )
        bot.answer_callback_query(call.id, "Ключ создан.")
        return

    if call.data == "admin_list_keys":
        with db_lock:
            with get_connection() as connection:
                keys = list_license_keys(connection, status_filter="unused", limit=10)
        bot.send_message(
            call.message.chat.id,
            build_license_key_list_message(keys, "Последние ключи"),
            parse_mode="HTML",
        )
        bot.answer_callback_query(call.id)
        return

    if call.data == "admin_list_promos":
        with db_lock:
            with get_connection() as connection:
                promos = list_promo_codes(connection, include_inactive=False, limit=10)
        bot.send_message(
            call.message.chat.id,
            build_promo_list_message(promos, "Активные промокоды"),
            parse_mode="HTML",
        )
        bot.answer_callback_query(call.id)
        return

    if call.data == "admin_open_shop":
        send_subscription_offer(call.message.chat.id)
        bot.answer_callback_query(call.id)
        return

    bot.answer_callback_query(call.id)


@bot.pre_checkout_query_handler(func=lambda query: True)
def handle_pre_checkout_query(pre_checkout_query):
    parsed_payload = parse_invoice_payload(pre_checkout_query.invoice_payload)
    if not parsed_payload:
        bot.answer_pre_checkout_query(
            pre_checkout_query.id,
            ok=False,
            error_message="Не удалось определить тариф оплаты.",
        )
        return

    if parsed_payload["expected_chat_id"] != pre_checkout_query.from_user.id:
        bot.answer_pre_checkout_query(
            pre_checkout_query.id,
            ok=False,
            error_message="Этот счет привязан к другому пользователю.",
        )
        return

    promo_code = parsed_payload.get("promo_code")
    with db_lock:
        with get_connection() as connection:
            plan = get_effective_plan(connection, parsed_payload["plan_id"])
            if not plan:
                bot.answer_pre_checkout_query(
                    pre_checkout_query.id,
                    ok=False,
                    error_message="Не удалось определить тариф оплаты.",
                )
                return

            if pre_checkout_query.currency != "XTR":
                bot.answer_pre_checkout_query(
                    pre_checkout_query.id,
                    ok=False,
                    error_message="Для этой покупки используются только Telegram Stars.",
                )
                return

            expected_amount = int(plan["stars"])
            if promo_code:
                promo = get_promo_code(connection, promo_code)
                if not is_promo_valid_for_plan(connection, promo, plan, pre_checkout_query.from_user.id):
                    bot.answer_pre_checkout_query(
                        pre_checkout_query.id,
                        ok=False,
                        error_message="Промокод больше недоступен.",
                    )
                    return
                expected_amount = calculate_discounted_stars(plan, promo)

    if int(pre_checkout_query.total_amount) != expected_amount:
        bot.answer_pre_checkout_query(
            pre_checkout_query.id,
            ok=False,
            error_message="Сумма оплаты не совпадает с тарифом.",
        )
        return

    bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)


@bot.message_handler(content_types=["successful_payment"])
def handle_successful_payment(message):
    payment = message.successful_payment
    parsed_payload = parse_invoice_payload(payment.invoice_payload)
    if not parsed_payload:
        bot.send_message(
            message.chat.id,
            "Оплата получена, но тариф не удалось распознать. Напишите в поддержку.",
        )
        return

    promo_code = parsed_payload.get("promo_code")
    charge_id = payment.telegram_payment_charge_id
    username = message.from_user.username or message.from_user.first_name or "User"
    plan = None

    with db_lock:
        with get_connection() as connection:
            plan = get_effective_plan(connection, parsed_payload["plan_id"])
            if not plan:
                bot.send_message(
                    message.chat.id,
                    "Оплата получена, но тариф не удалось распознать. Напишите в поддержку.",
                )
                return
            existing_payment = get_star_payment_by_charge_id(connection, charge_id)
            if existing_payment:
                token_data = get_token_by_value(connection, existing_payment["token"])
                connection.commit()
                if token_data:
                    bot.send_message(
                        message.chat.id,
                        (
                            "<b>Эта оплата уже была обработана</b>\n\n"
                            f"{format_subscription_status(token_data)}"
                        ),
                        parse_mode="HTML",
                    )
                return

            token_data = get_or_create_token_record(connection, message.chat.id, username)
            updated_token = apply_plan_to_token_record(connection, token_data, plan)
            record_star_payment(
                connection=connection,
                telegram_payment_charge_id=payment.telegram_payment_charge_id,
                provider_payment_charge_id=payment.provider_payment_charge_id,
                chat_id=message.chat.id,
                token=updated_token["token"],
                plan_id=plan["id"],
                promo_code=promo_code,
                invoice_payload=payment.invoice_payload,
                currency=payment.currency,
                total_amount=int(payment.total_amount),
                days=int(plan["days"]),
            )
            if promo_code:
                promo = get_promo_code(connection, promo_code)
                if promo and is_promo_valid_for_plan(connection, promo, plan, message.chat.id):
                    connection.execute(
                        "UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?",
                        (promo_code,),
                    )
                clear_chat_promo(connection, message.chat.id)
            connection.commit()

    access_line = "Доступ: навсегда" if plan["permanent"] else f"Продлено на: {plan['days']} дней"
    bot.send_message(
        message.chat.id,
        (
            "<b>Оплата прошла успешно</b>\n\n"
            f"Ваш токен: <code>{updated_token['token']}</code>\n"
            f"{access_line}\n"
            f"{format_subscription_status(updated_token)}"
        ),
        parse_mode="HTML",
    )


@app.route("/api/validate", methods=["POST"])
def validate_token_post():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"valid": False, "error": "INVALID_REQUEST"})

    token = str(data.get("token", "")).strip()
    device_id = str(data.get("deviceId", "")).strip()
    client_ip = data.get("clientIp")
    return jsonify(activate_token(token, device_id, client_ip))


@app.route("/api/admin/users", methods=["GET"])
def admin_list_users_api():
    if not is_internal_api_request_authorized():
        return unauthorized_internal_api_response()

    search = str(request.args.get("search", "")).strip()
    limit = max(1, min(request.args.get("limit", default=200, type=int), 500))

    with db_lock:
        with get_connection() as connection:
            users = list_admin_users(connection, search=search, limit=limit)
            summary = get_admin_user_summary(connection)

    return jsonify({
        "success": True,
        "users": users,
        "summary": summary,
        "error": None,
    })


@app.route("/api/admin/users/ban", methods=["POST"])
def admin_ban_user_api():
    if not is_internal_api_request_authorized():
        return unauthorized_internal_api_response()

    data = request.get_json(silent=True) or {}
    token = str(data.get("token", "")).strip()
    if not token:
        return jsonify({"success": False, "user": None, "error": "TOKEN_REQUIRED"}), 400

    with db_lock:
        with get_connection() as connection:
            updated_user = set_admin_ban_state(connection, token, True)

    if not updated_user:
        return jsonify({"success": False, "user": None, "error": "TOKEN_NOT_FOUND"}), 404

    return jsonify({
        "success": True,
        "user": format_admin_user_record(updated_user),
        "error": None,
    })


@app.route("/api/admin/users/unban", methods=["POST"])
def admin_unban_user_api():
    if not is_internal_api_request_authorized():
        return unauthorized_internal_api_response()

    data = request.get_json(silent=True) or {}
    token = str(data.get("token", "")).strip()
    if not token:
        return jsonify({"success": False, "user": None, "error": "TOKEN_REQUIRED"}), 400

    with db_lock:
        with get_connection() as connection:
            updated_user = set_admin_ban_state(connection, token, False)

    if not updated_user:
        return jsonify({"success": False, "user": None, "error": "TOKEN_NOT_FOUND"}), 404

    return jsonify({
        "success": True,
        "user": format_admin_user_record(updated_user),
        "error": None,
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


def run_flask():
    app.run(host="0.0.0.0", port=API_PORT, debug=False, use_reloader=False)


if __name__ == "__main__":
    init_db()
    migrate_sqlite_db_to_postgres()
    migrate_legacy_json()
    ensure_primary_admin_tokens()

    print(f"Limitless Token API started on port {API_PORT}")
    print("Bot started! Polling Telegram API...")

    api_thread = threading.Thread(target=run_flask)
    api_thread.daemon = True
    api_thread.start()

    bot.infinity_polling()
