"""
Обработчики для депозитов
"""

import logging
import asyncio
import random
import base64
import httpx
from aiogram import Router, F
from aiogram.types import Message
from aiogram.fsm.context import FSMContext
from aiogram.enums import ParseMode
from states import DepositStates
from config import Config
from utils.texts import get_text, get_casino_name, get_text_with_premium_emoji
from utils.premium_emoji import add_premium_emoji_to_text
from utils.answer_helper import answer_with_text, answer_with_custom_text
from utils.keyboards import get_casino_keyboard, get_amount_keyboard, get_cancel_keyboard, get_bank_keyboard
from utils.settings import load_settings, get_settings
from utils.qr_generator import generate_qr_image, get_casino_id_image_path
from utils.state_manager import set_pending_deposit_state, clear_pending_deposit_state, get_pending_deposit_state
from utils.timer import update_timer, cancel_timer, active_timers
# bot будет импортирован позже, когда он будет создан

logger = logging.getLogger(__name__)
router = Router()

# Глобальное хранилище состояний (в памяти, как в старом боте)
user_states = {}

ALL_CASINOS = [
    ('1xbet', '1XBET'),
    ('1win', '1WIN'),
    ('melbet', 'MELBET'),
    ('mostbet', 'MOSTBET'),
    ('winwin', 'WINWIN'),
    ('888starz', '888STARZ')
]

@router.message(F.text.in_([get_text('deposit'), "💰 Пополнить"]))
async def start_deposit(message: Message, state: FSMContext):
    """Начало процесса депозита"""
    try:
        user_id = message.from_user.id
        
        # Загружаем настройки
        try:
            settings = get_settings()
            if asyncio.get_event_loop().time() - settings.get('last_update', 0) > 300:
                await load_settings()
                settings = get_settings()
        except Exception as settings_error:
            logger.error(f"❌ Ошибка при загрузке настроек: {settings_error}")
            settings = get_settings()  # Используем кэшированные настройки
        
        # Проверяем паузу
        try:
            if settings.get('pause', False):
                from utils.premium_emoji import add_premium_emoji_to_text
                maintenance_message = settings.get('maintenance_message', 'Технические работы. Попробуйте позже.')
                pause_text = f"⏸️ <b>Бот на паузе</b>\n\n{maintenance_message}"
                text_with_emoji, entities = add_premium_emoji_to_text(pause_text, Config.PREMIUM_EMOJI_MAP)
                await message.answer(text_with_emoji, entities=entities if entities else None)
                return
        except Exception as pause_error:
            logger.error(f"❌ Ошибка при проверке паузы: {pause_error}")
        
        # Проверяем, включены ли депозиты
        try:
            if not settings.get('deposits_enabled', True):
                text, entities = get_text_with_premium_emoji('deposit_disabled')
                await message.answer(text, entities=entities if entities else None)
                return
        except Exception as deposit_check_error:
            logger.error(f"❌ Ошибка при проверке депозитов: {deposit_check_error}")
        
        # Проверяем, есть ли у пользователя активная заявка на пополнение
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{Config.API_URL}/api/public/check-pending-deposit",
                    params={
                        "userId": str(user_id)
                    },
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    result = response.json()
                    if result.get('success') and result.get('data'):
                        has_pending = result.get('data', {}).get('hasPending', False)
                        if has_pending:
                            # У пользователя есть активная заявка на пополнение
                            from utils.premium_emoji import add_premium_emoji_to_text
                            warning_text = "⚠️ У вас есть ожидающая заявка на пополнение. Дождитесь обработки текущей заявки перед созданием новой."
                            text_with_emoji, entities = add_premium_emoji_to_text(warning_text, Config.PREMIUM_EMOJI_MAP)
                            await message.answer(text_with_emoji, entities=entities if entities else None)
                            return
        except Exception as check_error:
            logger.warning(f"⚠️ Не удалось проверить активные заявки: {check_error}")
            # Продолжаем работу, если проверка не удалась
        
        # Начинаем диалог пополнения
        try:
            user_states[user_id] = {
                'step': 'deposit_bookmaker',
                'data': {}
            }
            await state.set_state(DepositStates.bookmaker)
            
            # Фильтруем доступные казино
            enabled_casinos = []
            for casino_key, casino_name in ALL_CASINOS:
                is_enabled = settings.get('casinos', {}).get(casino_key, True)
                if is_enabled:
                    enabled_casinos.append((casino_key, casino_name))
            
            reply_markup = get_casino_keyboard(enabled_casinos)
            
            deposit_title, title_entities = get_text_with_premium_emoji('deposit_title')
            select_casino = get_text('select_casino')
            menu_text = f"{deposit_title}\n\n{select_casino}"
            # Применяем премиум эмодзи ко всему тексту (включая select_casino)
            text_with_emoji, entities = add_premium_emoji_to_text(menu_text, Config.PREMIUM_EMOJI_MAP)
            # Объединяем entities: сначала из deposit_title, затем из общего текста
            all_entities = list(title_entities) if title_entities else []
            # Добавляем entities из общего текста, исключая те, что уже есть в title_entities
            if entities:
                for entity in entities:
                    # Проверяем, не пересекается ли entity с title_entities
                    overlaps = False
                    if title_entities:
                        title_end = max(e.offset + e.length for e in title_entities) if title_entities else 0
                        if entity.offset < title_end:
                            overlaps = True
                    if not overlaps:
                        all_entities.append(entity)
            await message.answer(text_with_emoji, reply_markup=reply_markup, entities=all_entities if all_entities else None)
        except Exception as e:
            logger.error(f"❌ Ошибка при начале депозита для пользователя {user_id}: {e}", exc_info=True)
            try:
                await answer_with_custom_text(message, "❌ Произошла ошибка. Попробуйте еще раз или напишите /start")
            except:
                pass
    except Exception as main_error:
        logger.error(f"❌ Критическая ошибка в start_deposit: {main_error}", exc_info=True)
        try:
            await message.answer("❌ Произошла ошибка. Попробуйте еще раз или напишите /start")
        except:
            pass

