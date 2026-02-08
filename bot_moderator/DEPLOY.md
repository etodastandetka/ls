# Деплой бота-модератора на сервер

## 1. Запушить код на сервер

```bash
cd /var/www/luxon
git add bot_moderator/
git commit -m "Add bot-moderator"
git push origin main
```

На сервере:
```bash
cd /var/www/luxon
git pull origin main
```

## 2. Настроить .env файл

Убедитесь, что в файле `/var/www/luxon/admin_nextjs/.env` есть токен:

```env
OPER_TOKEN=ваш_токен_бота_здесь
```

## 3. Установить зависимости

```bash
cd /var/www/luxon/bot_moderator

# Создать виртуальное окружение
python3 -m venv venv

# Активировать
source venv/bin/activate

# Установить зависимости
pip install -r requirements.txt
```

## 4. Запустить через PM2

```bash
cd /var/www/luxon/bot_moderator

# Запустить
pm2 start ecosystem.config.js

# Или использовать скрипт
bash start_server.sh
```

## 5. Полезные команды PM2

```bash
# Просмотр статуса
pm2 status

# Просмотр логов
pm2 logs bot-moderator

# Перезапуск
pm2 restart bot-moderator

# Остановка
pm2 stop bot-moderator

# Удалить из PM2
pm2 delete bot-moderator

# Сохранить конфигурацию PM2
pm2 save
pm2 startup
```

## 6. Проверка работы

После запуска проверьте логи:
```bash
pm2 logs bot-moderator --lines 50
```

Должны увидеть:
```
🤖 Бот-модератор запускается...
📋 Запрещенных слов в списке: 12
```

## Быстрый деплой (одной командой)

```bash
cd /var/www/luxon && \
git pull origin main && \
cd bot_moderator && \
python3 -m venv venv && \
source venv/bin/activate && \
pip install -r requirements.txt && \
pm2 start ecosystem.config.js && \
pm2 save
```

