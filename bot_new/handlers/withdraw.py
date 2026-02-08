"""
Обработчики для выводов
"""

import logging
import base64
import httpx
from aiogram import Router, F
from aiogram.types import Message
from aiogram.fsm.context import FSMContext
from states import WithdrawStates
from config import Config
from utils.texts import get_text, get_casino_name, get_text_with_premium_emoji
from utils.premium_emoji import add_premium_emoji_to_text
from utils.answer_helper import answer_with_text, answer_with_custom_text
from utils.keyboards import get_casino_keyboard, get_cancel_keyboard
from utils.settings import load_settings, get_settings
from utils.qr_generator import get_casino_id_image_path
from handlers.deposit import user_states, ALL_CASINOS

logger = logging.getLogger(__name__)
router = Router()

async def get_photo_base64(file_id: str) -> str:
    """Получает фото из Telegram и конвертирует в base64"""
    try:
        from bot import bot
        from io import BytesIO
        file = await bot.get_file(file_id)
        # В aiogram 3 используем bot.download() который возвращает BytesIO
        file_data = BytesIO()
        await bot.download(file, destination=file_data)
        file_data.seek(0)
        base64_data = base64.b64encode(file_data.read()).decode('utf-8')
        return f"data:image/jpeg;base64,{base64_data}"
    except Exception as e:
        logger.error(f"❌ Ошибка при получении фото: {e}", exc_info=True)
        raise

@router.message(F.text.in_([get_text('withdraw'), "💸 Вывести"]))
async def start_withdraw(message: Message, state: FSMContext):
    """Начало процесса вывода"""
    user_id = message.from_user.id
    
    # Загружаем настройки
    import asyncio
    settings = get_settings()
    if asyncio.get_event_loop().time() - settings.get('last_update', 0) > 300:
        await load_settings()
        settings = get_settings()
    
    # Проверяем паузу
    if settings.get('pause', False):
        maintenance_message = settings.get('maintenance_message', 'Технические работы. Попробуйте позже.')
        pause_text = f"⏸️ <b>Бот на паузе</b>\n\n{maintenance_message}"
        text_with_emoji, entities = add_premium_emoji_to_text(pause_text, Config.PREMIUM_EMOJI_MAP)
        await message.answer(text_with_emoji, entities=entities if entities else None)
        return
    
    # Проверяем, включены ли выводы
    if not settings.get('withdrawals_enabled', True):
        await answer_with_text(message, 'withdraw_disabled')
        return
    
    # Начинаем диалог вывода
    user_states[user_id] = {
        'step': 'withdraw_bookmaker',
        'data': {}
    }
    await state.set_state(WithdrawStates.bookmaker)
    
    # Фильтруем доступные казино
    enabled_casinos = []
    for casino_key, casino_name in ALL_CASINOS:
        is_enabled = settings.get('casinos', {}).get(casino_key, True)
        if is_enabled:
            enabled_casinos.append((casino_key, casino_name))
    
    reply_markup = get_casino_keyboard(enabled_casinos)
    withdraw_text = "💸 <b>Вывод средств</b>\n\nВыберите казино:"
    text_with_emoji, entities = add_premium_emoji_to_text(withdraw_text, Config.PREMIUM_EMOJI_MAP)
    await message.answer(text_with_emoji, reply_markup=reply_markup, entities=entities if entities else None)

