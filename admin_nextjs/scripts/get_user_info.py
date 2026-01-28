#!/usr/bin/env python3
"""
Скрипт для получения полной информации о пользователе по Telegram ID
Использование:
    python get_user_info.py <telegram_id>
    или
    python get_user_info.py  (интерактивный режим)
"""

import sys
import os
import json
from datetime import datetime
from typing import Optional, Dict, Any

# Добавляем путь к корню проекта
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("❌ Ошибка: требуется библиотека psycopg2")
    print("Установите её командой: pip install psycopg2-binary")
    sys.exit(1)


def load_env_file():
    """Загружает переменные окружения из .env файла"""
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    # Убираем кавычки если есть
                    value = value.strip('"\'')
                    os.environ[key.strip()] = value


def get_db_connection():
    """Получает подключение к базе данных"""
    load_env_file()
    
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        print("❌ Ошибка: DATABASE_URL не установлен")
        print("Установите переменную окружения DATABASE_URL или добавьте в .env файл")
        sys.exit(1)
    
    try:
        # Убираем параметр schema из URL, так как psycopg2 его не поддерживает
        # Формат Prisma: postgresql://user:pass@host:port/db?schema=public
        # Формат psycopg2: postgresql://user:pass@host:port/db
        if '?' in database_url:
            database_url = database_url.split('?')[0]
        
        conn = psycopg2.connect(database_url)
        return conn
    except Exception as e:
        print(f"❌ Ошибка подключения к базе данных: {e}")
        print(f"   DATABASE_URL (первые 50 символов): {database_url[:50]}...")
        sys.exit(1)


def format_datetime(dt) -> str:
    """Форматирует datetime в читаемый формат"""
    if dt is None:
        return "N/A"
    if isinstance(dt, str):
        return dt
    return dt.strftime('%Y-%m-%d %H:%M:%S')


def format_decimal(value) -> float:
    """Преобразует Decimal в float"""
    if value is None:
        return 0.0
    return float(value)


