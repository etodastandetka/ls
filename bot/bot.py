#!/usr/bin/env python3
"""
Простой Telegram бот для LUXON
Только команда /start с кнопками WebApp
"""

import logging
import re
import httpx
import base64
import random
import os
import json
import time
from pathlib import Path
from io import BytesIO
from urllib.parse import quote
try:
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
    QRCODE_AVAILABLE = True
except ImportError:
    QRCODE_AVAILABLE = False
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo, ReplyKeyboardMarkup, KeyboardButton, ReplyKeyboardRemove
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes
from telegram.constants import ParseMode
from security import validate_input, sanitize_input
import asyncio

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Отключаем спам от httpx (только WARNING и ERROR)
logging.getLogger("httpx").setLevel(logging.WARNING)

def _load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception:
        return


# Загружаем .env из admin/.env или admin_nextjs/.env
_root_dir = Path(__file__).resolve().parents[1]
_load_env_file(_root_dir / "admin" / ".env")
_load_env_file(_root_dir / "admin_nextjs" / ".env")

# Токен бота
BOT_TOKEN = os.getenv("BOT_TOKEN", "")

# URL сайта
WEBSITE_URL = os.getenv("MINI_APP_URL", "https://lux-on.org")
API_URL = os.getenv("ADMIN_PUBLIC_URL", os.getenv("NEXT_PUBLIC_API_URL", "https://pipiska.net"))
SUPPORT_BOT_URL = os.getenv("SUPPORT_BOT_URL", "https://t.me/operator_luxon_bot")

# Словарь для хранения состояний пользователей
user_states = {}

# Словарь для хранения активных таймеров (user_id -> task)
active_timers = {}

# Путь к файлу для сохранения ожидания фото чека (переживает рестарт бота)
PENDING_DEPOSIT_STATE_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    'pending_deposit_states.json'
)

# Кеш ожиданий фото чека (user_id -> {data, expires_at})
pending_deposit_states = {}

def _write_pending_deposit_states(states: dict) -> None:
    """Сохраняет ожидания фото чека в файл (атомарно)."""
    try:
        tmp_path = f"{PENDING_DEPOSIT_STATE_FILE}.tmp"
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(states, f, ensure_ascii=True)
        os.replace(tmp_path, PENDING_DEPOSIT_STATE_FILE)
    except Exception as e:
        logger.warning(f"⚠️ Не удалось сохранить pending_deposit_states: {e}")

def _load_pending_deposit_states() -> dict:
    """Загружает ожидания фото чека из файла и очищает истекшие."""
    if not os.path.exists(PENDING_DEPOSIT_STATE_FILE):
        return {}
    try:
        with open(PENDING_DEPOSIT_STATE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {}
    except Exception as e:
        logger.warning(f"⚠️ Не удалось загрузить pending_deposit_states: {e}")
        return {}
    
    now_ts = time.time()
    cleaned = {}
    for key, value in data.items():
        if not isinstance(value, dict):
            continue
        expires_at = value.get('expires_at')
        if isinstance(expires_at, (int, float)) and expires_at > now_ts:
            cleaned[key] = value
    
    if cleaned != data:
        _write_pending_deposit_states(cleaned)
    return cleaned

def set_pending_deposit_state(user_id: int, data: dict, expires_at: float) -> None:
    """Сохраняет ожидание фото чека для пользователя."""
    if not data:
        return
    pending_deposit_states[str(user_id)] = {
        'data': data,
        'expires_at': expires_at
    }
    _write_pending_deposit_states(pending_deposit_states)

def get_pending_deposit_state(user_id: int) -> dict | None:
    """Возвращает сохраненные данные ожидания фото чека, если они актуальны."""
    key = str(user_id)
    state = pending_deposit_states.get(key)
    if not state:
        return None
    expires_at = state.get('expires_at')
    if not isinstance(expires_at, (int, float)) or expires_at <= time.time():
        pending_deposit_states.pop(key, None)
        _write_pending_deposit_states(pending_deposit_states)
        return None
    return state.get('data')

def clear_pending_deposit_state(user_id: int) -> None:
    """Очищает ожидание фото чека для пользователя."""
    key = str(user_id)
    if key in pending_deposit_states:
        pending_deposit_states.pop(key, None)
        _write_pending_deposit_states(pending_deposit_states)

# Загружаем ожидания фото чека при старте
pending_deposit_states = _load_pending_deposit_states()

# Кеш настроек (обновляется при старте и периодически)
settings_cache = {
    'casinos': {},
    'deposit_banks': [],
    'withdrawal_banks': [],
    'deposits_enabled': True,
    'withdrawals_enabled': True,
    'pause': False,
    'maintenance_message': 'Технические работы. Попробуйте позже.',
    'last_update': 0
}

# Маппинг названий банков
BANK_NAMES = {
    'kompanion': 'Компаньон',
    'demirbank': 'DemirBank',
    'demir': 'DemirBank',
    'omoney': 'O!Money',
    'balance': 'Balance.kg',
    'bakai': 'Bakai',
    'megapay': 'MegaPay',
    'mbank': 'MBank',
    'odengi': 'O!Money'
}

# Маппинг названий казино
CASINO_NAMES = {
    '1xbet': '1XBET',
    '1win': '1WIN',
    'melbet': 'MELBET',
    'mostbet': 'MOSTBET',
    'winwin': 'WINWIN',
    '888starz': '888STARZ'
}

# Функция для получения названия казино
def get_casino_name(bookmaker: str) -> str:
    """Получает отформатированное название казино"""
    if not bookmaker:
        return ''
    bookmaker_lower = bookmaker.lower()
    return CASINO_NAMES.get(bookmaker_lower, bookmaker.upper())

# Функция для получения пути к изображению ID казино
def get_casino_id_image_path(bookmaker: str) -> str:
    """Возвращает путь к изображению с примером ID для казино"""
    if not bookmaker:
        return None
    bookmaker_lower = bookmaker.lower()
    
    # Путь относительно bot.py (bot/bot.py -> ../images/)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    images_dir = os.path.join(script_dir, '..', 'images')
    
    # Маппинг казино на имена файлов изображений (может быть в разных форматах)
    image_map = {
        '1xbet': '1xbet-id.jpg',
        '1win': '1win-id.jpg',
        'melbet': 'melbet-id.jpg',
        'mostbet': 'mostbet-id.jpg',
        'winwin': None,  # Нет изображения
        '888starz': None  # Нет изображения
    }
    
    # Сначала пробуем найти файл из маппинга
    image_filename = image_map.get(bookmaker_lower)
    if image_filename:
        image_path = os.path.join(images_dir, image_filename)
        if os.path.exists(image_path):
            return image_path
    
    # Если не найдено, пробуем найти файл по шаблону {casino}-id.{ext}
    # Пробуем разные расширения
    for ext in ['jpg', 'jpeg', 'png', 'JPG', 'JPEG', 'PNG']:
        image_filename = f"{bookmaker_lower}-id.{ext}"
        image_path = os.path.join(images_dir, image_filename)
        if os.path.exists(image_path):
            return image_path
    
    return None

# Словарь переводов
TRANSLATIONS = {
    'ru': {
        'welcome': "Привет, {user_name}!\n\nПополнение | Вывод\nиз букмекерских контор!\n\n📥 Пополнение — 0%\n📤 Вывод — 0%\n🕒 Работаем 24/7\n\n👨‍💻 Поддержка: @operator_luxon_bot\n💬 Чат для всех: @luxon_chat\n\n🔒 Финансовый контроль обеспечен личным отделом безопасности",
        'select_action': "Выберите действие:",
        'main_menu_text': "Привет, {user_name} | LUX ON!\n\nПополнение | Вывод\nиз букмекерских контор!\n\n📥 Пополнение — 0%\n📤 Вывод — 0%\n🕒 Работаем 24/7\n\n👨‍💻 Поддержка: @operator_luxon_bot\n💬 Чат для всех: @luxon_chat\n\n🔒 Финансовый контроль обеспечен личным отделом безопасности",
        'main_menu_webapp_button': "LUX ON",
        'menu_ready_text': "✨ Меню готово",
        'deposit': "💰 Пополнить",
        'withdraw': "💸 Вывести",
        'support': "👨‍💻 Тех поддержка",
        'transactions': "📊 Мои транзакции",
        'info': "ℹ️ Информация",
        'faq': "📖 Инструкция",
        'deposit_title': "💰 <b>Пополнение счета</b>",
        'withdraw_title': "💸 <b>Вывод средств</b>",
        'select_casino': "Выберите казино:",
        'casino_label': "Казино: {casino_name}",
        'bank_label': "Банк: {bank_name}",
        'phone_label': "Телефон: {phone}",
        'enter_player_id': "Введите ваш ID игрока в казино:",
        'select_bank': "Выберите банк для получения средств:",
        'enter_phone': "Введите номер телефона (начинается с +996):",
        'enter_phone_format': "Введите номер телефона в формате +996XXXXXXXXX:",
        'phone_saved_button': "📱 {phone}",
        'cancel_request': "❌ Отменить заявку",
        'send_qr_code': "Отправьте фото QR-кода кошелька:",
        'qr_received': "QR-код: ✅ Загружен",
        'enter_account_id': "Введите ваш ID игрока в казино:",
        'enter_withdraw_code': "Введите код для вывода:",
        'enter_withdraw_amount': "Введите сумму для вывода:",
        'min_amount': "Минимум: {min} KGS",
        'max_amount': "Максимум: {max} KGS",
        'invalid_phone': "❌ Номер телефона должен начинаться с +996",
        'invalid_phone_length': "❌ Неверный формат номера телефона",
        'invalid_code': "❌ Пожалуйста, введите корректный код.",
        'invalid_id': "❌ Пожалуйста, введите корректный ID.",
        'invalid_amount': "❌ Пожалуйста, введите корректную сумму.",
        'amount_too_small': "❌ Минимальная сумма: {min} KGS",
        'amount_too_large': "❌ Максимальная сумма: {max} KGS",
        'withdrawal_request_sent': "✅ <b>Заявка на вывод создана!</b>\n\n📋 <b>Детали заявки:</b>\n🆔 <b>ID:</b> {account_id}\n📱 <b>Телефон:</b> {phone}\n💸 <b>Казино:</b> {casino_name}\n\n⏳ <b>Время обработки:</b> до 30 минут\n\n📝 <b>Важно:</b> Просто ожидайте ответа от бота. Если вы напишете оператору, это не ускорит процесс. Спасибо за понимание!",
        'deposit_request_sent': "✅ <b>Заявка отправлена!</b>\n\n🆔 <b>ID заявки:</b> {request_id}\n💰 <b>Сумма:</b> {amount:.2f} KGS\n🆔 <b>ID {casino_name}:</b> {account_id}\n\n⏳ Ожидайте подтверждения от оператора.\n📞 Время обработки: до 30 минут",
        'processing_time': "⏳ Время обработки: до 30 минут",
        'wait_for_bot_response': "📨 Просто ожидайте ответа от бота, никуда писать не нужно.",
        'operator_will_check': "👨‍💼 Оператор проверит вашу заявку как можно скорее.",
        'dont_write_operator': "⚠️ Если вы напишете оператору, это не ускорит процесс. Спасибо за понимание!",
        'saved_phone_label': "📱 Сохраненный номер:",
        'saved_id_label': "💾 Сохраненный ID:",
        'error_occurred': "❌ Произошла ошибка при обработке. Попробуйте еще раз или введите /start",
        'please_select_from_buttons': "❌ Пожалуйста, выберите из предложенных кнопок",
        'deposit_disabled': "❌ Пополнение временно отключено. Попробуйте позже.",
        'withdraw_disabled': "❌ Вывод временно отключен. Попробуйте позже.",
        'error_processing': "❌ Произошла ошибка при обработке выбора. Попробуйте еще раз или введите /start",
        'how_to_get_code': "Как получить код:",
        'code_instructions': "1. Заходим на сайт букмекера\n2. Вывести со счета\n3. Выбираем наличные\n4. Пишем сумму\n5. Город: Бишкек\n6. Улица: Lux Kassa\n\nДальше делаем все по инструкции после получения кода введите его здесь",
        'enter_confirmation_code': "Введите код подтверждения:",
        'checking_code': "🔍 Проверяю код вывода...",
        'code_checked_success': "✅ Код проверен! Сумма: {amount} сом",
        'code_invalid': "❌ Код неверный или вывод не найден",
        'withdraw_instruction_title': "📍 Заходим👇🏻",
        'withdraw_instruction_steps': "📍1. Настройки!\n📍2. Вывести со счета!\n📍3. Касса\n📍4. Сумму для Вывода!\n📍(Город Бишкек, улица: {address})\n📍5. Подтвердить\n📍6. Получить Код!\n📍7. Отправить его нам",
        'timer_expired': "⏰ <b>Пополнение отменено, время оплаты прошло</b>\n\n❌ <b>Не переводите по старым реквизитам</b>\n\nНачните заново, нажав на <b>Пополнить</b>",
        'timer_label': "⏰ <b>Таймер: {timer_text}</b>",
        'send_receipt_photo': "После оплаты отправьте фото чека:",
        'please_send_qr': "❌ Пожалуйста, отправьте фото QR-кода",
        'please_send_receipt': "❌ Пожалуйста, отправьте фото чека.",
        'amount_not_found': "⚠️ Сумма вывода не найдена. Проверьте код и попробуйте ещё раз.",
        'amount_parse_error': "⚠️ Ошибка при обработке суммы вывода. Попробуйте ещё раз.",
        'withdraw_check_error': "⚠️ Не удалось проверить сумму вывода. Попробуйте еще раз.",
        'request_id_label': "🆔 <b>ID заявки:</b> #{request_id}",
        'waiting_processing': "Ожидайте обработки заявки администратором.",
        'waiting_money': "Ожидайте поступление денег. Ваша заявка будет обработана в ближайшее время.",
        'deposit_amount_prompt': "Введите сумму пополнения:",
        'min_amount_deposit': "Минимум: 35 KGS",
        'max_amount_deposit': "Максимум: 100 000 KGS",
        'invalid_amount_format': "❌ Введите корректную сумму (число) или выберите из кнопок",
        'amount_range_error': "❌ Сумма должна быть от 35 до 100,000 сом",
        'invalid_player_id_format': "❌ Введите корректный ID игрока (только цифры)",
        'invalid_code_empty': "❌ Введите код подтверждения",
        'select_bank_for_payment': "Выберите способ оплаты:",
        'payment_instruction_qr': "ℹ️ Оплатите и отправьте скриншот чека в течении 5 минут, чек должен быть в формате картинки 📎",
        'no_payment_methods': "❌ Нет доступных способов оплаты. Обратитесь к администратору.",
        'qr_generating': "Генерирую QR code...",
        'no_qr_data': "❌ Ошибка при получении ссылок на оплату. Попробуйте еще раз.",
        'press_button_to_pay': "Нажмите кнопку ниже для оплаты:",
        'enter_correct_code': "❌ Введите код подтверждения",
        'no_photo_required': "❌ Сейчас не требуется отправка фото. Следуйте инструкциям выше.",
        'error_processing_casino': "❌ Произошла ошибка при обработке выбора казино. Попробуйте еще раз или введите /start",
        'error_processing_bank': "❌ Произошла ошибка при обработке выбора банка. Попробуйте еще раз или введите /start",
        'please_send_receipt_after_payment': "❌ Пожалуйста, отправьте фото чека после оплаты",
        'error_creating_request': "❌ Ошибка создания заявки: {error}",
        'error_processing_photo': "❌ Ошибка при обработке фото: {error}",
        'error_creating_withdraw': "❌ Ошибка создания заявки на вывод",
        'request_not_created': "❌ Заявка не создана: {error}",
        'invalid_amount_check': "⚠️ Сумма вывода не найдена. Проверьте код и попробуйте ещё раз.",
        'withdraw_check_failed': "⚠️ Не удалось проверить сумму вывода. Попробуйте еще раз.",
        'withdraw_execute_failed': "❌ Ошибка выполнения вывода. Попробуйте еще раз.",
        'withdraw_check_timeout': "⚠️ Не удалось проверить сумму вывода. Попробуйте еще раз.",
        'server_unavailable': "❌ Сервер недоступен. Пожалуйста, убедитесь, что админ-панель запущена.",
        'request_creation_error': "❌ Ошибка создания заявки. Попробуйте еще раз.",
        'amount_range_error_deposit': "❌ Сумма должна быть от 35 до 100,000 сом",
        'invalid_amount_format_deposit': "❌ Введите корректную сумму (число) или выберите из кнопок",
    }
}

def get_main_menu_keyboard() -> ReplyKeyboardMarkup:
    """Создает Reply клавиатуру основного меню."""
    reply_keyboard = [
        [
            KeyboardButton("💰 Пополнить"),
            KeyboardButton("💸 Вывести")
        ],
        [
            KeyboardButton("👨‍💻 Тех поддержка"),
            KeyboardButton("📊 История")
        ],
        [
            KeyboardButton("📖 Инструкция")
        ]
    ]
    return ReplyKeyboardMarkup(reply_keyboard, resize_keyboard=True, one_time_keyboard=False)

async def send_main_menu(bot, chat_id: int, user_name: str) -> None:
    """Отправляет главное меню с WebApp кнопкой и клавиатурой."""
    safe_name = user_name if user_name else "друг"
    main_menu_text = get_text('main_menu_text', user_name=safe_name)
    webapp_button_text = get_text('main_menu_webapp_button')
    menu_ready_text = get_text('menu_ready_text')
    
    inline_keyboard = [
        [InlineKeyboardButton(webapp_button_text, web_app=WebAppInfo(url="https://lux-on.org"))]
    ]
    inline_markup = InlineKeyboardMarkup(inline_keyboard)
    
    try:
        await bot.send_message(
            chat_id=chat_id,
            text=main_menu_text,
            reply_markup=inline_markup,
            parse_mode='HTML'
        )
    except Exception as e:
        logger.error(f"❌ Ошибка при отправке главного меню: {e}")
    
    # Отправляем сообщение с клавиатурой и скрываем текст после короткой паузы
    try:
        temp_message = await bot.send_message(
            chat_id=chat_id,
            text=menu_ready_text,
            reply_markup=get_main_menu_keyboard()
        )
        try:
            await asyncio.sleep(0.6)
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=temp_message.message_id,
                text="\u200B",
                reply_markup=get_main_menu_keyboard()
            )
        except Exception as delete_error:
            logger.warning(f"⚠️ Не удалось скрыть текст сообщения меню: {delete_error}")
    except Exception as e:
        logger.error(f"❌ Ошибка при отправке клавиатуры главного меню: {e}")