@router.message(WithdrawStates.bookmaker)
async def process_withdraw_bookmaker(message: Message, state: FSMContext):
    """Обработка выбора казино для вывода"""
    user_id = message.from_user.id
    message_text = message.text or ''
    
    # Проверка на отмену заявки
    if message_text and ("отменить заявку" in message_text.lower() or message_text.strip() == "❌ Отменить заявку"):
        from handlers.messages import cancel_request_text
        await cancel_request_text(message, state)
        return
    
    if user_id not in user_states:
        await answer_with_custom_text(message, "❌ Ошибка. Начните заново с /start")
        return
    
    # Определяем казино
    bookmaker_map = {
        '1XBET': '1xbet',
        '1WIN': '1win',
        'MELBET': 'melbet',
        'MOSTBET': 'mostbet',
        'WINWIN': 'winwin',
        '888STARZ': '888starz'
    }
    
    bookmaker = bookmaker_map.get(message_text)
    if not bookmaker:
        await answer_with_text(message, 'please_select_from_buttons')
        return
    
    # Проверяем настройки букмекера
    settings = get_settings()
    bookmaker_settings = settings.get('bookmaker_settings', {})
    bookmaker_key = bookmaker.lower()
    bookmaker_withdraw_enabled = True
    
    if bookmaker_settings and bookmaker_key in bookmaker_settings:
        bookmaker_withdraw_enabled = bookmaker_settings[bookmaker_key].get('withdraw_enabled', True)
    
    if not bookmaker_withdraw_enabled:
        casino_name = get_casino_name(bookmaker)
        await answer_with_custom_text(message, f"❌ Выводы для {casino_name} временно недоступны. Попробуйте позже или выберите другое казино.")
        return
    
    user_states[user_id]['data']['bookmaker'] = bookmaker
    user_states[user_id]['step'] = 'withdraw_phone'
    await state.set_state(WithdrawStates.phone)
    
    # Получаем сохраненный номер телефона
    saved_phone = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{Config.API_URL}/api/public/casino-account",
                params={"user_id": str(user_id), "casino_id": "phone"}
            )
            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    phone_value = result.get('data', {}).get('phone')
                    if phone_value and phone_value != 'null' and phone_value != '':
                        saved_phone = str(phone_value).strip()
    except Exception as e:
        logger.warning(f"Не удалось получить сохраненный телефон: {e}")
    
    # Создаем клавиатуру
    from aiogram.types import ReplyKeyboardMarkup, KeyboardButton
    keyboard_buttons = []
    if saved_phone:
        keyboard_buttons.append([KeyboardButton(text=saved_phone)])
    keyboard_buttons.append([KeyboardButton(text="❌ Отменить заявку")])
    reply_markup = ReplyKeyboardMarkup(keyboard=keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)
    
    casino_name = get_casino_name(bookmaker)
    withdraw_title = get_text('withdraw_title')
    casino_label = get_text('casino_label', casino_name=casino_name)
    enter_phone = get_text('enter_phone')
    await message.answer(f"{withdraw_title}\n\n{casino_label}\n\n{enter_phone}", reply_markup=reply_markup)

@router.message(WithdrawStates.phone)
async def process_withdraw_phone(message: Message, state: FSMContext):
    """Обработка телефона"""
    user_id = message.from_user.id
    message_text = message.text or ''
    
    if user_id not in user_states:
        await answer_with_custom_text(message, "❌ Ошибка. Начните заново с /start")
        return
    
    phone = message_text.strip()
    
    # Проверка формата телефона
    if not phone.startswith('+996'):
        await answer_with_text(message, 'invalid_phone')
        return
    
    if len(phone) < 13 or len(phone) > 16:
        await answer_with_text(message, 'invalid_phone_length')
        return
    
    # Сохраняем телефон
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{Config.API_URL}/api/public/casino-account",
                json={
                    "user_id": str(user_id),
                    "casino_id": "phone",
                    "account_id": phone
                },
                headers={"Content-Type": "application/json"}
            )
    except Exception as e:
        logger.warning(f"Не удалось сохранить телефон через API: {e}")
    
    user_states[user_id]['data']['phone'] = phone
    user_states[user_id]['step'] = 'withdraw_qr'
    await state.set_state(WithdrawStates.qr_photo)
    
    reply_markup = get_cancel_keyboard()
    casino_name = get_casino_name(user_states[user_id]['data'].get('bookmaker', ''))
    withdraw_title = get_text('withdraw_title')
    casino_label = get_text('casino_label', casino_name=casino_name)
    phone_label = get_text('phone_label', phone=phone)
    send_qr = get_text('send_qr_code')
    menu_text = f"{withdraw_title}\n\n{casino_label}\n{phone_label}\n\n{send_qr}"
    text_with_emoji, entities = add_premium_emoji_to_text(menu_text, Config.PREMIUM_EMOJI_MAP)
    all_entities = list(title_entities) if title_entities else []
    if entities:
        all_entities.extend(entities)
    await message.answer(text_with_emoji, reply_markup=reply_markup, entities=all_entities if all_entities else None)

