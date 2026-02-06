"""
Утилиты для автоматического приветствия пользователей
"""

import logging
import httpx
from config import Config

logger = logging.getLogger(__name__)

async def check_is_first_message(user_id: int) -> bool:
    """Проверяет, является ли это первым сообщением от пользователя"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                f"{Config.API_URL}/api/users/{user_id}/chat/first-message",
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    return data.get('data', {}).get('isFirst', False)
            
            logger.warning(f"⚠️ Не удалось проверить первое сообщение для пользователя {user_id}: статус {response.status_code}")
            return False
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке первого сообщения для пользователя {user_id}: {e}")
        return False

async def send_greeting(bot, chat_id: int, user_name: str = "") -> int | None:
    """Отправляет приветственное сообщение пользователю
    
    Args:
        bot: Экземпляр бота
        chat_id: ID чата
        user_name: Имя пользователя (опционально)
    
    Returns:
        message_id отправленного сообщения или None при ошибке
    """
    greeting_text = "Привет! Чем могу помочь?"
    if user_name:
        greeting_text = f"Привет, {user_name}! Чем могу помочь?"
    
    try:
        message = await bot.send_message(
            chat_id=chat_id,
            text=greeting_text,
            parse_mode="HTML"
        )
        
        # Приветствие не сохраняем через ingest (это исходящее сообщение от бота)
        # Оно будет сохранено автоматически при отправке через бота, если нужно
        # Или можно сохранить через отдельный endpoint для исходящих сообщений
        
        return message.message_id
    except Exception as e:
        logger.error(f"❌ Ошибка при отправке приветствия пользователю {chat_id}: {e}")
        return None

