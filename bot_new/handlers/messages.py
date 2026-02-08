"""
Обработчики обычных сообщений
"""

import logging
import httpx
from aiogram import Router, F
from aiogram.types import Message
from aiogram.fsm.context import FSMContext
from config import Config
from utils.texts import get_text
from utils.keyboards import get_support_keyboard, get_history_keyboard, get_faq_keyboard
from utils.settings import load_settings, get_settings
from handlers.deposit import user_states
from handlers.start import send_main_menu
from utils.state_manager import get_pending_deposit_state, clear_pending_deposit_state
from security import validate_input, sanitize_input
from states import DepositStates, WithdrawStates

logger = logging.getLogger(__name__)
router = Router()

@router.message(lambda m: m.text and ("отменить заявку" in m.text.lower() or m.text.strip() == "❌ Отменить заявку"))
async def cancel_request_text(message: Message, state: FSMContext):
    """Обработка отмены заявки через текст (проверяется в самом начале)"""
    user_id = message.from_user.id
    logger.info(f"🛑 Пользователь {user_id} отменил заявку через Reply-клавиатуру")
    
    # Удаляем сообщение с QR-кодом если оно есть
    if user_id in user_states:
        data = user_states[user_id].get('data', {})
        if 'timer_message_id' in data and 'timer_chat_id' in data:
            try:
                from bot import bot
                await bot.delete_message(
                    chat_id=data['timer_chat_id'],
                    message_id=data['timer_message_id']
                )
                logger.info(f"✅ Сообщение с QR-кодом удалено для пользователя {user_id} при отмене заявки")
            except Exception as delete_error:
                logger.warning(f"⚠️ Не удалось удалить сообщение с QR-кодом для пользователя {user_id}: {delete_error}")
    
    # Останавливаем таймер если он активен
    from utils.timer import cancel_timer, active_timers
    cancel_timer(user_id)
    if user_id in active_timers:
        try:
            if hasattr(active_timers[user_id], 'cancel'):
                active_timers[user_id].cancel()
            logger.info(f"⏹️ Таймер остановлен для пользователя {user_id}")
        except Exception as e:
            logger.warning(f"⚠️ Ошибка при остановке таймера: {e}")
        if user_id in active_timers:
            del active_timers[user_id]
    
    # Очищаем состояние (FSM, user_states, pending_deposit_state)
    await state.clear()
    if user_id in user_states:
        del user_states[user_id]
    clear_pending_deposit_state(user_id)
    logger.info(f"✅ Все состояния очищены для пользователя {user_id}")
    
    # Отправляем главное меню
    await send_main_menu(message, message.from_user.first_name)

@router.message(F.text.in_([get_text('support'), "👨‍💻 Тех поддержка"]))
async def support_handler(message: Message):
    """Обработка кнопки поддержки"""
    from utils.premium_emoji import add_premium_emoji_to_text
    keyboard = get_support_keyboard(Config.SUPPORT_BOT_URL)
    support_text = "👨‍💻 <b>Техническая поддержка</b>\n\nНажмите на кнопку ниже, чтобы открыть раздел поддержки:"
    text_with_emoji, entities = add_premium_emoji_to_text(support_text, Config.PREMIUM_EMOJI_MAP)
    await message.answer(
        text_with_emoji,
        reply_markup=keyboard,
        entities=entities if entities else None
    )

@router.message(F.text == "📊 История")
async def history_handler(message: Message):
    """Обработка кнопки истории"""
    from utils.premium_emoji import add_premium_emoji_to_text
    keyboard = get_history_keyboard(Config.WEBSITE_URL)
    history_text = "📊 <b>История транзакций</b>\n\nНажмите на кнопку ниже, чтобы открыть историю ваших транзакций:"
    text_with_emoji, entities = add_premium_emoji_to_text(history_text, Config.PREMIUM_EMOJI_MAP)
    await message.answer(
        text_with_emoji,
        reply_markup=keyboard,
        entities=entities if entities else None
    )

@router.message(F.text.in_([get_text('faq'), "📖 Инструкция"]))
async def faq_handler(message: Message):
    """Обработка кнопки инструкции"""
    from utils.premium_emoji import add_premium_emoji_to_text
    keyboard = get_faq_keyboard(Config.WEBSITE_URL)
    faq_text = "📖 <b>Инструкция</b>\n\nНажмите на кнопку ниже, чтобы открыть инструкцию:"
    text_with_emoji, entities = add_premium_emoji_to_text(faq_text, Config.PREMIUM_EMOJI_MAP)
    await message.answer(
        text_with_emoji,
        reply_markup=keyboard,
        entities=entities if entities else None
    )

