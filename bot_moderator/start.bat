@echo off
REM Скрипт для запуска бота-модератора на Windows

cd /d "%~dp0"

REM Проверяем наличие виртуального окружения
if not exist "venv" (
    echo Создаю виртуальное окружение...
    python -m venv venv
)

REM Активируем виртуальное окружение
call venv\Scripts\activate.bat

REM Устанавливаем зависимости
pip install -r requirements.txt

REM Запускаем бота
python bot.py

pause

