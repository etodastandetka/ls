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
        return

_root_dir = Path(__file__).resolve().parents[1]
_load_env_file(_root_dir / "admin" / ".env")
_load_env_file(_root_dir / "admin_nextjs" / ".env")

class Config:
    # Токен бота из .env файла (admin_nextjs/.env)
    BOT_TOKEN = os.getenv("BOT_TOKEN") or os.getenv("TELEGRAM_BOT_TOKEN") or "8502647763:AAEaHMQpwzeFbUN4Hq1ZCq42CagkPFMgADo"
    WEBSITE_URL = os.getenv("MINI_APP_URL", "https://lux-on.org")
    API_URL = os.getenv("ADMIN_PUBLIC_URL", os.getenv("NEXT_PUBLIC_API_URL", "https://pipiska.net"))
    SUPPORT_BOT_URL = os.getenv("SUPPORT_BOT_URL", "https://t.me/operator_luxon_bot")
    PENDING_DEPOSIT_STATE_FILE = Path(__file__).parent / 'pending_deposit_states.json'
    DEPOSIT_TIMEOUT_SECONDS = 300  # 5 минут
    
    BANK_NAMES = {
        'kompanion': 'Компаньон',
        'demirbank': 'DemirBank',
        'demir': 'DemirBank',
        'omoney': 'O!Money',
        'balance': 'Balance.kg',
        'bakai': 'Bakai',
        'megapay': 'MegaPay',
        'mbank': 'MBank',
        'odengi': 'O!Money'
    }
    
    CASINO_NAMES = {
        '1xbet': '1XBET',
        '1win': '1WIN',
        'melbet': 'MELBET',
        'mostbet': 'MOSTBET',
        'winwin': 'WINWIN',
        '888starz': '888STARZ'
    }

