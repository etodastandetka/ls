#!/bin/bash
# Скрипт для настройки виртуального окружения для manage_admins.py

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"

echo "🔧 Настройка виртуального окружения для управления админами..."
echo ""

# Проверяем наличие python3
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 не найден. Установите Python3:"
    echo "   apt-get update && apt-get install -y python3 python3-pip python3-venv"
    exit 1
fi

echo "✅ Python3 найден: $(python3 --version)"
echo ""

# Создаем venv если его нет
if [ ! -d "$VENV_DIR" ]; then
    echo "📦 Создаю виртуальное окружение..."
    python3 -m venv "$VENV_DIR"
    echo "✅ Виртуальное окружение создано"
else
    echo "✅ Виртуальное окружение уже существует"
fi

echo ""
echo "📥 Устанавливаю зависимости..."
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install -r "$SCRIPT_DIR/requirements-admin.txt"

echo ""
echo "✅ Настройка завершена!"
echo ""
echo "📝 Использование:"
echo "   source scripts/venv/bin/activate"
echo "   python3 scripts/manage_admins.py <command>"
echo ""
echo "Или используйте обертку:"
echo "   ./scripts/run-admin-script.sh <command>"


































































