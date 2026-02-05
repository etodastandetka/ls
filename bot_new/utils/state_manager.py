"""
Управление состояниями пользователей и восстановление после рестарта
"""

import json
import time
import logging
from pathlib import Path
from typing import Dict, Optional
from config import Config

logger = logging.getLogger(__name__)

def _write_pending_deposit_states(states: dict) -> None:
    """Сохраняет ожидания фото чека в файл (атомарно)."""
    try:
        tmp_path = f"{Config.PENDING_DEPOSIT_STATE_FILE}.tmp"
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(states, f, ensure_ascii=True)
        Path(tmp_path).replace(Config.PENDING_DEPOSIT_STATE_FILE)
    except Exception as e:
        logger.warning(f"⚠️ Не удалось сохранить pending_deposit_states: {e}")

def _load_pending_deposit_states() -> dict:
    """Загружает ожидания фото чека из файла и очищает истекшие."""
    if not Config.PENDING_DEPOSIT_STATE_FILE.exists():
        return {}
    try:
        with open(Config.PENDING_DEPOSIT_STATE_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {}
    except Exception as e:
        logger.warning(f"⚠️ Не удалось загрузить pending_deposit_states: {e}")
        return {}
    
    now_ts = time.time()
    cleaned = {}
    for key, value in data.items():
        if not isinstance(value, dict):
            continue
        expires_at = value.get('expires_at')
        if isinstance(expires_at, (int, float)) and expires_at > now_ts:
            cleaned[key] = value
    
    if cleaned != data:
        _write_pending_deposit_states(cleaned)
    return cleaned

# Глобальное хранилище состояний (в памяти)
pending_deposit_states = _load_pending_deposit_states()

def set_pending_deposit_state(user_id: int, data: dict, expires_at: float) -> None:
    """Сохраняет ожидание фото чека для пользователя."""
    if not data:
        return
    pending_deposit_states[str(user_id)] = {
        'data': data,
        'expires_at': expires_at
    }
    _write_pending_deposit_states(pending_deposit_states)

def get_pending_deposit_state(user_id: int) -> Optional[dict]:
    """Возвращает сохраненные данные ожидания фото чека, если они актуальны."""
    key = str(user_id)
    state = pending_deposit_states.get(key)
    if not state:
        return None
    expires_at = state.get('expires_at')
    if not isinstance(expires_at, (int, float)) or expires_at <= time.time():
        pending_deposit_states.pop(key, None)
        _write_pending_deposit_states(pending_deposit_states)
        return None
    return state.get('data')

def clear_pending_deposit_state(user_id: int) -> None:
    """Очищает ожидание фото чека для пользователя."""
    key = str(user_id)
    if key in pending_deposit_states:
        pending_deposit_states.pop(key, None)
        _write_pending_deposit_states(pending_deposit_states)