@router.message(DepositStates.bookmaker)
async def process_bookmaker(message: Message, state: FSMContext):
    """Обработка выбора казино"""
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
    
    # Определяем казино по тексту кнопки
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
    bookmaker_deposit_enabled = True
    
    if bookmaker_settings and bookmaker_key in bookmaker_settings:
        bookmaker_deposit_enabled = bookmaker_settings[bookmaker_key].get('deposit_enabled', True)
    
    if not bookmaker_deposit_enabled:
        casino_name = get_casino_name(bookmaker)
        await answer_with_custom_text(message, f"❌ Пополнения для {casino_name} временно недоступны. Попробуйте позже или выберите другое казино.")
        return
    
    user_states[user_id]['data']['bookmaker'] = bookmaker
    user_states[user_id]['step'] = 'deposit_player_id'
    await state.set_state(DepositStates.player_id)
    
    # Получаем сохраненный ID
    saved_id = user_states[user_id]['data'].get('saved_player_ids', {}).get(bookmaker, '')
    if not saved_id:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(
                    f"{Config.API_URL}/api/public/casino-account",
                    params={"user_id": str(user_id), "casino_id": bookmaker.lower()}
                )
                if response.status_code == 200:
                    result = response.json()
                    if result.get('success') and result.get('data', {}).get('accountId'):
                        saved_id = result.get('data', {}).get('accountId')
                        if 'saved_player_ids' not in user_states[user_id]['data']:
                            user_states[user_id]['data']['saved_player_ids'] = {}
                        user_states[user_id]['data']['saved_player_ids'][bookmaker] = saved_id
        except Exception as e:
            logger.warning(f"Не удалось получить сохраненный ID из API: {e}")
    
    # Создаем клавиатуру
    keyboard_buttons = []
    if saved_id:
        keyboard_buttons.append([saved_id])
    keyboard_buttons.append(["❌ Отменить заявку"])
    reply_markup = get_cancel_keyboard()
    if saved_id:
        from aiogram.types import ReplyKeyboardMarkup, KeyboardButton
        reply_markup = ReplyKeyboardMarkup(
            keyboard=[[KeyboardButton(text=saved_id)], [KeyboardButton(text="❌ Отменить заявку")]],
            resize_keyboard=True, one_time_keyboard=False
        )
    
    casino_name = get_casino_name(bookmaker)
    deposit_title = get_text('deposit_title')
    casino_label = get_text('casino_label', casino_name=casino_name)
    enter_player_id = get_text('enter_player_id')
    
    message_text = f"{deposit_title}\n\n{casino_label}\n\n{enter_player_id}"
    
    # Пытаемся отправить фото с примером ID
    casino_image_path = get_casino_id_image_path(bookmaker)
    if casino_image_path:
        try:
            from aiogram.types import FSInputFile
            photo = FSInputFile(casino_image_path)
            await message.answer_photo(photo=photo, caption=message_text, reply_markup=reply_markup)
        except Exception as e:
            logger.warning(f"⚠️ Не удалось отправить фото ID казино {bookmaker}: {e}")
            await message.answer(message_text, reply_markup=reply_markup)
    else:
        await message.answer(message_text, reply_markup=reply_markup)

