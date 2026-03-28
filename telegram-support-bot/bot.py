import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import telebot
from flask import Flask, jsonify


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
                    f"[limitless-support-bot] Falling back from {preferred} to {candidate} because the original path is not writable.",
                    flush=True,
                )
            return candidate
        except OSError as exc:
            last_error = exc

    if last_error is not None:
        raise last_error
    return preferred


BOT_TOKEN = os.getenv("SUPPORT_BOT_TOKEN", "").strip()
OWNER_ID_RAW = os.getenv("SUPPORT_BOT_OWNER_ID", "").strip()
OWNER_ID = int(OWNER_ID_RAW or "0")
RETRY_INTERVAL_SECONDS = max(5, int(os.getenv("SUPPORT_RETRY_INTERVAL_SECONDS", "15")))
API_PORT = int(os.getenv("SUPPORT_API_PORT", os.getenv("PORT", "3002")))
DB_FILE = resolve_writable_path(
    os.getenv("SUPPORT_DB_PATH", str(Path(__file__).with_name("support.db"))),
    "support-bot",
)

if not BOT_TOKEN:
    raise RuntimeError("SUPPORT_BOT_TOKEN is required")

if OWNER_ID <= 0:
    raise RuntimeError("SUPPORT_BOT_OWNER_ID must be a positive Telegram user id")

bot = telebot.TeleBot(BOT_TOKEN)
pending_delivery_lock = threading.Lock()
app = Flask(__name__)


def log(message: str) -> None:
    print(message, flush=True)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "support-bot"})


def run_flask() -> None:
    app.run(host="0.0.0.0", port=API_PORT, debug=False, use_reloader=False)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS admins (
                user_id INTEGER PRIMARY KEY,
                role TEXT NOT NULL,
                username TEXT,
                display_name TEXT,
                added_by INTEGER NOT NULL,
                added_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS relay_messages (
                admin_chat_id INTEGER NOT NULL,
                admin_message_id INTEGER NOT NULL,
                user_chat_id INTEGER NOT NULL,
                user_message_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (admin_chat_id, admin_message_id)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS support_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_chat_id INTEGER NOT NULL,
                user_message_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                username TEXT,
                display_name TEXT,
                content_type TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                delivered_count INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at TEXT NOT NULL,
                forwarded_at TEXT,
                UNIQUE (user_chat_id, user_message_id)
            )
            """
        )
        connection.execute(
            """
            INSERT INTO admins (user_id, role, username, display_name, added_by, added_at)
            VALUES (?, 'owner', '', 'Owner', ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET role = 'owner'
            """,
            (OWNER_ID, OWNER_ID, now_iso()),
        )
        connection.commit()


def row_to_dict(row: sqlite3.Row | None) -> Optional[dict]:
    if row is None:
        return None
    return dict(row)


def sync_admin_identity(user) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE admins
            SET username = ?, display_name = ?
            WHERE user_id = ?
            """,
            (
                user.username or "",
                user.first_name or user.username or str(user.id),
                user.id,
            ),
        )
        connection.commit()


def get_admin(user_id: int) -> Optional[dict]:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM admins WHERE user_id = ? LIMIT 1",
            (user_id,),
        ).fetchone()
    return row_to_dict(row)


def is_admin(user_id: int) -> bool:
    return get_admin(user_id) is not None


def is_owner(user_id: int) -> bool:
    admin = get_admin(user_id)
    return bool(admin and admin.get("role") == "owner")


def add_admin(user_id: int, added_by: int) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO admins (user_id, role, username, display_name, added_by, added_at)
            VALUES (?, 'admin', '', '', ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET role = 'admin', added_by = excluded.added_by
            """,
            (user_id, added_by, now_iso()),
        )
        connection.commit()


def remove_admin(user_id: int) -> bool:
    if user_id == OWNER_ID:
        return False

    with get_connection() as connection:
        result = connection.execute(
            "DELETE FROM admins WHERE user_id = ?",
            (user_id,),
        )
        connection.commit()
        return result.rowcount > 0


def list_admins() -> list[dict]:
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM admins ORDER BY CASE WHEN role = 'owner' THEN 0 ELSE 1 END, user_id ASC"
        ).fetchall()
    return [dict(row) for row in rows]


def store_relay(admin_chat_id: int, admin_message_id: int, user_chat_id: int, user_message_id: int) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO relay_messages (
                admin_chat_id,
                admin_message_id,
                user_chat_id,
                user_message_id,
                created_at
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (admin_chat_id, admin_message_id, user_chat_id, user_message_id, now_iso()),
        )
        connection.commit()


def get_relay(admin_chat_id: int, admin_message_id: int) -> Optional[dict]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT * FROM relay_messages
            WHERE admin_chat_id = ? AND admin_message_id = ?
            LIMIT 1
            """,
            (admin_chat_id, admin_message_id),
        ).fetchone()
    return row_to_dict(row)