@router.message(WithdrawStates.qr_photo, F.photo | F.document)
async def process_withdraw_qr(message: Message, state: FSMContext):
    """Обработка QR-кода"""
    user_id = message.from_user.id
    
    # Проверка на отмену заявки (если пришло текстовое сообщение вместо фото)
    if message.text and ("отменить заявку" in message.text.lower() or message.text.strip() == "❌ Отменить заявку"):
        from handlers.messages import cancel_request_text
        await cancel_request_text(message, state)
        return
    
    if user_id not in user_states:
        await answer_with_custom_text(message, "❌ Ошибка. Начните заново с /start")
        return
    
    # Получаем фото
    photo_file_id = None
    if message.photo:
        photo_file_id = message.photo[-1].file_id
    elif message.document and message.document.mime_type and message.document.mime_type.startswith('image/'):
        photo_file_id = message.document.file_id
    
    if not photo_file_id:
        await answer_with_text(message, 'please_send_qr')
        return
    
    user_states[user_id]['data']['qr_photo_id'] = photo_file_id
    user_states[user_id]['step'] = 'withdraw_player_id'
    await state.set_state(WithdrawStates.player_id)
    
    # Получаем сохраненный ID
    saved_id = user_states[user_id]['data'].get('saved_player_ids', {}).get(user_states[user_id]['data']['bookmaker'], '')
    if not saved_id:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{Config.API_URL}/api/public/casino-account",
                    params={"user_id": str(user_id), "casino_id": user_states[user_id]['data']['bookmaker'].lower()}
                )
                if response.status_code == 200:
                    result = response.json()
                    if result.get('success') and result.get('data', {}).get('accountId'):
                        saved_id = result.get('data', {}).get('accountId')
                        if 'saved_player_ids' not in user_states[user_id]['data']:
                            user_states[user_id]['data']['saved_player_ids'] = {}
                        user_states[user_id]['data']['saved_player_ids'][user_states[user_id]['data']['bookmaker']] = saved_id
        except Exception as e:
            logger.warning(f"Не удалось получить сохраненный ID из API: {e}")
    
    # Создаем клавиатуру
    from aiogram.types import ReplyKeyboardMarkup, KeyboardButton
    keyboard_buttons = []
    if saved_id and saved_id != 'None' and saved_id != 'null' and str(saved_id).strip():
        keyboard_buttons.append([KeyboardButton(text=str(saved_id).strip())])
    keyboard_buttons.append([KeyboardButton(text="❌ Отменить заявку")])
    reply_markup = ReplyKeyboardMarkup(keyboard=keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)
    
    casino_name = get_casino_name(user_states[user_id]['data'].get('bookmaker', ''))
    withdraw_title = get_text('withdraw_title')
    casino_label = get_text('casino_label', casino_name=casino_name)
    phone_label = get_text('phone_label', phone=user_states[user_id]['data'].get('phone', ''))
    qr_received = get_text('qr_received')
    enter_account_id = get_text('enter_account_id')
    
    message_text = f"{withdraw_title}\n\n{casino_label}\n{phone_label}\n{qr_received}\n\n{enter_account_id}"
    
    # Пытаемся отправить фото с примером ID
    casino_image_path = get_casino_id_image_path(user_states[user_id]['data'].get('bookmaker', ''))
    if casino_image_path:
        try:
            from aiogram.types import FSInputFile
            photo = FSInputFile(casino_image_path)
            await message.answer_photo(photo=photo, caption=message_text, reply_markup=reply_markup)
        except Exception as e:
            logger.warning(f"⚠️ Не удалось отправить фото ID казино: {e}")
            await message.answer(message_text, reply_markup=reply_markup)
    else:
        await message.answer(message_text, reply_markup=reply_markup)

