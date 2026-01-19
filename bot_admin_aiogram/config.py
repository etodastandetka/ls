import os
from pathlib import Path


def _load_env_file(env_path: Path) -> None:
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
        # Тихо игнорируем ошибки чтения env файла
        return


# Загружаем .env из admin/.env или admin_nextjs/.env
_root_dir = Path(__file__).resolve().parents[1]
_load_env_file(_root_dir / "admin" / ".env")
_load_env_file(_root_dir / "admin_nextjs" / ".env")

# Токен и настройки берём из переменных окружения
BOT_TOKEN = os.getenv("BOT_TOKEN", "")

# Общий пароль для доступа в бота
BOT_PASSWORD = os.getenv("BOT_PASSWORD", "")

# Публичный URL админки (пример: https://pipiska.net)
ADMIN_API_URL = os.getenv("ADMIN_API_URL", "")

# Токен админа из cookies (auth_token)
ADMIN_AUTH_TOKEN = os.getenv("ADMIN_AUTH_TOKEN", "")

REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "20"))

# Файл для хранения авторизованных пользователей
AUTHORIZED_USERS_FILE = "authorized_users.json"

