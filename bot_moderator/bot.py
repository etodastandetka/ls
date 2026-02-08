#!/usr/bin/env python3
"""
Telegram бот-модератор для удаления сообщений с запрещенными словами в группах
"""

import logging
import os
import re
from aiogram import Bot, Dispatcher, Router, F
from aiogram.types import Message, ChatMemberUpdated
from aiogram.filters import ChatMemberUpdatedFilter, IS_MEMBER, IS_NOT_MEMBER
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode, ChatType
from config import Config

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Инициализация бота и диспетчера
bot = Bot(
    token=Config.BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)
router = Router()


def contains_forbidden_words(text: str) -> bool:
    """
    Проверяет, содержит ли текст запрещенные слова
    
    Args:
        text: Текст для проверки
        
    Returns:
        True если содержит запрещенные слова, False иначе
    """
    if not text:
        return False
    
    text_lower = text.lower()
    
    # Проверяем каждое запрещенное слово
    for word in Config.FORBIDDEN_WORDS:
        word_lower = word.lower()
        
        # Если слово начинается с @, ищем его как упоминание
        if word_lower.startswith("@"):
            # Ищем @username в тексте
            username = word_lower.lstrip("@")
            # Проверяем упоминание с @ или без
            if f"@{username}" in text_lower or username in text_lower:
                logger.info(f"🚫 Найдено запрещенное упоминание: '{word}' в тексте: '{text[:50]}...'")
                return True
        else:
            # Для обычных слов используем регулярное выражение
            # \b означает границу слова
            pattern = r'\b' + re.escape(word_lower) + r'\b'
            if re.search(pattern, text_lower, re.IGNORECASE):
                logger.info(f"🚫 Найдено запрещенное слово: '{word}' в тексте: '{text[:50]}...'")
                return True
    
    return False


async def delete_message(message: Message):
    """
    Удаляет сообщение из группы
    
    Args:
        message: Сообщение для удаления
    """
    try:
        await bot.delete_message(
            chat_id=message.chat.id,
            message_id=message.message_id
        )
        logger.info(f"✅ Сообщение {message.message_id} удалено из чата {message.chat.id}")
    except Exception as e:
        error_str = str(e).lower()
        if "message to delete not found" in error_str:
            logger.debug(f"⚠️ Сообщение {message.message_id} уже удалено")
        elif "not enough rights" in error_str or "can't delete message" in error_str:
            logger.warning(f"⚠️ У бота нет прав на удаление сообщений в чате {message.chat.id}")
        else:
            logger.error(f"❌ Ошибка при удалении сообщения {message.message_id}: {e}")


@router.message(F.chat.type.in_([ChatType.GROUP, ChatType.SUPERGROUP]))
async def moderate_message(message: Message):
    """
    Обработчик сообщений в группах для модерации
    
    Args:
        message: Входящее сообщение
    """
    # Пропускаем сообщения от администраторов (если включено в конфиге)
    if Config.SKIP_ADMINS:
        try:
            member = await bot.get_chat_member(message.chat.id, message.from_user.id)
            if member.status in ['administrator', 'creator']:
                logger.debug(f"⏭️ Пропущено сообщение от администратора {message.from_user.id}")
                return
        except Exception as e:
            logger.warning(f"⚠️ Ошибка при проверке статуса пользователя: {e}")
    
    # Получаем текст сообщения
    text = message.text or message.caption or ""
    
    # Проверяем упоминания пользователей (entities)
    if message.entities or message.caption_entities:
        entities = message.entities or message.caption_entities
        for entity in entities:
            if entity.type == "mention":
                # Извлекаем username из упоминания
                mention_text = text[entity.offset:entity.offset + entity.length]
                # Убираем @ для проверки
                username = mention_text.lstrip("@").lower()
                # Проверяем, есть ли этот username в запрещенных словах
                for forbidden_word in Config.FORBIDDEN_WORDS:
                    forbidden_username = forbidden_word.lstrip("@").lower()
                    if username == forbidden_username:
                        logger.info(f"🚫 Найдено запрещенное упоминание: '{mention_text}'")
                        await delete_message(message)
                        if Config.SEND_WARNING:
                            try:
                                warning_text = Config.WARNING_MESSAGE.format(
                                    user=message.from_user.first_name or "Пользователь"
                                )
                                warning_msg = await bot.send_message(
                                    chat_id=message.chat.id,
                                    text=warning_text
                                )
                                if Config.WARNING_DELETE_SECONDS > 0:
                                    import asyncio
                                    await asyncio.sleep(Config.WARNING_DELETE_SECONDS)
                                    try:
                                        await bot.delete_message(
                                            chat_id=message.chat.id,
                                            message_id=warning_msg.message_id
                                        )
                                    except:
                                        pass
                            except Exception as e:
                                logger.error(f"❌ Ошибка при отправке предупреждения: {e}")
                        return
    
    # Проверяем на наличие запрещенных слов в тексте
    if contains_forbidden_words(text):
        # Удаляем сообщение
        await delete_message(message)
        
        # Отправляем предупреждение (если включено в конфиге)
        if Config.SEND_WARNING:
            try:
                warning_text = Config.WARNING_MESSAGE.format(
                    user=message.from_user.first_name or "Пользователь"
                )
                warning_msg = await bot.send_message(
                    chat_id=message.chat.id,
                    text=warning_text
                )
                
                # Удаляем предупреждение через указанное время
                if Config.WARNING_DELETE_SECONDS > 0:
                    import asyncio
                    await asyncio.sleep(Config.WARNING_DELETE_SECONDS)
                    try:
                        await bot.delete_message(
                            chat_id=message.chat.id,
                            message_id=warning_msg.message_id
                        )
                    except:
                        pass
            except Exception as e:
                logger.error(f"❌ Ошибка при отправке предупреждения: {e}")


