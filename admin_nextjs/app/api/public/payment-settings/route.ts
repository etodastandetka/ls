import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiResponse } from '@/lib/api-helpers'
import { 
  protectAPI, 
  rateLimit, 
  getClientIP 
} from '@/lib/security'

// Публичный эндпоинт для получения настроек платежей (без авторизации)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

export async function GET(request: NextRequest) {
  try {
    // 🛡️ МАКСИМАЛЬНАЯ ЗАЩИТА
    const protectionResult = protectAPI(request)
    if (protectionResult) return protectionResult

    // Rate limiting (строгий для публичного endpoint)
    const rateLimitResult = rateLimit({ 
      maxRequests: 30, 
      windowMs: 60 * 1000,
      keyGenerator: (req) => `payment_settings:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) {
      const response = NextResponse.json(
        createApiResponse(null, 'Rate limit exceeded'),
        { status: 429 }
      )
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }
    
    // Получаем telegram_user_id из query параметров (если передан)
    const { searchParams } = new URL(request.url)
    const telegramUserId = searchParams.get('user_id')
    
    // Получаем настройки из BotConfiguration
    const configs = await prisma.botConfiguration.findMany()
    const settingsMap: Record<string, any> = {}
    
    configs.forEach((config) => {
      let value: any = config.value
      // Пытаемся распарсить JSON, если это строка
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value)
        } catch {
          // Если не JSON, оставляем как строку
        }
      }
      settingsMap[config.key] = value
    })

    // Получаем список админов (telegram_user_id)
    let adminIds = settingsMap.admin_telegram_ids || settingsMap.admin_ids || []
    // Если это строка, пытаемся распарсить как JSON массив
    if (typeof adminIds === 'string') {
      try {
        adminIds = JSON.parse(adminIds)
      } catch {
        // Если не JSON, разбиваем по запятой
        adminIds = adminIds.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
      }
    }
    const adminIdsArray = Array.isArray(adminIds) ? adminIds : []
    const isAdmin = telegramUserId && adminIdsArray.includes(telegramUserId.toString())

    // Получаем настройки депозитов
    let depositSettings = settingsMap.deposit_settings || settingsMap.deposits || {
      enabled: true,
      banks: ['mbank', 'bakai', 'balance', 'demir', 'omoney', 'megapay']
    }

    // Получаем настройки выводов
    let withdrawalSettings = settingsMap.withdrawal_settings || settingsMap.withdrawals || {
      enabled: true,
      banks: ['kompanion', 'odengi', 'bakai', 'balance', 'megapay', 'mbank']
    }
    
    // Если пользователь админ - всегда включаем депозиты и выводы
    if (isAdmin) {
      depositSettings = typeof depositSettings === 'object' 
        ? { ...depositSettings, enabled: true }
        : { enabled: true, banks: ['mbank', 'bakai', 'balance', 'demir', 'omoney', 'megapay'] }
      
      withdrawalSettings = typeof withdrawalSettings === 'object'
        ? { ...withdrawalSettings, enabled: true }
        : { enabled: true, banks: ['kompanion', 'odengi', 'bakai', 'balance', 'megapay', 'mbank'] }
    }

    // Получаем настройки казино
    const casinoSettings = settingsMap.casinos || {
      '1xbet': true,
      '1win': true,
      melbet: true,
      mostbet: true,
      winwin: true
    }

    // Получаем настройки букмекеров (депозиты и выводы)
    // Дефолтные значения для всех букмекеров
    const defaultBookmakerSettings = {
      '1xbet': { deposit_enabled: true, withdraw_enabled: true },
      '1win': { deposit_enabled: true, withdraw_enabled: true },
      melbet: { deposit_enabled: true, withdraw_enabled: true },
      mostbet: { deposit_enabled: true, withdraw_enabled: true },
      winwin: { deposit_enabled: true, withdraw_enabled: true },
      '888starz': { deposit_enabled: true, withdraw_enabled: true }
    }
    
    // Мержим настройки из базы с дефолтными (если настройка не определена, используем дефолт)
    let bookmakerSettings: Record<string, { deposit_enabled: boolean; withdraw_enabled: boolean }> = { ...defaultBookmakerSettings }
    if (settingsMap.bookmaker_settings && typeof settingsMap.bookmaker_settings === 'object') {
      // Для каждого букмекера мержим настройки
      Object.keys(defaultBookmakerSettings).forEach((key) => {
        const bookmakerKey = key as keyof typeof defaultBookmakerSettings
        if (settingsMap.bookmaker_settings[bookmakerKey]) {
          bookmakerSettings[bookmakerKey] = {
            deposit_enabled: settingsMap.bookmaker_settings[bookmakerKey].deposit_enabled !== false,
            withdraw_enabled: settingsMap.bookmaker_settings[bookmakerKey].withdraw_enabled !== false
          }
        }
      })
    }

    // Если пользователь админ - всегда включаем депозиты и выводы для всех букмекеров
    if (isAdmin) {
      bookmakerSettings = { ...defaultBookmakerSettings }
    }

    // Формируем ответ в формате, который ожидает клиентский сайт
    const response = {
      success: true,
      deposits: typeof depositSettings === 'object' ? depositSettings : { enabled: depositSettings !== false, banks: [] },
      withdrawals: typeof withdrawalSettings === 'object' ? withdrawalSettings : { enabled: withdrawalSettings !== false, banks: [] },
      casinos: casinoSettings,
      bookmaker_settings: bookmakerSettings,
      pause: settingsMap.pause === 'true' || settingsMap.pause === true,
      maintenance_message: settingsMap.maintenance_message || 'Технические работы. Попробуйте позже.',
      require_receipt_photo: settingsMap.require_receipt_photo === 'true' || settingsMap.require_receipt_photo === true,
    }

    const res = NextResponse.json(response)
    res.headers.set('Access-Control-Allow-Origin', '*')
    return res
  } catch (error: any) {
    console.error('Payment settings API error:', error)
    // Возвращаем настройки по умолчанию при ошибке
    const res = NextResponse.json({
      success: true,
      deposits: { enabled: true, banks: ['mbank', 'bakai', 'balance', 'demir', 'omoney', 'megapay'] },
      withdrawals: { enabled: true, banks: ['kompanion', 'odengi', 'bakai', 'balance', 'megapay', 'mbank'] },
      casinos: {
        '1xbet': true,
        '1win': true,
        melbet: true,
        mostbet: true,
        winwin: true
      },
      bookmaker_settings: {
        '1xbet': { deposit_enabled: true, withdraw_enabled: true },
        '1win': { deposit_enabled: true, withdraw_enabled: true },
        melbet: { deposit_enabled: true, withdraw_enabled: true },
        mostbet: { deposit_enabled: true, withdraw_enabled: true },
        winwin: { deposit_enabled: true, withdraw_enabled: true }
      },
      pause: false,
      maintenance_message: 'Технические работы. Попробуйте позже.',
      require_receipt_photo: false,
    })
    res.headers.set('Access-Control-Allow-Origin', '*')
    return res
  }
}

// Кешируем настройки на 30 секунд (они редко меняются)
export const revalidate = 30

