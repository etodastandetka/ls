#!/usr/bin/env python3
"""
Telegram бот-модератор для удаления сообщений с запрещенными словами в группах
"""

import logging
import os
import re
import asyncio
from datetime import datetime, timedelta
from aiogram import Bot, Dispatcher, Router, F
from aiogram.types import Message, ChatMemberUpdated, ChatPermissions
from aiogram.filters import ChatMemberUpdatedFilter, IS_MEMBER, IS_NOT_MEMBER, Command
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode, ChatType
from config import Config
from words_manager import add_word, remove_word, get_words, get_words_count

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


# FSM состояния для управления словами
class WordManagement(StatesGroup):
    waiting_for_add_word = State()
    waiting_for_remove_word = State()


def get_forbidden_words() -> list:
    """Получает актуальный список запрещенных слов"""
    try:
        from words_manager import get_words
        return get_words()
    except:
        return Config.FORBIDDEN_WORDS


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
    logger.debug(f"🔍 Проверяю текст на запрещенные слова: '{text_lower[:100]}'")
    
    # Получаем актуальный список слов
    forbidden_words = get_forbidden_words()
    
    # Проверяем каждое запрещенное слово
    for word in forbidden_words:
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
            # Для обычных слов проверяем вхождение (без границ слова для кириллицы)
            # Используем простой поиск подстроки, так как \b не всегда работает с кириллицей
            if word_lower in text_lower:
                logger.info(f"🚫 Найдено запрещенное слово: '{word}' в тексте: '{text[:50]}...'")
                return True
    
    logger.debug(f"✅ Запрещенных слов не найдено")
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


async def mute_user(message: Message, duration_seconds: int = 300):
    """
    Мутит пользователя на указанное время
    
    Args:
        message: Сообщение от пользователя
        duration_seconds: Длительность мута в секундах (по умолчанию 5 минут)
    """
    try:
        # Создаем ограничения (мут)
        permissions = ChatPermissions(
            can_send_messages=False,
            can_send_media_messages=False,
            can_send_polls=False,
            can_send_other_messages=False,
            can_add_web_page_previews=False,
            can_change_info=False,
            can_invite_users=False,
            can_pin_messages=False
        )
        
        # Вычисляем время окончания мута
        until_date = datetime.now() + timedelta(seconds=duration_seconds)
        
        # Применяем мут
        await bot.restrict_chat_member(
            chat_id=message.chat.id,
            user_id=message.from_user.id,
            permissions=permissions,
            until_date=until_date
        )
        
        logger.info(f"🔇 Пользователь {message.from_user.id} замьючен на {duration_seconds} секунд в чате {message.chat.id}")
        return True
    except Exception as e:
        error_str = str(e).lower()
        if "not enough rights" in error_str or "can't restrict" in error_str:
            logger.warning(f"⚠️ У бота нет прав на ограничение пользователей в чате {message.chat.id}")
        else:
            logger.error(f"❌ Ошибка при муте пользователя {message.from_user.id}: {e}")
        return False


async def unmute_user(chat_id: int, user_id: int) -> tuple[bool, str]:
    """
    Размучивает пользователя
    
    Args:
        chat_id: ID чата
        user_id: ID пользователя
        
    Returns:
        Tuple (успех, сообщение)
    """
    try:
        # Создаем полные права (размут)
        permissions = ChatPermissions(
            can_send_messages=True,
            can_send_media_messages=True,
            can_send_polls=True,
            can_send_other_messages=True,
            can_add_web_page_previews=True,
            can_change_info=False,
            can_invite_users=False,
            can_pin_messages=False
        )
        
        # Применяем размут (until_date=None означает снятие ограничений)
        await bot.restrict_chat_member(
            chat_id=chat_id,
            user_id=user_id,
            permissions=permissions,
            until_date=None
        )
        
        logger.info(f"🔊 Пользователь {user_id} размьючен в чате {chat_id}")
        return True, f"✅ Пользователь размьючен"
    except Exception as e:
        error_str = str(e).lower()
        if "not enough rights" in error_str or "can't restrict" in error_str:
            logger.warning(f"⚠️ У бота нет прав на ограничение пользователей в чате {chat_id}")
            return False, "❌ У бота нет прав на размут пользователей"
        elif "user not found" in error_str or "chat not found" in error_str:
            return False, "❌ Пользователь не найден"
        else:
            logger.error(f"❌ Ошибка при размуте пользователя {user_id}: {e}")
            return False, f"❌ Ошибка: {str(e)}"


@router.message(Command("test"), F.chat.type.in_([ChatType.GROUP, ChatType.SUPERGROUP]))
async def test_command(message: Message):
    """Команда /test для проверки работы бота в группе"""
    words = get_forbidden_words()
    words_list = "\n".join([f"• {word}" for word in words[:10]])  # Показываем первые 10
    await message.answer(
        f"✅ Бот работает!\n\n"
        f"📋 Запрещенных слов: {len(words)}\n"
        f"Примеры: {words_list}"
    )


