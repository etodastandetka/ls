#!/usr/bin/env python3
"""
Telegram бот для LUXON на aiogram 3
"""

import logging
import asyncio
import os
from pathlib import Path
from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from config import Config
from security import check_rate_limit, get_user_id

# Настройка логирования
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

# Отключаем спам от httpx
logging.getLogger("httpx").setLevel(logging.WARNING)

# Инициализация бота и диспетчера
bot = Bot(
    token=Config.BOT_TOKEN,
    default=DefaultBotProperties(parse_mode=ParseMode.HTML)
)
storage = MemoryStorage()
dp = Dispatcher(storage=storage)

# Импортируем обработчики (после создания dp)
async def setup_handlers():
    from handlers import start, deposit, withdraw, callback, messages, referral
    
    # Регистрируем обработчики в правильном порядке
    # Сначала start (команды должны обрабатываться первыми)
    dp.include_router(start.router)
    # Затем referral
    dp.include_router(referral.router)
    # Затем deposit и withdraw (FSM состояния)
    dp.include_router(deposit.router)
    dp.include_router(withdraw.router)
    # Затем callback
    dp.include_router(callback.router)
    # И messages в конце (обработка всех остальных сообщений)
    dp.include_router(messages.router)
    
    # Middleware для rate limiting
    from aiogram import BaseMiddleware
    from typing import Callable, Dict, Any, Awaitable
    
    class RateLimitMiddleware(BaseMiddleware):
        async def __call__(
            self,
            handler: Callable[[Any, Dict[str, Any]], Awaitable[Any]],
            event: Any,
            data: Dict[str, Any]
        ) -> Any:
            user_id = get_user_id(event)
            if user_id:
                is_allowed, error_message = check_rate_limit(user_id)
                if not is_allowed:
                    logger.warning(f"🚫 Rate limit для пользователя {user_id}: {error_message}")
                    try:
                        if hasattr(event, 'message') and event.message:
                            await event.message.answer(f"⚠️ {error_message}\n\nПожалуйста, подождите перед повторной попыткой.")
                        elif hasattr(event, 'callback_query') and event.callback_query:
                            await event.callback_query.answer(error_message, show_alert=True)
                    except Exception as e:
                        logger.error(f"❌ Ошибка при отправке сообщения о rate limit: {e}")
                    return
            return await handler(event, data)
    
    dp.message.middleware(RateLimitMiddleware())
    dp.callback_query.middleware(RateLimitMiddleware())

# Middleware для rate limiting будет добавлен после setup_handlers

# Обработчик ошибок
@dp.errors()
async def error_handler(event, exception):
    """Обработчик ошибок"""
    error_str = str(exception)
    
    # Игнорируем ошибки заблокированных пользователей
    if "bot was blocked by the user" in error_str.lower():
        logger.debug(f"⚠️ Пользователь заблокировал бота")
        return
    
    logger.error(f"❌ Ошибка в боте: {exception}", exc_info=exception)
    
    # Пытаемся отправить сообщение пользователю об ошибке
    try:
        if hasattr(event, 'event') and hasattr(event.event, 'chat'):
            await event.event.answer("❌ Произошла ошибка. Попробуйте позже или напишите /start")
    except Exception as e:
        if "bot was blocked by the user" not in str(e).lower():
            logger.error(f"❌ Не удалось отправить сообщение об ошибке: {e}")

async def main():
    """Главная функция"""
    if not Config.BOT_TOKEN or ":" not in Config.BOT_TOKEN:
        raise ValueError("BOT_TOKEN не задан или имеет неверный формат")
    
    logger.info("🤖 Бот запускается...")
    
    # Настраиваем обработчики
    await setup_handlers()
    
    # Загружаем настройки при старте
    from utils.settings import load_settings
    try:
        await load_settings()
        logger.info("✅ Настройки загружены")
    except Exception as e:
        logger.warning(f"⚠️ Не удалось загрузить настройки при старте: {e}")
    
    # Запускаем бота
    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("🛑 Бот остановлен пользователем")
    except Exception as e:
        logger.error(f"❌ Критическая ошибка: {e}", exc_info=True)

