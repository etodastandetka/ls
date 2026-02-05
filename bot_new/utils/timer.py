"""
Таймер для депозитов
"""

import logging
import asyncio
from typing import Dict
from aiogram import Bot
from aiogram.enums import ParseMode
from utils.keyboards import get_bank_keyboard
from utils.settings import load_settings, get_settings
from utils.texts import get_casino_name, get_text
from html import escape

logger = logging.getLogger(__name__)

# Словарь активных таймеров
active_timers: Dict[int, asyncio.Task] = {}

async def update_timer(bot: Bot, user_id: int, total_seconds: int, data: dict, message_id: int, chat_id: int, user_states: dict) -> None:
    """Обновляет таймер с оптимизацией для большого количества пользователей"""
    try:
        start_time = asyncio.get_event_loop().time()
        remaining_seconds = total_seconds
        last_update_time = 0
        last_displayed_minutes = -1
        update_interval = 5  # Обновляем каждые 5 секунд (вместо каждой секунды)
        consecutive_errors = 0
        max_consecutive_errors = 3
        
        # Кэшируем настройки
        settings_cache_time = 0
        settings_cache = None
        
        while remaining_seconds > 0:
            await asyncio.sleep(1)
            
            # Проверяем, не была ли заявка уже создана
            if user_id not in user_states:
                logger.info(f"⏹️ Таймер остановлен для пользователя {user_id} - состояние очищено")
                if user_id in active_timers:
                    del active_timers[user_id]
                break
            
            current_state = user_states.get(user_id, {})
            current_step = current_state.get('step', '')
            
            # Если заявка уже создана, останавливаем таймер
            if current_step not in ['deposit_bank', 'deposit_receipt_photo']:
                logger.info(f"⏹️ Таймер остановлен для пользователя {user_id} - заявка создана")
                if user_id in active_timers:
                    del active_timers[user_id]
                break
            
            # Вычисляем оставшееся время
            elapsed = int(asyncio.get_event_loop().time() - start_time)
            remaining_seconds = max(0, total_seconds - elapsed)
            
            # Форматируем таймер
            minutes = remaining_seconds // 60
            seconds = remaining_seconds % 60
            
            # Обновляем сообщение только если:
            # 1. Прошло достаточно времени (update_interval секунд)
            # 2. Или изменилась минута (для более точного отображения)
            # 3. Или осталось меньше минуты (обновляем каждую секунду)
            current_time = asyncio.get_event_loop().time()
            should_update = (
                (current_time - last_update_time >= update_interval) or
                (minutes != last_displayed_minutes) or
                (remaining_seconds < 60)
            )
            
            if should_update:
                timer_text = f"{minutes}:{seconds:02d}"
                last_displayed_minutes = minutes
                
                # Обновляем сообщение
                try:
                    current_data = user_states.get(user_id, {}).get('data', data)
                    bank_links = current_data.get('bank_links', {})
                    
                    # Загружаем настройки если они устарели (кэшируем на 5 минут)
                    if current_time - settings_cache_time > 300:
                        try:
                            settings = get_settings()
                            if asyncio.get_event_loop().time() - settings.get('last_update', 0) > 300:
                                await load_settings()
                                settings = get_settings()
                            settings_cache = settings
                            settings_cache_time = current_time
                        except Exception as settings_error:
                            logger.warning(f"⚠️ Ошибка загрузки настроек в таймере: {settings_error}")
                            if settings_cache is None:
                                settings_cache = get_settings()
                            settings = settings_cache
                    else:
                        settings = settings_cache or get_settings()
                    
                    enabled_banks = settings.get('deposit_banks', [])
                    reply_markup = get_bank_keyboard(bank_links, enabled_banks)
                    
                    casino_name = get_casino_name(current_data.get('bookmaker', ''))
                    
                    # Используем HTML для отдельных цитат без пробела между ними
                    amount_str = f"{current_data.get('amount', 0):.2f}"
                    player_id_str = str(current_data.get('player_id', ''))
                    
                    updated_text = (
                        f"<blockquote>💰 Сумма: {amount_str} сом</blockquote>"
                        f"<blockquote>🆔 ID: {player_id_str}</blockquote>\n\n"
                        f"⏳ Время на оплату: {timer_text}\n"
                        f"‼️ Оплата строго до копеек\n"
                        f"📸 После оплаты отправьте фото чека"
                    )
                    
                    is_photo_message = current_data.get('is_photo_message', False)
                    if is_photo_message:
                        await bot.edit_message_caption(
                            chat_id=chat_id,
                            message_id=message_id,
                            caption=updated_text,
                            reply_markup=reply_markup,
                            parse_mode=ParseMode.HTML
                        )
                    else:
                        await bot.edit_message_text(
                            chat_id=chat_id,
                            message_id=message_id,
                            text=updated_text,
                            reply_markup=reply_markup,
                            parse_mode=ParseMode.HTML
                        )
                    
                    # Успешное обновление - сбрасываем счетчик ошибок
                    consecutive_errors = 0
                    last_update_time = current_time
                    
                except Exception as e:
                    consecutive_errors += 1
                    error_msg = str(e).lower()
                    
                    # Если слишком много ошибок подряд, останавливаем таймер
                    if consecutive_errors >= max_consecutive_errors:
                        logger.error(f"❌ Таймер остановлен для пользователя {user_id} - слишком много ошибок подряд: {e}")
                        if user_id in active_timers:
                            del active_timers[user_id]
                        break
                    
                    # Если это rate limit ошибка, увеличиваем интервал обновления
                    if 'rate limit' in error_msg or 'too many requests' in error_msg or 'flood' in error_msg:
                        logger.warning(f"⚠️ Rate limit для пользователя {user_id}, увеличиваю интервал обновления")
                        update_interval = min(update_interval * 2, 30)  # Максимум 30 секунд
                        last_update_time = current_time  # Сбрасываем таймер, чтобы не обновлять сразу
                    else:
                        logger.warning(f"⚠️ Не удалось обновить таймер для пользователя {user_id}: {e}")
        
        # Время истекло - отменяем заявку
        if user_id in user_states:
            logger.info(f"⏰ Таймер истек для пользователя {user_id}, отменяю заявку")
            
            current_data = user_states.get(user_id, {}).get('data', data)
            
            # Очищаем состояние
            del user_states[user_id]
            from utils.state_manager import clear_pending_deposit_state
            clear_pending_deposit_state(user_id)
            
            # Удаляем таймер из активных
            if user_id in active_timers:
                del active_timers[user_id]
            
            # Отправляем сообщение об отмене
            try:
                cancel_text = "⏰ <b>Пополнение отменено, время оплаты прошло</b>\n\n❌ <b>Не переводите по старым реквизитам</b>\n\nНачните заново, нажав на <b>Пополнить</b>"
                
                try:
                    await bot.delete_message(chat_id=chat_id, message_id=message_id)
                    logger.info(f"✅ Сообщение с QR-кодом удалено для пользователя {user_id} после истечения таймера")
                except Exception as delete_error:
                    logger.warning(f"⚠️ Не удалось удалить сообщение с QR-кодом для пользователя {user_id}: {delete_error}")
                
                await bot.send_message(chat_id=chat_id, text=cancel_text)
                from handlers.start import send_main_menu
                await send_main_menu(chat_id, "", bot)
            except Exception as e:
                logger.error(f"❌ Ошибка при отправке сообщения об отмене для пользователя {user_id}: {e}")
    except asyncio.CancelledError:
        logger.info(f"⏹️ Таймер отменен для пользователя {user_id}")
        if user_id in active_timers:
            del active_timers[user_id]
    except Exception as e:
        logger.error(f"❌ Ошибка в таймере для пользователя {user_id}: {e}", exc_info=True)
        if user_id in active_timers:
            del active_timers[user_id]
    finally:
        if user_id in active_timers:
            del active_timers[user_id]

def cancel_timer(user_id: int):
    """Отменяет таймер для пользователя"""
    if user_id in active_timers:
        try:
            active_timers[user_id].cancel()
            logger.info(f"⏹️ Таймер остановлен для пользователя {user_id}")
        except Exception as e:
            logger.warning(f"⚠️ Ошибка при остановке таймера: {e}")
        del active_timers[user_id]


