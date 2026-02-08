# Обновление бота-модератора на сервере

## Если git pull не работает из-за незакоммиченных изменений:

### Вариант 1: Сохранить изменения (stash)
```bash
cd /var/www/luxon/admin_nextjs
git stash
git pull
# Если нужны сохраненные изменения:
git stash pop
```

### Вариант 2: Отменить изменения (если они не нужны)
```bash
cd /var/www/luxon/admin_nextjs
git reset --hard
git pull
```

### Вариант 3: Закоммитить изменения
```bash
cd /var/www/luxon/admin_nextjs
git add .
git commit -m "Local changes"
git pull
```

## После успешного git pull:

### 1. Обновить бота-модератора
```bash
cd /var/www/luxon
git pull origin main
```

### 2. Перейти в папку бота-модератора
```bash
cd /var/www/luxon/bot_moderator
```

### 3. Установить зависимости (если нужно)
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 4. Запустить через PM2
```bash
pm2 start ecosystem.config.js
# Или перезапустить если уже запущен
pm2 restart bot-moderator
```

### 5. Проверить логи
```bash
pm2 logs bot-moderator --lines 50
```

