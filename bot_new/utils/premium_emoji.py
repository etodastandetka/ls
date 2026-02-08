"""
Утилита для работы с премиум эмодзи в Telegram боте
Требуется второй юзернейм (collectible username) у бота

Для получения custom_emoji_id:
1. Отправьте себе сообщение с премиум эмодзи
2. Используйте метод getUpdates или webhook для получения message.entities
3. Найдите entity с type="custom_emoji" и получите custom_emoji_id
"""

from typing import Optional, List, Dict
from aiogram.types import MessageEntity
from aiogram.enums import MessageEntityType
from aiogram import Bot
import re


def _utf16_len(text: str) -> int:
    """Вычисляет длину строки в UTF-16 (для Telegram API)"""
    return len(text.encode('utf-16-le')) // 2

def _utf16_offset(text: str, byte_pos: int) -> int:
    """Вычисляет offset в UTF-16 для позиции в строке"""
    return _utf16_len(text[:byte_pos])

def _parse_html_tags(text: str) -> List[tuple]:
    """
    Парсит HTML теги и возвращает список (offset, length, tag_type)
    offset и length в UTF-16
    """
    entities = []
    # Паттерн для HTML тегов: <tag>, </tag>, <tag attr="value">
    pattern = r'<(/?)(\w+)(?:\s+[^>]*)?>'
    
    for match in re.finditer(pattern, text):
        tag_start = match.start()
        tag_end = match.end()
        tag_name = match.group(2)
        is_closing = match.group(1) == '/'
        
        # Определяем тип entity на основе тега
        entity_type = None
        if tag_name.lower() == 'b':
            entity_type = MessageEntityType.BOLD
        elif tag_name.lower() == 'i':
            entity_type = MessageEntityType.ITALIC
        elif tag_name.lower() == 'u':
            entity_type = MessageEntityType.UNDERLINE
        elif tag_name.lower() == 's':
            entity_type = MessageEntityType.STRIKETHROUGH
        elif tag_name.lower() == 'code':
            entity_type = MessageEntityType.CODE
        elif tag_name.lower() == 'pre':
            entity_type = MessageEntityType.PRE
        elif tag_name.lower() == 'a':
            entity_type = MessageEntityType.TEXT_LINK
        
        if entity_type:
            # Для открывающих тегов сохраняем позицию начала
            # Для закрывающих тегов - позицию конца
            if not is_closing:
                entities.append((tag_start, tag_end, entity_type, 'open'))
            else:
                entities.append((tag_start, tag_end, entity_type, 'close'))
    
    return entities

def _remove_html_tags(text: str) -> tuple[str, Dict[int, int]]:
    """
    Удаляет HTML теги из текста и возвращает mapping старых позиций к новым
    Returns: (текст_без_тегов, {старая_позиция: новая_позиция})
    """
    pattern = r'<[^>]+>'
    new_text = ''
    position_map = {}  # Старая позиция -> новая позиция
    
    last_pos = 0
    new_pos = 0
    
    for match in re.finditer(pattern, text):
        # Добавляем текст до тега
        before_tag = text[last_pos:match.start()]
        new_text += before_tag
        
        # Обновляем mapping для символов до тега
        for i in range(len(before_tag)):
            position_map[last_pos + i] = new_pos + i
        
        new_pos += len(before_tag)
        last_pos = match.end()
    
    # Добавляем оставшийся текст
    remaining = text[last_pos:]
    new_text += remaining
    for i in range(len(remaining)):
        position_map[last_pos + i] = new_pos + i
    
    return new_text, position_map


def create_premium_emoji_entity(
    custom_emoji_id: str,
    offset: int,
    length: int = 1
) -> MessageEntity:
    """
    Создает entity для премиум эмодзи
    
    Args:
        custom_emoji_id: ID кастомного эмодзи (строка, получается из Telegram)
        offset: Позиция в тексте (где будет эмодзи) в UTF-16
        length: Длина (обычно 1 для одного эмодзи) в UTF-16
    
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
    Поддерживает HTML теги - удаляет их и создает entities для форматирования
    
    Args:
        text: Исходный текст с обычными эмодзи (может содержать HTML теги)
        emoji_map: Словарь {обычный_эмодзи: custom_emoji_id}
    
    Returns:
        Кортеж (текст_без_HTML_с_эмодзи, список_entities)
        entities включают как премиум эмодзи, так и форматирование из HTML
    
    Example:
        text, entities = add_premium_emoji_to_text(
            "Привет <b>😊</b>! Это 🎉",
            {"😊": "1234567890123456789", "🎉": "9876543210987654321"}
        )
    """
    # Удаляем HTML теги и получаем mapping позиций
    text_without_html, position_map = _remove_html_tags(text)
    
    entities = []
    new_text = text_without_html
    
    # Проходим по тексту и создаем entities для каждого найденного эмодзи
    for emoji_char, emoji_id in emoji_map.items():
        offset = 0
        while True:
            pos = new_text.find(emoji_char, offset)
            if pos == -1:
                break
            
            # Вычисляем offset и length в UTF-16 (требуется для Telegram API)
            utf16_offset = _utf16_offset(new_text, pos)
            utf16_length = _utf16_len(emoji_char)
            
            # Создаем entity для премиум эмодзи
            entity = create_premium_emoji_entity(
                custom_emoji_id=emoji_id,
                offset=utf16_offset,
                length=utf16_length
            )
            entities.append(entity)
            offset = pos + len(emoji_char)
    
    # Парсим HTML теги и создаем entities для форматирования
    html_entities = _parse_html_tags(text)
    # Создаем пары открывающих и закрывающих тегов
    tag_stack = {}  # {tag_type: [(open_pos, open_end), ...]}
    
    for tag_start, tag_end, tag_type, tag_kind in html_entities:
        if tag_kind == 'open':
            if tag_type not in tag_stack:
                tag_stack[tag_type] = []
            # Находим позицию в тексте без HTML
            # Ищем позицию начала тега в исходном тексте
            # И переводим в позицию в тексте без HTML через position_map
            mapped_start = position_map.get(tag_start, tag_start)
            tag_stack[tag_type].append((mapped_start, tag_end))
        elif tag_kind == 'close':
            if tag_type in tag_stack and tag_stack[tag_type]:
                open_start, open_end = tag_stack[tag_type].pop()
                mapped_end = position_map.get(tag_start, tag_start)
                # Создаем entity для форматирования
                # offset - позиция после открывающего тега
                # length - до закрывающего тега
                text_after_open = text_without_html[open_end:]
                text_before_close = text_after_open[:mapped_end - open_end]
                if text_before_close:
                    utf16_offset_start = _utf16_offset(text_without_html, open_end)
                    utf16_length = _utf16_len(text_before_close)
                    entity = MessageEntity(
                        type=tag_type,
                        offset=utf16_offset_start,
                        length=utf16_length
                    )
                    entities.append(entity)
    
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
    
    # Отключаем parse_mode если передаем entities
    kwargs.pop('parse_mode', None)
    
    # Отправляем сообщение с entities
    return await bot.send_message(
        chat_id=chat_id,
        text=new_text,
        entities=entities if entities else None,
        **kwargs
    )