@router.message(WithdrawStates.player_id)
async def process_withdraw_player_id(message: Message, state: FSMContext):
    """Обработка ID игрока для вывода"""
    user_id = message.from_user.id
    message_text = message.text or ''
    
    # Проверка на отмену заявки
    if message_text and ("отменить заявку" in message_text.lower() or message_text.strip() == "❌ Отменить заявку"):
        from handlers.messages import cancel_request_text
        await cancel_request_text(message, state)
        return
    
    if user_id not in user_states:
        await answer_with_custom_text(message, "❌ Ошибка. Начните заново с /start")
        return
    
    if not message_text.strip().isdigit():
        await answer_with_text(message, 'invalid_player_id_format')
        return
    
    player_id = message_text.strip()
    
    # Сохраняем ID
    if 'saved_player_ids' not in user_states[user_id]['data']:
        user_states[user_id]['data']['saved_player_ids'] = {}
    user_states[user_id]['data']['saved_player_ids'][user_states[user_id]['data']['bookmaker']] = player_id
    
    # Сохраняем через API
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{Config.API_URL}/api/public/casino-account",
                json={
                    "user_id": str(user_id),
                    "casino_id": user_states[user_id]['data']['bookmaker'].lower(),
                    "account_id": player_id
                },
                headers={"Content-Type": "application/json"}
            )
    except Exception as e:
        logger.warning(f"Не удалось сохранить ID через API: {e}")
    
    user_states[user_id]['data']['player_id'] = player_id
    user_states[user_id]['step'] = 'withdraw_code'
    await state.set_state(WithdrawStates.code)
    
    reply_markup = get_cancel_keyboard()
    
    # Определяем адрес
    bookmaker_lower = user_states[user_id]['data']['bookmaker'].lower()
    if '1xbet' in bookmaker_lower or '1x' in bookmaker_lower:
        address_text = "tsum lux"
    else:
        address_text = "Lux on 24/7"
    
    casino_name = get_casino_name(user_states[user_id]['data'].get('bookmaker', ''))
    withdraw_title = get_text('withdraw_title')
    casino_label = get_text('casino_label', casino_name=casino_name)
    phone_label = get_text('phone_label', phone=user_states[user_id]['data'].get('phone', ''))
    account_id_label = f"🆔 ID игрока: {user_states[user_id]['data'].get('player_id', '')}"
    
    instruction_text = f"""{withdraw_title}

{casino_label}
{phone_label}
{account_id_label}

📍 Заходим👇🏻
📍1. Настройки!
📍2. Вывести со счета!
📍3. Касса
📍4. Сумму для Вывода!
📍(Город Бишкек, улица: {address_text})
📍5. Подтвердить
📍6. Получить Код!
📍7. Отправить его нам"""
    
    await message.answer(instruction_text, reply_markup=reply_markup)