@router.message(Command("unmute"), F.chat.type.in_([ChatType.GROUP, ChatType.SUPERGROUP]))
async def unmute_command(message: Message):
    """Команда /unmute для размута пользователя"""
    # Проверяем права администратора
    if not is_admin(message.from_user.id):
        await message.answer("❌ У вас нет прав для выполнения этой команды")
        return
    
    target_user_id = None
    target_username = None
    
    # Проверяем реплай на сообщение
    if message.reply_to_message:
        target_user_id = message.reply_to_message.from_user.id
        target_username = message.reply_to_message.from_user.username or message.reply_to_message.from_user.first_name
        logger.info(f"🔊 Размут по реплаю: пользователь {target_user_id} (@{target_username})")
    else:
        # Пытаемся извлечь username или ID из текста команды
        command_text = message.text or ""
        parts = command_text.split()
        
        if len(parts) > 1:
            # Пытаемся найти username или ID
            target = parts[1].strip()
            
            # Если это username (начинается с @)
            if target.startswith("@"):
                username = target.lstrip("@")
                try:
                    # Пытаемся найти пользователя через entities (упоминания в сообщении)
                    if message.entities:
                        for entity in message.entities:
                            if entity.type == "text_mention" and entity.user:
                                target_user_id = entity.user.id
                                target_username = entity.user.username or entity.user.first_name
                                logger.info(f"🔊 Размут по упоминанию: пользователь {target_user_id} (@{target_username})")
                                break
                    
                    # Если не нашли через entities, ищем через упоминания (mentions)
                    if not target_user_id and message.entities:
                        text = message.text or ""
                        for entity in message.entities:
                            if entity.type == "mention":
                                mention_text = text[entity.offset:entity.offset + entity.length]
                                if mention_text.lower() == target.lower():
                                    # К сожалению, через mention мы не можем получить user_id напрямую
                                    # Нужно использовать другой подход
                                    pass
                    
                    # Если не нашли через entities, просим использовать реплай
                    if not target_user_id:
                        await message.answer(
                            f"❌ Не удалось найти пользователя @{username}.\n\n"
                            "💡 <b>Используйте один из способов:</b>\n"
                            "• Реплай на сообщение пользователя: /unmute\n"
                            "• Упоминание пользователя в команде: /unmute @username (если он есть в группе)",
                            parse_mode=ParseMode.HTML
                        )
                        return
                except Exception as e:
                    logger.error(f"❌ Ошибка при поиске пользователя по username: {e}")
                    await message.answer("❌ Ошибка при поиске пользователя")
                    return
            else:
                # Пытаемся распарсить как ID
                try:
                    target_user_id = int(target)
                    logger.info(f"🔊 Размут по ID: пользователь {target_user_id}")
                except ValueError:
                    await message.answer(
                        "❌ Неверный формат. Используйте:\n"
                        "• Реплай на сообщение: /unmute\n"
                        "• Или username: /unmute @username"
                    )
                    return
        else:
            await message.answer(
                "❌ Укажите пользователя для размута:\n\n"
                "💡 <b>Способы использования:</b>\n"
                "• Реплай на сообщение: /unmute\n"
                "• Username: /unmute @username\n"
                "• ID пользователя: /unmute 123456789",
                parse_mode=ParseMode.HTML
            )
            return
    
    if not target_user_id:
        await message.answer("❌ Не удалось определить пользователя для размута")
        return
    
    # Выполняем размут
    success, result_message = await unmute_user(message.chat.id, target_user_id)
    
    if success:
        user_info = f"@{target_username}" if target_username else f"ID: {target_user_id}"
        await message.answer(f"✅ Пользователь {user_info} размьючен")
    else:
        await message.answer(result_message)