def get_user_info(user_id: int) -> Dict[str, Any]:
    """Получает полную информацию о пользователе"""
    conn = get_db_connection()
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        user_id_bigint = int(user_id)
        
        # 1. Основная информация о пользователе
        cursor.execute("""
            SELECT 
                user_id,
                username,
                first_name,
                last_name,
                language,
                selected_bookmaker,
                note,
                is_active,
                created_at
            FROM users
            WHERE user_id = %s
        """, (user_id_bigint,))
        
        user = cursor.fetchone()
        
        if not user:
            return {
                'error': f'Пользователь с ID {user_id} не найден в базе данных',
                'user_id': user_id
            }
        
        # 2. Реферальная связь (чей реферал)
        cursor.execute("""
            SELECT 
                br.id as referral_id,
                br.referrer_id,
                br.created_at as referral_created_at,
                u.username as referrer_username,
                u.first_name as referrer_first_name
            FROM referrals br
            INNER JOIN users u ON u.user_id = br.referrer_id
            WHERE br.referred_id = %s
        """, (user_id_bigint,))
        
        referral_from = cursor.fetchone()
        
        # 3. Список рефералов пользователя
        cursor.execute("""
            SELECT 
                br.id as referral_id,
                br.referred_id,
                br.created_at as referral_created_at,
                u.username as referred_username,
                u.first_name as referred_first_name,
                u.last_name as referred_last_name
            FROM referrals br
            INNER JOIN users u ON u.user_id = br.referred_id
            WHERE br.referrer_id = %s
            ORDER BY br.created_at DESC
        """, (user_id_bigint,))
        
        referrals = cursor.fetchall()
        
        # 4. Расчет баланса (заработанное - выведенное)
        # Заработанное
        cursor.execute("""
            SELECT COALESCE(SUM(commission_amount), 0)::numeric as total
            FROM referral_earnings
            WHERE referrer_id = %s
              AND status = 'completed'
        """, (user_id_bigint,))
        
        total_earned_result = cursor.fetchone()
        total_earned = format_decimal(total_earned_result['total']) if total_earned_result else 0.0
        
        # Выведенное
        cursor.execute("""
            SELECT COALESCE(SUM(amount), 0)::numeric as total
            FROM referral_withdrawal_requests
            WHERE user_id = %s
              AND status = 'completed'
        """, (user_id_bigint,))
        
        total_withdrawn_result = cursor.fetchone()
        total_withdrawn = format_decimal(total_withdrawn_result['total']) if total_withdrawn_result else 0.0
        
        available_balance = total_earned - total_withdrawn
        
        # 5. Статистика рефералов
        cursor.execute("""
            SELECT 
                COUNT(DISTINCT br.referred_id) as total_referrals,
                COUNT(DISTINCT CASE 
                    WHEN r.id IS NOT NULL 
                    THEN br.referred_id 
                END) as active_referrals
            FROM referrals br
            LEFT JOIN requests r ON r.user_id = br.referred_id 
                AND r.request_type = 'deposit' 
                AND r.status IN ('completed', 'approved', 'auto_completed', 'autodeposit_success')
            WHERE br.referrer_id = %s
        """, (user_id_bigint,))
        
        referral_stats = cursor.fetchone()
        
        # 6. Транзакции (последние 10)
        cursor.execute("""
            SELECT 
                id,
                bookmaker,
                trans_type,
                amount,
                status,
                created_at
            FROM transactions
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT 10
        """, (user_id_bigint,))
        
        transactions = cursor.fetchall()
        
        # 7. Заявки (последние 10)
        cursor.execute("""
            SELECT 
                id,
                bookmaker,
                account_id,
                amount,
                request_type,
                status,
                status_detail,
                processed_by,
                bank,
                created_at,
                updated_at,
                processed_at
            FROM requests
            WHERE user_id = %s
            ORDER BY created_at DESC
            LIMIT 10
        """, (user_id_bigint,))
        
        requests = cursor.fetchall()
        
        # 8. Статистика заработка
        cursor.execute("""
            SELECT 
                COUNT(*) as total_earnings,
                COALESCE(SUM(commission_amount), 0)::numeric as total_commission,
                MIN(created_at) as first_earning_date,
                MAX(created_at) as last_earning_date
            FROM referral_earnings
            WHERE referrer_id = %s
              AND status = 'completed'
        """, (user_id_bigint,))
        
        earnings_stats = cursor.fetchone()
        
        # Формируем результат
        result = {
            'user_id': str(user_id_bigint),
            'user_info': {
                'username': user['username'],
                'first_name': user['first_name'],
                'last_name': user['last_name'],
                'language': user['language'],
                'selected_bookmaker': user['selected_bookmaker'],
                'note': user['note'],
                'is_active': user['is_active'],
                'created_at': format_datetime(user['created_at'])
            },
            'referral_connection': {
                'is_referred': referral_from is not None,
                'referrer_id': str(referral_from['referrer_id']) if referral_from else None,
                'referrer_username': referral_from['referrer_username'] if referral_from else None,
                'referrer_name': referral_from['referrer_first_name'] if referral_from else None,
                'referral_created_at': format_datetime(referral_from['referral_created_at']) if referral_from else None
            },
            'referrals': {
                'total_count': len(referrals),
                'active_count': referral_stats['active_referrals'] if referral_stats else 0,
                'list': [
                    {
                        'user_id': str(ref['referred_id']),
                        'username': ref['referred_username'],
                        'name': f"{ref['referred_first_name'] or ''} {ref['referred_last_name'] or ''}".strip(),
                        'referral_created_at': format_datetime(ref['referral_created_at'])
                    }
                    for ref in referrals
                ]
            },
            'balance': {
                'total_earned': round(total_earned, 2),
                'total_withdrawn': round(total_withdrawn, 2),
                'available_balance': round(available_balance, 2)
            },
            'earnings_stats': {
                'total_earnings_count': earnings_stats['total_earnings'] if earnings_stats else 0,
                'total_commission': round(format_decimal(earnings_stats['total_commission']) if earnings_stats else 0.0, 2),
                'first_earning_date': format_datetime(earnings_stats['first_earning_date']) if earnings_stats and earnings_stats['first_earning_date'] else None,
                'last_earning_date': format_datetime(earnings_stats['last_earning_date']) if earnings_stats and earnings_stats['last_earning_date'] else None
            },
            'recent_transactions': [
                {
                    'id': t['id'],
                    'bookmaker': t['bookmaker'],
                    'type': t['trans_type'],
                    'amount': round(format_decimal(t['amount']), 2),
                    'status': t['status'],
                    'created_at': format_datetime(t['created_at'])
                }
                for t in transactions
            ],
            'recent_requests': [
                {
                    'id': r['id'],
                    'bookmaker': r['bookmaker'],
                    'account_id': r['account_id'],
                    'amount': round(format_decimal(r['amount']), 2) if r['amount'] else None,
                    'type': r['request_type'],
                    'status': r['status'],
                    'status_detail': r['status_detail'],
                    'processed_by': r['processed_by'],
                    'bank': r['bank'],
                    'created_at': format_datetime(r['created_at']),
                    'processed_at': format_datetime(r['processed_at'])
                }
                for r in requests
            ]
        }
        
        return result
        
    except Exception as e:
        return {
            'error': f'Ошибка при получении данных: {str(e)}',
            'user_id': user_id
        }
    finally:
        cursor.close()
        conn.close()