@router.message()
async def handle_other_messages(message: Message, state: FSMContext):
    """Обработка всех остальных сообщений"""
    try:
        user_id = message.from_user.id
        message_text = message.text or message.caption or ''
        
        # Пропускаем команды (они обрабатываются другими роутерами)
        if message_text and message_text.startswith('/'):
            return
        
        # Пропускаем кнопки главного меню (они обрабатываются другими роутерами)
        from utils.texts import get_text
        if message_text in [get_text('deposit'), get_text('withdraw'), get_text('support'), get_text('faq'), "💰 Пополнить", "💸 Вывести", "👨‍💻 Тех поддержка", "📊 История", "📖 Инструкция"]:
            return
        
        # Если нет активного диалога, но пришло фото/скрин — сообщаем, что заявки нет
        if (
            message.photo
            or (
                message.document
                and message.document.mime_type
                and message.document.mime_type.startswith('image/')
            )
        ):
            if user_id not in user_states:
                from utils.premium_emoji import add_premium_emoji_to_text
                error_text = "❌ Нет активной заявки для фото чека. Нажмите «Пополнить» и пройдите шаги заново."
                text_with_emoji, entities = add_premium_emoji_to_text(error_text, Config.PREMIUM_EMOJI_MAP)
                await message.answer(
                    text_with_emoji,
                    entities=entities if entities else None
                )
                return
        
        # Валидация входных данных
        if message_text:
            is_valid, error_msg = validate_input(message_text)
            if not is_valid:
                logger.warning(f"🚫 Invalid input from user {user_id}: {error_msg}")
                try:
                    from utils.premium_emoji import add_premium_emoji_to_text
                    warning_text = "⚠️ Сообщение содержит недопустимые символы. Пожалуйста, отправьте корректное сообщение."
                    text_with_emoji, entities = add_premium_emoji_to_text(warning_text, Config.PREMIUM_EMOJI_MAP)
                    await message.answer(text_with_emoji, entities=entities if entities else None, parse_mode=None)
                except:
                    pass
                return
            message_text = sanitize_input(message_text)
        
        # Проверяем, является ли это первым сообщением, и отправляем приветствие
        try:
            from utils.greeting import check_is_first_message, send_greeting
            from bot import bot
            
            is_first = await check_is_first_message(user_id)
            if is_first:
                logger.info(f"👋 Первое сообщение от пользователя {user_id}, отправляю приветствие")
                await send_greeting(bot, user_id, message.from_user.first_name)
        except Exception as greeting_error:
            logger.warning(f"⚠️ Ошибка при проверке/отправке приветствия (не критично): {greeting_error}")
        
        # Сохраняем сообщение в админку через API (неблокирующе)
        try:
            message_type = 'text'
            media_url = None
            
            if message.photo:
                message_type = 'photo'
                media_url = message.photo[-1].file_id
            elif message.video:
                message_type = 'video'
                media_url = message.video.file_id
            elif message.document:
                message_type = 'document'
                media_url = message.document.file_id
            elif message.voice:
                message_type = 'voice'
                media_url = message.voice.file_id
            elif message.audio:
                message_type = 'audio'
                media_url = message.audio.file_id
            elif message.sticker:
                message_type = 'sticker'
                media_url = message.sticker.file_id
            
            # Пропускаем сохранение системных сообщений
            system_messages = ["❌ Отменить заявку", "💰 Пополнить", "💸 Вывести"]
            if message_text not in system_messages:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    payload = {
                        "message_text": message_text,
                        "message_type": message_type,
                        "media_url": media_url,
                        "telegram_message_id": message.message_id
                    }
                    response = await client.post(
                        f"{Config.API_URL}/api/users/{user_id}/chat/ingest",
                        json=payload,
                        headers={"Content-Type": "application/json"}
                    )
                    
                    if response.status_code == 200:
                        try:
                            response_data = response.json()
                            if response_data.get('success'):
                                logger.info(f"✅ Сообщение от пользователя {user_id} сохранено в чат")
                        except Exception:
                            pass
        except Exception as e:
            logger.warning(f"⚠️ Ошибка при сохранении сообщения в чат (не критично): {e}")
    except Exception as main_error:
        logger.error(f"❌ Критическая ошибка в handle_other_messages для пользователя {user_id}: {main_error}", exc_info=True)
        # Не отправляем сообщение об ошибке, чтобы не спамить пользователя


