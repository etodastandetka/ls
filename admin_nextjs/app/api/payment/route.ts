import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiResponse } from '@/lib/api-helpers'
import { sendTelegramGroupMessage } from '@/lib/telegram-group'
import { 
  rateLimit, 
  sanitizeInput, 
  containsSQLInjection, 
  containsXSS,
  getClientIP 
} from '@/lib/security'
import { getAdminInternalUrl, getAdminPublicUrl } from '@/config/domains'
import { AUTO_DEPOSIT_CONFIG, DEPOSIT_CONFIG } from '@/config/app'

/**
 * Планирует отложенное уведомление о депозите через минуту
 * Вызывается только если автопополнение не сработало
 * ВАЖНО: Использует setTimeout, который работает в контексте сервера
 * Если сервер перезагрузится, уведомление не отправится (но это нормально)
 */
function scheduleDelayedNotification(requestId: number) {
  // Используем setTimeout для вызова endpoint через N минут (из конфигурации)
  // ВАЖНО: Это работает только если сервер не перезагрузится
  setTimeout(async () => {
    try {
      // Используем централизованную конфигурацию доменов
      // Приоритет: внутренний URL (для локальных вызовов), затем публичный
      const baseUrl = getAdminInternalUrl() || getAdminPublicUrl()
      
      console.log(`⏰ [Delayed Notification] Sending notification for request ${requestId} after delay`)
      
      const response = await fetch(`${baseUrl}/api/notifications/delayed-deposit?requestId=${requestId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })
      
      if (response.ok) {
        try {
          const data = await response.json()
          if (data.success && !data.data?.skipped) {
            console.log(`✅ [Delayed Notification] Notification sent for request ${requestId}`)
          } else {
            console.log(`ℹ️ [Delayed Notification] Notification skipped for request ${requestId}:`, data.data?.reason || 'Unknown reason')
          }
        } catch (parseError: any) {
          console.error(`❌ [Delayed Notification] Failed to parse response for request ${requestId}:`, parseError.message)
        }
      } else {
        // Получаем текст ошибки для лучшей диагностики
        let errorText = `Status: ${response.status}`
        try {
          const errorData = await response.text()
          if (errorData) {
            errorText += `, Response: ${errorData.substring(0, 200)}`
          }
        } catch (e) {
          // Игнорируем ошибки парсинга
        }
        console.error(`❌ [Delayed Notification] Failed to send notification for request ${requestId}: ${errorText}`)
      }
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error'
      const errorStack = error.stack ? `\nStack: ${error.stack.substring(0, 500)}` : ''
      console.error(`❌ [Delayed Notification] Error sending notification for request ${requestId}: ${errorMessage}${errorStack}`)
    }
  }, AUTO_DEPOSIT_CONFIG.DELAYED_NOTIFICATION_MS)
}

// API для создания заявок из внешних источников (мини-приложение, бот и т.д.)
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

export async function POST(request: NextRequest) {
  try {
    // 🛡️ Rate limiting для payment endpoint (критичный)
    const { SECURITY_CONFIG } = await import('@/config/app')
    const rateLimitResult = rateLimit({ 
      maxRequests: Math.floor(SECURITY_CONFIG.RATE_LIMIT_MAX_REQUESTS / 3), // Строже для критичного endpoint
      windowMs: SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS,
      keyGenerator: (req) => `payment:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) {
      return rateLimitResult
    }

    const body = await request.json()

    // 🛡️ Валидация и очистка входных данных
    const sanitizedBody = sanitizeInput(body)
    
    // Определяем источник заявки (bot или mini_app)
    const source = sanitizedBody.source || (sanitizedBody.telegram_user_id ? 'bot' : 'mini_app')
    
    const {
      userId,
      user_id,
      telegram_user_id,
      playerId,
      type, // deposit/withdraw
      amount,
      bookmaker,
      bank,
      payment_method, // payment_method из клиентского сайта
      phone,
      account_id,
      telegram_username,
      telegram_first_name,
      telegram_last_name,
      receipt_photo, // base64 строка фото чека (для deposit)
      qr_photo, // base64 строка фото QR-кода (для withdraw)
      site_code, // Код ордера на вывод (для withdraw)
      transaction_id, // ID транзакции от Mostbet API (для withdraw)
    } = sanitizedBody

    // Маппинг payment_method на bank (для клиентского сайта)
    // Если bank не указан, но есть payment_method, используем его
    let finalBank = bank || payment_method || null
    
    // Нормализация названий банков
    if (finalBank) {
      const bankMapping: Record<string, string> = {
        'omoney': 'omoney',
        'o!money': 'omoney',
        'odengi': 'omoney',
        'o! bank': 'omoney',
        'obank': 'omoney',
        'demirbank': 'demirbank',
        'demir': 'demirbank',
        'balance': 'balance',
        'balance.kg': 'balance',
        'bakai': 'bakai',
        'megapay': 'megapay',
        'mbank': 'mbank',
        'optima': 'optima',
        'компаньон': 'kompanion',
        'kompanion': 'kompanion',
        'companion': 'kompanion'
      }
      
      const normalizedBank = finalBank.toLowerCase().trim()
      finalBank = bankMapping[normalizedBank] || finalBank
    }

    // 🛡️ Проверка на SQL инъекции и XSS в строковых полях
    const stringFields = [
      { name: 'telegram_username', value: telegram_username },
      { name: 'telegram_first_name', value: telegram_first_name },
      { name: 'telegram_last_name', value: telegram_last_name },
      { name: 'bookmaker', value: bookmaker },
      { name: 'bank', value: finalBank },
      { name: 'phone', value: phone },
      { name: 'account_id', value: account_id },
      { name: 'site_code', value: site_code }
    ].filter(f => f.value)
    
    for (const field of stringFields) {
      if (typeof field.value === 'string') {
        if (containsSQLInjection(field.value) || containsXSS(field.value)) {
          console.warn(`🚫 Security threat detected in field '${field.name}' from ${getClientIP(request)}: ${field.value.substring(0, 100)}`)
          return NextResponse.json(
            { error: 'Invalid input detected' },
            { status: 400 }
          )
        }
      }
    }

    // Определяем user_id (Telegram ID пользователя - обязателен для правильной идентификации)
    // Приоритет: telegram_user_id > userId > user_id
    // НЕ используем playerId как userId, т.к. это ID аккаунта в букмекере, а не Telegram ID
    let finalUserId = telegram_user_id || userId || user_id
    
    // accountId - это ID аккаунта в букмекере (может быть одинаковым для разных пользователей)
    // Приоритет: account_id > playerId (но НЕ userId/user_id, т.к. это Telegram ID)
    const finalAccountId = account_id || playerId

    console.log('📝 Payment API - Creating request:', {
      telegram_user_id,
      userId,
      user_id,
      playerId,
      finalUserId,
      type,
      amount,
      bookmaker,
      bank: finalBank
    })

    // 🚫 Блокировка пользователей: не принимаем заявки от заблокированных
    if (!finalUserId) {
      return NextResponse.json(
        createApiResponse(null, 'User ID is required'),
        { status: 400 }
      )
    }
    const blockedUser = await prisma.botUser.findUnique({
      where: { userId: BigInt(finalUserId) },
      select: { isActive: true },
    })
    if (blockedUser?.isActive === false) {
      return NextResponse.json(
        createApiResponse(null, 'User is blocked'),
        { status: 403 }
      )
    }

    // 🛡️ КРИТИЧНАЯ ЗАЩИТА ОТ ДУБЛИРОВАНИЯ: проверяем ДО создания заявки
    // Загружаем настройки один раз для всех проверок
    const configs = await prisma.botConfiguration.findMany()
    const settingsMap: Record<string, any> = {}
    
    configs.forEach((config) => {
      let value: any = config.value
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value)
        } catch {
          // Если не JSON, оставляем как строку
        }
      }
      settingsMap[config.key] = value
    })

    // Получаем список админов
    let adminIds = settingsMap.admin_telegram_ids || []
    if (typeof adminIds === 'string') {
      try {
        adminIds = JSON.parse(adminIds)
      } catch {
        adminIds = adminIds.split(',').map((id: string) => id.trim()).filter((id: string) => id.length > 0)
      }
    }
    const adminIdsArray = Array.isArray(adminIds) ? adminIds : []
    const isAdmin = finalUserId && adminIdsArray.includes(finalUserId.toString())

    // Получаем настройки букмекеров
    const bookmakerSettings = settingsMap.bookmaker_settings || {
      '1xbet': { deposit_enabled: true, withdraw_enabled: true },
      '1win': { deposit_enabled: true, withdraw_enabled: true },
      melbet: { deposit_enabled: true, withdraw_enabled: true },
      mostbet: { deposit_enabled: true, withdraw_enabled: true },
      winwin: { deposit_enabled: true, withdraw_enabled: true }
    }

    // Нормализуем название букмекера для проверки
    const normalizedBookmaker = bookmaker ? bookmaker.toLowerCase().trim() : ''
    const bookmakerKey = normalizedBookmaker === '1win' ? '1win' :
                        normalizedBookmaker === '1xbet' ? '1xbet' :
                        normalizedBookmaker === 'melbet' ? 'melbet' :
                        normalizedBookmaker === 'mostbet' ? 'mostbet' :
                        normalizedBookmaker === 'winwin' ? 'winwin' : null

    // Проверка настроек депозитов
    if (type === 'deposit' && bookmakerKey && !isAdmin) {
      const bookmakerDepositEnabled = bookmakerSettings[bookmakerKey]?.deposit_enabled !== false
      
      if (!bookmakerDepositEnabled) {
        console.error(`🚫 [Payment API] BLOCKED: Deposits disabled for bookmaker ${bookmakerKey} for user ${finalUserId}`)
        return NextResponse.json(
          createApiResponse(null, `Пополнения для ${bookmaker} временно недоступны. Попробуйте позже.`),
          {
            status: 403,
            headers: {
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }
    }

    // Проверка настроек выводов
    if (type === 'withdraw' && finalUserId) {
      // Получаем настройки выводов
      const withdrawalSettings = settingsMap.withdrawal_settings || settingsMap.withdrawals || {
        enabled: true,
        banks: []
      }

      // Проверяем, включены ли выводы
      const withdrawalsEnabled = typeof withdrawalSettings === 'object' 
        ? withdrawalSettings.enabled !== false 
        : withdrawalSettings !== false

      // Если выводы отключены и пользователь не админ - блокируем
      if (!withdrawalsEnabled && !isAdmin) {
        console.error(`🚫 [Payment API] BLOCKED: Withdrawals disabled for user ${finalUserId}`)
        return NextResponse.json(
          createApiResponse(null, 'Вывод средств временно недоступен. Попробуйте позже.'),
          {
            status: 403,
            headers: {
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }

      // Проверка настроек букмекера для выводов
      if (bookmakerKey && !isAdmin) {
        const bookmakerWithdrawEnabled = bookmakerSettings[bookmakerKey]?.withdraw_enabled !== false
        
        if (!bookmakerWithdrawEnabled) {
          console.error(`🚫 [Payment API] BLOCKED: Withdrawals disabled for bookmaker ${bookmakerKey} for user ${finalUserId}`)
          return NextResponse.json(
            createApiResponse(null, `Выводы для ${bookmaker} временно недоступны. Попробуйте позже.`),
            {
              status: 403,
              headers: {
                'Access-Control-Allow-Origin': '*',
              }
            }
          )
        }
      }

      // Проверка на pending заявку убрана - пользователь может отправить только один раз через фронтенд
    }

    // Проверка на точные дубликаты (одинаковые параметры за последние 2 минуты)
    // Для вывода проверка дубликатов убрана - защита на фронтенде
    if (finalUserId && type && amount && type !== 'withdraw') {
      const whereClause: any = {
        userId: BigInt(finalUserId),
        requestType: type,
        amount: parseFloat(amount),
        bookmaker: bookmaker || undefined,
        accountId: finalAccountId || undefined,
        createdAt: {
          gte: new Date(Date.now() - 2 * 60 * 1000) // Последние 2 минуты
        },
        status: 'pending' // Проверяем только pending заявки
      }

      // Проверяем существование дубликата ДО создания
      const existingRequest = await prisma.request.findFirst({
        where: whereClause,
        orderBy: {
          createdAt: 'desc'
        }
      })

      if (existingRequest) {
        console.log(`⚠️ Payment API: Duplicate request detected (${type}), returning existing request:`, existingRequest.id)
        return NextResponse.json(
          createApiResponse({
            id: existingRequest.id,
            userId: existingRequest.userId.toString(),
            type: existingRequest.requestType,
            status: existingRequest.status,
            amount: existingRequest.amount?.toString()
          }, 'Заявка уже создана. Не нажимайте кнопку несколько раз.'),
          {
            status: 200,
            headers: {
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }
    }

    // Проверяем обязательные поля
    // Для error_log не требуется amount
    if (!type) {
      console.error('❌ Payment API: Missing required field: type', { 
        body: JSON.stringify(body).substring(0, 500)
      })
      const errorResponse = NextResponse.json(
        createApiResponse(null, 'Missing required field: type'),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
      return errorResponse
    }

    // Для error_log не требуется amount
    if (type !== 'error_log' && !amount) {
      console.error('❌ Payment API: Missing required field: amount', { 
        userId, 
        user_id, 
        telegram_user_id, 
        playerId, 
        finalUserId,
        type, 
        amount,
        body: JSON.stringify(body).substring(0, 500) // Первые 500 символов для отладки
      })
      const errorResponse = NextResponse.json(
        createApiResponse(null, 'Missing required field: amount'),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
      return errorResponse
    }

    // Валидация минимального депозита в зависимости от букмекера
    let finalAmount = amount ? parseFloat(amount) : null
    if (type === 'deposit' && finalAmount) {
      if (!isNaN(finalAmount)) {
        const normalizedBookmaker = (bookmaker || '').toLowerCase()
        let minDeposit = DEPOSIT_CONFIG.MIN_DEPOSIT_AMOUNT
        
        // Для 1win минимальный депозит из конфигурации
        if (normalizedBookmaker.includes('1win') || normalizedBookmaker === '1win') {
          minDeposit = DEPOSIT_CONFIG.MIN_DEPOSIT_AMOUNT_1WIN
        }
        // Для Mostbet минимальный депозит 400
        else if (normalizedBookmaker.includes('mostbet') || normalizedBookmaker === 'mostbet') {
          minDeposit = DEPOSIT_CONFIG.MIN_DEPOSIT_AMOUNT_MOSTBET
        }
        
        if (finalAmount < minDeposit) {
          const errorResponse = NextResponse.json(
            createApiResponse(null, `Минимальная сумма депозита для ${bookmaker || 'этого букмекера'}: ${minDeposit} сом`),
            { 
              status: 400,
              headers: {
                'Access-Control-Allow-Origin': '*',
              }
            }
          )
          return errorResponse
        }
        
        // Убрана проверка на максимальную сумму депозита - разрешаем до 500к
        // if (finalAmount > DEPOSIT_CONFIG.MAX_DEPOSIT_AMOUNT) {
        //   const errorResponse = NextResponse.json(
        //     createApiResponse(null, `Максимальная сумма депозита: ${DEPOSIT_CONFIG.MAX_DEPOSIT_AMOUNT} сом`),
        //     { 
        //       status: 400,
        //       headers: {
        //         'Access-Control-Allow-Origin': '*',
        //       }
        //     }
        //   )
        //   return errorResponse
        // }

        // 🔄 Автоматическая корректировка копеек для избежания конфликтов
        // ВАЖНО: Если сумма уже содержит копейки (от клиентского сайта), проверяем только на конфликт
        // Если копеек нет (от бота), генерируем их автоматически
        const hasCents = finalAmount % 1 !== 0 // Проверяем, есть ли копейки (остаток от деления на 1)
        const MAX_ATTEMPTS = 10
        let adjustedAmount = finalAmount
        let attempts = 0
        
        while (attempts < MAX_ATTEMPTS) {
          // Проверяем, есть ли активная заявка с такой же суммой
          const existingRequest = await prisma.request.findFirst({
            where: {
              requestType: 'deposit',
              amount: adjustedAmount,
              status: {
                in: ['pending', 'processing', 'deferred'] // Активные статусы
              }
            },
            orderBy: {
              createdAt: 'desc'
            }
          })
          
          if (!existingRequest) {
            // Сумма свободна, используем её
            if (adjustedAmount !== finalAmount) {
              console.log(`✅ [Payment API] Amount adjusted: ${finalAmount} → ${adjustedAmount} (to avoid conflict)`)
            }
            finalAmount = adjustedAmount
            break
          }
          
          // Сумма занята
          // Если копейки уже были (от клиентского сайта), просто увеличиваем на 0.01
          // Если копеек не было (от бота), генерируем рандомные копейки
          attempts++
          if (hasCents) {
            // Копейки уже есть - просто увеличиваем на 0.01
            adjustedAmount = Math.round((adjustedAmount + 0.01) * 100) / 100
          } else {
            // Копеек не было - генерируем рандомные (от 0.01 до 0.99)
            const randomCents = Math.floor(Math.random() * 99) + 1
            adjustedAmount = Math.floor(finalAmount) + (randomCents / 100)
            console.log(`🎲 [Payment API] Generated random cents: ${randomCents} (${finalAmount} → ${adjustedAmount})`)
          }
          
          // Убрана проверка на максимальную сумму - разрешаем до 500к
          // if (adjustedAmount > DEPOSIT_CONFIG.MAX_DEPOSIT_AMOUNT) {
          //   console.warn(`⚠️ [Payment API] Cannot adjust amount ${finalAmount}: all variants exceed max deposit`)
          //   // Используем последнюю проверенную сумму
          //   finalAmount = adjustedAmount - 0.01
          //   break
          // }
        }
        
        if (attempts >= MAX_ATTEMPTS) {
          console.warn(`⚠️ [Payment API] Could not find free amount after ${MAX_ATTEMPTS} attempts, using last checked: ${adjustedAmount}`)
          finalAmount = adjustedAmount
        }
      }
    }

    // Для error_log просто логируем и возвращаем успех
    if (type === 'error_log') {
      const errorData = body.error || {}
      console.error('📝 Error log received:', {
        message: errorData.message,
        name: errorData.name,
        url: errorData.url,
        userAgent: errorData.userAgent,
        timestamp: errorData.timestamp,
        telegram_user_id: body.telegram_user_id
      })
      return NextResponse.json(
        createApiResponse({ logged: true }, undefined, 'Error logged successfully'),
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }
    
    // Если userId не указан, используем accountId или playerId как fallback
    if (!finalUserId) {
      console.warn('⚠️ Payment API: userId not found, using accountId/playerId as fallback')
      finalUserId = finalAccountId || playerId || 'unknown'
    }

    // Преобразуем userId в BigInt (если это строка с числом)
    // Если не удается преобразовать, используем хеш от строки
    let userIdBigInt: bigint
    try {
      if (typeof finalUserId === 'string') {
        // Пробуем преобразовать в число
        const num = parseInt(finalUserId, 10)
        if (!isNaN(num) && num > 0) {
          userIdBigInt = BigInt(num)
        } else {
          // Если не число, создаем хеш от строки
          console.warn('⚠️ userId is not a number, creating hash:', finalUserId)
          const hash = finalUserId.split('').reduce((acc, char) => {
            return ((acc << 5) - acc) + char.charCodeAt(0) | 0
          }, 0)
          userIdBigInt = BigInt(Math.abs(hash))
        }
      } else {
        userIdBigInt = BigInt(finalUserId)
      }
    } catch (e) {
      console.error('❌ Payment API: Invalid userId format, using fallback', finalUserId, e)
      // Используем хеш от строки как fallback
      const hash = String(finalUserId).split('').reduce((acc, char) => {
        return ((acc << 5) - acc) + char.charCodeAt(0) | 0
      }, 0)
      userIdBigInt = BigInt(Math.abs(hash))
    }

    // Если данные пользователя не переданы, пытаемся получить из BotUser
    let finalFirstName = telegram_first_name
    let finalLastName = telegram_last_name
    let finalUsername = telegram_username
    
    if (!finalFirstName || !finalLastName) {
      try {
        const botUser = await prisma.botUser.findUnique({
          where: { userId: userIdBigInt },
          select: {
            firstName: true,
            lastName: true,
            username: true,
          },
        })
        
        if (botUser) {
          if (!finalFirstName && botUser.firstName) {
            finalFirstName = botUser.firstName
          }
          if (!finalLastName && botUser.lastName) {
            finalLastName = botUser.lastName
          }
          if (!finalUsername && botUser.username) {
            finalUsername = botUser.username
          }
          console.log('✅ [Payment API] Получены данные пользователя из BotUser:', {
            firstName: finalFirstName,
            lastName: finalLastName,
            username: finalUsername
          })
        }
      } catch (error: any) {
        console.warn('⚠️ [Payment API] Не удалось получить данные пользователя из BotUser:', error.message)
      }
    }

    console.log('💾 Payment API - Saving to database:', {
      userId: userIdBigInt.toString(),
      username: finalUsername,
      firstName: finalFirstName,
      lastName: finalLastName,
      type,
      originalAmount: amount ? parseFloat(amount) : null,
      finalAmount: finalAmount,
      bookmaker,
      bank: finalBank
    })

    // Для error_log сохраняем информацию об ошибке в statusDetail
    // Для вывода Mostbet сохраняем transaction_id в statusDetail
    let statusDetail: string | null = null
    if (type === 'error_log' && body.error) {
      // Сохраняем информацию об ошибке
      statusDetail = JSON.stringify({
        error: body.error,
        timestamp: body.error.timestamp || new Date().toISOString(),
        userAgent: body.error.userAgent,
        url: body.error.url
      })
    } else if (type === 'withdraw' && transaction_id) {
      // Сохраняем transaction_id от Mostbet API в statusDetail
      statusDetail = JSON.stringify({
        transaction_id: transaction_id,
        source: 'mostbet_api'
      })
      console.log(`[Payment API] Saving transaction_id for Mostbet withdrawal: ${transaction_id}`)
    }

    // Нормализуем фото чека: убеждаемся что это валидный base64 с префиксом
    let photoUrl = receipt_photo || qr_photo || null
    if (photoUrl) {
      // Функция для нормализации base64 строки
      const normalizeBase64 = (str: string): string | null => {
        // Удаляем все пробелы и переносы строк
        str = str.trim().replace(/\s/g, '')
        
        // Если уже правильный формат, возвращаем как есть
        if (/^data:image\/\w+;base64,.+$/.test(str)) {
          return str
        }
        
        // Если есть неправильный формат (например, data:image/jpegbase64 или data:image/jpegbase64,)
        // Ищем паттерн data:image/типbase64 (без точки с запятой между типом и base64)
        const wrongFormatMatch = str.match(/^data:image\/(jpeg|png|gif|webp|jpg)base64,?(.+)$/i)
        if (wrongFormatMatch) {
          const mimeType = wrongFormatMatch[1].toLowerCase()
          const base64Data = wrongFormatMatch[2]
          // Нормализуем mimeType (jpg -> jpeg)
          const normalizedMimeType = mimeType === 'jpg' ? 'jpeg' : mimeType
          console.log('📸 [Payment API] Исправлен неправильный формат (без точки с запятой):', normalizedMimeType)
          return `data:image/${normalizedMimeType};base64,${base64Data}`
        }
        
        // Также проверяем более общий случай: data:image/любое_словоbase64
        const generalWrongMatch = str.match(/^data:image\/(\w+)base64,?(.+)$/i)
        if (generalWrongMatch) {
          const mimeType = generalWrongMatch[1].toLowerCase()
          const base64Data = generalWrongMatch[2]
          // Нормализуем mimeType
          const normalizedMimeType = mimeType === 'jpg' ? 'jpeg' : mimeType
          console.log('📸 [Payment API] Исправлен общий неправильный формат:', normalizedMimeType)
          return `data:image/${normalizedMimeType};base64,${base64Data}`
        }
        
        // Если есть data:image/... но без base64, или неправильный формат
        const partialMatch = str.match(/^data:image\/(\w+)([^;]*)(.+)$/i)
        if (partialMatch) {
          const mimeType = partialMatch[1]
          const base64Data = partialMatch[3].replace(/^[,;]/, '') // Убираем лишние символы
          return `data:image/${mimeType};base64,${base64Data}`
        }
        
        // Если нет префикса data:image, добавляем его
        // Пытаемся определить тип изображения по первым байтам base64
        let mimeType = 'image/jpeg' // По умолчанию JPEG
        
        if (str.startsWith('iVBORw0KGgo')) {
          mimeType = 'image/png'
        } else if (str.startsWith('R0lGODlh') || str.startsWith('R0lGODdh')) {
          mimeType = 'image/gif'
        } else if (str.startsWith('/9j/')) {
          mimeType = 'image/jpeg'
        } else if (str.startsWith('UklGR')) {
          mimeType = 'image/webp'
        }
        
        return `data:${mimeType};base64,${str}`
      }
      
      photoUrl = normalizeBase64(photoUrl)
      
      // Проверяем валидность base64 строки
      if (photoUrl) {
        const base64Match = photoUrl.match(/^data:image\/(\w+);base64,(.+)$/)
        if (!base64Match || !base64Match[2]) {
          console.error('❌ [Payment API] Неверный формат base64 фото:', {
            photoLength: photoUrl.length,
            photoPreview: photoUrl.substring(0, 100)
          })
          photoUrl = null // Не сохраняем невалидное фото
        }
      }
    }
    
    console.log('📸 [Payment API] Сохранение фото чека:', {
      hasPhoto: !!photoUrl,
      photoLength: photoUrl?.length || 0,
      isBase64: photoUrl?.startsWith('data:image') || false,
      requestType: type,
      photoPreview: photoUrl ? photoUrl.substring(0, 50) + '...' : null
    })
    
    // Проверка на дубликат кода вывода убрана - защита на фронтенде
    
    const newRequest = await prisma.request.create({
      data: {
        userId: userIdBigInt,
        username: finalUsername,
        firstName: finalFirstName,
        lastName: finalLastName,
        bookmaker,
        accountId: finalAccountId?.toString(),
        amount: finalAmount, // В сомах (для пополнения в букмекере), null для error_log (может быть скорректировано для депозитов)
        requestType: type,
        bank: finalBank,
        phone,
        status: 'pending',
        statusDetail: statusDetail, // Для error_log содержит JSON с информацией об ошибке
        photoFileUrl: photoUrl, // Сохраняем base64 фото чека (для deposit) или QR-кода (для withdraw)
        paymentMethod: 'bank',
        withdrawalCode: site_code || null, // Код ордера на вывод (для 1xbet)
        source: source, // 'bot' или 'mini_app'
      },
    })
    
    console.log('✅ [Payment API] Заявка создана:', {
      id: newRequest.id,
      hasPhoto: !!newRequest.photoFileUrl,
      photoFileUrlLength: newRequest.photoFileUrl?.length || 0
    })
    

    console.log('✅ Payment API - Request created successfully:', {
      id: newRequest.id,
      userId: newRequest.userId.toString(),
      type: newRequest.requestType,
      status: newRequest.status,
      amount: newRequest.amount?.toString()
    })

    // Если это заявка на пополнение - СРАЗУ проверяем есть ли входящие платежи с такой суммой
    // Автопополнение должно работать секунду в секунду - мгновенно при создании заявки
    if (type === 'deposit' && newRequest.amount) {
      const requestAmount = parseFloat(newRequest.amount.toString())
      console.log(`🔍 [Auto-Deposit] Instantly checking for incoming payments with amount ${requestAmount} for request ${newRequest.id}`)
      
      // Ищем необработанные входящие платежи с точным совпадением суммы
      // Делаем это СИНХРОННО (await) чтобы автопополнение сработало мгновенно
      try {
      // Ищем входящие платежи в окне ±5 минут от времени создания заявки
      // Это защищает от случайного пополнения если пользователь не пополнял
      // И работает даже если платеж пришел ДО создания заявки
      const requestCreatedAt = newRequest.createdAt
      const searchWindowMs = AUTO_DEPOSIT_CONFIG.REQUEST_SEARCH_WINDOW_MS
      const searchWindowStart = new Date(requestCreatedAt.getTime() - searchWindowMs) // 5 минут ДО создания заявки
      const searchWindowEnd = new Date(requestCreatedAt.getTime() + searchWindowMs) // 5 минут ПОСЛЕ создания заявки
      
      // КРИТИЧЕСКИ ВАЖНО: Максимальный возраст платежа - не более 1 часа от текущего времени
      // Это предотвращает привязку старых платежей (например, месяц назад) к новым заявкам
      // даже если суммы совпадают с копейками
      const maxPaymentAge = 60 * 60 * 1000 // 1 час
      const minPaymentDate = new Date(Date.now() - maxPaymentAge)
      
      console.log(`🔍 [Auto-Deposit] Searching payments in window: ${searchWindowStart.toISOString()} to ${searchWindowEnd.toISOString()} for request ${newRequest.id}`)
      console.log(`   Max payment age: 1 hour (payments older than ${minPaymentDate.toISOString()} will be ignored)`)
      
      const incomingPayments = await prisma.incomingPayment.findMany({
        where: {
          isProcessed: false,
          amount: requestAmount,
          // КРИТИЧЕСКИ ВАЖНО: Платеж не должен быть старше 1 часа
          paymentDate: {
            gte: minPaymentDate, // Платеж не старше 1 часа
          },
          OR: [
            {
              // Платежи где paymentDate попадает в окно
              paymentDate: {
                gte: searchWindowStart,
                lte: searchWindowEnd
              }
            },
            {
              // Или платежи где createdAt попадает в окно (если paymentDate не точный)
              createdAt: {
                gte: searchWindowStart,
                lte: searchWindowEnd
              }
            }
          ]
        },
          orderBy: {
            paymentDate: 'desc' // Берем самый свежий
          },
          take: 1 // Только один
        })

        if (incomingPayments.length > 0) {
          const payment = incomingPayments[0]
          const timeDiff = requestCreatedAt.getTime() - payment.paymentDate.getTime()
          const timeDiffAbs = Math.abs(timeDiff)
          const minutesDiff = Math.floor(timeDiffAbs / 60000)
          const paymentDirection = timeDiff > 0 ? 'BEFORE' : 'AFTER'
          
          // КРИТИЧЕСКИ ВАЖНО: Дополнительная проверка - разница времени не должна превышать окно поиска более чем в 2 раза
          // Это защищает от привязки старых платежей, но позволяет небольшие отклонения
          // Увеличено до 2x окна для большей гибкости (10 минут вместо 5)
          const maxTimeDiff = searchWindowMs * 2 // 10 минут вместо 5
          if (timeDiffAbs > maxTimeDiff) {
            console.log(`⚠️ [Auto-Deposit] Payment ${payment.id} time difference (${minutesDiff} minutes) exceeds max window (${Math.floor(maxTimeDiff / 60000)} minutes), skipping`)
            console.log(`   Payment date: ${payment.paymentDate.toISOString()}, Request created: ${requestCreatedAt.toISOString()}`)
            // Платеж слишком старый или новый - не привязываем
            scheduleDelayedNotification(newRequest.id)
            return
          }
          
          console.log(`✅ [Auto-Deposit] Found matching payment ${payment.id} for NEW request ${newRequest.id}`)
          console.log(`   Payment ${paymentDirection} request by ${minutesDiff} minutes, processing INSTANTLY...`)
          console.log(`   Payment date: ${payment.paymentDate.toISOString()}, Request created: ${requestCreatedAt.toISOString()}`)
          
          // Импортируем функцию автопополнения из отдельного модуля
          const { matchAndProcessPayment } = await import('../../../lib/auto-deposit')
          
          // Вызываем автопополнение СИНХРОННО - ждем результат
          // Это гарантирует что автопополнение произойдет секунду в секунду
          const result = await matchAndProcessPayment(payment.id, requestAmount)
          
          if (result && (result.success || result.paymentLinked)) {
            console.log(`✅ [Auto-Deposit] INSTANT auto-deposit completed for request ${newRequest.id} with payment ${payment.id}`)
            console.log(`   Status updated: ${result.statusUpdated !== false}, Payment linked: ${result.paymentLinked !== false}`)
            // Автопополнение сработало - уведомление НЕ отправляем
          } else {
            console.log(`ℹ️ [Auto-Deposit] Auto-deposit check completed for request ${newRequest.id}, but no match found`)
            // Автопополнение не сработало - отправим уведомление через минуту
            scheduleDelayedNotification(newRequest.id)
          }
        } else {
          console.log(`ℹ️ [Auto-Deposit] No matching incoming payments yet for request ${newRequest.id} (amount: ${requestAmount})`)
          // Автопополнение не сработало - отправим уведомление через N минут (из конфигурации)
          scheduleDelayedNotification(newRequest.id)
        }
      } catch (error: any) {
        console.error(`❌ [Auto-Deposit] Error checking incoming payments for request ${newRequest.id}:`, error.message)
        // Не блокируем создание заявки если проверка не удалась
        // Отправим уведомление через N минут на всякий случай
        scheduleDelayedNotification(newRequest.id)
      }
    }

    // Если это вывод, отправляем уведомление в группу и browser notification
    if (type === 'withdraw') {
      const amountStr = newRequest.amount ? parseFloat(newRequest.amount.toString()).toFixed(2) : '0.00'
      const bookmakerStr = newRequest.bookmaker || 'не указано'
      const usernameStr = newRequest.username || newRequest.firstName || 'Пользователь'
      const accountIdStr = newRequest.accountId || 'не указан'
      
      const groupMessage = `🔴 <b>Новая заявка на вывод</b>\n\n` +
        `👤 Пользователь: ${usernameStr}\n` +
        `💰 Сумма: ${amountStr} сом\n` +
        `🎰 Букмекер: ${bookmakerStr}\n` +
        `🆔 ID аккаунта: ${accountIdStr}\n` +
        `📋 ID заявки: #${newRequest.id}\n\n` +
        `Статус: ожидает обработки`
      
      sendTelegramGroupMessage(groupMessage).catch(err => {
        console.error('Failed to send withdrawal notification to group:', err)
      })
      
      // Отправляем в дополнительную группу для выводов
      sendTelegramGroupMessage(groupMessage, '-1003654117842').catch(err => {
        console.error('Failed to send withdrawal notification to withdrawals group:', err)
      })
      
      // Отправляем browser notification через Service Worker
      // Это будет обработано когда dashboard откроется и обнаружит новую заявку
    }
    
    // Если это пополнение:
    // - Если автопополнение сработало - уведомление НЕ отправляем (уже обработано)
    // - Если автопополнение не сработало - уведомление будет отправлено через минуту через scheduleDelayedNotification

    const response = NextResponse.json(
      createApiResponse({
        id: newRequest.id,
        transactionId: newRequest.id,
        amount: finalAmount, // Возвращаем скорректированную сумму для обновления QR-кода
        originalAmount: amount ? parseFloat(amount) : null, // Исходная сумма для сравнения
        message: 'Заявка успешно создана',
      })
    )
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
  } catch (error: any) {
    console.error('❌ Payment API error:', error)
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack?.substring(0, 500)
    })
    
    // Проверяем, является ли это ошибкой уникального ограничения (duplicate key)
    if (error.code === 'P2002') {
      const errorResponse = NextResponse.json(
        createApiResponse(null, 'Заявка с такими данными уже существует. Пожалуйста, подождите обработки предыдущей заявки.'),
        { status: 409 }
      )
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    // Проверяем, является ли это ошибкой валидации
    if (error.code === 'P2003' || error.code === 'P2011') {
      const errorResponse = NextResponse.json(
        createApiResponse(null, 'Ошибка валидации данных. Проверьте правильность введенных данных.'),
        { status: 400 }
      )
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    const errorResponse = NextResponse.json(
      createApiResponse(null, error.message || 'Ошибка при создании заявки. Пожалуйста, попробуйте еще раз.'),
      { status: 500 }
    )
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    return errorResponse
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, status, status_detail } = body

    if (!id || !status) {
      const response = NextResponse.json(
        createApiResponse(null, 'Missing required fields: id, status'),
        { status: 400 }
      )
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    // ЗАЩИТА: Проверяем, что это не попытка автоматически отменить вывод
    const existingRequest = await prisma.request.findUnique({
      where: { id: parseInt(id) },
      select: { requestType: true, status: true }
    })

    if (!existingRequest) {
      const response = NextResponse.json(
        createApiResponse(null, 'Request not found'),
        { status: 404 }
      )
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    // ЗАЩИТА: Выводы НЕ МОГУТ быть отклонены через этот endpoint
    // Отклонение выводов возможно ТОЛЬКО через админку администратором
    if (status === 'rejected' && existingRequest.requestType === 'withdraw') {
      console.log(`[Payment API] ❌ Attempt to reject withdrawal ${id} via PUT /api/payment - BLOCKED`)
      const response = NextResponse.json(
        createApiResponse(null, 'Withdrawals cannot be rejected automatically. Only admin can reject via admin panel.'),
        { status: 403 }
      )
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    const updateData: any = {
      status,
    }

    if (status_detail) {
      updateData.statusDetail = status_detail
    }

    if (['completed', 'rejected', 'approved'].includes(status)) {
      updateData.processedAt = new Date()
    }

    const updatedRequest = await prisma.request.update({
      where: { id: parseInt(id) },
      data: updateData,
    })

    const response = NextResponse.json(
      createApiResponse({
        ...updatedRequest,
        userId: updatedRequest.userId.toString(), // Convert BigInt to string
        amount: updatedRequest.amount ? updatedRequest.amount.toString() : null,
      })
    )
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
  } catch (error: any) {
    console.error('Payment API update error:', error)
    const errorResponse = NextResponse.json(
      createApiResponse(null, error.message || 'Failed to update request'),
      { status: 500 }
    )
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    return errorResponse
  }
}

