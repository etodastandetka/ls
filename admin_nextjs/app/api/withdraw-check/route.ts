import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiResponse } from '@/lib/api-helpers'
import { processWithdraw, checkWithdrawAmountCashdesk } from '@/lib/casino-withdraw'
import { getCasinoConfig } from '@/lib/deposit-balance'
import { 
  containsSQLInjection,
  getClientIP 
} from '@/lib/security'

/**
 * API для проверки суммы вывода и подтверждения вывода
 * POST /api/withdraw-check
 * Body: { bookmaker, playerId, code }
 */
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
  const requestId = Math.random().toString(36).substring(7)
  const ip = getClientIP(request)
  
  try {
    console.log(`[Withdraw Check #${requestId}] Request started from IP: ${ip}`)
    
    // 🛡️ ЗАЩИТА: protectAPI уже вызывается в middleware для непубличных маршрутов
    // Этот endpoint является публичным (добавлен в publicApiRoutes в middleware)
    // Поэтому здесь не вызываем protectAPI, чтобы не блокировать легитимные запросы
    // Middleware уже обработал защиту для этого маршрута
    
    console.log(`[Withdraw Check #${requestId}] ✅ Processing public API request`)

    // Rate limiting уже обрабатывается в middleware для публичных API
    // Здесь не применяем дополнительный rate limit, чтобы не блокировать легитимные запросы

    // Проверяем Content-Type
    const contentType = request.headers.get('content-type')
    if (!contentType || !contentType.includes('application/json')) {
      console.warn(`[Withdraw Check #${requestId}] ⚠️ Invalid Content-Type: ${contentType}`)
      // Не блокируем, но логируем
    }
    
    let body: any
    try {
      const bodyText = await request.text()
      console.log(`[Withdraw Check #${requestId}] Raw body (first 200 chars):`, bodyText.substring(0, 200))
      
      try {
        body = JSON.parse(bodyText)
      } catch (jsonError: any) {
        console.error(`[Withdraw Check #${requestId}] ❌ JSON parse error:`, {
          error: jsonError.message,
          bodyPreview: bodyText.substring(0, 200),
          contentType
        })
        return NextResponse.json(
          createApiResponse(null, 'Invalid JSON in request body'),
          { 
            status: 400,
            headers: {
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }
    } catch (readError: any) {
      console.error(`[Withdraw Check #${requestId}] ❌ Error reading request body:`, readError)
      return NextResponse.json(
        createApiResponse(null, 'Error reading request body'),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    // Извлекаем поля до sanitizeInput, чтобы код не был поврежден
    const { bookmaker: rawBookmaker, playerId: rawPlayerId, code: rawCode } = body

    // Валидация наличия полей (до sanitizeInput)
    if (!rawBookmaker || !rawPlayerId || !rawCode) {
      console.error('❌ [Withdraw Check] Missing required fields:', {
        hasBookmaker: !!rawBookmaker,
        hasPlayerId: !!rawPlayerId,
        hasCode: !!rawCode,
        codeType: typeof rawCode,
        codeLength: typeof rawCode === 'string' ? rawCode.length : 'N/A'
      })
      return NextResponse.json(
        createApiResponse(null, 'Missing required fields: bookmaker, playerId, code'),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    // Преобразуем в строки и обрезаем пробелы
    const bookmaker = String(rawBookmaker).trim()
    const playerId = String(rawPlayerId).trim()
    // КОД НЕ ОБРАБАТЫВАЕМ через sanitizeInput - он может содержать любые символы
    // Только обрезаем пробелы по краям
    const code = String(rawCode).trim()

    // Проверяем, что после trim код не пустой
    if (!code || code.length === 0) {
      console.error('❌ [Withdraw Check] Code is empty after trim')
      return NextResponse.json(
        createApiResponse(null, 'Code cannot be empty'),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    // Проверяем минимальную длину кода (обычно коды вывода минимум 3-4 символа)
    if (code.length < 3) {
      console.error('❌ [Withdraw Check] Code too short:', code.length)
      return NextResponse.json(
        createApiResponse(null, 'Code is too short (minimum 3 characters)'),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    // 🛡️ Проверка на SQL инъекции (только для bookmaker и playerId)
    // КОД ВЫВОДА НЕ ПРОВЕРЯЕМ НА SQL ИНЪЕКЦИИ - он может содержать любые символы
    const stringFields = [bookmaker, playerId].filter(Boolean)
    for (const field of stringFields) {
      if (typeof field === 'string' && containsSQLInjection(field)) {
        console.warn(`🚫 SQL injection attempt from ${getClientIP(request)} in field: ${field.substring(0, 20)}`)
        const response = NextResponse.json(
          createApiResponse(null, 'Invalid input detected'),
          { status: 400 }
        )
        response.headers.set('Access-Control-Allow-Origin', '*')
        return response
      }
    }

    // КОД ВЫВОДА: не проверяем на SQL инъекции, так как код может содержать любые символы
    // Коды вывода от букмекера могут содержать буквы, цифры, дефисы, подчеркивания и другие символы
    // Проверка SQL инъекций для кода вывода отключена, чтобы не блокировать валидные коды

    console.log(`[Withdraw Check #${requestId}] ✅ Fields validated:`, {
      bookmaker,
      playerId,
      code: code.substring(0, 20) + (code.length > 20 ? '...' : ''),
      codeLength: code.length,
      codeType: typeof code,
      ip,
      userAgent: request.headers.get('user-agent')?.substring(0, 50)
    })

    // Получаем конфигурацию букмекера
    const normalizedBookmaker = bookmaker.toLowerCase()
    
    let config: any = null

    // 1xbet, Melbet, Winwin, 888starz используют Cashdesk API
    if (normalizedBookmaker.includes('1xbet') || normalizedBookmaker === '1xbet' ||
        normalizedBookmaker.includes('melbet') || normalizedBookmaker === 'melbet' ||
        normalizedBookmaker.includes('winwin') || normalizedBookmaker === 'winwin' ||
        normalizedBookmaker.includes('888starz') || normalizedBookmaker.includes('888') || normalizedBookmaker === '888starz') {
      
      // Определяем ключ конфигурации
      let configKey = ''
      if (normalizedBookmaker.includes('1xbet') || normalizedBookmaker === '1xbet') {
        configKey = '1xbet_api_config'
      } else if (normalizedBookmaker.includes('melbet') || normalizedBookmaker === 'melbet') {
        configKey = 'melbet_api_config'
      } else if (normalizedBookmaker.includes('winwin')) {
        configKey = 'winwin_api_config'
      } else if (normalizedBookmaker.includes('888starz') || normalizedBookmaker.includes('888') || normalizedBookmaker === '888starz') {
        configKey = '888starz_api_config'
      }

      const setting = await prisma.botConfiguration.findFirst({
        where: { key: configKey },
      })

      if (setting) {
        const settingConfig = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
        if (settingConfig.hash && settingConfig.cashierpass && settingConfig.login && settingConfig.cashdeskid) {
          config = {
            hash: settingConfig.hash,
            cashierpass: settingConfig.cashierpass,
            login: settingConfig.login,
            cashdeskid: String(settingConfig.cashdeskid),
          }
        }
      }

      // Fallback на переменные окружения
      if (!config) {
        config = await getCasinoConfig(bookmaker)
      }

      if (!config || !config.hash || !config.cashierpass || !config.cashdeskid) {
        return NextResponse.json(
          createApiResponse(null, `${bookmaker} API configuration not found. Please configure ${configKey} in database.`),
          { 
            status: 400,
            headers: {
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }

      console.log(`[Withdraw Check] Calling checkWithdrawAmountCashdesk for ${bookmaker}`)
      console.log(`  - playerId: ${playerId}`)
      console.log(`  - code: ${code}`)
      
      const checkResult = await checkWithdrawAmountCashdesk(bookmaker, playerId, code, config)
      
      console.log(`[Withdraw Check] checkWithdrawAmountCashdesk result:`, {
        success: checkResult.success,
        amount: checkResult.amount,
        message: checkResult.message,
      })
      
      if (!checkResult.success) {
        return NextResponse.json(
          createApiResponse(null, checkResult.message || 'Код неверный или вывод не найден'),
          { 
            status: 400,
            headers: {
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }

      // Проверяем, что сумма получена
      if (checkResult.amount === undefined || checkResult.amount === null || isNaN(checkResult.amount)) {
        return NextResponse.json(
          createApiResponse(null, 'Не удалось получить сумму ордера. Проверьте код и попробуйте еще раз.'),
          { 
            status: 400,
            headers: {
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }

      // Для Cashdesk API метод Payout сразу выполняет вывод
      // Возвращаем флаг alreadyExecuted для 1xbet, Winwin, 888starz (как у других Cashdesk букмекеров)
      const amount = Math.abs(checkResult.amount) // Сумма может быть отрицательной
      
      return NextResponse.json(
        createApiResponse(
          {
            amount: amount,
            alreadyExecuted: true, // Cashdesk API Payout сразу выполняет вывод
          },
          undefined, // error - нет ошибки
          'Withdrawal executed' // message - сообщение об успехе
        ),
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }


    // Для Mostbet
    if (normalizedBookmaker.includes('mostbet') || normalizedBookmaker === 'mostbet') {
      const setting = await prisma.botConfiguration.findFirst({
        where: { key: 'mostbet_api_config' },
      })

      if (setting) {
        const settingConfig = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
        if (settingConfig.api_key && settingConfig.secret && settingConfig.cashpoint_id) {
          config = {
            api_key: settingConfig.api_key,
            secret: settingConfig.secret,
            cashpoint_id: String(settingConfig.cashpoint_id),
          }
        }
      }

      if (!config) {
        config = {
          api_key: process.env.MOSTBET_API_KEY || 'api-key:1b896249-f0dc-45ff-826e-4175c72d1e0e',
          secret: process.env.MOSTBET_SECRET || '73353b6b-868e-4561-9128-dce1c91bd24e',
          cashpoint_id: process.env.MOSTBET_CASHPOINT_ID || 'C92905',
        }
      }
    }

    // Для 1win
    if (normalizedBookmaker.includes('1win') || normalizedBookmaker === '1win') {
      const setting = await prisma.botConfiguration.findFirst({
        where: { key: '1win_api_config' },
      })

      if (setting) {
        const settingConfig = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
        if (settingConfig.api_key && settingConfig.api_key.trim() !== '') {
          config = {
            api_key: settingConfig.api_key.trim(), // Очищаем пробелы
          }
          console.log(`[Withdraw Check] ✅ 1win API key found in database (length: ${config.api_key.length})`)
        } else {
          console.warn(`[Withdraw Check] ⚠️ 1win API key in database is empty or missing`)
        }
      } else {
        console.warn(`[Withdraw Check] ⚠️ 1win API config not found in database`)
      }

      if (!config || !config.api_key || config.api_key.trim() === '') {
        const envApiKey = process.env.ONEWIN_API_KEY || process.env['1WIN_API_KEY'] || ''
        if (envApiKey && envApiKey.trim() !== '') {
          config = {
            api_key: envApiKey.trim(),
          }
          console.log(`[Withdraw Check] ✅ 1win API key found in environment (length: ${config.api_key.length})`)
        } else {
          console.error(`[Withdraw Check] ❌ 1win API key not found in database or environment`)
          return NextResponse.json(
            createApiResponse(null, '1win API key not configured. Please configure 1win_api_config in database or set ONEWIN_API_KEY environment variable.'),
            { 
              status: 400,
              headers: {
                'Access-Control-Allow-Origin': '*',
              }
            }
          )
        }
      }

      // Финальная проверка, что API ключ валиден
      if (!config.api_key || config.api_key.trim().length < 10) {
        console.error(`[Withdraw Check] ❌ 1win API key is invalid (too short: ${config.api_key?.length || 0} characters)`)
        return NextResponse.json(
          createApiResponse(null, 'Invalid 1win API key format. Please check your configuration.'),
          { 
            status: 400,
            headers: {
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }
    }

    if (!config) {
      return NextResponse.json(
        createApiResponse(null, `Unsupported bookmaker or missing configuration: ${bookmaker}`),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    // Отправляем запрос на вывод через API букмекера (без проверки в базе данных)
    // Получаем код → отправляем запрос на вывод по API выбранного букмекера → если сумма получена → возвращаем для подтверждения
    const result = await processWithdraw(bookmaker, playerId, code, config)

    if (!result.success) {
      return NextResponse.json(
        createApiResponse(null, result.message || 'Failed to check withdrawal'),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    // Для 1xbet, 888starz, Winwin и Mostbet вывод уже выполнен на этом этапе
    // Cashdesk API Payout сразу выполняет вывод для 1xbet/888starz/Winwin
    // Mostbet API confirmation сразу выполняет вывод
    const isAlreadyExecuted = normalizedBookmaker.includes('1xbet') || 
                              normalizedBookmaker === '1xbet' ||
                              normalizedBookmaker.includes('888starz') || 
                              normalizedBookmaker.includes('888') || 
                              normalizedBookmaker === '888starz' ||
                              normalizedBookmaker.includes('winwin') ||
                              normalizedBookmaker === 'winwin' ||
                              normalizedBookmaker.includes('mostbet') ||
                              normalizedBookmaker === 'mostbet'

    console.log(`[Withdraw Check] Result:`, {
      success: result.success,
      amount: result.amount,
      transactionId: result.transactionId,
      message: result.message,
      isAlreadyExecuted,
      bookmaker: normalizedBookmaker
    })

    // Проверяем, что amount есть и является валидным числом
    // Если API букмекера вернуло сумму успешно - значит код валидный и можно переходить к подтверждению
    if (!result.amount || result.amount <= 0 || (typeof result.amount === 'number' && isNaN(result.amount))) {
      console.error(`[Withdraw Check] Amount is missing or invalid:`, {
        amount: result.amount,
        type: typeof result.amount,
        isNaN: typeof result.amount === 'number' ? isNaN(result.amount) : 'N/A (not a number)',
        fullResult: result
      })
      return NextResponse.json(
        createApiResponse(null, 'Не удалось получить сумму вывода. Проверьте код и попробуйте еще раз.'),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    const responseData = createApiResponse(
      {
        amount: result.amount,
        transactionId: result.transactionId, // ID транзакции от Mostbet API
        message: result.message,
        alreadyExecuted: isAlreadyExecuted, // Флаг, что вывод уже выполнен
      },
      undefined, // error - нет ошибки
      isAlreadyExecuted ? 'Withdrawal executed successfully' : 'Withdrawal checked successfully' // message - сообщение об успехе
    )
    
    // Логируем transactionId для Mostbet
    if (result.transactionId && (normalizedBookmaker.includes('mostbet') || normalizedBookmaker === 'mostbet')) {
      console.log(`[Withdraw Check] Mostbet transactionId: ${result.transactionId}`)
    }

    console.log(`[Withdraw Check] Response data:`, JSON.stringify(responseData, null, 2))

    return NextResponse.json(
      responseData,
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      }
    )
  } catch (error: any) {
    console.error('❌ [Withdraw Check] Unexpected error:', {
      message: error.message,
      stack: error.stack?.substring(0, 500),
      name: error.name,
      ip: getClientIP(request),
      userAgent: request.headers.get('user-agent')?.substring(0, 50)
    })
    
    // Если это ошибка валидации, возвращаем 400, иначе 500
    const isValidationError = error.message?.includes('Missing') || 
                              error.message?.includes('Invalid') ||
                              error.message?.includes('required')
    const statusCode = isValidationError ? 400 : 500
    
    return NextResponse.json(
      createApiResponse(null, `Error: ${error.message || 'Unknown error'}`),
      { 
        status: statusCode,
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      }
    )
  }
}

