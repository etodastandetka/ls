#!/bin/bash
# Обертка для запуска manage_admins.py с автоматической активацией venv

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

# Проверяем наличие venv
if [ ! -d "$VENV_DIR" ]; then
    echo "⚠️  Виртуальное окружение не найдено. Запускаю настройку..."
    "$SCRIPT_DIR/setup-admin-venv.sh"
fi

# Активируем venv и запускаем скрипт
source "$VENV_DIR/bin/activate"
python3 "$SCRIPT_DIR/manage_admins.py" "$@"


































