def get_text(key: str, lang: str = 'ru', **kwargs) -> str:
    """Получает переведенный текст с подстановкой переменных"""
    translations = TRANSLATIONS.get(lang, TRANSLATIONS['ru'])
    text = translations.get(key, key)
    
    # Если есть {casino_name} в тексте, но не передано, пытаемся получить из kwargs или использовать значение по умолчанию
    if '{casino_name}' in text and 'casino_name' not in kwargs:
        casino_key = kwargs.get('bookmaker') or kwargs.get('casino') or ''
        kwargs['casino_name'] = get_casino_name(casino_key)
    
    # Подставляем переменные
    try:
        return text.format(**kwargs)
    except KeyError as e:
        logger.warning(f"⚠️ Отсутствует переменная {e} в тексте '{key}'")
        return text

async def load_settings():
    """Загружает настройки из API"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{API_URL}/api/public/payment-settings")
            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    data = result
                else:
                    data = result
                
                settings_cache['casinos'] = data.get('casinos', {})
                deposits_data = data.get('deposits', {})
                withdrawals_data = data.get('withdrawals', {})
                
                if isinstance(deposits_data, dict):
                    settings_cache['deposit_banks'] = deposits_data.get('banks', [])
                    settings_cache['deposits_enabled'] = deposits_data.get('enabled', True)
                else:
                    settings_cache['deposit_banks'] = []
                    settings_cache['deposits_enabled'] = True
                
                if isinstance(withdrawals_data, dict):
                    settings_cache['withdrawal_banks'] = withdrawals_data.get('banks', [])
                    settings_cache['withdrawals_enabled'] = withdrawals_data.get('enabled', True)
                else:
                    settings_cache['withdrawal_banks'] = []
                    settings_cache['withdrawals_enabled'] = True
                
                settings_cache['pause'] = data.get('pause', False)
                settings_cache['maintenance_message'] = data.get('maintenance_message', 'Технические работы. Попробуйте позже.')
                settings_cache['last_update'] = asyncio.get_event_loop().time()
                logger.info(f"✅ Настройки загружены: казино={len(settings_cache['casinos'])}, депозиты={settings_cache['deposits_enabled']} (банки: {len(settings_cache['deposit_banks'])}), выводы={settings_cache['withdrawals_enabled']} (банки: {len(settings_cache['withdrawal_banks'])}), пауза={settings_cache['pause']}")
    except Exception as e:
        logger.warning(f"⚠️ Не удалось загрузить настройки: {e}, используем значения по умолчанию")
        # Значения по умолчанию
        settings_cache['casinos'] = {'1xbet': True, '1win': True, 'melbet': True, 'mostbet': True, 'winwin': True, '888starz': True}
        settings_cache['deposit_banks'] = ['mbank', 'bakai', 'balance', 'demir', 'omoney', 'megapay']
        settings_cache['withdrawal_banks'] = ['kompanion', 'odengi', 'bakai', 'balance', 'megapay', 'mbank']
        settings_cache['deposits_enabled'] = True
        settings_cache['withdrawals_enabled'] = True
        settings_cache['pause'] = False
        settings_cache['maintenance_message'] = 'Технические работы. Попробуйте позже.'

async def check_channel_subscription(user_id: int, channel_id: str) -> bool:
    """Проверяет подписку пользователя на канал"""
    try:
        check_url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChatMember"
        logger.info(f"🔍 Проверяю подписку пользователя {user_id} на канал {channel_id}")
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                check_url,
                json={
                    "chat_id": channel_id,
                    "user_id": user_id
                }
            )
            if response.status_code == 200:
                data = response.json()
                logger.info(f"📋 Ответ от Telegram API: {data}")
                if data.get('ok'):
                    member = data.get('result', {})
                    status = member.get('status', '')
                    logger.info(f"📊 Статус пользователя в канале: {status}")
                    is_subscribed = status in ['member', 'administrator', 'creator']
                    logger.info(f"{'✅' if is_subscribed else '❌'} Пользователь {'подписан' if is_subscribed else 'не подписан'}")
                    return is_subscribed
                else:
                    error_description = data.get('description', 'Unknown error')
                    logger.error(f"❌ Telegram API вернул ошибку: {error_description}")
                    # Если бот не может проверить (например, не админ канала), считаем что не подписан
                    return False
            else:
                logger.error(f"❌ HTTP ошибка при проверке подписки: {response.status_code}")
                return False
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке подписки: {e}", exc_info=True)
        return False

async def send_channel_subscription_message(update: Update, channel_username: str, channel_id: str) -> None:
    """Отправляет сообщение с кнопками для подписки на канал"""
    user = update.effective_user
    user_id = user.id
    
    # Формируем ссылку на канал
    channel_url = f"https://t.me/{channel_username.lstrip('@')}"
    
    # Создаем кнопки
    keyboard = [
        [
            InlineKeyboardButton("📢 Подписаться на канал", url=channel_url),
            InlineKeyboardButton("✅ Проверить подписку", callback_data=f"check_sub_{channel_id}")
        ]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    message_text = f"""🔔 <b>Подписка на канал</b>

Для продолжения работы с ботом необходимо подписаться на наш канал.

📢 Канал: @{channel_username.lstrip('@')}

