"""
Утилиты для загрузки настроек
"""

import logging
import asyncio
import httpx
from config import Config

logger = logging.getLogger(__name__)

# Кеш настроек
settings_cache = {
    'casinos': {},
    'deposit_banks': [],
    'withdrawal_banks': [],
    'deposits_enabled': True,
    'withdrawals_enabled': True,
    'pause': False,
    'maintenance_message': 'Технические работы. Попробуйте позже.',
    'last_update': 0,
    'bookmaker_settings': {}
}

async def load_settings():
    """Загружает настройки из API"""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{Config.API_URL}/api/public/payment-settings")
            if response.status_code == 200:
                result = response.json()
                data = result
                
                settings_cache['casinos'] = data.get('casinos', {})
                deposits_data = data.get('deposits', {})
                withdrawals_data = data.get('withdrawals', {})
                bookmaker_settings = data.get('bookmaker_settings', {})
                
                if isinstance(deposits_data, dict):
                    settings_cache['deposit_banks'] = deposits_data.get('banks', [])
                    settings_cache['deposits_enabled'] = deposits_data.get('enabled', True)
                else:
                    settings_cache['deposit_banks'] = []
                    settings_cache['deposits_enabled'] = True
                
                if isinstance(withdrawals_data, dict):
                    settings_cache['withdrawal_banks'] = withdrawals_data.get('banks', [])
                    settings_cache['withdrawals_enabled'] = withdrawals_data.get('enabled', True)
                else:
                    settings_cache['withdrawal_banks'] = []
                    settings_cache['withdrawals_enabled'] = True
                
                settings_cache['bookmaker_settings'] = bookmaker_settings
                settings_cache['pause'] = data.get('pause', False)
                settings_cache['maintenance_message'] = data.get('maintenance_message', 'Технические работы. Попробуйте позже.')
                settings_cache['last_update'] = asyncio.get_event_loop().time()
                logger.info(f"✅ Настройки загружены: букмекеры={len(settings_cache['casinos'])}, депозиты={settings_cache['deposits_enabled']}")
    except Exception as e:
        logger.warning(f"⚠️ Не удалось загрузить настройки: {e}, используем значения по умолчанию")
        settings_cache['casinos'] = {'1xbet': True, '1win': True, 'melbet': True, 'mostbet': True, 'winwin': True, '888starz': True}
        settings_cache['deposit_banks'] = ['mbank', 'bakai', 'balance', 'demir', 'omoney', 'megapay']
        settings_cache['withdrawal_banks'] = ['kompanion', 'odengi', 'bakai', 'balance', 'megapay', 'mbank']
        settings_cache['deposits_enabled'] = True
        settings_cache['withdrawals_enabled'] = True
        settings_cache['bookmaker_settings'] = {}
        settings_cache['pause'] = False
        settings_cache['maintenance_message'] = 'Технические работы. Попробуйте позже.'

def get_settings():
    """Возвращает кеш настроек"""
    return settings_cache


