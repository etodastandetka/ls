#!/bin/bash
# Скрипт для запуска бота-модератора

cd "$(dirname "$0")"

# Проверяем наличие виртуального окружения
if [ ! -d "venv" ]; then
    echo "Создаю виртуальное окружение..."
    python3 -m venv venv
fi

# Активируем виртуальное окружение
source venv/bin/activate

# Устанавливаем зависимости
pip install -r requirements.txt

# Запускаем бота
python bot.py

