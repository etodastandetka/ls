"""
Вспомогательная утилита для отправки сообщений с премиум эмодзи
"""

from typing import Optional
from aiogram import Bot
from aiogram.types import Message
from utils.premium_emoji import add_premium_emoji_to_text
from config import Config


async def send_message_with_premium_emoji(
    bot: Bot,
    chat_id: int,
    text: str,
    **kwargs
) -> Message:
    """
    Отправляет сообщение с автоматической заменой эмодзи на премиум версии
    
    Args:
        bot: Экземпляр бота
        chat_id: ID чата
        text: Текст сообщения
        **kwargs: Дополнительные параметры для send_message
    
    Returns:
        Отправленное сообщение
    """
    # Применяем премиум эмодзи
    text_with_emoji, entities = add_premium_emoji_to_text(text, Config.PREMIUM_EMOJI_MAP)
    
    # Отправляем сообщение
    return await bot.send_message(
        chat_id=chat_id,
        text=text_with_emoji,
        entities=entities if entities else None,
        **kwargs
    )


async def answer_with_premium_emoji(
    message: Message,
    text: str,
    **kwargs
) -> Message:
    """
    Отвечает на сообщение с автоматической заменой эмодзи на премиум версии
    
    Args:
        message: Сообщение, на которое отвечаем
        text: Текст ответа
        **kwargs: Дополнительные параметры для answer
    
    Returns:
        Отправленное сообщение
    """
    # Применяем премиум эмодзи
    text_with_emoji, entities = add_premium_emoji_to_text(text, Config.PREMIUM_EMOJI_MAP)
    
    # Отвечаем на сообщение
    return await message.answer(
        text=text_with_emoji,
        entities=entities if entities else None,
        **kwargs
    )