@router.message(WithdrawStates.code)
async def process_withdraw_code(message: Message, state: FSMContext):
    """Обработка кода вывода"""
    user_id = message.from_user.id
    message_text = message.text or ''
    
    # Проверка на отмену заявки
    if message_text and ("отменить заявку" in message_text.lower() or message_text.strip() == "❌ Отменить заявку"):
        from handlers.messages import cancel_request_text
        await cancel_request_text(message, state)
        return
    
    if user_id not in user_states:
        await answer_with_custom_text(message, "❌ Ошибка. Начните заново с /start")
        return
    
    if not message_text.strip():
        await answer_with_text(message, 'invalid_code_empty')
        return
    
    withdrawal_code = message_text.strip()
    user_states[user_id]['data']['code'] = withdrawal_code
    
    # Проверяем код и получаем сумму
    checking_text, checking_entities = get_text_with_premium_emoji('checking_code')
    checking_msg = await message.answer(checking_text, entities=checking_entities if checking_entities else None)
    withdraw_amount = 0
    amount_check_ok = True
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{Config.API_URL}/api/withdraw-check",
                json={
                    "bookmaker": user_states[user_id]['data']['bookmaker'],
                    "playerId": user_states[user_id]['data']['player_id'],
                    "code": withdrawal_code
                }
            )
            
            try:
                await checking_msg.delete()
            except:
                pass
            
            try:
                result = response.json()
                logger.info(f"Ответ проверки суммы (статус {response.status_code}): {result}")
            except Exception as json_error:
                logger.error(f"Ошибка парсинга JSON ответа: {json_error}")
                amount_check_ok = False
                await answer_with_custom_text(message, "⚠️ Не удалось проверить сумму вывода. Попробуйте еще раз.")
            
            if response.status_code == 200 and amount_check_ok:
                if result.get('success'):
                    data_obj = result.get('data', {})
                    amount_value = (
                        data_obj.get('amount') or 
                        data_obj.get('summa') or 
                        result.get('amount') or 
                        result.get('summa')
                    )
                    
                    if amount_value is not None:
                        try:
                            withdraw_amount = float(amount_value)
                            if withdraw_amount <= 0:
                                amount_check_ok = False
                                await answer_with_custom_text(message, "⚠️ Сумма вывода не найдена. Проверьте код и попробуйте ещё раз.")
                            else:
                                logger.info(f"✅ Сумма вывода успешно получена: {withdraw_amount} KGS. Отправляю заявку в админку...")
                        except (ValueError, TypeError) as e:
                            logger.error(f"Ошибка парсинга суммы: {e}, значение: {amount_value}")
                            amount_check_ok = False
                            await answer_with_custom_text(message, "⚠️ Ошибка при обработке суммы вывода. Попробуйте ещё раз.")
                    else:
                        amount_check_ok = False
                        error_message = result.get('error') or result.get('message') or 'Не удалось получить сумму вывода'
                        logger.warning(f"⚠️ API withdraw-check вернул ошибку: {error_message}")
                        await answer_with_custom_text(message, f"⚠️ {error_message}")
                else:
                    amount_check_ok = False
                    error_message = result.get('error') or result.get('message') or 'Не удалось проверить код вывода'
                    await message.answer(f"⚠️ {error_message}")
            elif amount_check_ok:
                amount_check_ok = False
                error_message = result.get('error') or result.get('message') or f'Ошибка сервера (статус {response.status_code})'
                await message.answer(f"⚠️ {error_message}")
    except Exception as e:
        logger.error(f"Ошибка проверки суммы вывода: {e}")
        amount_check_ok = False
        await message.answer("⚠️ Не удалось проверить сумму вывода. Попробуйте еще раз.")
    
    if not amount_check_ok:
        if user_id in user_states:
            del user_states[user_id]
        await state.clear()
        from handlers.start import send_main_menu
        await send_main_menu(message, message.from_user.first_name)
        return
    
    # Отправляем заявку на вывод (только если сумма успешно получена)
    logger.info(f"📤 Отправляю заявку на вывод в админку для пользователя {user_id}, сумма: {withdraw_amount} KGS")
    await submit_withdraw_request(message, user_id, user_states[user_id]['data'], withdraw_amount)
    
    # Очищаем состояние
    if user_id in user_states:
        del user_states[user_id]
    await state.clear()