@router.message(F.chat.type.in_([ChatType.GROUP, ChatType.SUPERGROUP]))
async def moderate_message(message: Message):
    """
    Обработчик сообщений в группах для модерации
    
    Args:
        message: Входящее сообщение
    """
    # Логируем каждое сообщение для отладки
    text = message.text or message.caption or ""
    logger.info(f"📨 Получено сообщение в группе {message.chat.id} от {message.from_user.id}: '{text[:100]}'")
    
    # Пропускаем сообщения от администраторов (если включено в конфиге)
    if Config.SKIP_ADMINS:
        try:
            member = await bot.get_chat_member(message.chat.id, message.from_user.id)
            if member.status in ['administrator', 'creator']:
                logger.info(f"⏭️ Пропущено сообщение от администратора {message.from_user.id} (статус: {member.status})")
                return
        except Exception as e:
            logger.warning(f"⚠️ Ошибка при проверке статуса пользователя: {e}")
    
    # Получаем текст сообщения
    if not text:
        logger.debug(f"⚠️ Сообщение без текста, пропускаем")
        return
    
    # Проверяем упоминания пользователей (entities)
    if message.entities or message.caption_entities:
        entities = message.entities or message.caption_entities
        for entity in entities:
            if entity.type == "mention":
                # Извлекаем username из упоминания
                mention_text = text[entity.offset:entity.offset + entity.length]
                # Убираем @ для проверки
                username = mention_text.lstrip("@").lower()
                # Получаем актуальный список слов
                forbidden_words = get_forbidden_words()
                # Проверяем, есть ли этот username в запрещенных словах
                for forbidden_word in forbidden_words:
                    forbidden_username = forbidden_word.lstrip("@").lower()
                    if username == forbidden_username:
                        logger.info(f"🚫 Найдено запрещенное упоминание: '{mention_text}'")
                        await delete_message(message)
                        # Мутим пользователя на 5 минут
                        mute_success = await mute_user(message, Config.MUTE_DURATION_SECONDS)
                        
                        if Config.SEND_WARNING:
                            try:
                                mute_text = " и замьючен на 5 минут" if mute_success else ""
                                warning_text = f"⚠️ {message.from_user.first_name or 'Пользователь'}, ваше сообщение было удалено{mute_text} из-за нарушения правил группы."
                                warning_msg = await bot.send_message(
                                    chat_id=message.chat.id,
                                    text=warning_text
                                )
                                if Config.WARNING_DELETE_SECONDS > 0:
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
    logger.debug(f"🔍 Начинаю проверку текста на запрещенные слова...")
    if contains_forbidden_words(text):
        logger.info(f"🚫 Обнаружено запрещенное слово! Удаляю сообщение {message.message_id}")
        # Удаляем сообщение
        await delete_message(message)
        
        # Мутим пользователя на 5 минут
        mute_success = await mute_user(message, Config.MUTE_DURATION_SECONDS)
        
        # Отправляем предупреждение (если включено в конфиге)
        if Config.SEND_WARNING:
            try:
                mute_text = " и замьючен на 5 минут" if mute_success else ""
                warning_text = f"⚠️ {message.from_user.first_name or 'Пользователь'}, ваше сообщение было удалено{mute_text} из-за нарушения правил группы."
                warning_msg = await bot.send_message(
                    chat_id=message.chat.id,
                    text=warning_text
                )
                
                # Удаляем предупреждение через указанное время
                if Config.WARNING_DELETE_SECONDS > 0:
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


def is_admin(user_id: int) -> bool:
    """Проверяет, является ли пользователь администратором"""
    return user_id == Config.ADMIN_ID


@router.message(Command("start"), F.chat.type == ChatType.PRIVATE)
async def start_command(message: Message):
    """Команда /start"""
    await message.answer(
        "👋 Привет! Я бот-модератор для групп.\n\n"
        "Добавьте меня в группу и предоставьте права администратора с возможностью удаления сообщений.\n\n"
        "Я буду автоматически удалять сообщения, содержащие запрещенные слова и мутить нарушителей на 5 минут."
    )


@router.message(Command("help"), F.chat.type == ChatType.PRIVATE)
async def help_command(message: Message):
    """Команда /help"""
    help_text = (
        "📖 <b>Справка по боту-модератору</b>\n\n"
        "1. Добавьте бота в группу\n"
        "2. Предоставьте боту права администратора\n"
        "3. Включите право на удаление сообщений и ограничение пользователей\n"
        "4. Бот будет автоматически удалять сообщения с запрещенными словами\n"
        "5. Нарушители будут замьючены на 5 минут\n\n"
    )
    
    if is_admin(message.from_user.id):
        help_text += (
            "<b>Команды администратора:</b>\n"
            "/words - список запрещенных слов\n"
            "/add_word - добавить слово\n"
            "/remove_word - удалить слово\n"
        )
    
    await message.answer(help_text, parse_mode=ParseMode.HTML)


@router.message(Command("test"), F.chat.type == ChatType.PRIVATE)
async def test_command_private(message: Message):
    """Команда /test - показывает список запрещенных слов"""
    words = get_words()
    if words:
        words_list = "\n".join([f"• {word}" for word in words])
        await message.answer(
            f"📋 <b>Список запрещенных слов:</b>\n\n{words_list}\n\n"
            f"Всего: {len(words)} слов"
        )
    else:
        await message.answer("📋 Список запрещенных слов пуст")


