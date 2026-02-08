"""
Менеджер для управления запрещенными словами
"""

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

WORDS_FILE = Path(__file__).parent / 'forbidden_words.json'


def load_words() -> list:
    """Загружает список запрещенных слов из файла"""
    if not WORDS_FILE.exists():
        # Если файла нет, возвращаем пустой список
        return []
    
    try:
        with open(WORDS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            words = data.get('words', [])
            logger.info(f"📋 Загружено {len(words)} запрещенных слов из файла")
            return words
    except Exception as e:
        logger.error(f"❌ Ошибка при загрузке слов из файла: {e}")
        return []


def save_words(words: list) -> bool:
    """Сохраняет список запрещенных слов в файл"""
    try:
        data = {'words': words}
        with open(WORDS_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        logger.info(f"✅ Сохранено {len(words)} запрещенных слов в файл")
        return True
    except Exception as e:
        logger.error(f"❌ Ошибка при сохранении слов в файл: {e}")
        return False


def add_word(word: str) -> tuple[bool, str]:
    """Добавляет слово в список"""
    words = load_words()
    word_lower = word.lower().strip()
    
    if not word_lower:
        return False, "❌ Слово не может быть пустым"
    
    if word_lower in [w.lower() for w in words]:
        return False, f"⚠️ Слово '{word}' уже есть в списке"
    
    words.append(word)
    if save_words(words):
        return True, f"✅ Слово '{word}' добавлено в список"
    else:
        return False, "❌ Ошибка при сохранении слова"


def remove_word(word: str) -> tuple[bool, str]:
    """Удаляет слово из списка"""
    words = load_words()
    word_lower = word.lower().strip()
    
    words_lower = [w.lower() for w in words]
    if word_lower not in words_lower:
        return False, f"⚠️ Слово '{word}' не найдено в списке"
    
    # Удаляем слово (сохраняем оригинальный регистр)
    words = [w for w in words if w.lower() != word_lower]
    
    if save_words(words):
        return True, f"✅ Слово '{word}' удалено из списка"
    else:
        return False, "❌ Ошибка при сохранении изменений"


def get_words() -> list:
    """Возвращает список всех запрещенных слов"""
    return load_words()


def get_words_count() -> int:
    """Возвращает количество запрещенных слов"""
    return len(load_words())

