#!/usr/bin/env python3
"""
🛡️ Модуль защиты от DDoS и атак для Telegram ботов
"""

import time
import logging
from collections import defaultdict
from typing import Dict, Optional

logger = logging.getLogger(__name__)

_rate_limit_store: Dict[str, Dict] = defaultdict(dict)
_blocked_users: Dict[int, float] = {}


def get_user_id(update) -> Optional[int]:
    """Извлекает user_id из update"""
    if hasattr(update, 'effective_user') and update.effective_user:
        return update.effective_user.id
    if hasattr(update, 'message') and update.message and update.message.from_user:
        return update.message.from_user.id
    if hasattr(update, 'callback_query') and update.callback_query and update.callback_query.from_user:
        return update.callback_query.from_user.id
    return None

RATE_LIMIT_WINDOW = 60
MAX_REQUESTS_PER_WINDOW = 30
BLOCK_DURATION = 900


def is_user_blocked(user_id: int) -> bool:
    """Проверяет, заблокирован ли пользователь"""
    if user_id in _blocked_users:
        unblock_time = _blocked_users[user_id]
        if time.time() < unblock_time:
            return True
        else:
            del _blocked_users[user_id]
    return False


def block_user(user_id: int, duration: int = BLOCK_DURATION) -> None:
    """Блокирует пользователя на указанное время"""
    unblock_time = time.time() + duration
    _blocked_users[user_id] = unblock_time
    logger.warning(f"🚫 User {user_id} blocked for {duration} seconds")


def check_rate_limit(user_id: int):
    """
    Проверяет rate limit для пользователя
    Возвращает (is_allowed, error_message)
    """
    if is_user_blocked(user_id):
        remaining_time = int(_blocked_users[user_id] - time.time())
        return False, f"User temporarily blocked. Try again in {remaining_time} seconds."
    
    now = time.time()
    user_data = _rate_limit_store.get(user_id, {})
    
    reset_time = user_data.get('reset_time', 0)
    if reset_time < now:
        user_data = {
            'count': 0,
            'reset_time': now + RATE_LIMIT_WINDOW
        }
    
    user_data['count'] = user_data.get('count', 0) + 1
    
    if user_data['count'] > MAX_REQUESTS_PER_WINDOW:
        block_user(user_id, BLOCK_DURATION)
        logger.warning(f"🚫 Rate limit exceeded for user {user_id}. Blocked for {BLOCK_DURATION} seconds.")
        return False, "Rate limit exceeded. You have been temporarily blocked."
    
    _rate_limit_store[user_id] = user_data
    
    return True, None


def validate_input(text: Optional[str], max_length: int = 4096):
    """
    Валидирует входной текст
    Возвращает (is_valid, error_message)
    """
    if text is None:
        return True, None
    
    if len(text) > max_length:
        return False, f"Text too long. Maximum length is {max_length} characters."
    
    import re
    sql_patterns = [
        r'\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\s+.*(FROM|INTO|TABLE|DATABASE|WHERE)',
        r'(--|#)\s*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION)',
        r'/\*.*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION).*\*/',
        r'\bOR\b.*=.*=',
        r'\bAND\b.*=.*=',
        r"('|`|\").*(\bOR\b|\bAND\b).*('|`|\")",
        r';.*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION)',
    ]
    
    for pattern in sql_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return False, "Invalid input detected."
    
    xss_patterns = [
        r'<script',
        r'javascript:',
        r'onerror=',
        r'onload=',
        r'<iframe',
    ]
    
    for pattern in xss_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return False, "Invalid input detected."
    
    return True, None


def sanitize_input(text: str) -> str:
    """Очищает входной текст от потенциально опасных символов"""
    import html
    text = html.escape(text)
    text = text.replace("'", "").replace('"', '').replace(';', '').replace('--', '')
    return text

