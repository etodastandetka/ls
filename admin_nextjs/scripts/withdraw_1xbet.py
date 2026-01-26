#!/usr/bin/env python3
"""
Скрипт для вывода средств из 1xBet через Cashdesk API
Использование:
    python withdraw_1xbet.py <account_id> <withdrawal_code>
    или
    python withdraw_1xbet.py  (интерактивный режим)
"""

import sys
import hashlib
import base64
import json
import os
from typing import Optional

try:
    import requests
except ImportError:
    print("❌ Ошибка: требуется библиотека requests")
    print("Установите её командой: pip install requests")
    sys.exit(1)


# Конфигурация API 1xBet (можно задать через переменные окружения)
DEFAULT_HASH = os.getenv('XBET_HASH', '97f471a9db92debbda38201af67e15f64d086e94ae4b919d8a6a4f64958912cf')
DEFAULT_CASHIERPASS = os.getenv('XBET_CASHIERPASS', 'wiaWAfE9')
DEFAULT_LOGIN = os.getenv('XBET_LOGIN', 'zhenishbAd')
DEFAULT_CASHDESKID = os.getenv('XBET_CASHDESKID', '1388580')

BASE_URL = 'https://partners.servcul.com/CashdeskBotAPI/'


def generate_confirm(user_id: str, hash_value: str) -> str:
    """Генерация confirm для 1xBet"""
    confirm_string = f"{user_id}:{hash_value}"
    return hashlib.md5(confirm_string.encode()).hexdigest()


def generate_sign_for_withdraw_1xbet(
    user_id: str,
    code: str,
    hash_value: str,
    cashierpass: str,
    cashdeskid: str
) -> str:
    """Генерация подписи для вывода 1xBet"""
    # a) SHA256(hash={hash}&lng=ru&userid={user_id})
    step1_string = f"hash={hash_value}&lng=ru&userid={user_id}"
    step1_hash = hashlib.sha256(step1_string.encode()).hexdigest()
    
    # b) MD5(code={code}&cashierpass={cashierpass}&cashdeskid={cashdeskid})
    step2_string = f"code={code}&cashierpass={cashierpass}&cashdeskid={cashdeskid}"
    step2_hash = hashlib.md5(step2_string.encode()).hexdigest()
    
    # c) SHA256(step1 + step2)
    combined = step1_hash + step2_hash
    return hashlib.sha256(combined.encode()).hexdigest()


def generate_basic_auth(login: str, cashierpass: str) -> str:
    """Генерация Basic Auth header"""
    auth_string = f"{login}:{cashierpass}"
    auth_base64 = base64.b64encode(auth_string.encode()).decode()
    return f"Basic {auth_base64}"


