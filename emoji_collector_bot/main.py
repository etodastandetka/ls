"""
Бот для сбора премиум эмодзи
Отправляйте премиум эмодзи боту, он сохранит их и выдаст конфиг
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from aiogram import Bot, Dispatcher, Router, F
from aiogram.types import Message, MessageEntity, InlineKeyboardMarkup, InlineKeyboardButton, InputFile
from aiogram.enums import MessageEntityType
from aiogram.filters import Command

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Токен бота (установите в .env или здесь)
# Пробуем загрузить из .env файла
env_file = Path(__file__).parent / ".env"
if env_file.exists():
    try:
        for line in env_file.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ[key.strip()] = value.strip().strip('"').strip("'")
    except Exception as e:
        logger.warning(f"Не удалось загрузить .env: {e}")

BOT_TOKEN = os.getenv("BOT_TOKEN") or "8502647763:AAEaHMQpwzeFbUN4Hq1ZCq42CagkPFMgADo"

# Файл для хранения эмодзи
EMOJI_STORAGE_FILE = Path(__file__).parent / "premium_emojis.json"

# Загружаем сохраненные эмодзи
def load_emojis() -> dict:
    """Загружает сохраненные эмодзи из файла"""
    if EMOJI_STORAGE_FILE.exists():
        try:
            with open(EMOJI_STORAGE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Ошибка загрузки эмодзи: {e}")
    return {}

# Сохраняем эмодзи
def save_emojis(emojis: dict):
    """Сохраняет эмодзи в файл"""
    try:
        with open(EMOJI_STORAGE_FILE, 'w', encoding='utf-8') as f:
            json.dump(emojis, f, ensure_ascii=False, indent=2)
        logger.info(f"Сохранено {len(emojis)} эмодзи")
    except Exception as e:
        logger.error(f"Ошибка сохранения эмодзи: {e}")

# Инициализация
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()
router = Router()

# Загружаем сохраненные эмодзи
saved_emojis = load_emojis()
logger.info(f"Загружено {len(saved_emojis)} сохраненных эмодзи")

@router.message(Command("start"))
async def cmd_start(message: Message):
    """Обработчик команды /start"""
    text = (
        "👋 <b>Бот для сбора премиум эмодзи</b>\n\n"
        "📝 <b>Как использовать:</b>\n"
        "1. Отправьте мне сообщение с премиум эмодзи\n"
        "2. Бот автоматически сохранит их\n"
        "3. Нажмите кнопку 'Конфиг' для получения конфига\n\n"
        "💡 <b>Сохранено эмодзи:</b> {count}"
    ).format(count=len(saved_emojis))
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📋 Конфиг", callback_data="get_config")],
        [InlineKeyboardButton(text="🗑️ Очистить все", callback_data="clear_all")],
        [InlineKeyboardButton(text="📊 Список эмодзи", callback_data="list_emojis")]
    ])
    
    await message.answer(text, reply_markup=keyboard, parse_mode="HTML")

@router.message(Command("config"))
async def cmd_config(message: Message):
    """Обработчик команды /config"""
    await send_config(message)

@router.message(Command("clear"))
async def cmd_clear(message: Message):
    """Обработчик команды /clear"""
    global saved_emojis
    saved_emojis = {}
    save_emojis(saved_emojis)
    await message.answer("✅ Все эмодзи удалены!")

@router.message(Command("list"))
async def cmd_list(message: Message):
    """Обработчик команды /list"""
    await send_emoji_list(message)

@router.callback_query(F.data == "get_config")
async def callback_get_config(callback_query):
    """Обработчик кнопки 'Конфиг'"""
    await callback_query.answer()
    await send_config(callback_query.message)

@router.callback_query(F.data == "clear_all")
async def callback_clear_all(callback_query):
    """Обработчик кнопки 'Очистить все'"""
    global saved_emojis
    saved_emojis = {}
    save_emojis(saved_emojis)
    await callback_query.answer("✅ Все эмодзи удалены!")
    await callback_query.message.edit_text(
        "✅ Все эмодзи удалены!\n\nИспользуйте /start для начала работы."
    )

@router.callback_query(F.data == "list_emojis")
async def callback_list_emojis(callback_query):
    """Обработчик кнопки 'Список эмодзи'"""
    await callback_query.answer()
    await send_emoji_list(callback_query.message)

async def send_config(message: Message):
    """Отправляет конфиг файл"""
    if not saved_emojis:
        await message.answer("❌ Нет сохраненных эмодзи. Отправьте премиум эмодзи боту.")
        return
    
    # Формируем конфиг в формате Python
    config_text = "# Премиум эмодзи конфиг\n"
    config_text += "# Скопируйте это в bot_new/config.py в PREMIUM_EMOJI_MAP\n\n"
    config_text += "PREMIUM_EMOJI_MAP = {\n"
    
    for emoji_char, emoji_id in saved_emojis.items():
        # Экранируем кавычки в эмодзи
        emoji_escaped = emoji_char.replace('"', '\\"').replace("'", "\\'")
        config_text += f'    "{emoji_escaped}": "{emoji_id}",\n'
    
    config_text += "}\n"
    
    # Отправляем как файл
    from io import BytesIO
    config_bytes = config_text.encode('utf-8')
    config_file = BytesIO(config_bytes)
    config_file.name = "premium_emoji_config.py"
    
    await message.answer_document(
        document=config_file,
        caption=f"📋 <b>Конфиг файл</b>\n\nСохранено эмодзи: {len(saved_emojis)}\n\nСкопируйте содержимое в <code>bot_new/config.py</code> в <code>PREMIUM_EMOJI_MAP</code>",
        parse_mode="HTML"
    )
    
    # Также отправляем текстом для удобства
    if len(config_text) < 4096:  # Лимит Telegram
        await message.answer(f"<pre>{config_text}</pre>", parse_mode="HTML")
    else:
        await message.answer("⚠️ Конфиг слишком большой, отправлен только файл")

async def send_emoji_list(message: Message):
    """Отправляет список сохраненных эмодзи"""
    if not saved_emojis:
        await message.answer("❌ Нет сохраненных эмодзи.")
        return
    
    text = f"📊 <b>Сохранено эмодзи: {len(saved_emojis)}</b>\n\n"
    
    for i, (emoji_char, emoji_id) in enumerate(saved_emojis.items(), 1):
        text += f"{i}. {emoji_char} → <code>{emoji_id}</code>\n"
        if len(text) > 3500:  # Ограничение длины сообщения
            text += f"\n... и еще {len(saved_emojis) - i} эмодзи"
            break
    
    await message.answer(text, parse_mode="HTML")

@router.message()
async def handle_message(message: Message):
    """Обработчик всех сообщений - ищет премиум эмодзи"""
    if not message.entities:
        return
    
    found_emojis = []
    
    # Ищем премиум эмодзи в сообщении
    for entity in message.entities:
        if entity.type == MessageEntityType.CUSTOM_EMOJI:
            emoji_id = entity.custom_emoji_id
            # Получаем символ эмодзи из текста
            emoji_char = message.text[entity.offset:entity.offset + entity.length] if message.text else "?"
            
            # Сохраняем эмодзи
            if emoji_char not in saved_emojis or saved_emojis[emoji_char] != emoji_id:
                saved_emojis[emoji_char] = emoji_id
                found_emojis.append((emoji_char, emoji_id))
                logger.info(f"Сохранен эмодзи: {emoji_char} → {emoji_id}")
    
    # Сохраняем в файл если нашли новые
    if found_emojis:
        save_emojis(saved_emojis)
        
        text = f"✅ <b>Сохранено {len(found_emojis)} эмодзи:</b>\n\n"
        for emoji_char, emoji_id in found_emojis:
            text += f"{emoji_char} → <code>{emoji_id}</code>\n"
        
        text += f"\n📊 Всего сохранено: {len(saved_emojis)}"
        
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="📋 Получить конфиг", callback_data="get_config")]
        ])
        
        await message.answer(text, reply_markup=keyboard, parse_mode="HTML")
    else:
        # Если эмодзи не найдены, показываем подсказку
        if message.text and message.text.startswith("/"):
            return  # Игнорируем команды
        
        await message.answer(
            "ℹ️ Премиум эмодзи не найдены в сообщении.\n\n"
            "Отправьте сообщение с премиум эмодзи, и я сохраню их автоматически."
        )

async def main():
    """Запуск бота"""
    dp.include_router(router)
    
    logger.info("Бот запущен!")
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Бот остановлен")

