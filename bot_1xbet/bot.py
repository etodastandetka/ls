#!/usr/bin/env python3
"""
Простой Telegram бот для LUXON
Только команда /start с кнопками WebApp
"""

import logging
import re
import httpx
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, ContextTypes
from telegram.constants import ParseMode

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Токен бота
BOT_TOKEN = "8042108386:AAFGNVTTfrMy-KwHjxOA72Gd_iV-Bgy5u4U"

# URL сайта
WEBSITE_URL = "https://lux-on.org"
API_URL = "https://pipiska.net"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик команды /start"""
    user = update.effective_user
    user_id = user.id
    
    # Обработка реферальной ссылки
    # Пробуем получить параметр из context.args (предпочтительный способ)
    param = None
    if context.args and len(context.args) > 0:
        param = context.args[0]
        logger.info(f"📋 Получен параметр из context.args: {param}")
    elif update.message and update.message.text:
        # Fallback: получаем из текста сообщения
        parts = update.message.text.split()
        if len(parts) > 1:
            param = parts[1]
            logger.info(f"📋 Получен параметр из message.text: {param}")
    
    if param:
        # Обрабатываем формат ref123456 или ref_123456
        if param.startswith('ref'):
            referral_code = param[3:]  # Убираем 'ref'
            if referral_code.startswith('_'):
                referral_code = referral_code[1:]  # Убираем '_' если есть
            
            logger.info(f"🔍 Обработка реферального кода: {referral_code} для пользователя {user_id}")
            
            # Пытаемся извлечь ID рефера
            try:
                referrer_id = int(referral_code)
                if referrer_id == user_id:
                    logger.warning(f"⚠️ Пользователь {user_id} пытается пригласить самого себя")
                else:
                    # Регистрируем реферальную связь через API
                    logger.info(f"🔄 Регистрация реферала: {referrer_id} -> {user_id}")
                    try:
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            response = await client.post(
                                f"{API_URL}/api/referral/register",
                                json={
                                    "referrer_id": str(referrer_id),
                                    "referred_id": str(user_id),
                                    "username": user.username,
                                    "first_name": user.first_name,
                                    "last_name": user.last_name
                                },
                                headers={"Content-Type": "application/json"}
                            )
                            
                            logger.info(f"📡 Ответ API: статус {response.status_code}")
                            
                            if response.status_code == 200:
                                data = response.json()
                                logger.info(f"📋 Данные ответа: {data}")
                                if data.get('success'):
                                    logger.info(f"✅ Реферальная связь зарегистрирована: {referrer_id} -> {user_id}")
                                else:
                                    error_msg = data.get('error', 'Unknown error')
                                    logger.warning(f"⚠️ Не удалось зарегистрировать реферала: {error_msg}")
                            else:
                                try:
                                    error_text = response.text
                                    logger.error(f"❌ Ошибка API при регистрации реферала: {response.status_code} - {error_text[:200]}")
                                except:
                                    logger.error(f"❌ Ошибка API при регистрации реферала: {response.status_code}")
                    except httpx.TimeoutException:
                        logger.error(f"❌ Таймаут при регистрации реферала (превышено 10 секунд)")
                    except Exception as e:
                        logger.error(f"❌ Ошибка при регистрации реферала: {e}", exc_info=True)
            except ValueError as e:
                logger.warning(f"⚠️ Неверный формат реферального кода '{referral_code}': {e}")
    
    # Создаем кнопки как полноэкранные мини-приложения (WebApp)
    # Для бота 1xbet добавляем параметр ?bot=1xbet, чтобы показывать только 1xbet
    keyboard = [
        [
            InlineKeyboardButton("💰 Пополнить", web_app=WebAppInfo(url=f"{WEBSITE_URL}/deposit/step0?bot=1xbet")),
            InlineKeyboardButton("💸 Вывести", web_app=WebAppInfo(url=f"{WEBSITE_URL}/withdraw/step0?bot=1xbet"))
        ],
        [
            InlineKeyboardButton("📊 История", web_app=WebAppInfo(url=f"{WEBSITE_URL}/history?bot=1xbet")),
            InlineKeyboardButton("👥 Рефералы", web_app=WebAppInfo(url=f"{WEBSITE_URL}/referral?bot=1xbet"))
        ],
        [
            InlineKeyboardButton("ℹ️ Инструкция", web_app=WebAppInfo(url=f"{WEBSITE_URL}/instruction?bot=1xbet")),
            InlineKeyboardButton("🆘 Поддержка", web_app=WebAppInfo(url=f"{WEBSITE_URL}/support?bot=1xbet"))
        ],
        [
            InlineKeyboardButton("🚀 Открыть приложение", web_app=WebAppInfo(url=f"{WEBSITE_URL}?bot=1xbet"))
        ]
    ]
    
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    # Текст приветствия как на фото
    welcome_text = f"""Привет, {user.first_name}!

