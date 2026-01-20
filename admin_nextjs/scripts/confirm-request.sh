#!/bin/bash
# Скрипт для подтверждения заявки без пополнения казино
# Использование: ./scripts/confirm-request.sh <REQUEST_ID> [TOKEN]
# Пример: ./scripts/confirm-request.sh 11547

REQUEST_ID=$1
TOKEN=$2

if [ -z "$REQUEST_ID" ]; then
  echo "❌ Ошибка: Укажите ID заявки"
  echo "Использование: $0 <REQUEST_ID> [TOKEN]"
  echo "Пример: $0 11547"
  exit 1
fi

# Если токен не указан, пытаемся получить из переменной окружения или cookie
if [ -z "$TOKEN" ]; then
  # Попробуем получить токен из cookie файла (если есть)
  if [ -f "cookies.txt" ]; then
    echo "📋 Используем cookie из cookies.txt"
    curl -X PATCH "https://pipiska.net/api/requests/$REQUEST_ID" \
      -H "Content-Type: application/json" \
      -b cookies.txt \
      -d '{
        "status": "completed",
        "statusDetail": "Подтверждено вручную"
      }'
  else
    echo "❌ Ошибка: Токен не указан и файл cookies.txt не найден"
    echo "Сначала залогиньтесь:"
    echo "  curl -X POST https://pipiska.net/api/auth/login \\"
    echo "    -H \"Content-Type: application/json\" \\"
    echo "    -d '{\"username\": \"dastan\", \"password\": \"YOUR_PASSWORD\"}' \\"
    echo "    -c cookies.txt"
    exit 1
  fi
else
  # Используем Bearer токен
  echo "📋 Подтверждаем заявку #$REQUEST_ID..."
  curl -X PATCH "https://pipiska.net/api/requests/$REQUEST_ID" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{
      "status": "completed",
      "statusDetail": "Подтверждено вручную"
    }'
fi

echo ""
echo "✅ Готово!"

