"""
Клавиатуры для бота
"""

from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from utils.texts import get_text, get_casino_name

def get_main_menu_keyboard() -> ReplyKeyboardMarkup:
    """Создает Reply клавиатуру основного меню."""
    reply_keyboard = [
        [
            KeyboardButton(text=get_text('deposit')),
            KeyboardButton(text=get_text('withdraw'))
        ],
        [
            KeyboardButton(text=get_text('support')),
            KeyboardButton(text="📊 История")
        ],
        [
            KeyboardButton(text=get_text('faq'))
        ]
    ]
    return ReplyKeyboardMarkup(keyboard=reply_keyboard, resize_keyboard=True, one_time_keyboard=False)

def get_casino_keyboard(casinos: list, cancel_button: bool = True) -> ReplyKeyboardMarkup:
    """Создает клавиатуру с казино"""
    keyboard_buttons = []
    for i in range(0, len(casinos), 2):
        row = [KeyboardButton(text=casinos[i][1])]
        if i + 1 < len(casinos):
            row.append(KeyboardButton(text=casinos[i + 1][1]))
        keyboard_buttons.append(row)
    
    if cancel_button:
        keyboard_buttons.append([KeyboardButton(text="❌ Отменить заявку")])
    
    return ReplyKeyboardMarkup(keyboard=keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)

def get_amount_keyboard() -> ReplyKeyboardMarkup:
    """Создает клавиатуру с суммами"""
    keyboard_buttons = [
        [KeyboardButton(text="100"), KeyboardButton(text="200"), KeyboardButton(text="500")],
        [KeyboardButton(text="1000"), KeyboardButton(text="2000"), KeyboardButton(text="5000")],
        [KeyboardButton(text="10000")],
        [KeyboardButton(text="❌ Отменить заявку")]
    ]
    return ReplyKeyboardMarkup(keyboard=keyboard_buttons, resize_keyboard=True, one_time_keyboard=False)

def get_cancel_keyboard() -> ReplyKeyboardMarkup:
    """Создает клавиатуру с кнопкой отмены"""
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="❌ Отменить заявку")]],
        resize_keyboard=True,
        one_time_keyboard=False
    )

def get_main_menu_inline_keyboard(website_url: str) -> InlineKeyboardMarkup:
    """Создает inline клавиатуру с WebApp кнопкой"""
    inline_keyboard = [
        [InlineKeyboardButton(
            text=get_text('main_menu_webapp_button'),
            web_app=WebAppInfo(url=website_url)
        )]
    ]
    return InlineKeyboardMarkup(inline_keyboard=inline_keyboard)

def get_bank_keyboard(bank_links: dict, enabled_banks: list) -> InlineKeyboardMarkup:
    """Создает клавиатуру с банками для оплаты"""
    from utils.texts import BANK_NAMES
    
    keyboard = []
    bank_names_map = {
        'demirbank': 'DemirBank',
        'omoney': 'O!Money',
        'balance': 'Balance.kg',
        'bakai': 'Bakai',
        'megapay': 'MegaPay',
        'mbank': 'MBank'
    }
    
    all_banks_list = []
    added_banks = set()
    
    for bank_key, bank_name in bank_names_map.items():
        bank_link = bank_links.get(bank_key) or bank_links.get(bank_name)
        if not bank_link and bank_key == 'demirbank':
            bank_link = bank_links.get('demir') or bank_links.get('DemirBank')
        
        if bank_link and bank_name not in added_banks:
            added_banks.add(bank_name)
            is_enabled = bank_key in enabled_banks or 'demir' in bank_key.lower() or 'demirbank' in enabled_banks
            if is_enabled:
                all_banks_list.append(InlineKeyboardButton(text=bank_name, url=bank_link))
            else:
                all_banks_list.append(InlineKeyboardButton(text=f"{bank_name} ⚠️", callback_data=f"deposit_bank_{bank_key}_disabled"))
    
    # Разделяем на пары (по 2 в ряд)
    for i in range(0, len(all_banks_list), 2):
        if i + 1 < len(all_banks_list):
            keyboard.append([all_banks_list[i], all_banks_list[i + 1]])
        else:
            keyboard.append([all_banks_list[i]])
    
    keyboard.append([InlineKeyboardButton(text="❌ Отменить заявку", callback_data="cancel_request")])
    return InlineKeyboardMarkup(inline_keyboard=keyboard)

def get_support_keyboard(support_url: str) -> InlineKeyboardMarkup:
    """Создает клавиатуру для поддержки"""
    keyboard = [
        [InlineKeyboardButton(text="🚀 Открыть поддержку", url=support_url)]
    ]
    return InlineKeyboardMarkup(inline_keyboard=keyboard)

def get_history_keyboard(website_url: str) -> InlineKeyboardMarkup:
    """Создает клавиатуру для истории"""
    keyboard = [
        [InlineKeyboardButton(text="🚀 Открыть историю", web_app=WebAppInfo(url=f"{website_url}/history"))]
    ]
    return InlineKeyboardMarkup(inline_keyboard=keyboard)

def get_faq_keyboard(website_url: str) -> InlineKeyboardMarkup:
    """Создает клавиатуру для инструкции"""
    keyboard = [
        [InlineKeyboardButton(text="🚀 Открыть инструкцию", web_app=WebAppInfo(url=f"{website_url}/instruction"))]
    ]
    return InlineKeyboardMarkup(inline_keyboard=keyboard)

def get_channel_subscription_keyboard(channel_username: str, channel_id: str) -> InlineKeyboardMarkup:
    """Создает клавиатуру для подписки на канал"""
    channel_url = f"https://t.me/{channel_username.lstrip('@')}"
    keyboard = [
        [
            InlineKeyboardButton(text="📢 Подписаться на канал", url=channel_url),
            InlineKeyboardButton(text="✅ Проверить подписку", callback_data=f"check_sub_{channel_id}")
        ]
    ]
    return InlineKeyboardMarkup(inline_keyboard=keyboard)

