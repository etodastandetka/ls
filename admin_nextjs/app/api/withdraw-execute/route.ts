import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiResponse } from '@/lib/api-helpers'
import { processWithdraw, checkWithdrawAmountCashdesk } from '@/lib/casino-withdraw'
import { getCasinoConfig } from '@/lib/deposit-balance'
import { rateLimit, sanitizeInput, containsSQLInjection, getClientIP } from '@/lib/security'

/**
 * API для выполнения вывода средств (mobile.withdrawal)
 * POST /api/withdraw-execute
 * Body: { bookmaker, playerId, code, amount }
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
  try {
    // 🛡️ Rate limiting для withdraw-execute (критичный endpoint)
    const rateLimitResult = rateLimit({ 
      maxRequests: 20, 
      windowMs: 60 * 1000,
      keyGenerator: (req) => `withdraw:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) {
      return NextResponse.json(
        createApiResponse(null, 'Rate limit exceeded'),
        { 
          status: 429,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch (parseError: any) {
      console.error('❌ [Withdraw Execute] JSON parse error:', parseError)
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

    // Извлекаем поля до sanitizeInput, чтобы код не был поврежден
    const { bookmaker: rawBookmaker, playerId: rawPlayerId, code: rawCode, amount: rawAmount } = body

    // Валидация наличия полей (до sanitizeInput)
    if (!rawBookmaker || !rawPlayerId || !rawCode || rawAmount === undefined || rawAmount === null) {
      console.error('❌ [Withdraw Execute] Missing required fields:', {
        hasBookmaker: !!rawBookmaker,
        hasPlayerId: !!rawPlayerId,
        hasCode: !!rawCode,
        hasAmount: rawAmount !== undefined && rawAmount !== null,
        codeType: typeof rawCode,
        codeLength: typeof rawCode === 'string' ? rawCode.length : 'N/A'
      })
      return NextResponse.json(
        createApiResponse(null, 'Missing required fields: bookmaker, playerId, code, amount'),
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
    const amount = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount))

    // Проверяем, что после trim код не пустой
    if (!code || code.length === 0) {
      console.error('❌ [Withdraw Execute] Code is empty after trim')
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

    // Проверяем минимальную длину кода
    if (code.length < 3) {
      console.error('❌ [Withdraw Execute] Code too short:', code.length)
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

    // Проверяем валидность суммы
    if (isNaN(amount) || amount <= 0) {
      console.error('❌ [Withdraw Execute] Invalid amount:', rawAmount)
      return NextResponse.json(
        createApiResponse(null, 'Invalid amount: must be a positive number'),
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
        return NextResponse.json(
          createApiResponse(null, 'Invalid input detected'),
          { 
            status: 400,
            headers: {
              'Access-Control-Allow-Origin': '*',
            }
          }
        )
      }
    }

    // КОД ВЫВОДА: не проверяем на SQL инъекции, так как код может содержать любые символы
    // Коды вывода от букмекера могут содержать буквы, цифры, дефисы, подчеркивания и другие символы
    // Проверка SQL инъекций для кода вывода отключена, чтобы не блокировать валидные коды

    console.log(`[Withdraw Execute] Bookmaker: ${bookmaker}, Player ID: ${playerId}, Code: ${code} (length: ${code.length}), Amount: ${amount}`)

    // Отправляем запрос на вывод через API букмекера
    // Если API букмекера возвращает успешно сумму вывода - значит код валидный и можно переходить к подтверждению
    // Проверка дубликатов не нужна - букмекер сам проверяет коды через свой API

    const normalizedBookmaker = bookmaker.toLowerCase()

    // 1xbet, Melbet, Winwin, 888starz используют Cashdesk API
    // Для Cashdesk API метод Payout уже выполнил вывод на этапе check
    // Этот endpoint используется только для других букмекеров, которые требуют отдельного выполнения
    if (normalizedBookmaker.includes('1xbet') || normalizedBookmaker === '1xbet' ||
        normalizedBookmaker.includes('melbet') || normalizedBookmaker === 'melbet' ||
        normalizedBookmaker.includes('winwin') || normalizedBookmaker === 'winwin' ||
        normalizedBookmaker.includes('888starz') || normalizedBookmaker.includes('888') || normalizedBookmaker === '888starz') {
      
      // Для Cashdesk API вывод уже выполнен на этапе check
      return NextResponse.json(
        createApiResponse(
          {
            amount: typeof amount === 'number' ? amount : parseFloat(String(amount)),
            alreadyExecuted: true,
          },
          undefined, // no error
          'Withdrawal already executed'
        ),
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    // Для других букмекеров (Mostbet, 1win и т.д.) может потребоваться отдельное выполнение
    const config = await getCasinoConfig(bookmaker)
    
    if (!config) {
      return NextResponse.json(
        createApiResponse(null, `${bookmaker} API configuration not found`),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    const withdrawResult = await processWithdraw(bookmaker, playerId, code, config)

    if (!withdrawResult.success) {
      return NextResponse.json(
        createApiResponse(null, withdrawResult.message || 'Ошибка выполнения вывода'),
        { 
          status: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
          }
        }
      )
    }

    return NextResponse.json(
      createApiResponse(
        {
          amount: withdrawResult.amount,
          message: withdrawResult.message || 'Вывод выполнен успешно',
        },
        'Withdrawal executed successfully'
      ),
      {
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      }
    )
  } catch (error: any) {
    console.error('❌ Error executing withdrawal:', error)
    return NextResponse.json(
      createApiResponse(null, `Error: ${error.message}`),
      { 
        status: 500,
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      }
    )
  }
}

