"""
Обработчик команды /start
"""

import logging
import asyncio
import httpx
from aiogram import Router, F
from aiogram.types import Message
from aiogram.fsm.context import FSMContext
from config import Config
from utils.texts import get_text
from utils.keyboards import get_main_menu_keyboard, get_main_menu_inline_keyboard
from utils.settings import load_settings, get_settings
from utils.state_manager import clear_pending_deposit_state

logger = logging.getLogger(__name__)
router = Router()

async def check_channel_subscription(user_id: int, channel_id: str) -> bool:
    """Проверяет подписку пользователя на канал"""
    try:
        check_url = f"https://api.telegram.org/bot{Config.BOT_TOKEN}/getChatMember"
        logger.info(f"🔍 Проверяю подписку пользователя {user_id} на канал {channel_id}")
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                check_url,
                json={
                    "chat_id": channel_id,
                    "user_id": user_id
                }
            )
            if response.status_code == 200:
                data = response.json()
                if data.get('ok'):
                    member = data.get('result', {})
                    status = member.get('status', '')
                    is_subscribed = status in ['member', 'administrator', 'creator']
                    logger.info(f"{'✅' if is_subscribed else '❌'} Пользователь {'подписан' if is_subscribed else 'не подписан'}")
                    return is_subscribed
        return False
    except Exception as e:
        logger.error(f"❌ Ошибка при проверке подписки: {e}", exc_info=True)
        return False

async def send_channel_subscription_message(message: Message, channel_username: str, channel_id: str) -> None:
    """Отправляет сообщение с кнопками для подписки на канал"""
    from utils.keyboards import get_channel_subscription_keyboard
    from utils.premium_emoji import add_premium_emoji_to_text
    
    channel_url = f"https://t.me/{channel_username.lstrip('@')}"
    keyboard = get_channel_subscription_keyboard(channel_username, channel_id)
    
    message_text = f"""🔔 <b>Подписка на канал</b>

Для продолжения работы с ботом необходимо подписаться на наш канал.

📢 Канал: @{channel_username.lstrip('@')}

После подписки нажмите кнопку "✅ Проверить подписку"."""
    
    # Применяем премиум эмодзи
    text_with_emoji, entities = add_premium_emoji_to_text(message_text, Config.PREMIUM_EMOJI_MAP)
    
    try:
        await message.answer(text_with_emoji, reply_markup=keyboard, entities=entities if entities else None, parse_mode=None)
        logger.info(f"✅ Сообщение о подписке отправлено пользователю {message.from_user.id}")
    except Exception as e:
        logger.error(f"❌ Ошибка при отправке сообщения о подписке: {e}")

async def send_main_menu(message_or_chat_id, user_name: str = "", bot_instance=None) -> None:
    """Отправляет главное меню
    
    Args:
        message_or_chat_id: Message объект или chat_id (int)
        user_name: Имя пользователя
        bot_instance: Экземпляр бота (опционально)
    """
    from bot import bot
    from aiogram.types import Message
    
    # Определяем chat_id и bot
    if isinstance(message_or_chat_id, int):
        chat_id = message_or_chat_id
        bot_to_use = bot_instance or bot
    elif isinstance(message_or_chat_id, Message):
        # Это Message объект
        chat_id = message_or_chat_id.chat.id
        bot_to_use = bot_instance or bot
        user_id = message_or_chat_id.from_user.id
        logger.info(f"📤 send_main_menu вызван для пользователя {user_id}")
    else:
        # Пытаемся получить chat_id из атрибутов
        chat_id = getattr(message_or_chat_id, 'chat', None)
        if chat_id:
            chat_id = getattr(chat_id, 'id', None)
        if not chat_id:
            logger.error(f"❌ Не удалось определить chat_id из {message_or_chat_id}")
            return
        bot_to_use = bot_instance or bot
    
    safe_name = user_name if user_name else "друг"
    main_menu_text = get_text('main_menu_text', user_name=safe_name)
    menu_ready_text = get_text('menu_ready_text')
    
    # Применяем премиум эмодзи к текстам
    from utils.premium_emoji import add_premium_emoji_to_text
    main_menu_text_with_emoji, main_menu_entities = add_premium_emoji_to_text(main_menu_text, Config.PREMIUM_EMOJI_MAP)
    menu_ready_text_with_emoji, menu_ready_entities = add_premium_emoji_to_text(menu_ready_text, Config.PREMIUM_EMOJI_MAP)
    
    inline_keyboard = get_main_menu_inline_keyboard(Config.WEBSITE_URL)
    
    try:
        logger.info(f"📤 Отправляю inline меню в чат {chat_id}")
        await bot_to_use.send_message(
            chat_id=chat_id, 
            text=main_menu_text_with_emoji, 
            reply_markup=inline_keyboard,
            entities=main_menu_entities if main_menu_entities else None,
            parse_mode=None  # Отключаем parse_mode при использовании entities
        )
        logger.info(f"✅ Inline меню отправлено")
    except Exception as e:
        logger.error(f"❌ Ошибка при отправке главного меню: {e}", exc_info=True)
    
    try:
        logger.info(f"📤 Отправляю клавиатуру меню в чат {chat_id}")
        await bot_to_use.send_message(
            chat_id=chat_id, 
            text=menu_ready_text_with_emoji, 
            reply_markup=get_main_menu_keyboard(),
            entities=menu_ready_entities if menu_ready_entities else None,
            parse_mode=None  # Отключаем parse_mode при использовании entities
        )
        logger.info(f"✅ Клавиатура отправлена")
    except Exception as e:
        logger.error(f"❌ Ошибка при отправке клавиатуры главного меню: {e}", exc_info=True)

