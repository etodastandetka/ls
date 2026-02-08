"""
Обработчик команды /referral
"""

import logging
import httpx
from aiogram import Router
from aiogram.types import Message
from config import Config
from utils.texts import get_text

logger = logging.getLogger(__name__)
router = Router()

@router.message(lambda m: m.text and m.text.startswith('/referral'))
async def referral_command(message: Message):
    """Обработчик команды /referral для просмотра реферальной статистики"""
    user_id = message.from_user.id
    
    try:
        # Получаем данные реферальной программы через API
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{Config.API_URL}/api/public/referral-data",
                params={"user_id": str(user_id)}
            )
            
            if response.status_code == 200:
                data = response.json()
                
                if data.get('success'):
                    earned = data.get('earned', 0)
                    referral_count = data.get('referral_count', 0)
                    available_balance = data.get('available_balance', 0)
                    top_players = data.get('top_players', [])
                    user_rank = data.get('user_rank', 0)
                    
                    # Формируем сообщение
                    message_text = f"""📊 <b>Реферальная программа</b>

💰 <b>Заработано:</b> {earned:.2f} KGS
👥 <b>Рефералов:</b> {referral_count}
💵 <b>Доступно к выводу:</b> {available_balance:.2f} KGS
🏆 <b>Ваш рейтинг:</b> #{user_rank if user_rank > 0 else '—'}

📈 <b>Топ игроков:</b>"""
                    
                    if top_players:
                        for i, player in enumerate(top_players[:10], 1):
                            player_earned = player.get('earned', 0)
                            player_count = player.get('referral_count', 0)
                            message_text += f"\n{i}. {player.get('username', 'Пользователь')} — {player_earned:.2f} KGS ({player_count} реф.)"
                    else:
                        message_text += "\nПока нет данных"
                    
                    text_with_emoji, entities = add_premium_emoji_to_text(message_text, Config.PREMIUM_EMOJI_MAP)
                    await message.answer(text_with_emoji, entities=entities if entities else None, parse_mode=None)
                else:
                    await answer_with_custom_text(message, "❌ Ошибка при получении данных реферальной программы")
            else:
                await answer_with_custom_text(message, "❌ Ошибка при получении данных реферальной программы")
                
    except Exception as e:
        logger.error(f"Ошибка при получении реферальной статистики: {e}")
        await answer_with_custom_text(message, "❌ Произошла ошибка при получении данных")