Пополнение | Вывод
из букмекерских контор!

📥 Пополнение — 0%
📤 Вывод — 0%
🕒 Работаем 24/7

👨‍💻 Поддержка: @operator_luxon_bot
💬 Чат для всех: @luxon_chat

🔒 Финансовый контроль обеспечен личным отделом безопасности

Выберите действие:"""
    
    # Отправляем текст с кнопками
    await update.message.reply_text(
        welcome_text,
        reply_markup=reply_markup
    )

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик всех текстовых сообщений от пользователей (не команд)"""
    if not update.message or not update.message.from_user:
        return
    
    user = update.message.from_user
    user_id = user.id
    message_text = update.message.text or update.message.caption or ''
    telegram_message_id = update.message.message_id
    
    # Пропускаем команды (они обрабатываются отдельными обработчиками)
    if message_text and message_text.startswith('/'):
        logger.debug(f"Пропускаем команду: {message_text}")
        return
    
    logger.info(f"📨 Получено сообщение от пользователя {user_id}: {message_text[:50] if message_text else 'медиа'}")
    
    # Определяем тип сообщения и медиа URL
    message_type = 'text'
    media_url = None
    
    if update.message.photo:
        message_type = 'photo'
        # Берем самое большое фото (последнее в массиве)
        media_url = update.message.photo[-1].file_id
    elif update.message.video:
        message_type = 'video'
        media_url = update.message.video.file_id
    elif update.message.document:
        message_type = 'document'
        media_url = update.message.document.file_id
    elif update.message.voice:
        message_type = 'voice'
        media_url = update.message.voice.file_id
    elif update.message.audio:
        message_type = 'audio'
        media_url = update.message.audio.file_id
    elif update.message.sticker:
        message_type = 'sticker'
        media_url = update.message.sticker.file_id
    # Обрабатываем стикеры, если они есть (через общий обработчик)
    
    # Сохраняем сообщение в админку через API
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            payload = {
                "message_text": message_text,
                "message_type": message_type,
                "media_url": media_url,
                "telegram_message_id": telegram_message_id
            }
            logger.debug(f"Отправка в API: {API_URL}/api/users/{user_id}/chat/ingest")
            logger.debug(f"Payload: {payload}")
            
            response = await client.post(
                f"{API_URL}/api/users/{user_id}/chat/ingest",
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                try:
                    response_data = response.json()
                    if response_data.get('success'):
                        logger.info(f"✅ Сообщение от пользователя {user_id} сохранено в чат (ID: {response_data.get('messageId')})")
                    else:
                        logger.warning(f"⚠️ API вернул success=false: {response_data.get('error')}")
                except Exception as parse_error:
                    logger.warning(f"⚠️ Не удалось распарсить ответ API: {parse_error}")
            else:
                try:
                    error_text = response.text
                    logger.error(f"❌ Ошибка API при сохранении сообщения: {response.status_code} - {error_text[:200]}")
                except:
                    logger.error(f"❌ Ошибка API при сохранении сообщения: {response.status_code}")
    except httpx.TimeoutException:
        logger.error(f"❌ Таймаут при сохранении сообщения в чат")
    except Exception as e:
        logger.error(f"❌ Ошибка при сохранении сообщения в чат: {e}", exc_info=True)

async def referral_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик команды /referral для просмотра реферальной статистики"""
    user = update.effective_user
    user_id = user.id
    
    try:
        # Получаем данные реферальной программы через API
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{API_URL}/api/public/referral-data",
                params={"user_id": str(user_id)}
            )
            
            if response.status_code == 200:
                data = response.json()
                
                if data.get('success'):
                    earned = data.get('earned', 0)
                    referral_count = data.get('referral_count', 0)
                    available_balance = data.get('available_balance', 0)
                    top_players = data.get('top_players', [])
                    user_rank = data.get('user_rank', 0)
                    
                    # Формируем сообщение
                    message_text = f"👥 <b>Реферальная программа</b>\n\n"
                    message_text += f"💰 Заработано: <b>{earned:.2f} сом</b>\n"
                    message_text += f"👤 Рефералов: <b>{referral_count}</b>\n"
                    
                    if available_balance > 0:
                        message_text += f"💵 Доступно для вывода: <b>{available_balance:.2f} сом</b>\n"
                    
                    if user_rank > 0:
                        message_text += f"\n🏆 Ваше место в топе: <b>#{user_rank}</b>\n"
                    
                    # Генерируем реферальную ссылку
                    referral_link = f"https://t.me/{context.bot.username}?start=ref{user_id}"
                    message_text += f"\n🔗 Ваша реферальная ссылка:\n<code>{referral_link}</code>\n"
                    
                    # Добавляем топ-5 игроков
                    if top_players:
                        message_text += f"\n🏆 <b>Топ-5 реферов:</b>\n"
                        for i, player in enumerate(top_players[:5], 1):
                            prize_text = ""
                            if player.get('prize'):
                                prize_text = f" (Приз: {player['prize']:.0f} сом)"
                            player_id = player.get('id', '')
                            player_username = player.get('username', f'Игрок #{player_id}')
                            message_text += f"{i}. {player_username}\n"
                            message_text += f"   💰 {player.get('total_deposits', 0):.0f} сом | 👥 {player.get('referral_count', 0)} реф.{prize_text}\n"
                    
                    # Кнопки
                    keyboard = [
                        [
                            InlineKeyboardButton("🚀 Открыть приложение", web_app=WebAppInfo(url=f"{WEBSITE_URL}/referral"))
                        ]
                    ]
                    reply_markup = InlineKeyboardMarkup(keyboard)
                    
                    await update.message.reply_text(
                        message_text,
                        reply_markup=reply_markup,
                        parse_mode='HTML'
                    )
                else:
                    await update.message.reply_text("❌ Ошибка при получении данных реферальной программы")
            else:
                await update.message.reply_text("❌ Ошибка при получении данных реферальной программы")
                
    except Exception as e:
        logger.error(f"Ошибка при получении реферальной статистики: {e}")
        await update.message.reply_text("❌ Произошла ошибка при получении данных")

async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик ошибок"""
    logger.error(f"Ошибка: {context.error}")

def main() -> None:
    """Главная функция"""
    # Создаем приложение
    application = Application.builder().token(BOT_TOKEN).build()
    
    # Добавляем обработчик команды /start
    application.add_handler(CommandHandler("start", start))
    
    # Добавляем обработчик команды /referral для просмотра реферальной статистики
    application.add_handler(CommandHandler("referral", referral_command))
    
    # Добавляем обработчик всех сообщений (для сохранения в чат)
    # Важно: должен быть добавлен последним, чтобы не перехватывать команды
    from telegram.ext import MessageHandler, filters
    # Обработчик для текстовых сообщений (не команд)
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    # Обработчик для медиа (фото, видео, документы, голосовые, аудио)
    # Примечание: стикеры пропускаем, так как filters.STICKER не поддерживается в версии 20.7
    application.add_handler(MessageHandler(
        filters.PHOTO | filters.VIDEO | filters.Document.ALL | filters.VOICE | filters.AUDIO,
        handle_message
    ))
    # Обработчик для всех остальных сообщений (включая стикеры, локации и т.д.)
    # Используем ~ чтобы исключить уже обработанные типы
    application.add_handler(MessageHandler(
        ~filters.COMMAND & ~filters.TEXT & ~filters.PHOTO & ~filters.VIDEO & ~filters.Document.ALL & ~filters.VOICE & ~filters.AUDIO,
        handle_message
    ))
    
    # Добавляем обработчик ошибок
    application.add_error_handler(error_handler)
    
    # Запускаем бота
    print("🤖 Бот запущен!")
    logger.info("Bot started")
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == '__main__':
    main()
