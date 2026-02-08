"""
Вспомогательная функция для ответа с автоматическим применением премиум эмодзи
"""

from aiogram.types import Message
from utils.texts import get_text, get_text_with_premium_emoji
from utils.premium_emoji import add_premium_emoji_to_text
from config import Config


async def answer_with_text(message: Message, text_key: str, **kwargs) -> Message:
    """Отвечает на сообщение с текстом из get_text и автоматически применяет премиум эмодзи"""
    text, entities = get_text_with_premium_emoji(text_key, **kwargs)
    # Отключаем parse_mode при использовании entities
    kwargs.pop('parse_mode', None)
    return await message.answer(text, entities=entities if entities else None, **kwargs)


async def answer_with_custom_text(message: Message, text: str, **kwargs) -> Message:
    """Отвечает на сообщение с кастомным текстом и автоматически применяет премиум эмодзи"""
    text_with_emoji, entities = add_premium_emoji_to_text(text, Config.PREMIUM_EMOJI_MAP)
    # Отключаем parse_mode при использовании entities
    kwargs.pop('parse_mode', None)
    return await message.answer(text_with_emoji, entities=entities if entities else None, **kwargs)

