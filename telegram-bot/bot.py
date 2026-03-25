import telebot
from flask import Flask, jsonify, request
from flask_cors import CORS
import threading
import os
import uuid
import time
from datetime import datetime

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8605146619:AAHaaOgLqDxUi62VIRMfQCZ13LLE2NGtRMU")
API_PORT = int(os.getenv("API_PORT", 3001))

bot = telebot.TeleBot(BOT_TOKEN)
app = Flask(__name__)
CORS(app)

# Хранилище токенов в памяти: token -> { "chatId", "username", "createdAt" }
tokens_db = {}

def generate_token():
    ts = str(int(time.time() * 1000))
    random_str = str(uuid.uuid4().hex)[:16]
    return f"LMT-{ts}-{random_str}"

@bot.message_handler(commands=['start', 'help'])
def send_welcome(message):
    username = message.from_user.username or message.from_user.first_name or "User"
    text = (
        f"<b>Limitless Auth Bot</b>\n\n"
        f"Привет, {username}!\n\n"
        f"Этот бот генерирует безопасные токены для доступа к промту Limitless.\n\n"
        f"Команды:\n"
        f"/token — Получить новый токен\n"
        f"/mytoken — Показать текущий токен\n"
        f"/revoke — Отозвать текущий токен\n"
        f"/help — Эта справка\n"
    )
    bot.send_message(message.chat.id, text, parse_mode='HTML')

@bot.message_handler(commands=['token'])
def handle_token(message):
    chat_id = message.chat.id
    username = message.from_user.username or message.from_user.first_name or "User"
    
    for t_key, t_data in tokens_db.items():
        if t_data['chatId'] == chat_id:
            bot.send_message(chat_id, "У вас уже есть активный токен.\n\nИспользуйте /mytoken чтобы его увидеть или /revoke чтобы отозвать старый и создать новый.")
            return

    new_token = generate_token()
    tokens_db[new_token] = {
        'chatId': chat_id,
        'username': username,
        'createdAt': datetime.now().isoformat()
    }
    
    msg = (
        f"<b>Ваш токен для Limitless:</b>\n\n"
        f"<code>{new_token}</code>\n\n"
        f"<i>Скопируйте и вставьте его на сайте для входа.</i>\n\n"
        f"⚠️ Не передавайте его третьим лицам!"
    )
    bot.send_message(chat_id, msg, parse_mode='HTML')

@bot.message_handler(commands=['mytoken'])
def handle_mytoken(message):
    chat_id = message.chat.id
    for t_key, t_data in tokens_db.items():
        if t_data['chatId'] == chat_id:
            bot.send_message(chat_id, f"<b>Ваш токен:</b>\n\n<code>{t_key}</code>\n\nСоздан: {t_data['createdAt']}", parse_mode='HTML')
            return
    bot.send_message(chat_id, "У вас нет активного токена. Введите /token для создания.")

@bot.message_handler(commands=['revoke'])
def handle_revoke(message):
    chat_id = message.chat.id
    token_to_delete = None
    for t_key, t_data in tokens_db.items():
        if t_data['chatId'] == chat_id:
            token_to_delete = t_key
            break
            
    if token_to_delete:
        del tokens_db[token_to_delete]
        bot.send_message(chat_id, "Токен успешно отозван. Используйте /token для создания нового.")
    else:
        bot.send_message(chat_id, "У вас нет активного токена.")

@app.route('/api/validate', methods=['POST'])
def validate_token_post():
    data = request.get_json()
    if not data or 'token' not in data:
        return jsonify({"valid": False})
    
    token = data['token']
    if token in tokens_db:
        t_data = tokens_db[token]
        return jsonify({
            "valid": True,
            "username": t_data['username']
        })
    return jsonify({"valid": False})

@app.route('/validate/<token>', methods=['GET'])
def validate_token(token):
    if token in tokens_db:
        t_data = tokens_db[token]
        return jsonify({
            "valid": True,
            "username": t_data['username']
        })
    return jsonify({"valid": False})

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

def run_flask():
    app.run(host="0.0.0.0", port=API_PORT, debug=False, use_reloader=False)

if __name__ == "__main__":
    print(f"Limitless Token API started on port {API_PORT}")
    print("Bot started! Polling Telegram API...")
    
    api_thread = threading.Thread(target=run_flask)
    api_thread.daemon = True
    api_thread.start()
    
    bot.infinity_polling()
