"""
Конфигурация бота-модератора
"""

import os
from pathlib import Path


def _load_env_file(env_path: Path) -> None:
    """Загружает переменные окружения из .env файла"""
    if not env_path.exists():
        return
    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception:
        return


# Загружаем .env файл из admin_nextjs (как в других ботах проекта)
_root_dir = Path(__file__).resolve().parents[1]
_load_env_file(_root_dir / "admin_nextjs" / ".env")
# Также загружаем локальный .env если есть
_load_env_file(Path(__file__).resolve().parent / ".env")


class Config:
    # Токен бота из переменной окружения или .env файла (admin_nextjs/.env)
    BOT_TOKEN = os.getenv("OPER_TOKEN") or os.getenv("MODERATOR_BOT_TOKEN") or os.getenv("BOT_TOKEN")
    
    # Список запрещенных слов (регистр не важен)
    # Слова будут искаться как отдельные слова (не как часть других слов)
    FORBIDDEN_WORDS = [
        "чотал",
        "шотал",
        "четр",
        "шытр",
        "чотр",
        "пул",
        "акча",
        "грев",
        "мошенник",
        "котик",
        "luxon_boss",
        "luxservice",
        "@luxon_boss",
        "@luxservice",
    ]
    
    # Пропускать сообщения от администраторов группы
    SKIP_ADMINS = True
    
    # Отправлять предупреждение при удалении сообщения
    SEND_WARNING = True
    
    # Текст предупреждения (используется форматирование)
    WARNING_MESSAGE = "⚠️ {user}, ваше сообщение было удалено из-за нарушения правил группы."
    
    # Время в секундах, через которое удалять предупреждение (0 = не удалять)
    WARNING_DELETE_SECONDS = 10