После подписки нажмите кнопку "✅ Проверить подписку"."""
    
    try:
        await update.message.reply_text(
            message_text,
            reply_markup=reply_markup,
            parse_mode='HTML'
        )
        logger.info(f"✅ Сообщение о подписке отправлено пользователю {user_id}")
    except Exception as e:
        logger.error(f"❌ Ошибка при отправке сообщения о подписке: {e}")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик команды /start"""
    user = update.effective_user
    user_id = user.id
    logger.info(f"📥 Получена команда /start от пользователя {user_id} (@{user.username})")
    
    # Загружаем настройки если они устарели
    if asyncio.get_event_loop().time() - settings_cache.get('last_update', 0) > 300:
        await load_settings()
    
    # Проверяем паузу
    if settings_cache.get('pause', False):
        maintenance_message = settings_cache.get('maintenance_message', 'Технические работы. Попробуйте позже.')
        await update.message.reply_text(
            f"⏸️ <b>Бот на паузе</b>\n\n{maintenance_message}",
            parse_mode='HTML'
        )
        logger.info(f"⏸️ Бот на паузе, пользователь {user_id} получил сообщение о технических работах")
        return
    
    # Проверяем настройки канала
    logger.info(f"🔍 Проверяю настройки канала для пользователя {user_id}")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            logger.info(f"📡 Запрос к API: {API_URL}/api/channel/settings")
            response = await client.get(
                f"{API_URL}/api/channel/settings",
                headers={"Content-Type": "application/json"}
            )
            logger.info(f"📥 Ответ API: статус {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                logger.info(f"📋 Данные от API: {data}")
                
                if data.get('success'):
                    channel_settings = data.get('data', {})
                    logger.info(f"⚙️ Настройки канала: enabled={channel_settings.get('enabled')}, channel_id={channel_settings.get('channel_id')}, username={channel_settings.get('username')}")
                    
                    if channel_settings.get('enabled'):
                        logger.info("✅ Проверка подписки включена")
                        channel_id = channel_settings.get('channel_id')
                        channel_username = channel_settings.get('username', '')
                        
                        if channel_id:
                            logger.info(f"🔍 Проверяю подписку на канал {channel_id}")
                            # Проверяем подписку
                            is_subscribed = await check_channel_subscription(
                                user_id, 
                                channel_id
                            )
                            
                            if not is_subscribed:
                                logger.info(f"❌ Пользователь {user_id} не подписан на канал, отправляю сообщение о подписке")
                                # Отправляем сообщение о подписке
                                await send_channel_subscription_message(
                                    update,
                                    channel_username,
                                    channel_id
                                )
                                return  # Не показываем основное меню, пока не подпишется
                            else:
                                logger.info(f"✅ Пользователь {user_id} подписан на канал, показываю основное меню")
                        else:
                            logger.warning("⚠️ channel_id не указан в настройках, пропускаю проверку подписки")
                    else:
                        logger.info("ℹ️ Проверка подписки отключена в настройках")
                else:
                    logger.warning(f"⚠️ API вернул success=false: {data.get('error')}")
            else:
                logger.error(f"❌ Ошибка API при получении настроек канала: {response.status_code}")
                try:
                    error_text = response.text
                    logger.error(f"📄 Текст ошибки: {error_text[:200]}")
                except:
                    pass
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке настроек канала: {e}", exc_info=True)
        # Продолжаем выполнение, если ошибка
    
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
            
            # Проверяем, что код не пустой и содержит только цифры
            if not referral_code or not referral_code.strip().isdigit():
                logger.warning(f"⚠️ Неверный формат реферального кода '{param}': код пустой или содержит не только цифры")
            else:
                logger.info(f"🔍 Обработка реферального кода: {referral_code} для пользователя {user_id}")
                
                # Пытаемся извлечь ID рефера
                try:
                    referrer_id = int(referral_code)
                    if referrer_id == user_id:
                        logger.warning(f"⚠️ Пользователь {user_id} пытается пригласить самого себя")
                    else:
                        # Регистрируем реферальную связь через API с повторными попытками
                        logger.info(f"🔄 Регистрация реферала: {referrer_id} -> {user_id}")
                        
                        # Параметры для повторных попыток
                        max_retries = 3
                        retry_delay = 2  # секунды между попытками
                        timeout = 15.0  # увеличенный таймаут
                        success = False
                        
                        for attempt in range(max_retries):
                            try:
                                async with httpx.AsyncClient(timeout=timeout) as client:
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
                                    
                                    logger.info(f"📡 Ответ API (попытка {attempt + 1}/{max_retries}): статус {response.status_code}")
                                    
                                    if response.status_code == 200:
                                        try:
                                            data = response.json()
                                            logger.info(f"📋 Данные ответа: {data}")
                                            if data.get('success'):
                                                logger.info(f"✅ Реферальная связь зарегистрирована: {referrer_id} -> {user_id}")
                                                success = True
                                                break
                                            else:
                                                error_msg = data.get('error', 'Unknown error')
                                                # Если это не временная ошибка (например, уже привязан), не повторяем
                                                if 'already referred' in error_msg.lower() or 'cannot refer yourself' in error_msg.lower():
                                                    logger.warning(f"⚠️ Не удалось зарегистрировать реферала: {error_msg}")
                                                    break
                                                logger.warning(f"⚠️ Не удалось зарегистрировать реферала (попытка {attempt + 1}): {error_msg}")
                                        except Exception as parse_error:
                                            logger.warning(f"⚠️ Ошибка парсинга ответа (попытка {attempt + 1}): {parse_error}")
                                            # Пробуем еще раз при ошибке парсинга
                                    else:
                                        try:
                                            error_text = response.text
                                            logger.error(f"❌ Ошибка API при регистрации реферала (попытка {attempt + 1}): {response.status_code} - {error_text[:200]}")
                                            # Если это 429 (rate limit) или 5xx ошибка, повторяем
                                            if response.status_code == 429 or response.status_code >= 500:
                                                if attempt < max_retries - 1:
                                                    logger.info(f"⏳ Повторная попытка через {retry_delay} секунд...")
                                                    await asyncio.sleep(retry_delay)
                                                    continue
                                        except:
                                            logger.error(f"❌ Ошибка API при регистрации реферала (попытка {attempt + 1}): {response.status_code}")
                                    
                                    # Если не успешно и это не последняя попытка, ждем перед повтором
                                    if attempt < max_retries - 1:
                                        logger.info(f"⏳ Повторная попытка через {retry_delay} секунд...")
                                        await asyncio.sleep(retry_delay)
                                        
                            except httpx.TimeoutException:
                                logger.error(f"❌ Таймаут при регистрации реферала (попытка {attempt + 1}/{max_retries}, превышено {timeout} секунд)")
                                if attempt < max_retries - 1:
                                    logger.info(f"⏳ Повторная попытка через {retry_delay} секунд...")
                                    await asyncio.sleep(retry_delay)
                                else:
                                    logger.error(f"❌ Все попытки регистрации реферала исчерпаны из-за таймаута")
                            except httpx.NetworkError as e:
                                logger.error(f"❌ Сетевая ошибка при регистрации реферала (попытка {attempt + 1}/{max_retries}): {e}")
                                if attempt < max_retries - 1:
                                    logger.info(f"⏳ Повторная попытка через {retry_delay} секунд...")
                                    await asyncio.sleep(retry_delay)
                                else:
                                    logger.error(f"❌ Все попытки регистрации реферала исчерпаны из-за сетевой ошибки")
                            except Exception as e:
                                logger.error(f"❌ Ошибка при регистрации реферала (попытка {attempt + 1}/{max_retries}): {e}", exc_info=True)
                                if attempt < max_retries - 1:
                                    logger.info(f"⏳ Повторная попытка через {retry_delay} секунд...")
                                    await asyncio.sleep(retry_delay)
                        
                        if not success:
                            logger.error(f"❌ Не удалось зарегистрировать реферала после {max_retries} попыток: {referrer_id} -> {user_id}")
                except ValueError as e:
                    logger.warning(f"⚠️ Неверный формат реферального кода '{referral_code}': {e}")
    
    # Отправляем главное меню
    try:
        await send_main_menu(context.bot, update.message.chat.id, user.first_name)
        logger.info(f"✅ Ответ отправлен пользователю {user_id}")
    except Exception as e:
        # Игнорируем ошибки заблокированных пользователей
        if "Forbidden: bot was blocked by the user" in str(e):
            logger.debug(f"⚠️ Пользователь {user_id} заблокировал бота")
        else:
            logger.error(f"❌ Ошибка при отправке ответа пользователю {user_id}: {e}")
            raise

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик всех текстовых сообщений от пользователей (не команд)"""
    if not update.message or not update.message.from_user:
        logger.warning("⚠️ handle_message: нет сообщения или пользователя")
        return
    
    user = update.message.from_user
    user_id = user.id
    message_text = update.message.text or update.message.caption or ''
    telegram_message_id = update.message.message_id
    
    logger.info(f"📨 handle_message: пользователь {user_id} (@{user.username}), сообщение: '{message_text[:50]}...'")
    
    # Пропускаем команды (они обрабатываются отдельными обработчиками)
    if message_text and message_text.startswith('/'):
        logger.warning(f"⚠️ handle_message получил команду {message_text} - это не должно происходить! Пропускаем.")
        return
    
    # Обработка отмены заявки через Reply клавиатуру (проверяем в самом начале, независимо от состояния)
    if message_text and ("отменить заявку" in message_text.lower() or message_text.strip() == "❌ Отменить заявку"):
        logger.info(f"🛑 Пользователь {user_id} отменил заявку через Reply-клавиатуру")
        
        # Удаляем сообщение с QR-кодом если оно есть
        if user_id in user_states:
            data = user_states[user_id].get('data', {})
            if 'timer_message_id' in data and 'timer_chat_id' in data:
                try:
                    await context.bot.delete_message(
                        chat_id=data['timer_chat_id'],
                        message_id=data['timer_message_id']
                    )
                    logger.info(f"✅ Сообщение с QR-кодом удалено для пользователя {user_id} при отмене заявки")
                except Exception as delete_error:
                    logger.warning(f"⚠️ Не удалось удалить сообщение с QR-кодом для пользователя {user_id}: {delete_error}")
        
        # Останавливаем таймер если он активен
        if user_id in active_timers:
            try:
                active_timers[user_id].cancel()
                logger.info(f"⏹️ Таймер остановлен для пользователя {user_id}")
            except Exception as e:
                logger.warning(f"⚠️ Ошибка при остановке таймера: {e}")
            del active_timers[user_id]
        
        # Очищаем состояние
        if user_id in user_states:
            del user_states[user_id]
            logger.info(f"✅ Состояние очищено для пользователя {user_id}")
        clear_pending_deposit_state(user_id)
        
        # Отправляем главное меню
        await send_main_menu(context.bot, update.message.chat.id, user.first_name)
        return
    
    # Обработка кнопок Reply клавиатуры (должна быть ПЕРЕД проверкой user_states)
    # Отвечаем ВСЕМ пользователям, независимо от подписки на канал
    # Получаем тексты кнопок из переводов для сравнения
    btn_deposit = get_text('deposit')
    btn_withdraw = get_text('withdraw')
    btn_support = get_text('support')
    btn_faq = get_text('faq')
    
    if message_text in [btn_deposit, btn_withdraw, btn_support, "📊 История", btn_faq]:
        logger.info(f"📨 Пользователь {user_id} нажал кнопку: {message_text}")
        
        # Загружаем настройки если они устарели
        if asyncio.get_event_loop().time() - settings_cache.get('last_update', 0) > 300:
            await load_settings()
        
        # Проверяем паузу
        if settings_cache.get('pause', False):
            maintenance_message = settings_cache.get('maintenance_message', 'Технические работы. Попробуйте позже.')
            await update.message.reply_text(
                f"⏸️ <b>Бот на паузе</b>\n\n{maintenance_message}",
                parse_mode='HTML'
            )
            logger.info(f"⏸️ Бот на паузе, пользователь {user_id} попытался использовать функцию")
            return
        
        if message_text == btn_deposit:
            # Проверяем, включены ли депозиты
            if not settings_cache.get('deposits_enabled', True):
                await update.message.reply_text(
                    "❌ Пополнение временно отключено. Попробуйте позже.",
                    parse_mode='HTML'
                )
                logger.info(f"❌ Депозиты отключены, пользователь {user_id} попытался пополнить")
                return
            
            # Начинаем диалог пополнения
            user_states[user_id] = {
                'step': 'deposit_bookmaker',
                'data': {}
            }
            
            # Формируем список доступных казино через Reply клавиатуру
            all_casinos = [
                ('1xbet', '1XBET'),
                ('1win', '1WIN'),
                ('melbet', 'MELBET'),
                ('mostbet', 'MOSTBET'),
                ('winwin', 'WINWIN'),
                ('888starz', '888STARZ')
            ]
            
            # Фильтруем доступные казино
            enabled_casinos = []
            for casino_key, casino_name in all_casinos:
                is_enabled = settings_cache.get('casinos', {}).get(casino_key, True)
                if is_enabled:
                    enabled_casinos.append((casino_key, casino_name))
            
            # Группируем кнопки по 2 в ряд
            keyboard_buttons = []
            for i in range(0, len(enabled_casinos), 2):
                row = [KeyboardButton(enabled_casinos[i][1])]
                if i + 1 < len(enabled_casinos):
                    row.append(KeyboardButton(enabled_casinos[i + 1][1]))
                keyboard_buttons.append(row)
            
            keyboard_buttons.append([KeyboardButton("❌ Отменить заявку")])
            reply_markup = ReplyKeyboardMarkup(keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)
            
            deposit_title = get_text('deposit_title')
            select_casino = get_text('select_casino')
            await update.message.reply_text(
                f"{deposit_title}\n\n{select_casino}",
                reply_markup=reply_markup,
                parse_mode='HTML'
            )
        elif message_text == btn_withdraw:
            # Проверяем, включены ли выводы
            if not settings_cache.get('withdrawals_enabled', True):
                await update.message.reply_text(
                    get_text('withdraw_disabled'),
                    parse_mode='HTML'
                )
                logger.info(f"❌ Выводы отключены, пользователь {user_id} попытался вывести")
                return
            
            # Начинаем диалог вывода
            user_states[user_id] = {
                'step': 'withdraw_bookmaker',
                'data': {}
            }
            
            # Формируем список доступных казино через Reply клавиатуру
            all_casinos = [
                ('1xbet', '1XBET'),
                ('1win', '1WIN'),
                ('melbet', 'MELBET'),
                ('mostbet', 'MOSTBET'),
                ('winwin', 'WINWIN'),
                ('888starz', '888STARZ')
            ]
            
            # Фильтруем доступные казино
            enabled_casinos = []
            for casino_key, casino_name in all_casinos:
                is_enabled = settings_cache.get('casinos', {}).get(casino_key, True)
                if is_enabled:
                    enabled_casinos.append((casino_key, casino_name))
            
            # Группируем кнопки по 2 в ряд
            keyboard_buttons = []
            for i in range(0, len(enabled_casinos), 2):
                row = [KeyboardButton(enabled_casinos[i][1])]
                if i + 1 < len(enabled_casinos):
                    row.append(KeyboardButton(enabled_casinos[i + 1][1]))
                keyboard_buttons.append(row)
            
            keyboard_buttons.append([KeyboardButton("❌ Отменить заявку")])
            reply_markup = ReplyKeyboardMarkup(keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)
            
            await update.message.reply_text(
                "💸 <b>Вывод средств</b>\n\nВыберите казино:",
                reply_markup=reply_markup,
                parse_mode='HTML'
            )
        elif message_text == btn_support:
            # Отправляем ссылку на бота техподдержки
            keyboard = [
                [InlineKeyboardButton("🚀 Открыть поддержку", url=SUPPORT_BOT_URL)]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)
            await update.message.reply_text(
                "👨‍💻 <b>Техническая поддержка</b>\n\nНажмите на кнопку ниже, чтобы открыть раздел поддержки:",
                reply_markup=reply_markup,
                parse_mode='HTML'
            )
        elif message_text == "📊 История":
            # Отправляем webapp ссылку на историю транзакций
            keyboard = [
                [InlineKeyboardButton("🚀 Открыть историю", web_app=WebAppInfo(url=f"{WEBSITE_URL}/history"))]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)
            await update.message.reply_text(
                "📊 <b>История транзакций</b>\n\nНажмите на кнопку ниже, чтобы открыть историю ваших транзакций:",
                reply_markup=reply_markup,
                parse_mode='HTML'
            )
        elif message_text == btn_faq:
            # Отправляем webapp ссылку на инструкцию
            keyboard = [
                [InlineKeyboardButton("🚀 Открыть инструкцию", web_app=WebAppInfo(url=f"{WEBSITE_URL}/instruction"))]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)
            await update.message.reply_text(
                "📖 <b>Инструкция</b>\n\nНажмите на кнопку ниже, чтобы открыть инструкцию:",
                reply_markup=reply_markup,
                parse_mode='HTML'
            )
        return
    
    # Пытаемся восстановить ожидание фото чека, если бот перезапускался
    if user_id not in user_states:
        photo_file_id = None
        if update.message.photo:
            photo_file_id = update.message.photo[-1].file_id
        elif update.message.document and update.message.document.mime_type and update.message.document.mime_type.startswith('image/'):
            photo_file_id = update.message.document.file_id
        
        if photo_file_id:
            pending_data = get_pending_deposit_state(user_id)
            if pending_data and pending_data.get('amount') and pending_data.get('player_id') and pending_data.get('bookmaker'):
                user_states[user_id] = {
                    'step': 'deposit_receipt_photo',
                    'data': pending_data
                }
                logger.info(f"♻️ Восстановлено ожидание фото чека для пользователя {user_id}")
            else:
                clear_pending_deposit_state(user_id)
    
    # Проверяем, есть ли активный диалог
    if user_id in user_states:
        state = user_states[user_id]
        step = state.get('step', '')
        data = state.get('data', {})
        
        # Если отправлено фото, но не в состоянии, где требуется фото - показываем ошибку
        if (update.message.photo or (update.message.document and update.message.document.mime_type and update.message.document.mime_type.startswith('image/'))):
            # Проверяем, требуется ли фото в текущем шаге
            if step not in ['withdraw_qr', 'deposit_receipt_photo', 'deposit_bank']:
                await update.message.reply_text("❌ Сейчас не требуется отправка фото. Следуйте инструкциям выше.")
                return
        
        # Обработка выбора казино для пополнения
        if step == 'deposit_bookmaker':
            try:
                # Определяем казино по тексту кнопки
                bookmaker_map = {
                    '1XBET': '1xbet',
                    '1WIN': '1win',
                    'MELBET': 'melbet',
                    'MOSTBET': 'mostbet',
                    'WINWIN': 'winwin',
                    '888STARZ': '888starz'
                }
                
                bookmaker = bookmaker_map.get(message_text)
                if not bookmaker:
                    await update.message.reply_text(get_text('please_select_from_buttons'))
                    return
                
                data['bookmaker'] = bookmaker
                state['step'] = 'deposit_player_id'
                user_states[user_id] = state
                
                # Получаем сохраненный ID для этого казино
                saved_id = data.get('saved_player_ids', {}).get(bookmaker, '')
                if not saved_id:
                    try:
                        async with httpx.AsyncClient(timeout=5.0) as client:
                            response = await client.get(
                                f"{API_URL}/api/public/casino-account",
                                params={"user_id": str(user_id), "casino_id": bookmaker.lower()}
                            )
                            if response.status_code == 200:
                                result = response.json()
                                if result.get('success') and result.get('data', {}).get('accountId'):
                                    saved_id = result.get('data', {}).get('accountId')
                                    if 'saved_player_ids' not in data:
                                        data['saved_player_ids'] = {}
                                    data['saved_player_ids'][bookmaker] = saved_id
                    except Exception as e:
                        logger.warning(f"Не удалось получить сохраненный ID из API: {e}")
                
                # Создаем Reply клавиатуру с сохраненным ID и кнопкой отмены
                keyboard_buttons = []
                if saved_id:
                    keyboard_buttons.append([KeyboardButton(str(saved_id))])
                keyboard_buttons.append([KeyboardButton("❌ Отменить заявку")])
                reply_markup = ReplyKeyboardMarkup(keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)
                
                casino_name = get_casino_name(bookmaker)
                deposit_title = get_text('deposit_title')
                casino_label = get_text('casino_label', casino_name=casino_name)
                enter_player_id = get_text('enter_player_id')
                
                # Формируем текст сообщения
                message_text = f"{deposit_title}\n\n{casino_label}\n\n{enter_player_id}"
                
                # Пытаемся отправить фото с примером ID, если оно есть
                casino_image_path = get_casino_id_image_path(bookmaker)
                if casino_image_path:
                    try:
                        with open(casino_image_path, 'rb') as photo:
                            await update.message.reply_photo(
                                photo=photo,
                                caption=message_text,
                                parse_mode='HTML',
                                reply_markup=reply_markup
                            )
                    except Exception as e:
                        logger.warning(f"⚠️ Не удалось отправить фото ID казино {bookmaker}: {e}")
                        # Если не удалось отправить фото, отправляем текстовое сообщение
                        await update.message.reply_text(
                            message_text,
                            parse_mode='HTML',
                            reply_markup=reply_markup
                        )
                else:
                    # Если нет изображения для этого казино, отправляем текстовое сообщение
                    await update.message.reply_text(
                        message_text,
                        parse_mode='HTML',
                        reply_markup=reply_markup
                    )
                return
            except Exception as e:
                logger.error(f"❌ Ошибка при обработке выбора казино для пополнения: {e}", exc_info=True)
                await update.message.reply_text(get_text('error_processing_casino'))
                return
        
        # Обработка выбора казино для вывода
        if step == 'withdraw_bookmaker':
            try:
                # Определяем казино по тексту кнопки
                bookmaker_map = {
                    '1XBET': '1xbet',
                    '1WIN': '1win',
                    'MELBET': 'melbet',
                    'MOSTBET': 'mostbet',
                    'WINWIN': 'winwin',
                    '888STARZ': '888starz'
                }
                
                bookmaker = bookmaker_map.get(message_text)
                if not bookmaker:
                    await update.message.reply_text(get_text('please_select_from_buttons'))
                    return
                
                data['bookmaker'] = bookmaker
                state['step'] = 'withdraw_qr'
                user_states[user_id] = state
                
                # Получаем сохраненный ID для этого казино
                saved_id = data.get('saved_player_ids', {}).get(bookmaker, '')
                if not saved_id:
                    try:
                        async with httpx.AsyncClient(timeout=5.0) as client:
                            response = await client.get(
                                f"{API_URL}/api/public/casino-account",
                                params={"user_id": str(user_id), "casino_id": bookmaker.lower()}
                            )
                            if response.status_code == 200:
                                result = response.json()
                                if result.get('success') and result.get('data', {}).get('accountId'):
                                    saved_id = result.get('data', {}).get('accountId')
                                    if 'saved_player_ids' not in data:
                                        data['saved_player_ids'] = {}
                                    data['saved_player_ids'][bookmaker] = saved_id
                    except Exception as e:
                        logger.warning(f"Не удалось получить сохраненный ID из API: {e}")
                
                # Получаем сохраненный номер телефона
                saved_phone = None
                try:
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        response = await client.get(
                            f"{API_URL}/api/public/casino-account",
                            params={"user_id": str(user_id), "casino_id": "phone"}
                        )
                        if response.status_code == 200:
                            result = response.json()
                            if result.get('success'):
                                phone_value = result.get('data', {}).get('phone')
                                if phone_value and phone_value != 'null' and phone_value != '':
                                    saved_phone = str(phone_value).strip()
                                    if 'saved_phones' not in data:
                                        data['saved_phones'] = {}
                                    data['saved_phones']['phone'] = saved_phone
                except Exception as e:
                    logger.warning(f"Не удалось получить сохраненный телефон: {e}")
                
                # Всегда переходим к шагу ввода телефона (даже если номер сохранен)
                state['step'] = 'withdraw_phone'
                user_states[user_id] = state
                
                # Создаем Reply клавиатуру с сохраненным номером (если есть) и кнопкой отмены
                keyboard_buttons = []
                if saved_phone:
                    # Показываем сохраненный номер как кнопку для быстрой отправки
                    keyboard_buttons.append([KeyboardButton(saved_phone)])
                keyboard_buttons.append([KeyboardButton("❌ Отменить заявку")])
                reply_markup = ReplyKeyboardMarkup(keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)
                
                casino_name = get_casino_name(bookmaker)
                withdraw_title = get_text('withdraw_title')
                casino_label = get_text('casino_label', casino_name=casino_name)
                enter_phone = get_text('enter_phone')
                
                await update.message.reply_text(
                    f"{withdraw_title}\n\n{casino_label}\n\n{enter_phone}",
                    parse_mode='HTML',
                    reply_markup=reply_markup
                )
                return
            except Exception as e:
                logger.error(f"❌ Ошибка при обработке выбора казино для вывода: {e}", exc_info=True)
                await update.message.reply_text(get_text('error_processing_casino'))
                return
        
        # Обработка пополнения
        if step == 'deposit_player_id':
            # Проверяем, не нажата ли кнопка с сохраненным ID (теперь кнопка содержит только цифры без префикса "ID: ")
            if not message_text or not message_text.strip().isdigit():
                await update.message.reply_text(get_text('invalid_player_id_format'))
                return
            player_id = message_text.strip()
            
            # Сохраняем ID для этого казино в user_states
            if 'saved_player_ids' not in data:
                data['saved_player_ids'] = {}
            data['saved_player_ids'][data['bookmaker']] = player_id
            
            # Сохраняем ID через API в базу данных (нормализуем название казино)
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(
                        f"{API_URL}/api/public/casino-account",
                        json={
                            "user_id": str(user_id),
                            "casino_id": data['bookmaker'].lower(),
                            "account_id": player_id
                        },
                        headers={"Content-Type": "application/json"}
                    )
            except Exception as e:
                logger.warning(f"Не удалось сохранить ID через API: {e}")
            
            data['player_id'] = player_id
            state['step'] = 'deposit_amount'
            user_states[user_id] = state
            
            # Создаем Reply клавиатуру с кнопками сумм и отмены
            keyboard_buttons = [
                [KeyboardButton("100"), KeyboardButton("200"), KeyboardButton("500")],
                [KeyboardButton("1000"), KeyboardButton("2000"), KeyboardButton("5000")],
                [KeyboardButton("10000")],
                [KeyboardButton("❌ Отменить заявку")]
            ]
            reply_markup = ReplyKeyboardMarkup(keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)
            
            deposit_title = get_text('deposit_title')
            deposit_amount_prompt = get_text('deposit_amount_prompt')
            min_amount_value = 100 if data.get('bookmaker') == '1win' else 35
            max_amount_value = 100000
            min_amount = get_text('min_amount', min=min_amount_value)
            max_amount = f"Максимум: {max_amount_value:,} KGS".replace(',', ' ')
            await update.message.reply_text(
                f"{deposit_title}\n\n{min_amount}\n{max_amount}\n\n{deposit_amount_prompt}",
                parse_mode='HTML',
                reply_markup=reply_markup
            )
            return
        
        elif step == 'deposit_amount':
            logger.info(f"💰 Обработка суммы пополнения для пользователя {user_id}: message_text='{message_text}'")
            
            # Проверяем, не нажата ли кнопка с суммой
            if message_text in ["100", "200", "500", "1000", "2000", "5000", "10000"]:
                amount = float(message_text)
            else:
                try:
                    amount = float(message_text.replace(',', '.').strip())
                except ValueError as e:
                    logger.error(f"❌ Ошибка парсинга суммы: {e}, message_text='{message_text}'")
                    await update.message.reply_text(get_text('invalid_amount_format_deposit'))
                    return
            
            logger.info(f"💰 Сумма распознана: {amount}")
            min_amount_value = 100 if data.get('bookmaker') == '1win' else 35
            max_amount_value = 100000
            if amount < min_amount_value or amount > max_amount_value:
                logger.warning(f"⚠️ Сумма вне диапазона: {amount}")
                await update.message.reply_text(
                    f"❌ Сумма должна быть от {min_amount_value} до {max_amount_value:,} сом".replace(',', ' ')
                )
                return
            
            # Добавляем случайные копейки к сумме (1-99 копеек), если сумма целая
            if amount == int(amount):
                random_kopecks = random.randint(1, 99)
                amount = amount + (random_kopecks / 100)
                logger.info(f"💰 Добавлены случайные копейки: {random_kopecks}, итоговая сумма: {amount}")
            
            data['amount'] = amount
            state['step'] = 'deposit_bank'
            user_states[user_id] = state
            
            # Отправляем сообщение о генерации QR и очищаем клавиатуру
            generating_message = await update.message.reply_text(
                f"⏳ {get_text('qr_generating')}",
                reply_markup=ReplyKeyboardRemove()
            )
            
            # Получаем только QR ссылки (заявку создадим после отправки фото)
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    # Получаем QR ссылки для всех банков
                    qr_response = await client.post(
                        f"{API_URL}/api/public/generate-qr",
                        json={
                            "amount": amount,
                            "playerId": data['player_id'],
                            "bank": "demirbank"  # По умолчанию, но ссылки будут для всех банков
                        },
                        headers={"Content-Type": "application/json"}
                    )
                    
                    logger.info(f"📥 Ответ от API generate-qr: status={qr_response.status_code}")
                    
                    if qr_response.status_code == 200:
                        qr_data = qr_response.json()
                        logger.info(f"📋 Данные QR: {qr_data}")
                        if qr_data.get('success'):
                            # Используем скорректированную сумму из API (с копейками, если были добавлены)
                            adjusted_amount = qr_data.get('amount', amount)
                            if adjusted_amount != amount:
                                logger.info(f"💰 API скорректировал сумму: {amount} → {adjusted_amount}")
                                amount = adjusted_amount
                                data['amount'] = amount
                            
                            # API возвращает all_bank_urls напрямую, а не внутри data
                            bank_links = qr_data.get('all_bank_urls', {})
                            # Таймер по умолчанию 5 минут (300 секунд)
                            timer_seconds = 300
                            logger.info(f"🔗 Получены ссылки для банков: {list(bank_links.keys())}")
                            
                            # Форматируем таймер (без ведущих нулей)
                            minutes = timer_seconds // 60
                            seconds = timer_seconds % 60
                            timer_text = f"{minutes}:{seconds:02d}"
                            
                            # Загружаем настройки если они устарели
                            if asyncio.get_event_loop().time() - settings_cache.get('last_update', 0) > 300:
                                await load_settings()
                            
                            # Получаем список доступных банков из настроек
                            enabled_banks = settings_cache.get('deposit_banks', [])
                            
                            # Формируем клавиатуру с учетом доступности банков
                            keyboard = []
                            bank_names_map = {
                                'demirbank': 'DemirBank',
                                'omoney': 'O!Money',
                                'balance': 'Balance.kg',
                                'bakai': 'Bakai',
                                'megapay': 'MegaPay',
                                'mbank': 'MBank'
                            }
                            
                            # Создаем кнопки для всех банков с URL ссылками (как на втором фото)
                            all_banks_list = []
                            added_banks = set()  # Отслеживаем уже добавленные банки
                            for bank_key, bank_name in bank_names_map.items():
                                # Проверяем, есть ли ссылка для этого банка
                                bank_link = bank_links.get(bank_key) or bank_links.get(bank_name)
                                # Также проверяем варианты с 'demir' для demirbank
                                if not bank_link and bank_key == 'demirbank':
                                    bank_link = bank_links.get('demir') or bank_links.get('DemirBank')
                                
                                if bank_link and bank_name not in added_banks:
                                    added_banks.add(bank_name)  # Помечаем банк как добавленный
                                    is_enabled = bank_key in enabled_banks or 'demir' in bank_key.lower() or 'demirbank' in enabled_banks
                                    if is_enabled:
                                        # Кнопка с URL - сразу открывает ссылку на оплату
                                        all_banks_list.append(InlineKeyboardButton(bank_name, url=bank_link))
                                    else:
                                        # Недоступный банк - показываем, но без ссылки (callback для показа сообщения)
                                        all_banks_list.append(InlineKeyboardButton(f"{bank_name} ⚠️", callback_data=f"deposit_bank_{bank_key}_disabled"))
                            
                            # Разделяем на пары (по 2 в ряд)
                            for i in range(0, len(all_banks_list), 2):
                                if i + 1 < len(all_banks_list):
                                    keyboard.append([all_banks_list[i], all_banks_list[i + 1]])
                                else:
                                    keyboard.append([all_banks_list[i]])
                            
                            if not keyboard:
                                logger.warning(f"⚠️ Нет ссылок для банков, отправляю сообщение без кнопок")
                                # Удаляем сообщение "Генерирую QR code..."
                                try:
                                    await generating_message.delete()
                                except Exception as e:
                                    logger.warning(f"⚠️ Не удалось удалить сообщение 'Генерирую QR code...': {e}")
                                await update.message.reply_text(
                                    f"❌ Не удалось получить ссылки для оплаты. Обратитесь в поддержку.",
                                    parse_mode='HTML'
                                )
                                return
                            
                            keyboard.append([InlineKeyboardButton("❌ Отменить заявку", callback_data="cancel_request")])
                            reply_markup = InlineKeyboardMarkup(keyboard)
                            
                            logger.info(f"📤 Отправляю сообщение с кнопками банков для пользователя {user_id}")
                            
                            # Отправляем QR-код перед кнопками банков
                            # Используем ссылку O!Money для QR-кода, если есть, иначе первую доступную
                            omoney_url = bank_links.get('O!Money') or bank_links.get('omoney') or (list(bank_links.values())[0] if bank_links else None)
                            if omoney_url:
                                try:
                                    # Логируем доступность библиотеки
                                    if not QRCODE_AVAILABLE:
                                        logger.warning("⚠️ Библиотека qrcode не установлена! Установите: pip install qrcode[pil]")
                                    
                                    if QRCODE_AVAILABLE:
                                        # Подготавливаем данные для текста на изображении
                                        casino_name = get_casino_name(data.get('bookmaker', ''))
                                        deposit_title = get_text('deposit_title')
                                        
                                        # Генерируем QR-код с текстом (увеличенный box_size для больших модулей)
                                        qr = qrcode.QRCode(
                                            version=1,
                                            error_correction=qrcode.constants.ERROR_CORRECT_L,
                                            box_size=28,  # Оптимальный размер модулей QR-кода
                                            border=4,
                                        )
                                        qr.add_data(omoney_url)
                                        qr.make(fit=True)
                                        
                                        # Создаем изображение QR-кода
                                        qr_img = qr.make_image(fill_color="black", back_color="white")
                                        
                                        # Создаем новое изображение с белым фоном
                                        img_width = 900  # Оптимальная ширина для QR-кода
                                        img_height = 1200  # Временная высота, будет обрезана после красной линии
                                        img = Image.new('RGBA', (img_width, img_height), (255, 255, 255, 255))  # RGBA для поддержки прозрачности водяных знаков
                                        
                                        # Водяной знак удален по запросу пользователя
                                        
                                        # Вставляем QR-код в центр (с отступом сверху, увеличенный размер)
                                        qr_size = 780  # Увеличенный размер QR-кода как на втором фото
                                        qr_img_resized = qr_img.resize((qr_size, qr_size))
                                        qr_x = (img_width - qr_size) // 2
                                        qr_y = 50
                                        img.paste(qr_img_resized, (qr_x, qr_y))
                                        
                                        # Добавляем текст
                                        draw = ImageDraw.Draw(img)
                                        
                                        # Загружаем шрифты (пробуем разные варианты)
                                        font_large = None
                                        font_medium = None
                                        font_small = None
                                        font_info = None
                                        
                                        # Пробуем загрузить шрифты из разных мест (Linux/Windows/Mac)
                                        font_paths = [
                                            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                                            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                                            "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
                                            "/System/Library/Fonts/Helvetica.ttc",
                                            "arial.ttf",
                                            "Arial.ttf",
                                            "/Windows/Fonts/arial.ttf",
                                            "/Windows/Fonts/ARIAL.TTF",
                                        ]
                                        
                                        font_path = None
                                        for path in font_paths:
                                            try:
                                                if os.path.exists(path):
                                                    # Пробуем загрузить шрифт
                                                    test_font = ImageFont.truetype(path, 16)
                                                    font_path = path
                                                    break
                                            except Exception as e:
                                                continue
                                        
                                        if font_path:
                                            try:
                                                font_large = ImageFont.truetype(font_path, 32)
                                                font_medium = ImageFont.truetype(font_path, 55)  # Значительно увеличен для текста "ОТСКАНИРУЙТЕ QR"
                                                font_small = ImageFont.truetype(font_path, 42)  # Увеличен для текста "В любом банке"
                                                font_info = ImageFont.truetype(font_path, 16)
                                                logger.info(f"✅ Загружен шрифт: {font_path}")
                                            except Exception as e:
                                                logger.warning(f"⚠️ Не удалось загрузить шрифт {font_path}: {e}")
                                                font_path = None
                                        
                                        # Fallback на стандартный шрифт (НЕ поддерживает кириллицу!)
                                        if not font_path:
                                            # Пробуем использовать встроенный шрифт PIL с большим размером
                                            try:
                                                # Пробуем загрузить любой доступный шрифт из системы
                                                import subprocess
                                                result = subprocess.run(['fc-list'], capture_output=True, text=True, timeout=2)
                                                if result.returncode == 0 and result.stdout:
                                                    # Парсим первый найденный шрифт
                                                    for line in result.stdout.split('\n')[:5]:
                                                        if '.ttf' in line or '.otf' in line:
                                                            try:
                                                                font_file = line.split(':')[0].strip()
                                                                if os.path.exists(font_file):
                                                                    font_large = ImageFont.truetype(font_file, 32)
                                                                    font_medium = ImageFont.truetype(font_file, 55)  # Значительно увеличен для текста "ОТСКАНИРУЙТЕ QR"
                                                                    font_small = ImageFont.truetype(font_file, 42)  # Увеличен для текста "В любом банке"
                                                                    font_info = ImageFont.truetype(font_file, 16)
                                                                    logger.info(f"✅ Найден шрифт через fc-list: {font_file}")
                                                                    font_path = font_file
                                                                    break
                                                            except:
                                                                continue
                                            except:
                                                pass
                                            
                                            if not font_path:
                                                font_large = ImageFont.load_default()
                                                font_medium = ImageFont.load_default()
                                                font_small = ImageFont.load_default()
                                                font_info = ImageFont.load_default()
                                                logger.error("❌ Шрифт не найден! Текст может не отображаться (стандартный шрифт не поддерживает кириллицу)")
                                                logger.error("💡 Установите шрифты: sudo apt-get install fonts-dejavu fonts-liberation")
                                        
                                        # Изображение уже в RGBA режиме, пересоздаем draw для работы с текстом
                                        draw = ImageDraw.Draw(img)
                                        
                                        # Текст "ПОПОЛНЕНИЕ ДЛЯ КАЗИНО" поверх QR-кода по диагонали в две строки
                                        text_line1 = "ПОПОЛНЕНИЕ ДЛЯ"
                                        text_line2 = "КАЗИНО"
                                        
                                        # Увеличиваем размер шрифта для текста поверх QR-кода (более заметный, чтобы закрывал QR-код)
                                        try:
                                            font_overlay = ImageFont.truetype(font_path, 85) if font_path else font_large  # Оптимальный размер для перекрытия QR-кода
                                        except:
                                            font_overlay = font_large
                                        
                                        # Создаем временное изображение для повернутого текста
                                        # Размеры для временного изображения (больше, чтобы текст поместился при повороте)
                                        temp_img_size = max(img_width, img_height) * 3
                                        temp_img = Image.new('RGBA', (temp_img_size, temp_img_size), (0, 0, 0, 0))
                                        temp_draw = ImageDraw.Draw(temp_img)
                                        
                                        # Получаем размеры обеих строк текста
                                        bbox1 = temp_draw.textbbox((0, 0), text_line1, font=font_overlay)
                                        bbox2 = temp_draw.textbbox((0, 0), text_line2, font=font_overlay)
                                        text_width1 = bbox1[2] - bbox1[0]
                                        text_height1 = bbox1[3] - bbox1[1]
                                        text_width2 = bbox2[2] - bbox2[0]
                                        text_height2 = bbox2[3] - bbox2[1]
                                        
                                        # Общая ширина и высота блока из двух строк
                                        block_width = max(text_width1, text_width2)
                                        block_height = text_height1 + text_height2 + 20  # Увеличено расстояние между строками для большего шрифта
                                        
                                        # Рисуем две строки текста одна под другой (красный, полупрозрачный)
                                        # Используем полупрозрачный красный цвет (R, G, B, Alpha)
                                        text_color = (220, 0, 0, 180)  # Красный с прозрачностью ~70% (более видимый)
                                        
                                        # Центрируем блок текста на временном изображении
                                        block_x = (temp_img_size - block_width) // 2
                                        block_y = (temp_img_size - block_height) // 2
                                        
                                        # Рисуем первую строку
                                        text_x1 = block_x + (block_width - text_width1) // 2
                                        text_y1 = block_y
                                        temp_draw.text((text_x1, text_y1), text_line1, fill=text_color, font=font_overlay)
                                        
                                        # Рисуем вторую строку под первой
                                        text_x2 = block_x + (block_width - text_width2) // 2
                                        text_y2 = block_y + text_height1 + 20  # Увеличено расстояние между строками
                                        temp_draw.text((text_x2, text_y2), text_line2, fill=text_color, font=font_overlay)
                                        
                                        # Поворачиваем текст по диагонали (около -40 градусов от нижнего левого к верхнему правому)
                                        rotation_angle = -40
                                        # Используем BICUBIC для лучшего качества поворота текста (LANCZOS не поддерживается в этой версии Pillow)
                                        rotated_text = temp_img.rotate(rotation_angle, expand=False, fillcolor=(0, 0, 0, 0), resample=Image.Resampling.BICUBIC)
                                        
                                        # Вычисляем позицию для центрирования текста по диагонали QR-кода
                                        # Центр QR-кода
                                        qr_center_x = qr_x + qr_size // 2
                                        qr_center_y = qr_y + qr_size // 2
                                        
                                        # Центр повернутого текста на временном изображении
                                        center_x = temp_img_size // 2
                                        center_y = temp_img_size // 2
                                        
                                        # Вырезаем область вокруг центра повернутого текста
                                        # Увеличиваем область crop для безопасности, чтобы текст не обрезался по краям
                                        crop_padding = 250
                                        crop_x1 = center_x - block_width // 2 - crop_padding
                                        crop_y1 = center_y - block_height // 2 - crop_padding
                                        crop_x2 = center_x + block_width // 2 + crop_padding
                                        crop_y2 = center_y + block_height // 2 + crop_padding
                                        
                                        text_crop = rotated_text.crop((crop_x1, crop_y1, crop_x2, crop_y2))
                                        
                                        # Вычисляем позицию для наложения текста так, чтобы центр текста совпадал с центром QR-кода
                                        crop_width = crop_x2 - crop_x1
                                        crop_height = crop_y2 - crop_y1
                                        paste_x = qr_center_x - crop_width // 2
                                        paste_y = qr_center_y - crop_height // 2
                                        
                                        # Накладываем текст поверх QR-кода с альфа-каналом
                                        img.paste(text_crop, (paste_x, paste_y), text_crop)
                                        
                                        # Текст "ОТСКАНИРУЙТЕ QR" под QR-кодом
                                        text_below1 = "ОТСКАНИРУЙТЕ QR"
                                        bbox2 = draw.textbbox((0, 0), text_below1, font=font_medium)
                                        text_width2 = bbox2[2] - bbox2[0]
                                        text_x2 = (img_width - text_width2) // 2
                                        text_y2 = qr_y + qr_size + 30  # Под QR-кодом с отступом
                                        draw.text((text_x2, text_y2), text_below1, fill='black', font=font_medium)
                                        
                                        # Текст "В любом банке"
                                        text_below2 = "В любом банке"
                                        bbox3 = draw.textbbox((0, 0), text_below2, font=font_small)
                                        text_width3 = bbox3[2] - bbox3[0]
                                        text_x3 = (img_width - text_width3) // 2
                                        text_y3 = text_y2 + 60  # Увеличено расстояние для большего шрифта
                                        draw.text((text_x3, text_y3), text_below2, fill='blue', font=font_small)
                                        
                                        # НЕ добавляем детальную информацию на изображение - она будет только в caption
                                        # Оставляем только QR-код, текст под ним и красную линию внизу
                                        
                                        # Красная линия внизу изображения (как на оригинале)
                                        # Размещаем её после текста "В любом банке" с небольшим отступом
                                        red_line_y = text_y3 + 50
                                        red_line_height = 5
                                        draw.rectangle([0, red_line_y, img_width, red_line_y + red_line_height], fill='red', outline='red', width=0)
                                        
                                        # Обрезаем изображение после красной линии, чтобы убрать пустое пространство внизу
                                        bottom_crop = red_line_y + red_line_height + 20  # Небольшой отступ после красной линии
                                        img = img.crop((0, 0, img_width, bottom_crop))
                                        
                                        # Конвертируем обратно в RGB для сохранения (PNG поддерживает RGBA, но RGB более совместим)
                                        img = img.convert('RGB')
                                        
                                        # Сохраняем в BytesIO
                                        qr_image = BytesIO()
                                        img.save(qr_image, format='PNG')
                                        qr_image.seek(0)
                                        qr_image.name = 'qr_code.png'
                                        
                                        # Логируем для отладки
                                        logger.info(f"✅ QR-код сгенерирован: размер {img_width}x{img_height}, шрифт: {font_path or 'default'}, текст добавлен")
                                    else:
                                        # Fallback на онлайн API если библиотеки нет
                                        logger.warning("⚠️ Библиотека qrcode недоступна, используем онлайн API")
                                        qr_code_url = f"https://api.qrserver.com/v1/create-qr-code/?size=900x900&data={quote(omoney_url, safe='')}"
                                        async with httpx.AsyncClient(timeout=10.0) as qr_client:
                                            qr_response = await qr_client.get(qr_code_url)
                                            if qr_response.status_code == 200:
                                                # Загружаем готовый QR-код и добавляем на него текст
                                                qr_img_online = Image.open(BytesIO(qr_response.content))
                                                
                                                # Подготавливаем данные для текста
                                                casino_name = get_casino_name(data.get('bookmaker', ''))
                                                deposit_title = get_text('deposit_title')
                                                
                                                # Создаем новое изображение с белым фоном
                                                img_width = 900  # Оптимальная ширина для размещения QR-кода
                                                img_height = 1100  # Оптимальная высота изображения
                                                img = Image.new('RGB', (img_width, img_height), 'white')
                                                
                                                # Вставляем QR-код
                                                qr_size = 780  # Увеличенный размер QR-кода как на втором фото
                                                qr_img_resized = qr_img_online.resize((qr_size, qr_size))
                                                qr_x = (img_width - qr_size) // 2
                                                qr_y = 50
                                                img.paste(qr_img_resized, (qr_x, qr_y))
                                                
                                                # Добавляем текст (используем стандартный шрифт, но хотя бы попробуем)
                                                draw = ImageDraw.Draw(img)
                                                try:
                                                    # Пробуем найти шрифт
                                                    font_paths = [
                                                        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                                                        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
                                                        "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
                                                    ]
                                                    font_info = None
                                                    for path in font_paths:
                                                        if os.path.exists(path):
                                                            try:
                                                                font_info = ImageFont.truetype(path, 16)
                                                                break
                                                            except:
                                                                continue
                                                    
                                                    if not font_info:
                                                        font_info = ImageFont.load_default()
                                                    
                                                    # Добавляем текст под QR-кодом
                                                    current_y = qr_y + qr_size + 30
                                                    
                                                    def draw_text_line(text, y_pos, font_obj, color='black'):
                                                        try:
                                                            bbox = draw.textbbox((0, 0), text, font=font_obj)
                                                            text_width = bbox[2] - bbox[0]
                                                            if text_width > 0:
                                                                text_x = (img_width - text_width) // 2
                                                                draw.text((text_x, y_pos), text, fill=color, font=font_obj)
                                                                return bbox[3] - bbox[1]
                                                        except:
                                                            pass
                                                        return 20
                                                    
                                                    current_y += draw_text_line("QR-kod dlya oplaty", current_y, font_info, 'black') + 10
                                                    current_y += draw_text_line(deposit_title, current_y, font_info, 'black') + 10
                                                    current_y += draw_text_line(f"Summa: {amount:.2f} som", current_y, font_info, 'black') + 10
                                                    current_y += draw_text_line(f"Casino: {casino_name}", current_y, font_info, 'black') + 10
                                                    current_y += draw_text_line(f"ID igroka: {data['player_id']}", current_y, font_info, 'black') + 10
                                                    current_y += draw_text_line(f"Timer: {timer_text}", current_y, font_info, 'red') + 10
                                                    current_y += draw_text_line("Posle oplaty otpravte foto cheka:", current_y, font_info, 'black') + 10
                                                    
                                                except Exception as e:
                                                    logger.error(f"❌ Ошибка при добавлении текста на QR-код из онлайн API: {e}")
                                                
                                                # Сохраняем в BytesIO
                                                qr_image = BytesIO()
                                                img.save(qr_image, format='PNG')
                                                qr_image.seek(0)
                                                qr_image.name = 'qr_code.png'
                                                logger.info(f"✅ QR-код из онлайн API обработан, текст добавлен")
                                            else:
                                                qr_image = None
                                                logger.error(f"❌ Не удалось загрузить QR-код из онлайн API: status={qr_response.status_code}")
                                    
                                    # Подготавливаем текст для caption
                                    casino_name = get_casino_name(data.get('bookmaker', ''))
                                    deposit_title = get_text('deposit_title')
                                    casino_label = get_text('casino_label', casino_name=casino_name)
                                    
                                    # Форматируем сумму с копейками (2 знака после запятой)
                                    formatted_amount = f"{amount:.2f}"
                                    caption_text = (
                                        f"💰 <b>Сумма:</b> {formatted_amount} KGS\n\n"
                                        f"🆔 <b>ID:</b> {data['player_id']}\n\n"
                                        f"⏳ <b>Время на оплату: {timer_text}</b>\n\n"
                                        f"‼️ <b>Оплатите точно до копеек!</b>\n"
                                        f"📸 Ждём фото чека после оплаты"
                                    )
                                    
                                    if qr_image:
                                        timer_message = await update.message.reply_photo(
                                            photo=qr_image,
                                            caption=caption_text,
                                            reply_markup=reply_markup,
                                            parse_mode='HTML'
                                        )
                                        # Сохраняем флаг что это фото-сообщение
                                        data['is_photo_message'] = True
                                        logger.info(f"✅ QR-код отправлен пользователю {user_id}")
                                    else:
                                        # Если QR-код не был сгенерирован, отправляем текстовое сообщение
                                        timer_message = await update.message.reply_text(
                                            caption_text,
                                            reply_markup=reply_markup,
                                            parse_mode='HTML'
                                        )
                                        # Сохраняем флаг что это текстовое сообщение
                                        data['is_photo_message'] = False
                                        logger.warning(f"⚠️ QR-код не был сгенерирован для пользователя {user_id}")
                                except Exception as e:
                                    logger.warning(f"⚠️ Не удалось отправить QR-код: {e}", exc_info=True)
                                    # Если QR-код не удалось отправить, отправляем текстовое сообщение
                                    casino_name = get_casino_name(data.get('bookmaker', ''))
                                    deposit_title = get_text('deposit_title')
                                    casino_label = get_text('casino_label', casino_name=casino_name)
                                    # Форматируем сумму с копейками (2 знака после запятой)
                                    formatted_amount = f"{amount:.2f}"
                                    timer_message = await update.message.reply_text(
                                        f"💰 <b>Сумма:</b> {formatted_amount} KGS\n\n"
                                        f"🆔 <b>ID:</b> {data['player_id']}\n\n"
                                        f"⏳ <b>Время на оплату: {timer_text}</b>\n\n"
                                        f"‼️ <b>Оплатите точно до копеек!</b>\n"
                                        f"📸 Ждём фото чека после оплаты",
                                        reply_markup=reply_markup,
                                        parse_mode='HTML'
                                    )
                                    # Сохраняем флаг что это текстовое сообщение
                                    data['is_photo_message'] = False
                            
                            # Сохраняем данные для таймера
                            data['timer_message_id'] = timer_message.message_id
                            data['timer_chat_id'] = timer_message.chat.id
                            user_states[user_id]['data'] = data
                            
                            # Сохраняем ссылки в состоянии для последующего использования
                            user_states[user_id]['data']['bank_links'] = bank_links
                            user_states[user_id]['data']['timer_seconds'] = timer_seconds
                            
                            # Сохраняем ожидание фото чека (для восстановления после рестарта)
                            pending_data = {
                                'amount': data.get('amount'),
                                'player_id': data.get('player_id'),
                                'bookmaker': data.get('bookmaker')
                            }
                            set_pending_deposit_state(user_id, pending_data, time.time() + timer_seconds)
                            
                            # Удаляем сообщение "Генерирую QR code..."
                            try:
                                await generating_message.delete()
                            except Exception as e:
                                logger.warning(f"⚠️ Не удалось удалить сообщение 'Генерирую QR code...': {e}")
                            
                            # Запускаем таймер как фоновую задачу
                            timer_task = asyncio.create_task(
                                update_timer(context.bot, user_id, timer_seconds, data, timer_message.message_id, timer_message.chat.id)
                            )
                            active_timers[user_id] = timer_task
                            
                            # Состояние остается deposit_bank - ждем выбора банка или фото
                            logger.info(f"✅ Сообщение с кнопками банков отправлено пользователю {user_id}, таймер запущен")
                            return
                        else:
                            logger.error(f"❌ QR данные не содержат success или data: {qr_data}")
                            # Удаляем сообщение "Генерирую QR code..."
                            try:
                                await generating_message.delete()
                            except Exception as e:
                                logger.warning(f"⚠️ Не удалось удалить сообщение 'Генерирую QR code...': {e}")
                            await update.message.reply_text(
                                f"❌ Ошибка при получении ссылок на оплату. Попробуйте еще раз."
                            )
                            return
                    else:
                        error_text = qr_response.text
                        logger.error(f"❌ Ошибка при получении QR ссылок: status={qr_response.status_code}, error={error_text}")
                        # Удаляем сообщение "Генерирую QR code..."
                        try:
                            await generating_message.delete()
                        except Exception as e:
                            logger.warning(f"⚠️ Не удалось удалить сообщение 'Генерирую QR code...': {e}")
                        await update.message.reply_text(
                            f"❌ Ошибка при получении ссылок на оплату. Попробуйте еще раз."
                        )
                        return
            except Exception as e:
                logger.error(f"❌ Ошибка при создании заявки или получении ссылок: {e}")
                # Удаляем сообщение "Генерирую QR code..."
                try:
                    await generating_message.delete()
                except Exception as delete_error:
                    logger.warning(f"⚠️ Не удалось удалить сообщение 'Генерирую QR code...': {delete_error}")
                await update.message.reply_text(
                    f"❌ Ошибка при создании заявки. Попробуйте еще раз или обратитесь в поддержку."
                )
                return
        
        # Обработка отправки фото чека для депозита (или выбора банка)
        elif step == 'deposit_bank' or step == 'deposit_receipt_photo':
            # Проверяем, есть ли фото
            photo_file_id = None
            if update.message.photo:
                photo_file_id = update.message.photo[-1].file_id
            elif update.message.document and update.message.document.mime_type and update.message.document.mime_type.startswith('image/'):
                photo_file_id = update.message.document.file_id
            
            if not photo_file_id:
                # Если нет фото, но есть текст - возможно пользователь выбрал банк через callback
                # Или просто ждем фото
                if step == 'deposit_bank':
                    await update.message.reply_text(get_text('please_send_receipt_after_payment'))
                else:
                    await update.message.reply_text(get_text('please_send_receipt'))
                return
            
            # Получаем фото в base64 и создаем заявку
            processing_message = await update.message.reply_text("⏳ Обрабатываю фото чека и создаю заявку...")
            try:
                receipt_photo_base64 = await asyncio.wait_for(
                    get_photo_base64(context.bot, photo_file_id),
                    timeout=20.0
                )
                logger.info(f"📤 Создаю заявку с фото чека, длина base64: {len(receipt_photo_base64)}")
                
                # Проверяем, что все необходимые данные есть
                if not data.get('amount'):
                    logger.error(f"❌ Отсутствует сумма в данных: {data}")
                    await update.message.reply_text("❌ Ошибка: отсутствует сумма. Начните заново.")
                    if user_id in user_states:
                        del user_states[user_id]
                    clear_pending_deposit_state(user_id)
                    return
                if not data.get('player_id'):
                    logger.error(f"❌ Отсутствует player_id в данных: {data}")
                    await update.message.reply_text("❌ Ошибка: отсутствует ID игрока. Начните заново.")
                    if user_id in user_states:
                        del user_states[user_id]
                    clear_pending_deposit_state(user_id)
                    return
                if not data.get('bookmaker'):
                    logger.error(f"❌ Отсутствует bookmaker в данных: {data}")
                    await update.message.reply_text("❌ Ошибка: отсутствует название казино. Начните заново.")
                    if user_id in user_states:
                        del user_states[user_id]
                    clear_pending_deposit_state(user_id)
                    return
                
                # Создаем заявку с фото чека
                user = update.effective_user
                # По умолчанию используем omoney (о деньги), но не сохраняем выбор банка для отслеживания
                bank = 'omoney'  # Всегда используем omoney по умолчанию
                
                request_body = {
                    "type": "deposit",
                    "bookmaker": data['bookmaker'],
                    "userId": str(user_id),
                    "telegram_user_id": str(user_id),
                    "amount": data['amount'],
                    "bank": bank,
                    "account_id": data['player_id'],
                    "playerId": data['player_id'],
                    "receipt_photo": receipt_photo_base64,  # Фото чека
                    "telegram_username": user.username,
                    "telegram_first_name": user.first_name,
                    "telegram_last_name": user.last_name,
                    "source": "bot"
                }
                
                async with httpx.AsyncClient(timeout=30.0) as client:
                    # Создаем заявку с фото
                    logger.info(f"📤 Отправляю заявку на создание: amount={data.get('amount')}, bookmaker={data.get('bookmaker')}, player_id={data.get('player_id')}")
                    logger.info(f"📤 Размер фото в base64: {len(receipt_photo_base64)} символов")
                    
                    try:
                        payment_response = await client.post(
                            f"{API_URL}/api/payment",
                            json=request_body,
                            headers={"Content-Type": "application/json"}
                        )
                    except httpx.TimeoutException:
                        logger.error(f"❌ Таймаут при создании заявки (превышено 30 секунд)")
                        await update.message.reply_text("❌ Превышено время ожидания. Попробуйте отправить фото еще раз.")
                        return
                    except Exception as e:
                        logger.error(f"❌ Ошибка сети при создании заявки: {e}", exc_info=True)
                        await update.message.reply_text(f"❌ Ошибка сети: {str(e)[:200]}")
                        return
                    
                    logger.info(f"📥 Ответ от API payment: status={payment_response.status_code}")
                    
                    # Пытаемся получить ответ в любом случае
                    try:
                        result = payment_response.json()
                        logger.info(f"📋 Результат создания заявки: {result}")
                    except Exception as e:
                        error_text = payment_response.text
                        logger.error(f"❌ Не удалось распарсить ответ API: {e}, текст ответа: {error_text[:500]}")
                        await update.message.reply_text(f"❌ Ошибка сервера. Попробуйте позже или обратитесь в поддержку.")
                        return
                    
                    if payment_response.status_code == 200:
                        if result.get('success') != False:
                            request_id = result.get('id') or result.get('data', {}).get('id') or 'N/A'
                            
                            # Используем переводы с динамическим названием казино
                            casino_name = get_casino_name(data.get('bookmaker', ''))
                            success_message = get_text(
                                'deposit_request_sent',
                                request_id=request_id,
                                amount=float(data.get('amount', 0)),
                                account_id=data.get('player_id', ''),
                                casino_name=casino_name
                            )
                            await update.message.reply_text(
                                success_message,
                                parse_mode='HTML',
                                reply_markup=ReplyKeyboardRemove()
                            )
                            
                            # Очищаем состояние только после успешного создания
                            if user_id in user_states:
                                del user_states[user_id]
                            clear_pending_deposit_state(user_id)
                        else:
                            error_msg = result.get('error') or result.get('message') or 'Неизвестная ошибка'
                            logger.error(f"❌ Заявка не создана (success=false): {error_msg}, полный ответ: {result}")
                            await update.message.reply_text(get_text('error_creating_request', error=error_msg))
                    else:
                        error_msg = result.get('error') or result.get('message') or payment_response.text[:200] or f'HTTP {payment_response.status_code}'
                        logger.error(f"❌ Ошибка создания заявки (status {payment_response.status_code}): {error_msg}, полный ответ: {result}")
                        await update.message.reply_text(get_text('error_creating_request', error=error_msg))
            except asyncio.TimeoutError:
                logger.error("❌ Таймаут при загрузке фото чека (20 секунд)")
                await update.message.reply_text("❌ Фото обрабатывается слишком долго. Попробуйте отправить фото еще раз.")
            except httpx.TimeoutException as e:
                logger.error(f"❌ Таймаут при обработке фото чека: {e}", exc_info=True)
                await update.message.reply_text("❌ Превышено время ожидания при обработке фото. Попробуйте отправить фото еще раз.")
            except Exception as e:
                logger.error(f"❌ Ошибка при обработке фото чека: {e}", exc_info=True)
                error_msg = str(e)
                # Если это ошибка получения фото, даем более понятное сообщение
                if "get_file" in error_msg.lower() or "file" in error_msg.lower():
                    await update.message.reply_text("❌ Не удалось загрузить фото. Попробуйте отправить фото еще раз.")
                else:
                    await update.message.reply_text(get_text('error_processing_photo', error=error_msg[:200]))
            finally:
                try:
                    await processing_message.delete()
                except Exception:
                    pass
            return
        
        # Обработка вывода
        elif step == 'withdraw_phone':
            # Получаем номер телефона
            phone = message_text.strip() if message_text else ""
            
            # Проверка формата телефона
            if not phone.startswith('+996'):
                error_msg = get_text('invalid_phone')
                await update.message.reply_text(error_msg)
                return
            
            if len(phone) < 13 or len(phone) > 16:
                error_msg = get_text('invalid_phone_length')
                await update.message.reply_text(error_msg)
                return
            
            # Сохраняем номер телефона через API (всегда, даже если была ошибка)
            saved_to_api = False
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(
                        f"{API_URL}/api/public/casino-account",
                        json={
                            "user_id": str(user_id),
                            "casino_id": "phone",
                            "account_id": phone
                        },
                        headers={"Content-Type": "application/json"}
                    )
                    if response.status_code == 200:
                        result = response.json()
                        if result.get('success'):
                            saved_to_api = True
                            logger.info(f"✅ Телефон успешно сохранен в API для пользователя {user_id}: {phone}")
                        else:
                            logger.warning(f"⚠️ API вернул success=false при сохранении телефона: {result}")
                    else:
                        logger.warning(f"⚠️ API вернул статус {response.status_code} при сохранении телефона")
            except Exception as e:
                logger.warning(f"❌ Не удалось сохранить телефон через API: {e}")
            
            # ВСЕГДА сохраняем в локальное состояние для быстрого доступа (даже если API не сработал)
            if 'saved_phones' not in data:
                data['saved_phones'] = {}
            data['saved_phones']['phone'] = phone
            # Обновляем состояние пользователя
            if user_id in user_states:
                user_states[user_id]['data'] = data
            logger.info(f"💾 Телефон сохранен в локальное состояние для пользователя {user_id}: {phone} (saved_to_api: {saved_to_api})")
            
            data['phone'] = phone
            state['step'] = 'withdraw_qr'
            user_states[user_id] = state
            
            # Создаем Reply клавиатуру с кнопкой отмены
            keyboard_buttons = [[KeyboardButton("❌ Отменить заявку")]]
            reply_markup = ReplyKeyboardMarkup(keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)
            
            casino_name = get_casino_name(data.get('bookmaker', ''))
            withdraw_title = get_text('withdraw_title')
            casino_label = get_text('casino_label', casino_name=casino_name)
            phone_label = get_text('phone_label', phone=phone)
            send_qr = get_text('send_qr_code')
            await update.message.reply_text(
                f"{withdraw_title}\n\n{casino_label}\n{phone_label}\n\n{send_qr}",
                parse_mode='HTML',
                reply_markup=reply_markup
            )
            return
        
        elif step == 'withdraw_qr':
            # Проверяем, есть ли фото
            photo_file_id = None
            if update.message.photo:
                photo_file_id = update.message.photo[-1].file_id
            elif update.message.document and update.message.document.mime_type and update.message.document.mime_type.startswith('image/'):
                photo_file_id = update.message.document.file_id
            
            if not photo_file_id:
                await update.message.reply_text(get_text('please_send_qr'))
                return
            
            # Сохраняем file_id фото
            data['qr_photo_id'] = photo_file_id
            state['step'] = 'withdraw_player_id'
            user_states[user_id] = state
            
            # Получаем сохраненный ID для этого казино из user_states
            saved_id = data.get('saved_player_ids', {}).get(data['bookmaker'], '')
            logger.info(f"🔍 Проверка сохраненного ID для пользователя {user_id}, казино {data.get('bookmaker', '')}: saved_id = {saved_id} (type: {type(saved_id)})")
            
            # Пытаемся получить сохраненный ID из API (нормализуем название казино)
            if not saved_id or saved_id == 'None' or saved_id == 'null' or not str(saved_id).strip():
                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        response = await client.get(
                            f"{API_URL}/api/public/casino-account",
                            params={"user_id": str(user_id), "casino_id": data['bookmaker'].lower()}
                        )
                        logger.info(f"🔍 Запрос сохраненного ID: статус {response.status_code} для пользователя {user_id}, казино {data['bookmaker']}")
                        if response.status_code == 200:
                            result = response.json()
                            logger.info(f"📋 Ответ API для ID: {result}")
                            
                            # Проверяем успешность и наличие ID
                            account_id_value = None
                            if result.get('success'):
                                account_id_value = result.get('data', {}).get('accountId')
                            
                            # Проверяем что ID есть и не пустой
                            if account_id_value is not None and account_id_value != 'null' and account_id_value != '':
                                id_str = str(account_id_value).strip()
                                if id_str:
                                    saved_id = id_str
                                    # Сохраняем в user_states для быстрого доступа
                                    if 'saved_player_ids' not in data:
                                        data['saved_player_ids'] = {}
                                    data['saved_player_ids'][data['bookmaker']] = saved_id
                                    user_states[user_id]['data'] = data
                                    logger.info(f"✅ Получен сохраненный ID из API для пользователя {user_id}, казино {data['bookmaker']}: {saved_id}")
                                else:
                                    logger.info(f"ℹ️ Сохраненный ID пустой для пользователя {user_id}, казино {data['bookmaker']}")
                            else:
                                logger.info(f"ℹ️ Сохраненный ID не найден в API для пользователя {user_id}, казино {data['bookmaker']} (accountId_value: {account_id_value}, type: {type(account_id_value)})")
                        else:
                            try:
                                error_text = response.text[:200]
                                logger.warning(f"⚠️ API вернул статус {response.status_code} при получении ID: {error_text}")
                            except:
                                logger.warning(f"⚠️ API вернул статус {response.status_code} при получении ID")
                except Exception as e:
                    logger.warning(f"❌ Не удалось получить сохраненный ID из API: {e}", exc_info=True)
            
            # Создаем Reply клавиатуру с сохраненным ID и кнопкой отмены
            keyboard_buttons = []
            logger.info(f"🔍 Проверка сохраненного ID перед добавлением в клавиатуру: saved_id = {saved_id} (type: {type(saved_id)})")
            if saved_id and saved_id != 'None' and saved_id != 'null' and str(saved_id).strip():
                # Всегда показываем сохраненный ID как кнопку для быстрой отправки
                id_str = str(saved_id).strip()
                keyboard_buttons.append([KeyboardButton(id_str)])
                logger.info(f"🆔 ✅ Добавлена кнопка с сохраненным ID: {id_str}")
            else:
                logger.info(f"🆔 ❌ Сохраненный ID не найден или пустой: {saved_id}")
            keyboard_buttons.append([KeyboardButton("❌ Отменить заявку")])
            reply_markup = ReplyKeyboardMarkup(keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)
            
            casino_name = get_casino_name(data.get('bookmaker', ''))
            withdraw_title = get_text('withdraw_title')
            casino_label = get_text('casino_label', casino_name=casino_name)
            phone_label = get_text('phone_label', phone=data.get('phone', ''))
            qr_received = get_text('qr_received')
            enter_account_id = get_text('enter_account_id')
            
            # Формируем текст сообщения
            message_text = f"{withdraw_title}\n\n{casino_label}\n{phone_label}\n{qr_received}\n\n{enter_account_id}"
            
            # Пытаемся отправить фото с примером ID, если оно есть
            casino_image_path = get_casino_id_image_path(data.get('bookmaker', ''))
            if casino_image_path:
                try:
                    with open(casino_image_path, 'rb') as photo:
                        await update.message.reply_photo(
                            photo=photo,
                            caption=message_text,
                            parse_mode='HTML',
                            reply_markup=reply_markup
                        )
                except Exception as e:
                    logger.warning(f"⚠️ Не удалось отправить фото ID казино {data.get('bookmaker', '')}: {e}")
                    # Если не удалось отправить фото, отправляем текстовое сообщение
                    await update.message.reply_text(
                        message_text,
                        parse_mode='HTML',
                        reply_markup=reply_markup
                    )
            else:
                # Если нет изображения для этого казино, отправляем текстовое сообщение
                await update.message.reply_text(
                    message_text,
                    parse_mode='HTML',
                    reply_markup=reply_markup
                )
            return
        
        elif step == 'withdraw_player_id':
            # Проверяем, не нажата ли кнопка с сохраненным ID (теперь кнопка содержит только цифры без префикса "ID: ")
            if not message_text or not message_text.strip().isdigit():
                await update.message.reply_text(get_text('invalid_player_id_format'))
                return
            player_id = message_text.strip()
            
            # Сохраняем ID для этого казино в user_states
            if 'saved_player_ids' not in data:
                data['saved_player_ids'] = {}
            data['saved_player_ids'][data['bookmaker']] = player_id
            
            # Сохраняем ID через API в базу данных (нормализуем название казино)
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    await client.post(
                        f"{API_URL}/api/public/casino-account",
                        json={
                            "user_id": str(user_id),
                            "casino_id": data['bookmaker'].lower(),
                            "account_id": player_id
                        },
                        headers={"Content-Type": "application/json"}
                    )
            except Exception as e:
                logger.warning(f"Не удалось сохранить ID через API: {e}")
            
            data['player_id'] = player_id
            state['step'] = 'withdraw_code'
            user_states[user_id] = state
            
            # Создаем Reply клавиатуру с кнопкой отмены
            keyboard_buttons = [[KeyboardButton("❌ Отменить заявку")]]
            reply_markup = ReplyKeyboardMarkup(keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)
            
            # Определяем адрес в зависимости от казино
            bookmaker_lower = data['bookmaker'].lower()
            if '1xbet' in bookmaker_lower or '1x' in bookmaker_lower:
                address_text = "tsum lux"
            else:
                address_text = "Lux on 24/7"
            
            # Используем переводы с динамическим названием казино
            casino_name = get_casino_name(data.get('bookmaker', ''))
            withdraw_title = get_text('withdraw_title')
            casino_label = get_text('casino_label', casino_name=casino_name)
            phone_label = get_text('phone_label', phone=data.get('phone', ''))
            account_id_label = f"🆔 ID игрока: {data.get('player_id', '')}"
            
            instruction_text = f"""{withdraw_title}

{casino_label}
{phone_label}
{account_id_label}

📍 Заходим👇🏻
📍1. Настройки!
📍2. Вывести со счета!
📍3. Касса
📍4. Сумму для Вывода!
📍(Город Бишкек, улица: {address_text})
📍5. Подтвердить
📍6. Получить Код!
📍7. Отправить его нам"""
            
            await update.message.reply_text(
                instruction_text,
                parse_mode='HTML',
                reply_markup=reply_markup
            )
            return
        
        elif step == 'withdraw_code':
            if not message_text or not message_text.strip():
                await update.message.reply_text(get_text('invalid_code_empty'))
                return
            
            withdrawal_code = message_text.strip()
            data['code'] = withdrawal_code
            
            # Получаем сумму вывода перед созданием заявки
            withdraw_amount = 0
            amount_check_ok = True
            try:
                checking_msg = await update.message.reply_text(get_text('checking_code'))
                
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(
                        f"{API_URL}/api/withdraw-check",
                        json={
                            "bookmaker": data['bookmaker'],
                            "playerId": data['player_id'],
                            "code": withdrawal_code
                        }
                    )
                    
                    try:
                        await checking_msg.delete()
                    except:
                        pass
                    
                    # Парсим JSON независимо от статуса, чтобы получить детальное сообщение об ошибке
                    try:
                        result = response.json()
                        logger.info(f"Ответ проверки суммы (статус {response.status_code}): {result}")
                    except Exception as json_error:
                        logger.error(f"Ошибка парсинга JSON ответа: {json_error}, статус: {response.status_code}")
                        try:
                            response_text = response.text[:200] if hasattr(response, 'text') else str(response.content[:200] if hasattr(response, 'content') else 'N/A')
                            logger.error(f"Текст ответа: {response_text}")
                        except:
                            pass
                        amount_check_ok = False
                        await update.message.reply_text("⚠️ Не удалось проверить сумму вывода. Попробуйте еще раз.")
                        # Выходим из блока try, но не из функции - обработка продолжится ниже
                    
                    if response.status_code == 200:
                        if result.get('success'):
                            # Парсим сумму: проверяем data.amount, data.summa, amount, summa
                            data_obj = result.get('data', {})
                            amount_value = (
                                data_obj.get('amount') or 
                                data_obj.get('summa') or 
                                result.get('amount') or 
                                result.get('summa')
                            )
                            
                            if amount_value is not None:
                                try:
                                    withdraw_amount = float(amount_value)
                                    if withdraw_amount <= 0:
                                        amount_check_ok = False
                                        await update.message.reply_text("⚠️ Сумма вывода не найдена. Проверьте код и попробуйте ещё раз.")
                                    else:
                                        logger.info(f"Сумма вывода получена: {withdraw_amount}")
                                except (ValueError, TypeError) as e:
                                    logger.error(f"Ошибка парсинга суммы: {e}, значение: {amount_value}")
                                    amount_check_ok = False
                                    await update.message.reply_text("⚠️ Ошибка при обработке суммы вывода. Попробуйте ещё раз.")
                            else:
                                amount_check_ok = False
                                error_message = result.get('error') or result.get('message') or 'Не удалось получить сумму вывода'
                                logger.error(f"Сумма не найдена в ответе. Структура ответа: {result}")
                                await update.message.reply_text(f"⚠️ {error_message}")
                        else:
                            amount_check_ok = False
                            error_message = result.get('error') or result.get('message') or 'Не удалось проверить код вывода'
                            await update.message.reply_text(f"⚠️ {error_message}")
                    else:
                        # Статус не 200 - показываем детальное сообщение об ошибке из JSON
                        amount_check_ok = False
                        error_message = result.get('error') or result.get('message') or f'Ошибка сервера (статус {response.status_code})'
                        logger.error(f"Ошибка проверки суммы вывода: статус {response.status_code}, сообщение: {error_message}, полный ответ: {result}")
                        await update.message.reply_text(f"⚠️ {error_message}")
            except Exception as e:
                logger.error(f"Ошибка проверки суммы вывода: {e}")
                amount_check_ok = False
                await update.message.reply_text("⚠️ Не удалось проверить сумму вывода. Попробуйте еще раз.")
            
            if not amount_check_ok:
                if user_id in user_states:
                    del user_states[user_id]
                await start(update, context)
                return
            
            # Отправляем заявку на вывод
            await submit_withdraw_request(update, context, user_id, data, withdraw_amount)
            
            # Очищаем состояние и убираем клавиатуру
            if user_id in user_states:
                del user_states[user_id]
            return
    
    # Если нет активного диалога, но пришло фото/скрин — сообщаем, что заявки нет
    if (
        update.message.photo
        or (
            update.message.document
            and update.message.document.mime_type
            and update.message.document.mime_type.startswith('image/')
        )
    ):
        await update.message.reply_text(
            "❌ Нет активной заявки для фото чека. Нажмите «Пополнить» и пройдите шаги заново."
        )
        return
    
    # Если нет активного диалога, сохраняем сообщение в чат как обычно
    # 🛡️ Валидация входных данных
    if message_text:
        is_valid, error_msg = validate_input(message_text)
        if not is_valid:
            logger.warning(f"🚫 Invalid input from user {user_id}: {error_msg}")
            try:
                await update.message.reply_text("⚠️ Сообщение содержит недопустимые символы. Пожалуйста, отправьте корректное сообщение.")
            except:
                pass
            return
        # Очищаем входные данные
        message_text = sanitize_input(message_text)
    
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
    
    # Пропускаем сохранение системных сообщений (кнопки отмены и т.д.)
    system_messages = ["❌ Отменить заявку", "💰 Пополнить", "💸 Вывести"]
    if message_text in system_messages:
        logger.debug(f"⏭️ Пропускаю сохранение системного сообщения: {message_text}")
    else:
        # Сохраняем сообщение в админку через API (неблокирующе)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
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
            logger.warning(f"⚠️ Таймаут при сохранении сообщения в чат (не критично)")
        except Exception as e:
            logger.warning(f"⚠️ Ошибка при сохранении сообщения в чат (не критично): {e}")
    
    # Если нет активного диалога, показываем меню
    # Кнопки уже в Reply клавиатуре, не нужно отправлять отдельное сообщение
    # await update.message.reply_text(reply_text, reply_markup=reply_markup)

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

async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик callback от inline кнопок"""
    query = update.callback_query
    if not query:
        return
    
    # Отвечаем на callback, игнорируем ошибки для старых запросов
    try:
        await query.answer()
    except Exception as e:
        # Игнорируем ошибки "Query is too old" - это нормально для старых кнопок
        if "too old" in str(e).lower() or "timeout" in str(e).lower():
            logger.debug(f"⚠️ Callback query истек: {e}")
        else:
            logger.warning(f"⚠️ Ошибка при ответе на callback query: {e}")
    
    user = update.effective_user
    user_id = user.id
    callback_data = query.data
    
    # 🛡️ Валидация callback_data
    if callback_data:
        is_valid, error_msg = validate_input(callback_data, max_length=64)
        if not is_valid:
            logger.warning(f"🚫 Invalid callback_data from user {user_id}: {error_msg}")
            try:
                await query.answer("⚠️ Недопустимые данные", show_alert=True)
            except:
                pass
            return
        callback_data = sanitize_input(callback_data)
    
    logger.info(f"📥 Получен callback от пользователя {user_id}: {callback_data}")
    
    # Обработка callback'ов для выбора казино и банков убрана
    # Теперь выбор происходит через Reply клавиатуру в handle_message
    
    # Обработка выбора банка для вывода теперь через Reply клавиатуру (убрана callback обработка)
    
    # Обработка отмены заявки
    if callback_data == "cancel_request":
        logger.info(f"🛑 Пользователь {user_id} отменил заявку через инлайн-кнопку")
        
        # Удаляем сообщение с QR-кодом/кнопками, если оно есть
        try:
            data = user_states.get(user_id, {}).get('data', {})
            if 'timer_message_id' in data and 'timer_chat_id' in data:
                await context.bot.delete_message(
                    chat_id=data['timer_chat_id'],
                    message_id=data['timer_message_id']
                )
                logger.info(f"✅ Сообщение с QR-кодом удалено для пользователя {user_id} при отмене (inline)")
            elif query.message:
                await query.message.delete()
        except Exception as delete_error:
            logger.warning(f"⚠️ Не удалось удалить сообщение с QR-кодом при отмене (inline): {delete_error}")
        
        # Останавливаем таймер если он активен
        if user_id in active_timers:
            try:
                active_timers[user_id].cancel()
                logger.info(f"⏹️ Таймер остановлен для пользователя {user_id}")
            except Exception as e:
                logger.warning(f"⚠️ Ошибка при остановке таймера: {e}")
            del active_timers[user_id]
        
        # Очищаем состояние
        if user_id in user_states:
            del user_states[user_id]
            logger.info(f"✅ Состояние очищено для пользователя {user_id}")
        
        await query.answer("Заявка отменена")
        
        # Отправляем главное меню
        user = query.from_user
        await send_main_menu(context.bot, query.message.chat.id, user.first_name)
        return
    
    # Обработка возврата в главное меню
    if callback_data == "back_to_menu":
        if user_id in user_states:
            del user_states[user_id]
        await query.answer("Возврат в главное меню")
        user = query.from_user
        await send_main_menu(context.bot, query.message.chat.id, user.first_name)
        return
    
    # Обработка проверки подписки
    if callback_data and callback_data.startswith('check_sub_'):
        channel_id = callback_data.replace('check_sub_', '')
        
        # Проверяем подписку
        is_subscribed = await check_channel_subscription(user_id, channel_id)
        
        if is_subscribed:
            # Пользователь подписан, отправляем основное меню
            try:
                try:
                    await query.edit_message_text("✅ Подписка подтверждена.", parse_mode='HTML')
                except Exception:
                    pass
                await send_main_menu(context.bot, query.message.chat.id, user.first_name)
                logger.info(f"✅ Основное меню отправлено пользователю {user_id} после проверки подписки")
            except Exception as e:
                logger.error(f"❌ Ошибка при отправке основного меню: {e}")
                await query.edit_message_text("✅ Спасибо за подписку! Используйте команду /start для продолжения.")
        else:
            # Пользователь не подписан
            await query.answer("❌ Вы еще не подписались на канал. Пожалуйста, подпишитесь и попробуйте снова.", show_alert=True)
            logger.info(f"⚠️ Пользователь {user_id} не подписан на канал")

async def update_timer(bot, user_id: int, total_seconds: int, data: dict, message_id: int, chat_id: int) -> None:
    """Обновляет таймер каждую секунду и отменяет заявку при истечении"""
    try:
        start_time = asyncio.get_event_loop().time()
        remaining_seconds = total_seconds
        
        while remaining_seconds > 0:
            await asyncio.sleep(1)
            
            # Проверяем, не была ли заявка уже создана (если создана, останавливаем таймер)
            if user_id not in user_states:
                logger.info(f"⏹️ Таймер остановлен для пользователя {user_id} - состояние очищено")
                # Удаляем таймер из активных
                if user_id in active_timers:
                    del active_timers[user_id]
                break  # Используем break вместо return для корректного завершения
            
            current_state = user_states.get(user_id, {})
            current_step = current_state.get('step', '')
            
            # Если заявка уже создана (отправлено фото), останавливаем таймер
            if current_step != 'deposit_bank' and current_step != 'deposit_receipt_photo':
                logger.info(f"⏹️ Таймер остановлен для пользователя {user_id} - заявка создана")
                # Удаляем таймер из активных
                if user_id in active_timers:
                    del active_timers[user_id]
                break  # Используем break вместо return для корректного завершения
            
            # Вычисляем оставшееся время
            elapsed = int(asyncio.get_event_loop().time() - start_time)
            remaining_seconds = max(0, total_seconds - elapsed)
            
            # Форматируем таймер (без ведущих нулей)
            minutes = remaining_seconds // 60
            seconds = remaining_seconds % 60
            timer_text = f"{minutes}:{seconds:02d}"
            
            # Обновляем сообщение
            try:
                # Получаем актуальные данные
                current_data = user_states.get(user_id, {}).get('data', data)
                bank_links = current_data.get('bank_links', {})
                
                # Загружаем настройки если они устарели
                if asyncio.get_event_loop().time() - settings_cache.get('last_update', 0) > 300:
                    await load_settings()
                
                # Получаем список доступных банков из настроек
                enabled_banks = settings_cache.get('deposit_banks', [])
                
                # Создаем кнопки банков заново с учетом доступности
                keyboard = []
                bank_names_map = {
                    'demirbank': 'DemirBank',
                    'omoney': 'O!Money',
                    'balance': 'Balance.kg',
                    'bakai': 'Bakai',
                    'megapay': 'MegaPay',
                    'mbank': 'MBank'
                }
                
                all_banks_list = []
                added_banks = set()  # Отслеживаем уже добавленные банки
                for bank_key, bank_name in bank_names_map.items():
                    bank_link = bank_links.get(bank_key) or bank_links.get(bank_name)
                    # Также проверяем варианты с 'demir' для demirbank
                    if not bank_link and bank_key == 'demirbank':
                        bank_link = bank_links.get('demir') or bank_links.get('DemirBank')
                    
                    if bank_link and bank_name not in added_banks:
                        added_banks.add(bank_name)  # Помечаем банк как добавленный
                        is_enabled = bank_key in enabled_banks or 'demir' in bank_key.lower() or 'demirbank' in enabled_banks
                        if is_enabled:
                            # Кнопка с URL - сразу открывает ссылку на оплату
                            all_banks_list.append(InlineKeyboardButton(bank_name, url=bank_link))
                        else:
                            # Недоступный банк - показываем, но без ссылки (callback для показа сообщения)
                            all_banks_list.append(InlineKeyboardButton(f"{bank_name} ⚠️", callback_data=f"deposit_bank_{bank_key}_disabled"))
                
                # Разделяем на пары (по 2 в ряд)
                for i in range(0, len(all_banks_list), 2):
                    if i + 1 < len(all_banks_list):
                        keyboard.append([all_banks_list[i], all_banks_list[i + 1]])
                    else:
                        keyboard.append([all_banks_list[i]])
                
                keyboard.append([InlineKeyboardButton("❌ Отменить заявку", callback_data="cancel_request")])
                reply_markup = InlineKeyboardMarkup(keyboard)
                
                casino_name = get_casino_name(current_data.get('bookmaker', ''))
                deposit_title = get_text('deposit_title')
                casino_label = get_text('casino_label', casino_name=casino_name)
                
                # Формируем текст для обновления
                updated_text = (
                    f"💰 <b>Сумма:</b> {current_data.get('amount', 0):.2f} KGS\n\n"
                    f"🆔 <b>ID:</b> {current_data.get('player_id', '')}\n\n"
                    f"⏳ <b>Время на оплату: {timer_text}</b>\n\n"
                    f"‼️ <b>Оплатите точно до копеек!</b>\n"
                    f"📸 Ждём фото чека после оплаты"
                )
                
                # Проверяем тип сообщения и используем соответствующий метод
                is_photo_message = current_data.get('is_photo_message', False)
                if is_photo_message:
                    # Обновляем caption фото
                    await bot.edit_message_caption(
                        chat_id=chat_id,
                        message_id=message_id,
                        caption=updated_text,
                        reply_markup=reply_markup,
                        parse_mode='HTML'
                    )
                else:
                    # Обновляем текстовое сообщение
                    await bot.edit_message_text(
                        chat_id=chat_id,
                        message_id=message_id,
                        text=updated_text,
                        reply_markup=reply_markup,
                        parse_mode='HTML'
                    )
            except Exception as e:
                logger.warning(f"⚠️ Не удалось обновить таймер для пользователя {user_id}: {e}")
                # Продолжаем работу таймера даже если не удалось обновить сообщение
        
        # Время истекло - отменяем заявку
        if user_id in user_states:
            logger.info(f"⏰ Таймер истек для пользователя {user_id}, отменяю заявку")
            
            # Получаем данные перед очисткой состояния
            current_data = user_states.get(user_id, {}).get('data', data)
            is_photo_message = current_data.get('is_photo_message', False)
            
            # Очищаем состояние
            del user_states[user_id]
            clear_pending_deposit_state(user_id)
            
            # Удаляем таймер из активных
            if user_id in active_timers:
                del active_timers[user_id]
            
            # Отправляем сообщение об отмене
            try:
                cancel_text = "⏰ <b>Пополнение отменено, время оплаты прошло</b>\n\n❌ <b>Не переводите по старым реквизитам</b>\n\nНачните заново, нажав на <b>Пополнить</b>"
                
                # Удаляем сообщение с QR-кодом полностью, чтобы пользователи случайно не перевели деньги по старым реквизитам
                try:
                    await bot.delete_message(
                        chat_id=chat_id,
                        message_id=message_id
                    )
                    logger.info(f"✅ Сообщение с QR-кодом удалено для пользователя {user_id} после истечения таймера")
                except Exception as delete_error:
                    logger.warning(f"⚠️ Не удалось удалить сообщение с QR-кодом для пользователя {user_id}: {delete_error}")
                
                # Отправляем новое сообщение об отмене
                await bot.send_message(
                    chat_id=chat_id,
                    text=cancel_text,
                    parse_mode='HTML'
                )
                await send_main_menu(bot, chat_id, "")
            except Exception as e:
                logger.error(f"❌ Ошибка при отправке сообщения об отмене для пользователя {user_id}: {e}")
    except asyncio.CancelledError:
        logger.info(f"⏹️ Таймер отменен для пользователя {user_id}")
        # Удаляем таймер из активных
        if user_id in active_timers:
            del active_timers[user_id]
    except Exception as e:
        logger.error(f"❌ Ошибка в таймере для пользователя {user_id}: {e}", exc_info=True)
        # Не очищаем состояние, чтобы случайная ошибка не ломала ожидание чека
        if user_id in active_timers:
            del active_timers[user_id]
    finally:
        # Гарантируем, что таймер удален из активных
        if user_id in active_timers:
            del active_timers[user_id]

async def get_photo_base64(bot, file_id: str) -> str:
    """Получает фото из Telegram и конвертирует в base64"""
    try:
        logger.info(f"📷 Начинаю загрузку фото: file_id={file_id}")
        file = await bot.get_file(file_id)
        logger.info(f"📷 Файл получен: file_path={file.file_path}, file_size={file.file_size}")
        file_data = await file.download_as_bytearray()
        logger.info(f"📷 Файл загружен: размер={len(file_data)} байт")
        base64_data = base64.b64encode(file_data).decode('utf-8')
        logger.info(f"📷 Base64 сгенерирован: длина={len(base64_data)} символов")
        result = f"data:image/jpeg;base64,{base64_data}"
        logger.info(f"✅ Фото успешно конвертировано в base64, итоговая длина: {len(result)} символов")
        return result
    except Exception as e:
        logger.error(f"❌ Ошибка при получении фото: {e}", exc_info=True)
        raise

async def submit_withdraw_request(update: Update, context: ContextTypes.DEFAULT_TYPE, user_id: int, data: dict, withdraw_amount: float) -> None:
    """Отправляет заявку на вывод"""
    try:
        # Получаем фото QR кода в base64
        qr_photo_base64 = None
        if 'qr_photo_id' in data:
            qr_photo_base64 = await get_photo_base64(context.bot, data['qr_photo_id'])
        
        bookmaker = data['bookmaker']
        normalized_bookmaker = bookmaker.lower()
        
        # Для 1xbet сначала выполняем вывод через withdraw-execute (как в клиентском сайте)
        if '1xbet' in normalized_bookmaker:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    execute_response = await client.post(
                        f"{API_URL}/api/withdraw-execute",
                        json={
                            "bookmaker": bookmaker,
                            "playerId": data['player_id'],
                            "code": data['code'],
                            "amount": withdraw_amount
                        },
                        headers={"Content-Type": "application/json"}
                    )
                    
                    # Парсим JSON независимо от статуса (как в клиентском сайте)
                    try:
                        execute_result = execute_response.json()
                        logger.info(f"Ответ withdraw-execute (статус {execute_response.status_code}): {execute_result}")
                    except Exception as json_error:
                        logger.error(f"Ошибка парсинга JSON ответа withdraw-execute: {json_error}, статус: {execute_response.status_code}")
                        try:
                            response_text = execute_response.text[:200] if hasattr(execute_response, 'text') else str(execute_response.content[:200] if hasattr(execute_response, 'content') else 'N/A')
                            logger.error(f"Текст ответа: {response_text}")
                        except:
                            pass
                        await update.message.reply_text(get_text('withdraw_execute_failed'))
                        await start(update, context)
                        return
                    
                    if execute_response.status_code != 200:
                        error_msg = execute_result.get('error') or execute_result.get('message') or f"Ошибка выполнения вывода: {execute_response.status_code}"
                        logger.error(f"Ошибка withdraw-execute: статус {execute_response.status_code}, сообщение: {error_msg}, полный ответ: {execute_result}")
                        await update.message.reply_text(f"❌ {error_msg}")
                        await start(update, context)
                        return
                    
                    if not execute_result.get('success'):
                        error_msg = execute_result.get('message') or execute_result.get('error') or 'Ошибка выполнения вывода'
                        await update.message.reply_text(f"❌ {error_msg}")
                        await start(update, context)
                        return
            except Exception as e:
                logger.error(f"Ошибка выполнения вывода для 1xbet: {e}")
                await update.message.reply_text("❌ Ошибка выполнения вывода. Попробуйте еще раз.")
                await start(update, context)
                return
        
        # Создаем заявку (используем те же поля, что и в клиентском сайте)
        user = update.effective_user
        # Устанавливаем значение по умолчанию для банка, если не указан
        bank = data.get('bank') or 'odengi'
        request_body = {
            "type": "withdraw",  # Как в клиентском сайте
            "telegram_user_id": str(user_id),
            "userId": str(user_id),  # Добавляем userId как в клиентском сайте
            "amount": withdraw_amount,
            "bookmaker": bookmaker,
            "bank": bank,
            "phone": data['phone'],
            "account_id": data['player_id'],
            "playerId": data['player_id'],  # Добавляем playerId как в клиентском сайте
            "telegram_username": user.username,
            "telegram_first_name": user.first_name,
            "telegram_last_name": user.last_name,
            "qr_photo": qr_photo_base64,  # Используем qr_photo как в клиентском сайте
            "site_code": data['code'],  # Используем site_code как в клиентском сайте (основное поле)
            "source": "bot"
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            payment_response = await client.post(
                f"{API_URL}/api/payment",
                json=request_body,
                headers={"Content-Type": "application/json"}
            )
            
            # Парсим JSON независимо от статуса, чтобы получить детальное сообщение об ошибке
            try:
                result = payment_response.json()
                logger.info(f"Ответ API payment (статус {payment_response.status_code}): {result}")
            except Exception as json_error:
                logger.error(f"Ошибка парсинга JSON ответа payment: {json_error}, статус: {payment_response.status_code}")
                try:
                    response_text = payment_response.text[:200] if hasattr(payment_response, 'text') else str(payment_response.content[:200] if hasattr(payment_response, 'content') else 'N/A')
                    logger.error(f"Текст ответа: {response_text}")
                except:
                    pass
                await update.message.reply_text(get_text('request_creation_error'))
                await start(update, context)
                return
            
            if payment_response.status_code == 200:
                request_id = result.get('data', {}).get('id')
                
                # Проверяем success (как в клиентском сайте: result.success !== false)
                if result.get('success') is False:
                    error_message = result.get('error') or 'Неизвестная ошибка'
                    await update.message.reply_text(f'❌ {error_message}')
                    await start(update, context)
                    return
                
                if request_id:
                    # Используем переводы с динамическим названием казино
                    casino_name = get_casino_name(data.get('bookmaker', ''))
                    # Форматируем сумму
                    amount_str = f"{withdraw_amount:.2f}".rstrip('0').rstrip('.')
                    
                    # Используем перевод для сообщения об успешной заявке
                    success_message = get_text(
                        'withdrawal_request_sent',
                        account_id=data.get('player_id', ''),
                        phone=data.get('phone', ''),
                        casino_name=casino_name
                    )
                    
                    request_created_msg = await update.message.reply_text(success_message, parse_mode='HTML')
                    
                    # Сохраняем ID сообщения в заявке
                    if request_created_msg.message_id:
                        try:
                            async with httpx.AsyncClient(timeout=5.0) as client2:
                                await client2.patch(
                                    f"{API_URL}/api/requests/{request_id}",
                                    json={"telegram_message_id": request_created_msg.message_id}
                                )
                        except Exception as e:
                            logger.warning(f"Не удалось сохранить ID сообщения: {e}")
                else:
                    await update.message.reply_text(get_text('error_creating_withdraw'))
            else:
                # Статус не 200 - показываем детальное сообщение об ошибке из JSON (как в клиентском сайте)
                error_message = result.get('error') or result.get('message') or f'Ошибка создания заявки ({payment_response.status_code})'
                logger.error(f"Ошибка API payment: статус {payment_response.status_code}, сообщение: {error_message}, полный ответ: {result}")
                await update.message.reply_text(f'❌ {error_message}')
        
        # Показываем главное меню
        await start(update, context)
                
    except Exception as e:
        logger.error(f"Ошибка создания заявки на вывод: {e}")
        error_msg = str(e).lower()
        if 'connection' in error_msg or 'connect' in error_msg or 'refused' in error_msg:
            await update.message.reply_text(
                '❌ Сервер недоступен. Пожалуйста, убедитесь, что админ-панель запущена на порту 3001.\n\n'
                'Запустите админ-панель:\n'
                'cd admin_nextjs\n'
                'npm run dev'
            )
        else:
            await update.message.reply_text('❌ Ошибка создания заявки. Попробуйте еще раз.')
        
        # Показываем главное меню
        await start(update, context)

async def submit_deposit_request(query, context: ContextTypes.DEFAULT_TYPE, user_id: int, data: dict) -> None:
    """Отправляет заявку на пополнение"""
    try:
        await query.answer("⏳ Отправляю заявку...")
        
        user = query.from_user
        request_body = {
            "type": "deposit",
            "bookmaker": data['bookmaker'],
            "userId": str(user_id),
            "telegram_user_id": str(user_id),
            "amount": data['amount'],
            "bank": data['bank'],
            "account_id": data['player_id'],
            "playerId": data['player_id'],
            "telegram_username": user.username,
            "telegram_first_name": user.first_name,
            "telegram_last_name": user.last_name,
            "source": "bot"  # Указываем, что заявка создана через бота
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            payment_response = await client.post(
                f"{API_URL}/api/payment",
                json=request_body,
                headers={"Content-Type": "application/json"}
            )
            
            if payment_response.status_code == 200:
                result = payment_response.json()
                if result.get('success') != False:
                    # Получаем ссылку на оплату
                    payment_url = result.get('data', {}).get('payment_url') or result.get('payment_url')
                    
                    if payment_url:
                        keyboard = [
                            [InlineKeyboardButton("💳 Оплатить", url=payment_url)]
                        ]
                        reply_markup = InlineKeyboardMarkup(keyboard)
                        
                        # Используем переводы с динамическим названием казино
                        casino_name = get_casino_name(data.get('bookmaker', ''))
                        bank_name = BANK_NAMES.get(data.get('bank', '').lower(), data.get('bank', ''))
                        
                        deposit_title = get_text('deposit_title')
                        casino_label = get_text('casino_label', casino_name=casino_name)
                        bank_label = get_text('bank_label', bank_name=bank_name)
                        
                        await query.edit_message_text(
                            f"✅ <b>Заявка на пополнение создана!</b>\n\n"
                            f"💰 Сумма: {data['amount']} сом\n"
                            f"{casino_label}\n"
                            f"🆔 ID игрока: {data['player_id']}\n"
                            f"{bank_label}\n\n"
                            f"Нажмите кнопку ниже для оплаты:",
                            reply_markup=reply_markup,
                            parse_mode='HTML'
                        )
                    else:
                        # Используем переводы
                        deposit_title = get_text('deposit_title')
                        
                        await query.edit_message_text(
                            f"✅ <b>Заявка на пополнение создана!</b>\n\n"
                            f"💰 Сумма: {data['amount']} сом\n"
                            f"⏳ Ожидайте обработки заявки администратором.",
                            parse_mode='HTML'
                        )
                else:
                    error_msg = result.get('error') or 'Неизвестная ошибка'
                    await query.edit_message_text(f"❌ Ошибка создания заявки: {error_msg}")
            else:
                error_text = payment_response.text
                await query.edit_message_text(f"❌ Ошибка создания заявки: {error_text[:200]}")
                
    except Exception as e:
        logger.error(f"❌ Ошибка при отправке заявки на пополнение: {e}", exc_info=True)
        await query.edit_message_text(f"❌ Произошла ошибка: {str(e)[:200]}")

async def error_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Обработчик ошибок"""
    error = context.error
    
    # Игнорируем ошибки заблокированных пользователей (это нормально)
    if "Forbidden: bot was blocked by the user" in str(error):
        logger.debug(f"⚠️ Пользователь заблокировал бота (update_id: {update.update_id if update else 'None'})")
        return
    
    # Логируем остальные ошибки
    logger.error(f"❌ Ошибка в боте: {error}", exc_info=error)
    
    # Пытаемся отправить сообщение пользователю об ошибке (только если не заблокирован)
    try:
        if update and update.effective_chat:
            await context.bot.send_message(
                chat_id=update.effective_chat.id,
                text="❌ Произошла ошибка. Попробуйте позже или напишите /start"
            )
    except Exception as e:
        # Игнорируем ошибки при отправке сообщения об ошибке (чтобы не зациклиться)
        if "Forbidden: bot was blocked by the user" not in str(e):
            logger.error(f"❌ Не удалось отправить сообщение об ошибке: {e}")

def main() -> None:
    """Главная функция"""
    if not BOT_TOKEN or ":" not in BOT_TOKEN:
        raise ValueError("BOT_TOKEN не задан или имеет неверный формат")
    
    # Создаем приложение с post_init для загрузки настроек
    async def post_init(app: Application) -> None:
        """Загружает настройки после инициализации приложения"""
        logger.info("🔄 Загрузка настроек из админки...")
        try:
            await load_settings()
        except Exception as e:
            logger.warning(f"⚠️ Не удалось загрузить настройки при старте: {e}")
    
    application = Application.builder().token(BOT_TOKEN).post_init(post_init).build()
    
    # Добавляем обработчик команды /start
    application.add_handler(CommandHandler("start", start))
    
    # Добавляем обработчик команды /referral для просмотра реферальной статистики
    application.add_handler(CommandHandler("referral", referral_command))
    
    # Добавляем обработчик callback от inline кнопок
    application.add_handler(CallbackQueryHandler(handle_callback))
    
    # Добавляем обработчик всех сообщений (для сохранения в чат)
    # Важно: должен быть добавлен последним, чтобы не перехватывать команды
    from telegram.ext import MessageHandler, filters
    # Обработчик для всех сообщений кроме команд
    application.add_handler(MessageHandler(~filters.COMMAND, handle_message))
    
    # Добавляем обработчик ошибок
    application.add_error_handler(error_handler)
    
    # Запускаем бота
    print("🤖 Бот запущен!")
    logger.info("Bot started")
    application.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == '__main__':
    main()