@router.message(Command("check"), F.chat.type == ChatType.PRIVATE)
async def check_command(message: Message):
    """Команда /check - проверка конфигурации"""
    token_status = "✅ Установлен" if Config.BOT_TOKEN and ":" in Config.BOT_TOKEN else "❌ Не установлен"
    words_count = get_words_count()
    await message.answer(
        f"⚙️ <b>Статус конфигурации:</b>\n\n"
        f"Токен: {token_status}\n"
        f"Запрещенных слов: {words_count}\n"
        f"Пропускать админов: {'Да' if Config.SKIP_ADMINS else 'Нет'}\n"
        f"Отправлять предупреждения: {'Да' if Config.SEND_WARNING else 'Нет'}\n"
        f"Длительность мута: {Config.MUTE_DURATION_SECONDS // 60} минут"
    )


@router.message(Command("words"), F.chat.type == ChatType.PRIVATE)
async def words_command(message: Message):
    """Команда /words - показывает список запрещенных слов"""
    if not is_admin(message.from_user.id):
        await message.answer("❌ У вас нет прав для выполнения этой команды")
        return
    
    words = get_words()
    if words:
        words_list = "\n".join([f"• {word}" for word in words])
        await message.answer(
            f"📋 <b>Список запрещенных слов:</b>\n\n{words_list}\n\n"
            f"Всего: {len(words)} слов"
        )
    else:
        await message.answer("📋 Список запрещенных слов пуст")


@router.message(Command("add_word"), F.chat.type == ChatType.PRIVATE)
async def add_word_command(message: Message, state: FSMContext):
    """Команда /add_word - добавление слова"""
    if not is_admin(message.from_user.id):
        await message.answer("❌ У вас нет прав для выполнения этой команды")
        return
    
    await state.set_state(WordManagement.waiting_for_add_word)
    await message.answer(
        "➕ <b>Добавление запрещенного слова</b>\n\n"
        "Отправьте слово, которое нужно добавить в список запрещенных.\n"
        "Для отмены отправьте /cancel",
        parse_mode=ParseMode.HTML
    )


@router.message(Command("remove_word"), F.chat.type == ChatType.PRIVATE)
async def remove_word_command(message: Message, state: FSMContext):
    """Команда /remove_word - удаление слова"""
    if not is_admin(message.from_user.id):
        await message.answer("❌ У вас нет прав для выполнения этой команды")
        return
    
    await state.set_state(WordManagement.waiting_for_remove_word)
    await message.answer(
        "➖ <b>Удаление запрещенного слова</b>\n\n"
        "Отправьте слово, которое нужно удалить из списка запрещенных.\n"
        "Для отмены отправьте /cancel",
        parse_mode=ParseMode.HTML
    )


@router.message(Command("cancel"), F.chat.type == ChatType.PRIVATE)
async def cancel_command(message: Message, state: FSMContext):
    """Команда /cancel - отмена операции"""
    await state.clear()
    await message.answer("❌ Операция отменена")


@router.message(WordManagement.waiting_for_add_word, F.chat.type == ChatType.PRIVATE)
async def process_add_word(message: Message, state: FSMContext):
    """Обработка добавления слова"""
    word = message.text.strip()
    success, result_message = add_word(word)
    await message.answer(result_message)
    await state.clear()


@router.message(WordManagement.waiting_for_remove_word, F.chat.type == ChatType.PRIVATE)
async def process_remove_word(message: Message, state: FSMContext):
    """Обработка удаления слова"""
    word = message.text.strip()
    success, result_message = remove_word(word)
    await message.answer(result_message)
    await state.clear()


@router.message(F.chat.type == ChatType.PRIVATE)
async def handle_private_message(message: Message):
    """Обработчик остальных приватных сообщений"""
    if message.text and not message.text.startswith('/'):
        await message.answer(
            "Я работаю только в группах. Добавьте меня в группу для начала модерации.\n\n"
            "Используйте /help для списка команд."
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
    
    # Загружаем слова из файла
    words = get_forbidden_words()
    logger.info(f"📋 Запрещенных слов в списке: {len(words)}")
    if words:
        logger.info(f"📝 Примеры запрещенных слов: {', '.join(words[:5])}...")
    logger.info(f"⚙️ Пропускать админов: {Config.SKIP_ADMINS}")
    logger.info(f"⚙️ Отправлять предупреждения: {Config.SEND_WARNING}")
    logger.info(f"⚙️ Длительность мута: {Config.MUTE_DURATION_SECONDS // 60} минут")
    logger.info(f"👤 ID администратора: {Config.ADMIN_ID}")
    
    # Проверяем информацию о боте
    try:
        bot_info = await bot.get_me()
        logger.info(f"✅ Бот запущен: @{bot_info.username} (ID: {bot_info.id})")
    except Exception as e:
        logger.error(f"❌ Ошибка при получении информации о боте: {e}")
    
    # Запускаем бота
    logger.info("🔄 Начинаю polling...")
    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())


if __name__ == '__main__':
    import asyncio
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("🛑 Бот остановлен пользователем")
    except Exception as e:
        logger.error(f"❌ Критическая ошибка: {e}", exc_info=True)