def print_user_info(info: Dict[str, Any]):
    """Красиво выводит информацию о пользователе"""
    if 'error' in info:
        print(f"❌ {info['error']}")
        return
    
    print("=" * 80)
    print("👤 ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ")
    print("=" * 80)
    print()
    
    # Основная информация
    user_info = info['user_info']
    print(f"🆔 Telegram ID: {info['user_id']}")
    print(f"👤 Username: @{user_info['username'] or 'N/A'}")
    print(f"📛 Имя: {user_info['first_name'] or 'N/A'} {user_info['last_name'] or 'N/A'}")
    print(f"🌐 Язык: {user_info['language']}")
    print(f"🎰 Выбранный букмекер: {user_info['selected_bookmaker'] or 'N/A'}")
    print(f"📝 Заметка: {user_info['note'] or 'N/A'}")
    print(f"✅ Активен: {'Да' if user_info['is_active'] else 'Нет'}")
    print(f"📅 Дата регистрации: {user_info['created_at']}")
    print()
    
    # Реферальная связь
    ref_conn = info['referral_connection']
    print("=" * 80)
    print("🔗 РЕФЕРАЛЬНАЯ СВЯЗЬ")
    print("=" * 80)
    if ref_conn['is_referred']:
        print(f"✅ Пользователь является рефералом")
        print(f"👤 Рефер: {ref_conn['referrer_name'] or 'N/A'} (@{ref_conn['referrer_username'] or 'N/A'})")
        print(f"🆔 ID рефера: {ref_conn['referrer_id']}")
        print(f"📅 Дата связи: {ref_conn['referral_created_at']}")
    else:
        print("❌ Пользователь не является рефералом")
    print()
    
    # Рефералы пользователя
    referrals = info['referrals']
    print("=" * 80)
    print(f"👥 РЕФЕРАЛЫ ПОЛЬЗОВАТЕЛЯ (Всего: {referrals['total_count']}, Активных: {referrals['active_count']})")
    print("=" * 80)
    if referrals['list']:
        for i, ref in enumerate(referrals['list'], 1):
            print(f"{i}. ID: {ref['user_id']} | @{ref['username'] or 'N/A'} | {ref['name'] or 'N/A'} | {ref['referral_created_at']}")
    else:
        print("Нет рефералов")
    print()
    
    # Баланс
    balance = info['balance']
    print("=" * 80)
    print("💰 БАЛАНС")
    print("=" * 80)
    print(f"💵 Заработано: {balance['total_earned']:.2f} сом")
    print(f"💸 Выведено: {balance['total_withdrawn']:.2f} сом")
    print(f"💳 Доступно: {balance['available_balance']:.2f} сом")
    print()
    
    # Статистика заработка
    earnings = info['earnings_stats']
    print("=" * 80)
    print("📊 СТАТИСТИКА ЗАРАБОТКА")
    print("=" * 80)
    print(f"📈 Всего заработков: {earnings['total_earnings_count']}")
    print(f"💰 Общая комиссия: {earnings['total_commission']:.2f} сом")
    if earnings['first_earning_date']:
        print(f"📅 Первый заработок: {earnings['first_earning_date']}")
    if earnings['last_earning_date']:
        print(f"📅 Последний заработок: {earnings['last_earning_date']}")
    print()
    
    # Последние транзакции
    transactions = info['recent_transactions']
    print("=" * 80)
    print(f"💳 ПОСЛЕДНИЕ ТРАНЗАКЦИИ ({len(transactions)})")
    print("=" * 80)
    if transactions:
        for t in transactions:
            print(f"  • {t['type']} | {t['bookmaker'] or 'N/A'} | {t['amount']:.2f} сом | {t['status']} | {t['created_at']}")
    else:
        print("Нет транзакций")
    print()
    
    # Последние заявки
    requests = info['recent_requests']
    print("=" * 80)
    print(f"📋 ПОСЛЕДНИЕ ЗАЯВКИ ({len(requests)})")
    print("=" * 80)
    if requests:
        for r in requests:
            print(f"  • #{r['id']} | {r['type']} | {r['bookmaker'] or 'N/A'} | {r['amount']:.2f if r['amount'] else 'N/A'} сом | {r['status']} | {r['created_at']}")
            if r['processed_by']:
                print(f"    Обработано: {r['processed_by']}")
    else:
        print("Нет заявок")
    print()
    
    print("=" * 80)


def main():
    """Главная функция"""
    print("=" * 80)
    print("🔍 ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ПОЛЬЗОВАТЕЛЕ")
    print("=" * 80)
    print()
    
    # Получаем ID из аргументов или интерактивно
    if len(sys.argv) >= 2:
        try:
            user_id = int(sys.argv[1])
        except ValueError:
            print("❌ Ошибка: ID должен быть числом")
            sys.exit(1)
    else:
        # Интерактивный режим
        user_id_str = input("Введите Telegram ID пользователя: ").strip()
        if not user_id_str:
            print("❌ Ошибка: ID не может быть пустым")
            sys.exit(1)
        try:
            user_id = int(user_id_str)
        except ValueError:
            print("❌ Ошибка: ID должен быть числом")
            sys.exit(1)
    
    print()
    print(f"🔍 Поиск информации о пользователе {user_id}...")
    print()
    
    # Получаем информацию
    info = get_user_info(user_id)
    
    # Выводим результат
    print_user_info(info)
    
    # Опционально: сохраняем в JSON
    if len(sys.argv) >= 3 and sys.argv[2] == '--json':
        output_file = f"user_{user_id}_info.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(info, f, ensure_ascii=False, indent=2, default=str)
        print(f"\n💾 Данные сохранены в {output_file}")


if __name__ == '__main__':
    main()

