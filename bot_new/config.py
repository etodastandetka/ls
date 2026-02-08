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
    
    # Премиум эмодзи (custom_emoji_id)
    # Получить ID можно через @BotFather или из сообщений с премиум эмодзи
    # Формат: {"обычный_эмодзи": "custom_emoji_id"}
    PREMIUM_EMOJI_MAP = {
        "💰": "5294282194368353577",
        "💚": "5474214798352749291",
        "📤": "5877540355187937244",
        "📥": "5877307202888273539",
        "🕒": "5778605968208170641",
        "⏰": "5985616167740379273",
        "⏳": "5314786200735740069",
        "⏸️": "5359543311897998264",
        "💬": "5891243564309942507",
        "🔒": "5296369303661067030",
        "📞": "5897567714674741148",
        "✨": "5325547803936572038",
        "📊": "5294541232435910416",
        "ℹ️": "5334544901428229844",
        "📖": "5897850551156084824",
        "📱": "5292013403664045674",
        "❌": "5017058788604117831",
        "✅": "5292059883800123944",
        "💾": "5884064642438795702",
        "🔍": "5397674675796985688",
        "📍": "5391032818111363540",
        "📎": "5305265301917549162",
        "📝": "6008090211181923982",
        "📸": "5884290437459480896",
    }
    
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