@router.my_chat_member(ChatMemberUpdatedFilter(IS_NOT_MEMBER >> IS_MEMBER))
async def bot_added_to_group(event: ChatMemberUpdated):
    """
    Обработчик добавления бота в группу
    """
    chat = event.chat
    logger.info(f"✅ Бот добавлен в группу: {chat.title} (ID: {chat.id})")
    
    # Проверяем права бота
    try:
        bot_member = await bot.get_chat_member(chat.id, bot.id)
        if bot_member.status != 'administrator':
            logger.warning(f"⚠️ Бот не является администратором в группе {chat.title}")
            try:
                await bot.send_message(
                    chat_id=chat.id,
                    text="⚠️ Для работы бота-модератора необходимо предоставить ему права администратора с возможностью удаления сообщений."
                )
            except:
                pass
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке прав бота: {e}")


@router.message(F.chat.type == ChatType.PRIVATE)
async def handle_private_message(message: Message):
    """
    Обработчик приватных сообщений
    """
    if message.text and message.text.startswith('/'):
        if message.text == '/start':
            await message.answer(
                "👋 Привет! Я бот-модератор для групп.\n\n"
                "Добавьте меня в группу и предоставьте права администратора с возможностью удаления сообщений.\n\n"
                "Я буду автоматически удалять сообщения, содержащие запрещенные слова."
            )
        elif message.text == '/help':
            await message.answer(
                "📖 <b>Справка по боту-модератору</b>\n\n"
                "1. Добавьте бота в группу\n"
                "2. Предоставьте боту права администратора\n"
                "3. Включите право на удаление сообщений\n"
                "4. Бот будет автоматически удалять сообщения с запрещенными словами\n\n"
                "Запрещенные слова настраиваются в файле config.py"
            )
    else:
        await message.answer(
            "Я работаю только в группах. Добавьте меня в группу для начала модерации."
        )


# Регистрируем роутер
dp.include_router(router)


@dp.errors()
async def error_handler(update, exception):
    """Обработчик ошибок"""
    error_str = str(exception)
    
    # Игнорируем ошибки заблокированных пользователей
    if "bot was blocked by the user" in error_str.lower():
        logger.debug(f"⚠️ Пользователь заблокировал бота")
        return
    
    logger.error(f"❌ Ошибка в боте: {exception}", exc_info=exception)


async def main():
    """Главная функция"""
    if not Config.BOT_TOKEN or ":" not in Config.BOT_TOKEN:
        raise ValueError("BOT_TOKEN не задан или имеет неверный формат")
    
    logger.info("🤖 Бот-модератор запускается...")
    logger.info(f"📋 Запрещенных слов в списке: {len(Config.FORBIDDEN_WORDS)}")
    
    # Запускаем бота
    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())


if __name__ == '__main__':
    import asyncio
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("🛑 Бот остановлен пользователем")
    except Exception as e:
        logger.error(f"❌ Критическая ошибка: {e}", exc_info=True)