def get_admin_chat_ids() -> list[int]:
    return [admin["user_id"] for admin in list_admins()]


def build_admin_label(admin: dict) -> str:
    display_name = admin.get("display_name") or "Unknown"
    username = admin.get("username") or ""
    username_part = f" (@{username})" if username else ""
    return f"{display_name}{username_part} [{admin['role']}] id={admin['user_id']}"


def build_user_label(user) -> str:
    display_name = user.first_name or user.username or "User"
    username_part = f" (@{user.username})" if user.username else ""
    return f"{display_name}{username_part} • id={user.id}"


def build_user_label_from_record(record: dict) -> str:
    display_name = record.get("display_name") or "User"
    username = record.get("username") or ""
    username_part = f" (@{username})" if username else ""
    return f"{display_name}{username_part} • id={record['user_id']}"


def build_support_header(user_label: str, message_kind: str, delayed: bool = False) -> str:
    delivery_note = "Отложенная доставка: админ был офлайн, сообщение было сохранено в очереди.\n\n" if delayed else ""
    return (
        "<b>Новое обращение в поддержку</b>\n\n"
        f"{delivery_note}"
        f"Клиент: {user_label}\n"
        f"Тип: {message_kind}\n\n"
        "Чтобы ответить клиенту, сделайте reply на это сообщение или на сообщение ниже."
    )


def queue_support_message(message) -> dict:
    with get_connection() as connection:
        existing = connection.execute(
            """
            SELECT * FROM support_messages
            WHERE user_chat_id = ? AND user_message_id = ?
            LIMIT 1
            """,
            (message.chat.id, message.message_id),
        ).fetchone()
        if existing is not None:
            return dict(existing)

        cursor = connection.execute(
            """
            INSERT INTO support_messages (
                user_chat_id,
                user_message_id,
                user_id,
                username,
                display_name,
                content_type,
                status,
                delivered_count,
                last_error,
                created_at,
                forwarded_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, NULL)
            """,
            (
                message.chat.id,
                message.message_id,
                message.from_user.id,
                message.from_user.username or "",
                message.from_user.first_name or message.from_user.username or str(message.from_user.id),
                message.content_type,
                now_iso(),
            ),
        )
        record_id = cursor.lastrowid
        row = connection.execute(
            "SELECT * FROM support_messages WHERE id = ? LIMIT 1",
            (record_id,),
        ).fetchone()
        connection.commit()
    return dict(row)


def list_pending_support_messages(limit: int = 50) -> list[dict]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM support_messages
            WHERE status = 'pending'
            ORDER BY id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [dict(row) for row in rows]


def count_pending_support_messages() -> int:
    with get_connection() as connection:
        row = connection.execute(
            "SELECT COUNT(*) AS total FROM support_messages WHERE status = 'pending'"
        ).fetchone()
    return int(row["total"]) if row is not None else 0


