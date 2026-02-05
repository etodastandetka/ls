"""
Генерация QR-кодов для депозитов
"""

import logging
import os
from io import BytesIO
from pathlib import Path
from typing import Optional
from urllib.parse import quote
try:
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
    QRCODE_AVAILABLE = True
except ImportError:
    QRCODE_AVAILABLE = False

logger = logging.getLogger(__name__)

def get_casino_id_image_path(bookmaker: str) -> Optional[str]:
    """Возвращает путь к изображению с примером ID для казино"""
    if not bookmaker:
        return None
    
    bookmaker_lower = bookmaker.lower()
    
    # Определяем базовую директорию (на уровень выше bot_new)
    current_file = Path(__file__).resolve()
    base_dir = current_file.parent.parent  # Из utils/ поднимаемся в LUXON/
    images_dir = base_dir / 'images'
    
    # Формируем имя файла: {casino}-id.jpg
    image_filename = f"{bookmaker_lower}-id.jpg"
    image_path = images_dir / image_filename
    
    # Проверяем существование файла
    if image_path.exists():
        return str(image_path)
    
    # Если не нашли, пробуем альтернативные варианты
    alternative_names = {
        '1xbet': '1xbet-id.jpg',
        '1win': '1win-id.jpg',
        'melbet': 'melbet-id.jpg',
        'mostbet': 'mostbet-id.jpg',
        'winwin': 'winwin.png',  # winwin может быть .png
    }
    
    if bookmaker_lower in alternative_names:
        alt_path = images_dir / alternative_names[bookmaker_lower]
        if alt_path.exists():
            return str(alt_path)
    
    logger.warning(f"⚠️ Не найден файл с примером ID для казино {bookmaker} в {images_dir}")
    return None