async def submit_withdraw_request(message: Message, user_id: int, data: dict, withdraw_amount: float) -> None:
    """Отправляет заявку на вывод"""
    try:
        import base64
        
        # Получаем фото QR кода в base64
        qr_photo_base64 = None
        if 'qr_photo_id' in data:
            from bot import bot
            qr_photo_base64 = await get_photo_base64(data['qr_photo_id'])
        
        bookmaker = data['bookmaker']
        normalized_bookmaker = bookmaker.lower()
        
        # Для 1xbet сначала выполняем вывод через withdraw-execute
        if '1xbet' in normalized_bookmaker:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    execute_response = await client.post(
                        f"{Config.API_URL}/api/withdraw-execute",
                        json={
                            "bookmaker": bookmaker,
                            "playerId": data['player_id'],
                            "code": data['code'],
                            "amount": withdraw_amount
                        },
                        headers={"Content-Type": "application/json"}
                    )
                    
                    try:
                        execute_result = execute_response.json()
                        logger.info(f"Ответ withdraw-execute (статус {execute_response.status_code}): {execute_result}")
                    except Exception as json_error:
                        logger.error(f"Ошибка парсинга JSON ответа withdraw-execute: {json_error}")
                        await answer_with_text(message, 'withdraw_execute_failed')
                        from handlers.start import send_main_menu
                        await send_main_menu(message, message.from_user.first_name)
                        return
                    
                    if execute_response.status_code != 200:
                        error_msg = execute_result.get('error') or execute_result.get('message') or f"Ошибка выполнения вывода: {execute_response.status_code}"
                        await answer_with_custom_text(message, f"❌ {error_msg}")
                        from handlers.start import send_main_menu
                        await send_main_menu(message, message.from_user.first_name)
                        return
                    
                    if not execute_result.get('success'):
                        error_msg = execute_result.get('message') or execute_result.get('error') or 'Ошибка выполнения вывода'
                        await answer_with_custom_text(message, f"❌ {error_msg}")
                        from handlers.start import send_main_menu
                        await send_main_menu(message, message.from_user.first_name)
                        return
            except Exception as e:
                logger.error(f"Ошибка выполнения вывода для 1xbet: {e}")
                await answer_with_custom_text(message, "❌ Ошибка выполнения вывода. Попробуйте еще раз.")
                from handlers.start import send_main_menu
                await send_main_menu(message, message.from_user.first_name)
                return
        
        # Создаем заявку
        user = message.from_user
        bank = data.get('bank') or 'odengi'
        request_body = {
            "type": "withdraw",
            "telegram_user_id": str(user_id),
            "userId": str(user_id),
            "amount": withdraw_amount,
            "bookmaker": bookmaker,
            "bank": bank,
            "phone": data['phone'],
            "account_id": data['player_id'],
            "playerId": data['player_id'],
            "telegram_username": user.username,
            "telegram_first_name": user.first_name,
            "telegram_last_name": user.last_name,
            "qr_photo": qr_photo_base64,
            "site_code": data['code'],
            "source": "bot"
        }
        
        logger.info(f"📤 Отправляю заявку на вывод в /api/payment: bookmaker={bookmaker}, amount={withdraw_amount}, playerId={data['player_id']}, phone={data['phone']}")
        async with httpx.AsyncClient(timeout=10.0) as client:
            payment_response = await client.post(
                f"{Config.API_URL}/api/payment",
                json=request_body,
                headers={"Content-Type": "application/json"}
            )
            
            try:
                result = payment_response.json()
                logger.info(f"✅ Ответ API payment (статус {payment_response.status_code}): success={result.get('success')}, request_id={result.get('data', {}).get('id')}")
            except Exception as json_error:
                logger.error(f"Ошибка парсинга JSON ответа payment: {json_error}")
                await answer_with_text(message, 'request_creation_error')
                from handlers.start import send_main_menu
                await send_main_menu(message, message.from_user.first_name)
                return
            
            if payment_response.status_code == 200:
                if result.get('success') is False:
                    error_message = result.get('error') or 'Неизвестная ошибка'
                    await message.answer(f'❌ {error_message}')
                    from handlers.start import send_main_menu
                    await send_main_menu(message, message.from_user.first_name)
                    return
                
                request_id = result.get('data', {}).get('id')
                if request_id:
                    casino_name = get_casino_name(data.get('bookmaker', ''))
                    success_message = get_text(
                        'withdrawal_request_sent',
                        account_id=data.get('player_id', ''),
                        phone=data.get('phone', ''),
                        casino_name=casino_name
                    )
                    await message.answer(success_message)
                    
                    # Сохраняем ID сообщения в заявке
                    if message.message_id:
                        try:
                            async with httpx.AsyncClient(timeout=5.0) as client2:
                                await client2.patch(
                                    f"{Config.API_URL}/api/requests/{request_id}",
                                    json={"telegram_message_id": message.message_id}
                                )
                        except Exception as e:
                            logger.warning(f"Не удалось сохранить ID сообщения: {e}")
                else:
                    await answer_with_text(message, 'error_creating_withdraw')
            else:
                error_message = result.get('error') or result.get('message') or f'Ошибка создания заявки ({payment_response.status_code})'
                await message.answer(f'❌ {error_message}')
        
        # Показываем главное меню
        from handlers.start import send_main_menu
        await send_main_menu(message, message.from_user.first_name)
                
    except Exception as e:
        logger.error(f"Ошибка создания заявки на вывод: {e}")
        error_msg = str(e).lower()
        if 'connection' in error_msg or 'connect' in error_msg or 'refused' in error_msg:
            await answer_with_custom_text(message, '❌ Сервер недоступен. Пожалуйста, убедитесь, что админ-панель запущена.')
        else:
            await answer_with_custom_text(message, '❌ Ошибка создания заявки. Попробуйте еще раз.')
        
        from handlers.start import send_main_menu
        await send_main_menu(message, message.from_user.first_name)

