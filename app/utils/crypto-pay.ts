/**
 * Crypto Pay utilities with KGS (Kyrgyzstani Som) conversion
 */

import { getApiBase } from './fetch'

// Кэш курса валют (обновляется раз в минуту)
let exchangeRateCache: {
    usdtToUsd: number | null;
    usdToKgs: number | null;
    usdtToKgs: number | null;
    timestamp: number;
} = {
    usdtToUsd: null,
    usdToKgs: null,
    usdtToKgs: null,
    timestamp: 0
};

const CACHE_DURATION = 30 * 1000; // 30 секунд (для более актуального курса)

/**
 * Сброс кэша курса валют (для принудительного обновления)
 */
export function clearExchangeRateCache(): void {
    exchangeRateCache = {
        usdtToUsd: null,
        usdToKgs: null,
        usdtToKgs: null,
        timestamp: 0
    };
}

/**
 * Получение курса валют через API админки
 */
export async function getExchangeRate(): Promise<{
    usdtToUsd: number | null;
    usdToKgs: number | null;
    usdtToKgs: number | null;
}> {
    // Проверяем кэш
    const now = Date.now();
    if (exchangeRateCache.timestamp > 0 && (now - exchangeRateCache.timestamp) < CACHE_DURATION) {
        return {
            usdtToUsd: exchangeRateCache.usdtToUsd,
            usdToKgs: exchangeRateCache.usdToKgs,
            usdtToKgs: exchangeRateCache.usdtToKgs
        };
    }

    try {
        const apiUrl = getApiBase();
        
        console.log('📡 Fetching exchange rate from:', `${apiUrl}/api/crypto-pay/exchange-rate`);
        const response = await fetch(`${apiUrl}/api/crypto-pay/exchange-rate`, {
            cache: 'no-store'
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API response not OK:', response.status, errorText);
            throw new Error(`Failed to fetch exchange rate: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        console.log('📊 Exchange rate API response:', data);
        
        if (data.success && data.data) {
            console.log('✅ Exchange rates received:', {
                usdtToUsd: data.data.usdtToUsd,
                usdToKgs: data.data.usdToKgs,
                usdtToKgs: data.data.usdtToKgs
            });
            
            exchangeRateCache = {
                usdtToUsd: data.data.usdtToUsd,
                usdToKgs: data.data.usdToKgs,
                usdtToKgs: data.data.usdtToKgs,
                timestamp: now
            };
            
            return {
                usdtToUsd: data.data.usdtToUsd,
                usdToKgs: data.data.usdToKgs,
                usdtToKgs: data.data.usdtToKgs
            };
        } else {
            console.error('❌ API response format error:', data);
            throw new Error('Invalid API response format');
        }
    } catch (error: any) {
        console.error('❌ Error fetching exchange rate from API:', error);
        // Не возвращаем fallback - пусть пользователь видит ошибку
        throw new Error(`Failed to fetch exchange rate from API: ${error.message || 'Unknown error'}. Please try again later.`);
    }

    // Если API вернул пустой ответ, выбрасываем ошибку
    throw new Error('Exchange rate API returned empty data. Please check server configuration.');
}

/**
 * Конвертация долларов (USD) в USDT
 * Для Crypto Bot: пользователь вводит USD, конвертируем в USDT
 */
export async function usdToUsdt(usd: number): Promise<number> {
    const rates = await getExchangeRate();
    // USDT обычно равен USD (1:1), но используем реальный курс если доступен
    const rate = rates.usdtToUsd || 1;
    return Math.round((usd / rate) * 100) / 100;
}

/**
 * Конвертация USDT в доллары (USD)
 */
export async function usdtToUsd(usdt: number): Promise<number> {
    const rates = await getExchangeRate();
    const rate = rates.usdtToUsd || 1;
    return Math.round((usdt * rate) * 100) / 100;
}

/**
 * Конвертация долларов (USD) в сомы (KGS)
 * Используется для конвертации суммы после оплаты для пополнения в букмекере
 * Всегда использует реальный курс из API
 */
export async function usdToKgs(usd: number): Promise<number> {
    const rates = await getExchangeRate();
    if (!rates.usdToKgs) {
        throw new Error('USD -> KGS exchange rate not available. Please try again later.');
    }
    const rate = rates.usdToKgs;
    return Math.round((usd * rate) * 100) / 100;
}

/**
 * Конвертация сомов в доллары (USD)
 * Всегда использует реальный курс из API
 */
export async function kgsToUsd(kgs: number): Promise<number> {
    const rates = await getExchangeRate();
    if (!rates.usdToKgs) {
        throw new Error('USD -> KGS exchange rate not available. Please try again later.');
    }
    const rate = rates.usdToKgs;
    return Math.round((kgs / rate) * 100) / 100;
}

/**
 * Конвертация USDT в сомы (KGS)
 * Всегда использует реальный курс из API
 */
export async function usdtToKgs(usdt: number): Promise<number> {
    const rates = await getExchangeRate();
    let rate: number;
    
    if (rates.usdtToKgs) {
        // Используем прямой курс USDT -> KGS
        rate = rates.usdtToKgs;
    } else if (rates.usdtToUsd && rates.usdToKgs) {
        // Конвертируем через USD: USDT -> USD -> KGS
        rate = rates.usdtToUsd * rates.usdToKgs;
    } else {
        throw new Error('USDT -> KGS exchange rate not available. Please try again later.');
    }
    
    return Math.round((usdt * rate) * 100) / 100;
}

/**
 * Конвертация сомов в USDT (для обратной совместимости)
 * Всегда использует реальный курс из API
 */
export async function kgsToUsdt(kgs: number): Promise<number> {
    const rates = await getExchangeRate();
    let rate: number;
    
    if (rates.usdtToKgs) {
        // Используем прямой курс USDT -> KGS
        rate = rates.usdtToKgs;
    } else if (rates.usdtToUsd && rates.usdToKgs) {
        // Конвертируем через USD: USDT -> USD -> KGS
        rate = rates.usdtToUsd * rates.usdToKgs;
    } else {
        throw new Error('USDT -> KGS exchange rate not available. Please try again later.');
    }
    
    return Math.round((kgs / rate) * 100) / 100;
}

/**
 * Форматирование суммы в сомах
 */
export function formatKgs(amount: number | string): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    return `${num.toFixed(2)} сом`;
}

/**
 * Форматирование суммы в USDT
 */
export function formatUsdt(amount: number | string | undefined | null): string {
    if (amount === undefined || amount === null) return '0.00 USDT';
    let num: number;
    if (typeof amount === 'string') {
        num = parseFloat(amount);
    } else if (typeof amount === 'number') {
        num = amount;
    } else {
        num = 0;
    }
    if (isNaN(num)) return '0.00 USDT';
    return `${num.toFixed(2)} USDT`;
}

/**
 * Форматирование суммы в долларах
 */
export function formatUsd(amount: number | string): string {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(num)) return '0.00 USD';
    return `$${num.toFixed(2)}`;
}

/**
 * Валидация суммы в долларах для криптоплатежей
 */
export function validateCryptoAmount(amountUsd: number): { valid: boolean; error?: string } {
    if (amountUsd < 1) {
        return {
            valid: false,
            error: 'Минимальная сумма: $1 USD'
        };
    }
    
    if (amountUsd > 1000) {
        return {
            valid: false,
            error: 'Максимальная сумма: $1000 USD'
        };
    }
    
    return { valid: true };
}