async def generate_qr_image(qr_url: str, bookmaker: str = '') -> Optional[BytesIO]:
    """Генерирует изображение QR-кода с текстом"""
    if not QRCODE_AVAILABLE:
        logger.warning("⚠️ Библиотека qrcode не установлена!")
        return None
    
    try:
        # Генерируем QR-код
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=28,
            border=4,
        )
        qr.add_data(qr_url)
        qr.make(fit=True)
        
        qr_img = qr.make_image(fill_color="black", back_color="white")
        
        # Создаем новое изображение
        img_width = 900
        img_height = 1200
        img = Image.new('RGBA', (img_width, img_height), (255, 255, 255, 255))
        
        # Вставляем QR-код
        qr_size = 780
        qr_img_resized = qr_img.resize((qr_size, qr_size))
        qr_x = (img_width - qr_size) // 2
        qr_y = 50
        img.paste(qr_img_resized, (qr_x, qr_y))
        
        # Добавляем текст поверх QR-кода
        draw = ImageDraw.Draw(img)
        
        # Загружаем шрифты
        font_path = None
        font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "arial.ttf",
            "Arial.ttf",
            "/Windows/Fonts/arial.ttf",
            "/Windows/Fonts/ARIAL.TTF",
        ]
        
        for path in font_paths:
            try:
                if os.path.exists(path):
                    test_font = ImageFont.truetype(path, 16)
                    font_path = path
                    break
            except Exception:
                continue
        
        if font_path:
            try:
                font_overlay = ImageFont.truetype(font_path, 85)
                font_medium = ImageFont.truetype(font_path, 55)
                font_small = ImageFont.truetype(font_path, 42)
            except Exception:
                font_overlay = ImageFont.load_default()
                font_medium = ImageFont.load_default()
                font_small = ImageFont.load_default()
        else:
            font_overlay = ImageFont.load_default()
            font_medium = ImageFont.load_default()
            font_small = ImageFont.load_default()
        
        # Текст поверх QR-кода
        text_line1 = "ПОПОЛНЕНИЕ ДЛЯ"
        text_line2 = "КАЗИНО"
        
        temp_img_size = max(img_width, img_height) * 3
        temp_img = Image.new('RGBA', (temp_img_size, temp_img_size), (0, 0, 0, 0))
        temp_draw = ImageDraw.Draw(temp_img)
        
        bbox1 = temp_draw.textbbox((0, 0), text_line1, font=font_overlay)
        bbox2 = temp_draw.textbbox((0, 0), text_line2, font=font_overlay)
        text_width1 = bbox1[2] - bbox1[0]
        text_height1 = bbox1[3] - bbox1[1]
        text_width2 = bbox2[2] - bbox2[0]
        text_height2 = bbox2[3] - bbox2[1]
        
        block_width = max(text_width1, text_width2)
        block_height = text_height1 + text_height2 + 20
        
        text_color = (220, 0, 0, 180)
        block_x = (temp_img_size - block_width) // 2
        block_y = (temp_img_size - block_height) // 2
        
        text_x1 = block_x + (block_width - text_width1) // 2
        text_y1 = block_y
        temp_draw.text((text_x1, text_y1), text_line1, fill=text_color, font=font_overlay)
        
        text_x2 = block_x + (block_width - text_width2) // 2
        text_y2 = block_y + text_height1 + 20
        temp_draw.text((text_x2, text_y2), text_line2, fill=text_color, font=font_overlay)
        
        rotation_angle = -40
        rotated_text = temp_img.rotate(rotation_angle, expand=False, fillcolor=(0, 0, 0, 0), resample=Image.Resampling.BICUBIC)
        
        qr_center_x = qr_x + qr_size // 2
        qr_center_y = qr_y + qr_size // 2
        center_x = temp_img_size // 2
        center_y = temp_img_size // 2
        
        crop_padding = 250
        crop_x1 = center_x - block_width // 2 - crop_padding
        crop_y1 = center_y - block_height // 2 - crop_padding
        crop_x2 = center_x + block_width // 2 + crop_padding
        crop_y2 = center_y + block_height // 2 + crop_padding
        
        text_crop = rotated_text.crop((crop_x1, crop_y1, crop_x2, crop_y2))
        
        crop_width = crop_x2 - crop_x1
        crop_height = crop_y2 - crop_y1
        paste_x = qr_center_x - crop_width // 2
        paste_y = qr_center_y - crop_height // 2
        
        img.paste(text_crop, (paste_x, paste_y), text_crop)
        
        # Текст под QR-кодом
        text_below1 = "ОТСКАНИРУЙТЕ QR"
        bbox2 = draw.textbbox((0, 0), text_below1, font=font_medium)
        text_width2 = bbox2[2] - bbox2[0]
        text_x2 = (img_width - text_width2) // 2
        text_y2 = qr_y + qr_size + 30
        draw.text((text_x2, text_y2), text_below1, fill='black', font=font_medium)
        
        text_below2 = "В любом банке"
        bbox3 = draw.textbbox((0, 0), text_below2, font=font_small)
        text_width3 = bbox3[2] - bbox3[0]
        text_x3 = (img_width - text_width3) // 2
        text_y3 = text_y2 + 60
        draw.text((text_x3, text_y3), text_below2, fill='blue', font=font_small)
        
        # Красная линия
        red_line_y = text_y3 + 50
        red_line_height = 5
        draw.rectangle([0, red_line_y, img_width, red_line_y + red_line_height], fill='red', outline='red', width=0)
        
        # Обрезаем изображение
        bottom_crop = red_line_y + red_line_height + 20
        img = img.crop((0, 0, img_width, bottom_crop))
        
        # Конвертируем в RGB
        img = img.convert('RGB')
        
        # Сохраняем в BytesIO
        qr_image = BytesIO()
        img.save(qr_image, format='PNG')
        qr_image.seek(0)
        qr_image.name = 'qr_code.png'
        
        logger.info(f"✅ QR-код сгенерирован")
        return qr_image
    except Exception as e:
        logger.error(f"❌ Ошибка при генерации QR-кода: {e}", exc_info=True)
        return None