def mark_support_message_forwarded(record_id: int, delivered_count: int) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE support_messages
            SET status = 'forwarded',
                delivered_count = ?,
                last_error = NULL,
                forwarded_at = ?
            WHERE id = ?
            """,
            (delivered_count, now_iso(), record_id),
        )
        connection.commit()


def mark_support_message_pending(record_id: int, error_text: str) -> None:
    with get_connection() as connection:
        connection.execute(
            """
            UPDATE support_messages
            SET status = 'pending',
                last_error = ?
            WHERE id = ?
            """,
            (error_text[:1000], record_id),
        )
        connection.commit()


def deliver_support_record_to_admins(record: dict, delayed: bool = False) -> int:
    admin_ids = get_admin_chat_ids()
    if not admin_ids:
        return 0

    message_kind = "Фото" if record["content_type"] == "photo" else "Сообщение"
    header = build_support_header(build_user_label_from_record(record), message_kind, delayed=delayed)

    delivered_count = 0
    errors: list[str] = []
    for admin_id in admin_ids:
        try:
            header_message = bot.send_message(admin_id, header, parse_mode="HTML")
            store_relay(admin_id, header_message.message_id, record["user_chat_id"], record["user_message_id"])

            copied_message = bot.copy_message(admin_id, record["user_chat_id"], record["user_message_id"])
            store_relay(admin_id, copied_message.message_id, record["user_chat_id"], record["user_message_id"])
            delivered_count += 1
        except Exception as exc:
            error_text = f"admin {admin_id}: {exc}"
            errors.append(error_text)
            log(f"Support delivery failed for record {record['id']} -> {error_text}")

    if delivered_count > 0:
        mark_support_message_forwarded(record["id"], delivered_count)
    else:
        mark_support_message_pending(record["id"], "; ".join(errors) or "No admin is reachable yet")

    return delivered_count


def flush_pending_support_messages(limit: int = 50) -> int:
    with pending_delivery_lock:
        delivered_total = 0
        for record in list_pending_support_messages(limit=limit):
            delivered_total += deliver_support_record_to_admins(record, delayed=True)
        return delivered_total


def retry_pending_support_messages_forever() -> None:
    while True:
        time.sleep(RETRY_INTERVAL_SECONDS)
        try:
            pending_total = count_pending_support_messages()
            if pending_total == 0:
                continue

            delivered_total = flush_pending_support_messages(limit=100)
            pending_left = count_pending_support_messages()
            if delivered_total > 0 or pending_left != pending_total:
                log(
                    "Support queue retry finished: "
                    f"delivered={delivered_total}, pending_left={pending_left}"
                )
        except Exception as exc:
            log(f"Support queue retry failed: {exc}")


def send_client_message_to_admins(message) -> None:
    record = queue_support_message(message)
    admin_ids = get_admin_chat_ids()
    if admin_ids:
        deliver_support_record_to_admins(record)
    else:
        log(f"Support message queued without active admins: record={record['id']}")

    bot.reply_to(message, "Ваше обращение отправлено администрации.")


def reply_from_admin(message) -> None:
    if not message.reply_to_message:
        bot.reply_to(
            message,
            "Админы не могут писать первыми. Ответьте реплаем на сообщение клиента.",
        )
        return

    relay = get_relay(message.chat.id, message.reply_to_message.message_id)
    if not relay:
        bot.reply_to(
            message,
            "Не удалось определить клиента для ответа. Ответьте реплаем на сообщение, которое пришло от пользователя.",
        )
        return

    try:
        bot.copy_message(
            relay["user_chat_id"],
            message.chat.id,
            message.message_id,
        )
    except Exception as exc:
        log(f"Support reply failed admin={message.chat.id} user_chat={relay['user_chat_id']}: {exc}")
        bot.reply_to(message, "Не удалось отправить ответ клиенту. Возможно, он остановил бота.")
        return

    bot.reply_to(message, "Ответ отправлен клиенту.")


def is_command_message(message) -> bool:
    return message.content_type == "text" and bool(message.text) and message.text.startswith("/")


@bot.message_handler(commands=["start"])
def handle_start(message):
    if is_admin(message.from_user.id):
        sync_admin_identity(message.from_user)
        delivered = flush_pending_support_messages()
        pending_left = count_pending_support_messages()
        note = ""
        if delivered > 0:
            note = f"\n\nДоставлено отложенных обращений: {delivered}."
        elif pending_left > 0:
            note = f"\n\nВ очереди еще ожидают обращения: {pending_left}. Можно повторить доставку командой /inbox."

        bot.send_message(
            message.chat.id,
            (
                "<b>Support Admin Bot</b>\n\n"
                "Вы в режиме администратора.\n"
                "Новые обращения клиентов будут приходить сюда.\n"
                "Ответ можно отправить только reply на сообщение клиента.\n\n"
                "Команды:\n"
                "/admins - список админов\n"
                "/addadmin &lt;id&gt; - добавить админа по id (только owner)\n"
                "/removeadmin &lt;id&gt; - удалить админа (только owner)\n"
                "/inbox - повторно доставить отложенные обращения"
                f"{note}"
            ),
            parse_mode="HTML",
        )
        return

    bot.send_message(
        message.chat.id,
        (
            "<b>Поддержка Limitless</b>\n\n"
            "Напишите сюда текстом или отправьте фото.\n"
            "Если администратор временно офлайн, ваше обращение сохранится и будет доставлено автоматически."
        ),
        parse_mode="HTML",
    )


@bot.message_handler(commands=["admins"])
def handle_admins(message):
    if not is_admin(message.from_user.id):
        bot.reply_to(message, "Эта команда доступна только администраторам.")
        return

    sync_admin_identity(message.from_user)
    admins = list_admins()
    if not admins:
        bot.reply_to(message, "Список админов пуст.")
        return

    lines = ["<b>Список админов</b>", ""]
    for admin in admins:
        lines.append(f"• {build_admin_label(admin)}")

    bot.send_message(message.chat.id, "\n".join(lines), parse_mode="HTML")


@bot.message_handler(commands=["inbox"])
def handle_inbox(message):
    if not is_admin(message.from_user.id):
        bot.reply_to(message, "Эта команда доступна только администраторам.")
        return

    sync_admin_identity(message.from_user)
    delivered = flush_pending_support_messages()
    pending_left = count_pending_support_messages()

    if delivered > 0:
        bot.reply_to(message, f"Готово. Доставлено отложенных обращений: {delivered}.")
        return

    if pending_left > 0:
        bot.reply_to(message, f"Пока не удалось доставить обращения. В очереди осталось: {pending_left}.")
        return

    bot.reply_to(message, "Очередь обращений пуста.")


@bot.message_handler(commands=["addadmin"])
def handle_add_admin(message):
    if not is_owner(message.from_user.id):
        bot.reply_to(message, "Добавлять админов может только owner.")
        return

    parts = message.text.split()
    if len(parts) != 2:
        bot.reply_to(message, "Использование: /addadmin <telegram_user_id>")
        return

    try:
        admin_user_id = int(parts[1])
    except ValueError:
        bot.reply_to(message, "User id должен быть числом.")
        return

    if admin_user_id <= 0:
        bot.reply_to(message, "User id должен быть положительным числом.")
        return

    add_admin(admin_user_id, message.from_user.id)
    bot.reply_to(
        message,
        f"Админ {admin_user_id} добавлен. Он должен открыть бота хотя бы один раз, чтобы получать обращения.",
    )


@bot.message_handler(commands=["removeadmin"])
def handle_remove_admin(message):
    if not is_owner(message.from_user.id):
        bot.reply_to(message, "Удалять админов может только owner.")
        return

    parts = message.text.split()
    if len(parts) != 2:
        bot.reply_to(message, "Использование: /removeadmin <telegram_user_id>")
        return

    try:
        admin_user_id = int(parts[1])
    except ValueError:
        bot.reply_to(message, "User id должен быть числом.")
        return

    if not remove_admin(admin_user_id):
        bot.reply_to(message, "Не удалось удалить админа. Проверьте id.")
        return

    bot.reply_to(message, f"Админ {admin_user_id} удален.")


@bot.message_handler(
    func=lambda message: not is_command_message(message),
    content_types=["text", "photo"],
)
def handle_messages(message):
    if is_admin(message.from_user.id):
        sync_admin_identity(message.from_user)
        reply_from_admin(message)
        return

    send_client_message_to_admins(message)


@bot.message_handler(func=lambda _: True, content_types=["audio", "document", "sticker", "video", "voice", "contact", "location"])
def handle_unsupported(message):
    if is_admin(message.from_user.id):
        bot.reply_to(
            message,
            "Для ответа клиенту используйте только текст или фото и обязательно reply на сообщение клиента.",
        )
        return

    bot.reply_to(message, "Поддержка сейчас принимает только текст и фото.")


if __name__ == "__main__":
    init_db()
    threading.Thread(
        target=run_flask,
        name="support-http-api",
        daemon=True,
    ).start()
    threading.Thread(
        target=retry_pending_support_messages_forever,
        name="support-retry-worker",
        daemon=True,
    ).start()
    log(f"Support bot started (retry every {RETRY_INTERVAL_SECONDS}s, http port {API_PORT})")
    bot.infinity_polling(skip_pending=True)
