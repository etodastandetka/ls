"""
Утилита для работы с премиум эмодзи в Telegram боте
Требуется второй юзернейм (collectible username) у бота

Для получения custom_emoji_id:
1. Отправьте себе сообщение с премиум эмодзи
2. Используйте метод getUpdates или webhook для получения message.entities
3. Найдите entity с type="custom_emoji" и получите custom_emoji_id
"""

from typing import Optional, List, Dict
from aiogram.types import MessageEntity, MessageEntityType
from aiogram import Bot


def create_premium_emoji_entity(
    custom_emoji_id: str,
    offset: int,
    length: int = 1
) -> MessageEntity:
    """
    Создает entity для премиум эмодзи
    
    Args:
        custom_emoji_id: ID кастомного эмодзи (строка, получается из Telegram)
        offset: Позиция в тексте (где будет эмодзи)
        length: Длина (обычно 1 для одного эмодзи)
    
    Returns:
        MessageEntity для использования в сообщении
    """
    return MessageEntity(
        type=MessageEntityType.CUSTOM_EMOJI,
        offset=offset,
        length=length,
        custom_emoji_id=custom_emoji_id
    )


def add_premium_emoji_to_text(
    text: str,
    emoji_map: Dict[str, str]
) -> tuple[str, List[MessageEntity]]:
    """
    Добавляет премиум эмодзи в текст, заменяя обычные эмодзи
    
    Args:
        text: Исходный текст с обычными эмодзи
        emoji_map: Словарь {обычный_эмодзи: custom_emoji_id}
    
    Returns:
        Кортеж (текст_с_эмодзи, список_entities)
    
    Example:
        text, entities = add_premium_emoji_to_text(
            "Привет 😊! Это 🎉",
            {"😊": "1234567890123456789", "🎉": "9876543210987654321"}
        )
    """
    entities = []
    new_text = text
    
    # Проходим по тексту и создаем entities для каждого найденного эмодзи
    for emoji_char, emoji_id in emoji_map.items():
        offset = 0
        while True:
            pos = new_text.find(emoji_char, offset)
            if pos == -1:
                break
            
            # Создаем entity для премиум эмодзи
            entity = create_premium_emoji_entity(
                custom_emoji_id=emoji_id,
                offset=pos,
                length=len(emoji_char)
            )
            entities.append(entity)
            offset = pos + len(emoji_char)
    
    return new_text, entities


async def send_message_with_premium_emoji(
    bot: Bot,
    chat_id: int,
    text: str,
    emoji_map: Optional[Dict[str, str]] = None,
    **kwargs
):
    """
    Отправляет сообщение с премиум эмодзи
    
    Args:
        bot: Экземпляр бота
        chat_id: ID чата
        text: Текст сообщения (может содержать обычные эмодзи, которые будут заменены)
        emoji_map: Словарь {обычный_эмодзи: custom_emoji_id}
        **kwargs: Дополнительные параметры для send_message
    
    Example:
        await send_message_with_premium_emoji(
            bot, chat_id,
            "Привет 😊! Это премиум эмодзи 🎉",
            emoji_map={
                "😊": "1234567890123456789",  # custom_emoji_id
                "🎉": "9876543210987654321"
            }
        )
    """
    if not emoji_map:
        # Если нет премиум эмодзи, отправляем обычное сообщение
        return await bot.send_message(chat_id=chat_id, text=text, **kwargs)
    
    # Добавляем премиум эмодзи в текст
    new_text, entities = add_premium_emoji_to_text(text, emoji_map)
    
    # Отправляем сообщение с entities
    return await bot.send_message(
        chat_id=chat_id,
        text=new_text,
        entities=entities if entities else None,
        **kwargs
    )

