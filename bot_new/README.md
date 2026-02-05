# Telegram Bot для LUXON (aiogram 3)

## Установка и запуск

### Первоначальная настройка

```bash
cd bot_new
bash setup.sh
```

Это создаст виртуальное окружение и установит все зависимости.

### Запуск через PM2 (рекомендуется)

```bash
# Создаем директорию для логов
mkdir -p logs

# Запускаем бота
pm2 start ecosystem.config.js

# Просмотр статуса
pm2 status

# Просмотр логов
pm2 logs luxon-bot

# Остановка
pm2 stop luxon-bot

# Перезапуск
pm2 restart luxon-bot

# Удаление из pm2
pm2 delete luxon-bot
```

### Запуск вручную

```bash
source venv/bin/activate
python bot.py
```

### Зависимости

Все зависимости указаны в `requirements.txt`:
- aiogram==3.4.1
- httpx==0.27.0
- qrcode[pil]==7.4.2
- Pillow==10.2.0
- aiofiles==23.2.1
- aiohttp==3.9.1
