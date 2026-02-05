"""
Обработчики callback кнопок
"""

import logging
from aiogram import Router
from aiogram.types import CallbackQuery
from aiogram.fsm.context import FSMContext
from handlers.deposit import user_states
from handlers.start import send_main_menu
from utils.timer import cancel_timer, active_timers
from bot import bot

logger = logging.getLogger(__name__)
router = Router()

@router.callback_query(lambda c: c.data == "cancel_request")
async def cancel_request(callback: CallbackQuery, state: FSMContext):
    """Обработка отмены заявки"""
    user_id = callback.from_user.id
    logger.info(f"🛑 Пользователь {user_id} отменил заявку через инлайн-кнопку")
    
    # Удаляем сообщение с QR-кодом/кнопками, если оно есть
    try:
        data = user_states.get(user_id, {}).get('data', {})
        if 'timer_message_id' in data and 'timer_chat_id' in data:
            await bot.delete_message(
                chat_id=data['timer_chat_id'],
                message_id=data['timer_message_id']
            )
            logger.info(f"✅ Сообщение с QR-кодом удалено для пользователя {user_id} при отмене (inline)")
        elif callback.message:
            await callback.message.delete()
    except Exception as delete_error:
        logger.warning(f"⚠️ Не удалось удалить сообщение с QR-кодом при отмене (inline): {delete_error}")
    
    # Останавливаем таймер если он активен
    cancel_timer(user_id)
    
    # Очищаем состояние
    if user_id in user_states:
        del user_states[user_id]
    logger.info(f"✅ Состояние очищено для пользователя {user_id}")
    
    from utils.state_manager import clear_pending_deposit_state
    clear_pending_deposit_state(user_id)
    
    await callback.answer("Заявка отменена")
    await state.clear()
    
    # Отправляем главное меню
    await send_main_menu(callback.message.chat.id, callback.from_user.first_name, bot)

@router.callback_query(lambda c: c.data == "back_to_menu")
async def back_to_menu(callback: CallbackQuery, state: FSMContext):
    """Обработка возврата в главное меню"""
    user_id = callback.from_user.id
    if user_id in user_states:
        del user_states[user_id]
    await callback.answer("Возврат в главное меню")
    await state.clear()
    
    await send_main_menu(callback.message.chat.id, callback.from_user.first_name, bot)

@router.callback_query(lambda c: c.data and c.data.startswith('check_sub_'))
async def check_subscription(callback: CallbackQuery):
    """Обработка проверки подписки"""
    user_id = callback.from_user.id
    channel_id = callback.data.replace('check_sub_', '')
    
    # Проверяем подписку
    from handlers.start import check_channel_subscription
    is_subscribed = await check_channel_subscription(user_id, channel_id)
    
    if is_subscribed:
        try:
            try:
                await callback.message.edit_text("✅ Подписка подтверждена.")
            except Exception:
                pass
            await send_main_menu(callback.message.chat.id, callback.from_user.first_name, bot)
            logger.info(f"✅ Основное меню отправлено пользователю {user_id} после проверки подписки")
        except Exception as e:
            logger.error(f"❌ Ошибка при отправке основного меню: {e}")
            await callback.message.edit_text("✅ Спасибо за подписку! Используйте команду /start для продолжения.")
    else:
        await callback.answer("❌ Вы еще не подписались на канал. Пожалуйста, подпишитесь и попробуйте снова.", show_alert=True)
        logger.info(f"⚠️ Пользователь {user_id} не подписан на канал")

@router.callback_query(lambda c: c.data and c.data.startswith('deposit_bank_') and c.data.endswith('_disabled'))
async def deposit_bank_disabled(callback: CallbackQuery):
    """Обработка нажатия на недоступный банк"""
    await callback.answer("⚠️ Этот банк временно недоступен. Выберите другой банк.", show_alert=True)