@router.message(F.text.startswith("/start"))
async def cmd_start(message: Message, state: FSMContext):
    """Обработчик команды /start"""
    try:
        user = message.from_user
        user_id = user.id
        logger.info(f"📥 Получена команда /start от пользователя {user_id} (@{user.username})")
        
        # Удаляем сообщение с QR-кодом если оно есть (при сбросе сессии)
        try:
            from handlers.deposit import user_states
            from utils.timer import cancel_timer
            if user_id in user_states:
                data = user_states[user_id].get('data', {})
                if 'timer_message_id' in data and 'timer_chat_id' in data:
                    try:
                        from bot import bot
                        await bot.delete_message(
                            chat_id=data['timer_chat_id'],
                            message_id=data['timer_message_id']
                        )
                        logger.info(f"✅ Сообщение с QR-кодом удалено для пользователя {user_id} при /start")
                    except Exception as delete_error:
                        logger.warning(f"⚠️ Не удалось удалить сообщение с QR-кодом для пользователя {user_id}: {delete_error}")
                
                # Останавливаем таймер и очищаем состояние
                try:
                    cancel_timer(user_id)
                    del user_states[user_id]
                    from utils.state_manager import clear_pending_deposit_state
                    clear_pending_deposit_state(user_id)
                    await state.clear()
                except Exception as clear_error:
                    logger.warning(f"⚠️ Ошибка при очистке состояния для пользователя {user_id}: {clear_error}")
        except Exception as cleanup_error:
            logger.warning(f"⚠️ Ошибка при очистке состояния при /start: {cleanup_error}")
        
        # Загружаем настройки если они устарели
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
                await message.answer(text_with_emoji, entities=entities if entities else None, parse_mode=None)
                logger.info(f"⏸️ Бот на паузе, пользователь {user_id} получил сообщение о технических работах")
                return
        except Exception as pause_error:
            logger.error(f"❌ Ошибка при проверке паузы: {pause_error}")
        
        # Проверяем настройки канала
        logger.info(f"🔍 Проверяю настройки канала для пользователя {user_id}")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{Config.API_URL}/api/channel/settings",
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    
                    if data.get('success'):
                        channel_settings = data.get('data', {})
                        
                        if channel_settings.get('enabled'):
                            logger.info("✅ Проверка подписки включена")
                            channel_id = channel_settings.get('channel_id')
                            channel_username = channel_settings.get('username', '')
                            
                            if channel_id:
                                logger.info(f"🔍 Проверяю подписку на канал {channel_id}")
                                try:
                                    is_subscribed = await check_channel_subscription(user_id, channel_id)
                                    
                                    if not is_subscribed:
                                        logger.info(f"❌ Пользователь {user_id} не подписан на канал, отправляю сообщение о подписке")
                                        await send_channel_subscription_message(message, channel_username, channel_id)
                                        return
                                    else:
                                        logger.info(f"✅ Пользователь {user_id} подписан на канал, показываю основное меню")
                                except Exception as sub_check_error:
                                    logger.error(f"❌ Ошибка при проверке подписки: {sub_check_error}")
                                    # Продолжаем работу, если проверка подписки не удалась
        except Exception as e:
            logger.error(f"❌ Ошибка при проверке настроек канала: {e}", exc_info=True)
            # Продолжаем работу, если проверка канала не удалась
        
        # Обработка реферальной ссылки
        param = None
        referral_registered = False
        
        # Логируем полное сообщение для отладки
        logger.info(f"🔍 [START] Полное сообщение: text='{message.text}', entities={message.entities}")
        
        # Пробуем получить параметр из текста сообщения
        if message.text:
            parts = message.text.split()
            logger.info(f"🔍 [START] Части сообщения: {parts}, количество: {len(parts)}")
            if len(parts) > 1:
                param = parts[1]
                logger.info(f"📋 Получен параметр из текста: '{param}'")
        
        # Если параметр не найден в тексте, пробуем получить из entities (для deep links)
        if not param and message.entities:
            for entity in message.entities:
                if entity.type == "bot_command" and entity.offset == 0:
                    # Параметр может быть после команды
                    if len(message.text) > entity.length:
                        potential_param = message.text[entity.length:].strip()
                        if potential_param:
                            param = potential_param
                            logger.info(f"📋 Получен параметр из entities: '{param}'")
                            break
        
        if param:
            if param.startswith('ref'):
                referral_code = param[3:]
                if referral_code.startswith('_'):
                    referral_code = referral_code[1:]
                
                logger.info(f"🔍 Обработка реферального кода из параметра '{param}': извлечен код '{referral_code}'")
                
                if not referral_code or not referral_code.strip().isdigit():
                    logger.warning(f"⚠️ Неверный формат реферального кода '{param}' (извлечен: '{referral_code}')")
                    try:
                        from utils.premium_emoji import add_premium_emoji_to_text
                        error_text = "⚠️ Неверный формат реферальной ссылки."
                        text_with_emoji, entities = add_premium_emoji_to_text(error_text, Config.PREMIUM_EMOJI_MAP)
                        await message.answer(text_with_emoji, entities=entities if entities else None, parse_mode=None)
                    except:
                        pass
                else:
                    logger.info(f"🔍 Обработка реферального кода: {referral_code} для пользователя {user_id}")
                    
                    try:
                        referrer_id = int(referral_code)
                        if referrer_id == user_id:
                            logger.warning(f"⚠️ Пользователь {user_id} пытается пригласить самого себя")
                            try:
                                from utils.premium_emoji import add_premium_emoji_to_text
                                error_text = "❌ Вы не можете использовать свою собственную реферальную ссылку."
                                text_with_emoji, entities = add_premium_emoji_to_text(error_text, Config.PREMIUM_EMOJI_MAP)
                                await message.answer(text_with_emoji, entities=entities if entities else None, parse_mode=None)
                            except:
                                pass
                        else:
                            logger.info(f"🔄 Регистрация реферала: {referrer_id} -> {user_id}, API_URL: {Config.API_URL}")
                            
                            max_retries = 3
                            retry_delay = 2
                            timeout = 15.0
                            success = False
                            error_message = None
                            
                            for attempt in range(max_retries):
                                try:
                                    async with httpx.AsyncClient(timeout=timeout) as client:
                                        api_url = f"{Config.API_URL}/api/referral/register"
                                        logger.info(f"📡 Отправка запроса на {api_url} (попытка {attempt + 1}/{max_retries})")
                                        
                                        response = await client.post(
                                            api_url,
                                            json={
                                                "referrer_id": str(referrer_id),
                                                "referred_id": str(user_id),
                                                "username": user.username,
                                                "first_name": user.first_name,
                                                "last_name": user.last_name
                                            },
                                            headers={"Content-Type": "application/json"}
                                        )
                                        
                                        logger.info(f"📡 Ответ API (попытка {attempt + 1}/{max_retries}): статус {response.status_code}")
                                        
                                        if response.status_code == 200:
                                            try:
                                                data = response.json()
                                                logger.info(f"📡 Данные ответа: {data}")
                                                if data.get('success'):
                                                    logger.info(f"✅ Реферальная связь зарегистрирована: {referrer_id} -> {user_id}")
                                                    referral_registered = True
                                                    success = True
                                                    # Уведомления отправляются автоматически через API endpoint
                                                    break
                                                else:
                                                    error_msg = data.get('error', 'Unknown error')
                                                    error_message = error_msg
                                                    logger.warning(f"⚠️ API вернул ошибку: {error_msg}")
                                                    if 'already referred' in error_msg.lower():
                                                        logger.info(f"ℹ️ Пользователь {user_id} уже является рефералом")
                                                        break
                                                    elif 'cannot refer yourself' in error_msg.lower():
                                                        logger.warning(f"⚠️ Пользователь {user_id} пытается пригласить самого себя")
                                                        break
                                            except Exception as parse_error:
                                                logger.error(f"❌ Ошибка парсинга ответа (попытка {attempt + 1}): {parse_error}")
                                                error_message = f"Ошибка обработки ответа: {str(parse_error)}"
                                        else:
                                            try:
                                                error_data = await response.json()
                                                error_message = error_data.get('error', f'HTTP {response.status_code}')
                                                logger.warning(f"⚠️ API вернул статус {response.status_code}: {error_message}")
                                            except:
                                                error_message = f'HTTP {response.status_code}'
                                                logger.warning(f"⚠️ API вернул статус {response.status_code}")
                                        
                                        if attempt < max_retries - 1:
                                            logger.info(f"⏳ Повторная попытка через {retry_delay} секунд...")
                                            await asyncio.sleep(retry_delay)
                                            
                                except httpx.TimeoutException as e:
                                    logger.error(f"⏱️ Таймаут при регистрации реферала (попытка {attempt + 1}/{max_retries}): {e}")
                                    error_message = "Таймаут соединения"
                                    if attempt < max_retries - 1:
                                        logger.info(f"⏳ Повторная попытка через {retry_delay} секунд...")
                                        await asyncio.sleep(retry_delay)
                                except Exception as e:
                                    logger.error(f"❌ Ошибка при регистрации реферала (попытка {attempt + 1}/{max_retries}): {e}", exc_info=True)
                                    error_message = f"Ошибка соединения: {str(e)}"
                                    if attempt < max_retries - 1:
                                        logger.info(f"⏳ Повторная попытка через {retry_delay} секунд...")
                                        await asyncio.sleep(retry_delay)
                            
                            if not success:
                                logger.error(f"❌ Не удалось зарегистрировать реферала после {max_retries} попыток: {referrer_id} -> {user_id}, ошибка: {error_message}")
                                # Не отправляем сообщение об ошибке пользователю, чтобы не пугать его
                                # Главное меню все равно отправится
                    except ValueError as e:
                        logger.error(f"❌ Неверный формат реферального кода '{referral_code}': {e}")
                        try:
                            from utils.premium_emoji import add_premium_emoji_to_text
                            error_text = "⚠️ Неверный формат реферальной ссылки."
                            text_with_emoji, entities = add_premium_emoji_to_text(error_text, Config.PREMIUM_EMOJI_MAP)
                            await message.answer(text_with_emoji, entities=entities if entities else None, parse_mode=None)
                        except:
                            pass
    
        # Очищаем состояние (FSM и user_states)
        try:
            await state.clear()
            from utils.state_manager import clear_pending_deposit_state
            clear_pending_deposit_state(user_id)
            
            # Очищаем user_states если есть
            from handlers.deposit import user_states
            if user_id in user_states:
                del user_states[user_id]
                logger.info(f"✅ user_states очищен для пользователя {user_id}")
            
            # Останавливаем таймер если активен
            from utils.timer import cancel_timer
            cancel_timer(user_id)
        except Exception as cleanup_error:
            logger.warning(f"⚠️ Ошибка при финальной очистке состояния: {cleanup_error}")
        
        # Отправляем главное меню
        logger.info(f"📤 Отправляю главное меню пользователю {user_id}")
        try:
            await send_main_menu(message, user.first_name)
            logger.info(f"✅ Ответ отправлен пользователю {user_id}")
        except Exception as e:
            logger.error(f"❌ Ошибка при отправке ответа пользователю {user_id}: {e}", exc_info=True)
            if "bot was blocked by the user" in str(e).lower():
                logger.debug(f"⚠️ Пользователь {user_id} заблокировал бота")
            else:
                # Пытаемся отправить хотя бы простое сообщение
                try:
                    await answer_with_custom_text(message, "Привет! Используйте кнопки меню для работы с ботом.")
                except:
                    pass
    except Exception as main_error:
        logger.error(f"❌ Критическая ошибка в обработчике /start для пользователя {user_id}: {main_error}", exc_info=True)
        try:
            from utils.premium_emoji import add_premium_emoji_to_text
            error_text = "❌ Произошла ошибка. Попробуйте еще раз или напишите /start"
            text_with_emoji, entities = add_premium_emoji_to_text(error_text, Config.PREMIUM_EMOJI_MAP)
            await message.answer(text_with_emoji, entities=entities if entities else None, parse_mode=None)
        except:
            pass