def withdraw_1xbet(
    account_id: str,
    withdrawal_code: str,
    hash_value: Optional[str] = None,
    cashierpass: Optional[str] = None,
    login: Optional[str] = None,
    cashdeskid: Optional[str] = None
) -> dict:
    """
    Вывод средств из 1xBet
    
    Args:
        account_id: ID счета в 1xBet
        withdrawal_code: Код ордера на вывод (из кабинета игрока)
        hash_value: Hash для API (по умолчанию из переменных окружения)
        cashierpass: Пароль кассира (по умолчанию из переменных окружения)
        login: Логин (по умолчанию из переменных окружения)
        cashdeskid: ID кассы (по умолчанию из переменных окружения)
    
    Returns:
        dict: Результат операции с полями success, message, amount, data
    """
    # Используем значения по умолчанию, если не указаны
    hash_value = hash_value or DEFAULT_HASH
    cashierpass = cashierpass or DEFAULT_CASHIERPASS
    login = login or DEFAULT_LOGIN
    cashdeskid = cashdeskid or DEFAULT_CASHDESKID
    
    # Проверка обязательных полей
    if not hash_value or not cashierpass or not login or not cashdeskid:
        return {
            'success': False,
            'message': 'Отсутствуют обязательные параметры API. Проверьте переменные окружения или передайте параметры явно.'
        }
    
    try:
        print(f"🔄 Вывод средств из 1xBet...")
        print(f"   ID счета: {account_id}")
        print(f"   Код вывода: {withdrawal_code}")
        
        # Генерируем confirm и подпись
        confirm = generate_confirm(account_id, hash_value)
        sign = generate_sign_for_withdraw_1xbet(account_id, withdrawal_code, hash_value, cashierpass, cashdeskid)
        auth_header = generate_basic_auth(login, cashierpass)
        
        # Формируем URL и тело запроса
        url = f"{BASE_URL}Deposit/{account_id}/Payout"
        request_body = {
            'cashdeskId': int(cashdeskid),
            'lng': 'ru',
            'code': withdrawal_code,
            'confirm': confirm
        }
        
        print(f"   URL: {url}")
        print(f"   Запрос: {json.dumps(request_body, indent=2, ensure_ascii=False)}")
        
        # Отправляем запрос
        response = requests.post(
            url,
            json=request_body,
            headers={
                'Content-Type': 'application/json',
                'Authorization': auth_header,
                'sign': sign
            },
            timeout=30
        )
        
        # Парсим ответ
        try:
            data = response.json()
        except json.JSONDecodeError:
            response_text = response.text
            return {
                'success': False,
                'message': f'Неверный формат ответа от API: {response_text[:200]}',
                'data': {'raw_response': response_text, 'status': response.status_code}
            }
        
        print(f"   Статус ответа: {response.status_code}")
        print(f"   Ответ: {json.dumps(data, indent=2, ensure_ascii=False)}")
        
        # Проверяем успешность операции
        has_success_flag = data.get('success') == True or data.get('Success') == True
        has_amount = (data.get('summa') is not None) or (data.get('Summa') is not None)
        
        # Если есть сумма и HTTP статус OK, считаем операцию успешной
        is_success = has_success_flag or (has_amount and response.ok)
        
        if is_success and response.ok:
            # Извлекаем сумму из ответа (может быть summa или Summa)
            amount = 0
            if data.get('summa') is not None:
                amount = abs(float(data.get('summa')))
            elif data.get('Summa') is not None:
                amount = abs(float(data.get('Summa')))
            
            return {
                'success': True,
                'message': f'✅ Вывод успешно выполнен! Сумма: {amount:.2f} KGS',
                'amount': amount,
                'data': data
            }
        else:
            error_msg = data.get('message') or data.get('Message') or data.get('error') or data.get('Error') or f'Ошибка (Статус: {response.status_code})'
            return {
                'success': False,
                'message': f'❌ {error_msg}',
                'data': data
            }
            
    except requests.exceptions.RequestException as e:
        return {
            'success': False,
            'message': f'Ошибка соединения: {str(e)}'
        }
    except Exception as e:
        return {
            'success': False,
            'message': f'Неожиданная ошибка: {str(e)}'
        }


def main():
    """Главная функция"""
    print("=" * 60)
    print("💸 Скрипт вывода средств из 1xBet")
    print("=" * 60)
    print()
    
    # Получаем параметры из аргументов командной строки или интерактивно
    if len(sys.argv) >= 3:
        account_id = sys.argv[1]
        withdrawal_code = sys.argv[2]
    else:
        # Интерактивный режим
        print("Введите данные для вывода:")
        account_id = input("ID счета 1xBet: ").strip()
        if not account_id:
            print("❌ Ошибка: ID счета не может быть пустым")
            sys.exit(1)
        
        withdrawal_code = input("Код ордера на вывод: ").strip()
        if not withdrawal_code:
            print("❌ Ошибка: код вывода не может быть пустым")
            sys.exit(1)
    
    print()
    
    # Выполняем вывод
    result = withdraw_1xbet(account_id, withdrawal_code)
    
    print()
    print("=" * 60)
    if result['success']:
        print(result['message'])
        if 'amount' in result:
            print(f"💰 Сумма вывода: {result['amount']:.2f} KGS")
        if 'data' in result and result['data']:
            print(f"\nДополнительная информация:")
            print(json.dumps(result['data'], indent=2, ensure_ascii=False))
    else:
        print(result['message'])
        if 'data' in result and result['data']:
            print(f"\nДетали ошибки:")
            print(json.dumps(result['data'], indent=2, ensure_ascii=False))
    print("=" * 60)
    
    sys.exit(0 if result['success'] else 1)


if __name__ == '__main__':
    main()