@router.message(DepositStates.player_id)
async def process_player_id(message: Message, state: FSMContext):
    """Обработка ID игрока"""
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
    user_states[user_id]['step'] = 'deposit_amount'
    await state.set_state(DepositStates.amount)
    
    reply_markup = get_amount_keyboard()
    
    deposit_title = get_text('deposit_title')
    deposit_amount_prompt = get_text('deposit_amount_prompt')
    bookmaker = user_states[user_id]['data'].get('bookmaker', '').lower()
    if bookmaker == '1win':
        min_amount_value = 100
    elif bookmaker == 'mostbet':
        min_amount_value = 400
    else:
        min_amount_value = 35
    max_amount_value = 500000
    min_amount = get_text('min_amount', min=min_amount_value)
    max_amount = f"Максимум: {max_amount_value:,} KGS".replace(',', ' ')
    await message.answer(f"{deposit_title}\n\n{min_amount}\n{max_amount}\n\n{deposit_amount_prompt}", reply_markup=reply_markup)

@router.message(DepositStates.amount)
async def process_amount(message: Message, state: FSMContext):
    """Обработка суммы"""
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
    
    # Проверяем сумму
    if message_text in ["100", "200", "500", "1000", "2000", "5000", "10000"]:
        amount = float(message_text)
    else:
        try:
            amount = float(message_text.replace(',', '.').strip())
        except ValueError:
            await answer_with_text(message, 'invalid_amount_format_deposit')
            return
    
    bookmaker = user_states[user_id]['data'].get('bookmaker', '').lower()
    if bookmaker == '1win':
        min_amount_value = 100
    elif bookmaker == 'mostbet':
        min_amount_value = 400
    else:
        min_amount_value = 35
    max_amount_value = 500000
    
    if amount < min_amount_value or amount > max_amount_value:
        await answer_with_custom_text(message, f"❌ Сумма должна быть от {min_amount_value} до {max_amount_value:,} сом".replace(',', ' '))
        return
    
    # Добавляем случайные копейки
    base_amount = int(amount)
    random_kopecks = random.randint(1, 99)
    amount = base_amount + (random_kopecks / 100)
    logger.info(f"💰 Сгенерированы случайные копейки: {random_kopecks}, итоговая сумма: {amount}")
    
    user_states[user_id]['data']['amount'] = amount
    user_states[user_id]['step'] = 'deposit_bank'
    await state.set_state(DepositStates.bank)
    
    # Отправляем сообщение о генерации QR (очищаем клавиатуру)
    from aiogram.types import ReplyKeyboardRemove
    qr_text, qr_entities = get_text_with_premium_emoji('qr_generating')
    generating_text = f"⏳ {qr_text}"
    text_with_emoji, entities = add_premium_emoji_to_text(generating_text, Config.PREMIUM_EMOJI_MAP)
    all_entities = list(qr_entities) if qr_entities else []
    if entities:
        all_entities.extend(entities)
    generating_message = await message.answer(text_with_emoji, reply_markup=ReplyKeyboardRemove(), entities=all_entities if all_entities else None)
    
    # Получаем QR ссылки
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            qr_response = await client.post(
                f"{Config.API_URL}/api/public/generate-qr",
                json={
                    "amount": amount,
                    "playerId": user_states[user_id]['data']['player_id'],
                    "bank": "demirbank"
                },
                headers={"Content-Type": "application/json"}
            )
            
            if qr_response.status_code == 200:
                qr_data = qr_response.json()
                if qr_data.get('success'):
                    adjusted_amount = qr_data.get('amount', amount)
                    if adjusted_amount != amount:
                        amount = adjusted_amount
                        user_states[user_id]['data']['amount'] = amount
                    
                    bank_links = qr_data.get('all_bank_urls', {})
                    timer_seconds = 300
                    
                    minutes = timer_seconds // 60
                    seconds = timer_seconds % 60
                    timer_text = f"{minutes}:{seconds:02d}"
                    
                    # Загружаем настройки
                    settings = get_settings()
                    if asyncio.get_event_loop().time() - settings.get('last_update', 0) > 300:
                        await load_settings()
                        settings = get_settings()
                    
                    enabled_banks = settings.get('deposit_banks', [])
                    reply_markup = get_bank_keyboard(bank_links, enabled_banks)
                    
                    if not reply_markup.inline_keyboard or len(reply_markup.inline_keyboard) == 0:
                        await generating_message.delete()
                        await answer_with_custom_text(message, "❌ Не удалось получить ссылки для оплаты. Обратитесь в поддержку.")
                        return
                    
                    # Генерируем QR-код
                    omoney_url = bank_links.get('O!Money') or bank_links.get('omoney') or (list(bank_links.values())[0] if bank_links else None)
                    qr_image = None
                    if omoney_url:
                        qr_image = await generate_qr_image(omoney_url, user_states[user_id]['data'].get('bookmaker', ''))
                    
                    casino_name = get_casino_name(user_states[user_id]['data'].get('bookmaker', ''))
                    formatted_amount = f"{amount:.2f}"
                    player_id = str(user_states[user_id]['data']['player_id'])
                    
                    # Используем HTML для отдельных цитат без пробела между ними
                    caption_text = (
                        f"<blockquote>💰 Сумма: {formatted_amount} сом</blockquote>"
                        f"<blockquote>🆔 ID: {player_id}</blockquote>\n\n"
                        f"⏳ Время на оплату: {timer_text}\n"
                        f"‼️ Оплата строго до копеек\n"
                        f"📸 После оплаты отправьте фото чека"
                    )
                    
                    if qr_image:
                        # В aiogram 3 нужно использовать BufferedInputFile для BytesIO
                        from aiogram.types import BufferedInputFile
                        qr_image.seek(0)
                        qr_bytes = qr_image.read()
                        photo_file = BufferedInputFile(qr_bytes, filename="qr_code.png")
                        timer_message = await message.answer_photo(
                            photo=photo_file,
                            caption=caption_text,
                            reply_markup=reply_markup,
                            parse_mode=ParseMode.HTML
                        )
                        user_states[user_id]['data']['is_photo_message'] = True
                    else:
                        timer_message = await message.answer(caption_text, reply_markup=reply_markup)
                        user_states[user_id]['data']['is_photo_message'] = False
                    
                    # Сохраняем данные для таймера
                    user_states[user_id]['data']['timer_message_id'] = timer_message.message_id
                    user_states[user_id]['data']['timer_chat_id'] = timer_message.chat.id
                    user_states[user_id]['data']['bank_links'] = bank_links
                    user_states[user_id]['data']['timer_seconds'] = timer_seconds
                    
                    # Сохраняем ожидание фото чека
                    pending_data = {
                        'amount': user_states[user_id]['data'].get('amount'),
                        'player_id': user_states[user_id]['data'].get('player_id'),
                        'bookmaker': user_states[user_id]['data'].get('bookmaker')
                    }
                    set_pending_deposit_state(user_id, pending_data, asyncio.get_event_loop().time() + timer_seconds)
                    
                    # Удаляем сообщение "Генерирую QR code..."
                    try:
                        await generating_message.delete()
                    except Exception as e:
                        logger.warning(f"⚠️ Не удалось удалить сообщение: {e}")
                    
                    # Запускаем таймер
                    from bot import bot
                    timer_task = asyncio.create_task(
                        update_timer(bot, user_id, timer_seconds, user_states[user_id]['data'], timer_message.message_id, timer_message.chat.id, user_states)
                    )
                    active_timers[user_id] = timer_task
                    
                    logger.info(f"✅ Сообщение с кнопками банков отправлено пользователю {user_id}, таймер запущен")
                    return
                else:
                    await generating_message.delete()
                    await answer_with_custom_text(message, "❌ Ошибка при получении ссылок на оплату. Попробуйте еще раз.")
                    return
            else:
                await generating_message.delete()
                await answer_with_custom_text(message, "❌ Ошибка при получении ссылок на оплату. Попробуйте еще раз.")
                return
    except Exception as e:
        logger.error(f"❌ Ошибка при создании заявки или получении ссылок: {e}")
        try:
            await generating_message.delete()
        except:
            pass
        await answer_with_custom_text(message, "❌ Ошибка при создании заявки. Попробуйте еще раз или обратитесь в поддержку.")

@router.message(DepositStates.bank, F.photo | F.document)
@router.message(DepositStates.receipt_photo, F.photo | F.document)
async def process_receipt_photo(message: Message, state: FSMContext):
    """Обработка фото чека"""
    user_id = message.from_user.id
    
    # Проверка на отмену заявки (если пришло текстовое сообщение вместо фото)
    if message.text and ("отменить заявку" in message.text.lower() or message.text.strip() == "❌ Отменить заявку"):
        from handlers.messages import cancel_request_text
        await cancel_request_text(message, state)
        return
    
    # Проверяем, что фото отправлено в правильном состоянии
    current_state = await state.get_state()
    if current_state not in [DepositStates.bank, DepositStates.receipt_photo]:
        await answer_with_custom_text(message, "❌ Сейчас не требуется отправка фото. Следуйте инструкциям выше.")
        return
    
    if user_id not in user_states:
        # Пытаемся восстановить состояние
        photo_file_id = None
        if message.photo:
            photo_file_id = message.photo[-1].file_id
        elif message.document and message.document.mime_type and message.document.mime_type.startswith('image/'):
            photo_file_id = message.document.file_id
        
        if photo_file_id:
            pending_data = get_pending_deposit_state(user_id)
            if pending_data and pending_data.get('amount') and pending_data.get('player_id') and pending_data.get('bookmaker'):
                user_states[user_id] = {
                    'step': 'deposit_receipt_photo',
                    'data': pending_data
                }
                await state.set_state(DepositStates.receipt_photo)
            else:
                clear_pending_deposit_state(user_id)
                await answer_with_custom_text(message, "❌ Нет активной заявки для фото чека. Нажмите «Пополнить» и пройдите шаги заново.")
                return
        else:
            await message.answer("❌ Нет активной заявки для фото чека. Нажмите «Пополнить» и пройдите шаги заново.")
            return
    
    # Получаем фото
    photo_file_id = None
    if message.photo:
        photo_file_id = message.photo[-1].file_id
    elif message.document and message.document.mime_type and message.document.mime_type.startswith('image/'):
        photo_file_id = message.document.file_id
    
    if not photo_file_id:
        await answer_with_text(message, 'please_send_receipt')
        return
    
    # Останавливаем таймер
    cancel_timer(user_id)
    
    # Получаем фото в base64
    processing_text = "⏳ Обрабатываю фото чека и создаю заявку..."
    text_with_emoji, entities = add_premium_emoji_to_text(processing_text, Config.PREMIUM_EMOJI_MAP)
    processing_message = await message.answer(text_with_emoji, entities=entities if entities else None)
    try:
        from bot import bot
        from io import BytesIO
        file = await bot.get_file(photo_file_id)
        # В aiogram 3 используем bot.download() который возвращает BytesIO
        file_data = BytesIO()
        await bot.download(file, destination=file_data)
        file_data.seek(0)
        base64_data = base64.b64encode(file_data.read()).decode('utf-8')
        receipt_photo_base64 = f"data:image/jpeg;base64,{base64_data}"
        
        data = user_states[user_id]['data']
        
        if not data.get('amount') or not data.get('player_id') or not data.get('bookmaker'):
            await answer_with_custom_text(message, "❌ Ошибка: отсутствуют данные. Начните заново.")
            if user_id in user_states:
                del user_states[user_id]
            clear_pending_deposit_state(user_id)
            return
        
        # Создаем заявку
        user = message.from_user
        request_body = {
            "type": "deposit",
            "bookmaker": data['bookmaker'],
            "userId": str(user_id),
            "telegram_user_id": str(user_id),
            "amount": data['amount'],
            "bank": "omoney",
            "account_id": data['player_id'],
            "playerId": data['player_id'],
            "receipt_photo": receipt_photo_base64,
            "telegram_username": user.username,
            "telegram_first_name": user.first_name,
            "telegram_last_name": user.last_name,
            "source": "bot"
        }
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            payment_response = await client.post(
                f"{Config.API_URL}/api/payment",
                json=request_body,
                headers={"Content-Type": "application/json"}
            )
            
            if payment_response.status_code == 200:
                result = payment_response.json()
                if result.get('success') != False:
                    request_id = result.get('id') or result.get('data', {}).get('id') or 'N/A'
                    
                    casino_name = get_casino_name(data.get('bookmaker', ''))
                    success_message = get_text(
                        'deposit_request_sent',
                        request_id=request_id,
                        amount=float(data.get('amount', 0)),
                        account_id=data.get('player_id', ''),
                        casino_name=casino_name
                    )
                    await message.answer(success_message, reply_markup=None)
                    
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
                                logger.info(f"✅ Сообщение с QR-кодом удалено для пользователя {user_id} после отправки фото чека")
                            except Exception as delete_error:
                                logger.warning(f"⚠️ Не удалось удалить сообщение с QR-кодом для пользователя {user_id}: {delete_error}")
                    
                    # Очищаем состояние
                    if user_id in user_states:
                        del user_states[user_id]
                    clear_pending_deposit_state(user_id)
                    await state.clear()
                else:
                    error_msg = result.get('error') or result.get('message') or 'Неизвестная ошибка'
                    await answer_with_text(message, 'error_creating_request', error=error_msg)
            else:
                result = payment_response.json() if payment_response.headers.get('content-type', '').startswith('application/json') else {}
                error_msg = result.get('error') or result.get('message') or payment_response.text[:200] or f'HTTP {payment_response.status_code}'
                await answer_with_text(message, 'error_creating_request', error=error_msg)
    except Exception as e:
        logger.error(f"❌ Ошибка при обработке фото чека: {e}", exc_info=True)
        await answer_with_text(message, 'error_processing_photo', error=str(e)[:200])
    finally:
        try:
            await processing_message.delete()
        except:
            pass

