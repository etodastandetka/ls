import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiResponse } from '@/lib/api-helpers'
import { 
  protectAPI, 
  rateLimit, 
  sanitizeInput, 
  containsSQLInjection,
  getClientIP 
} from '@/lib/security'

// Публичный эндпоинт для сохранения и получения account_id букмекера (для бота)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

// Получение сохраненного account_id для букмекера
export async function GET(request: NextRequest) {
  try {
    // 🛡️ МАКСИМАЛЬНАЯ ЗАЩИТА
    const protectionResult = protectAPI(request)
    if (protectionResult) return protectionResult

    // Rate limiting (строгий для публичного endpoint)
    const rateLimitResult = rateLimit({ 
      maxRequests: 30, 
      windowMs: 60 * 1000,
      keyGenerator: (req) => `casino_account:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) return rateLimitResult

    const { searchParams } = new URL(request.url)
    let userId = searchParams.get('user_id')
    let casinoId = searchParams.get('casino_id')

    // 🛡️ Валидация и очистка входных данных
    if (!userId || !casinoId) {
      return NextResponse.json(
        createApiResponse(null, 'user_id and casino_id are required'),
        { status: 400 }
      )
    }

    // Проверка на SQL инъекции
    if (containsSQLInjection(userId) || containsSQLInjection(casinoId)) {
      console.warn(`🚫 SQL injection attempt from ${getClientIP(request)}: userId=${userId}, casinoId=${casinoId}`)
      return NextResponse.json(
        createApiResponse(null, 'Invalid input'),
        { status: 400 }
      )
    }

    // Очистка и валидация
    userId = sanitizeInput(userId) as string
    casinoId = sanitizeInput(casinoId) as string

    // Проверка формата userId (должен быть числом)
    if (!/^\d+$/.test(userId)) {
      return NextResponse.json(
        createApiResponse(null, 'Invalid user_id format'),
        { status: 400 }
      )
    }

    let userBigInt: bigint
    try {
      userBigInt = BigInt(userId)
    } catch (e) {
      return NextResponse.json(
        createApiResponse(null, 'Invalid user_id'),
        { status: 400 }
      )
    }

    // Получаем сохраненный account_id или phone
    const dataType = `casino_account_id_${casinoId.toLowerCase()}`
    const userData = await prisma.botUserData.findUnique({
      where: {
        userId_dataType: {
          userId: userBigInt,
          dataType,
        },
      },
    })

    // Если запрашивается телефон (casinoId = 'phone')
    if (casinoId.toLowerCase() === 'phone') {
      const phoneData = await prisma.botUserData.findUnique({
        where: {
          userId_dataType: {
            userId: userBigInt,
            dataType: 'saved_phone',
          },
        },
      })
      return NextResponse.json(
        createApiResponse({
          phone: phoneData?.dataValue || null,
        })
      )
    }

    return NextResponse.json(
      createApiResponse({
        accountId: userData?.dataValue || null,
      })
    )
  } catch (error: any) {
    console.error('Get casino account API error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to get casino account'),
      { status: 500 }
    )
  }
}

// Сохранение account_id для букмекера
export async function POST(request: NextRequest) {
  try {
    // 🛡️ МАКСИМАЛЬНАЯ ЗАЩИТА
    const protectionResult = protectAPI(request)
    if (protectionResult) return protectionResult

    // Rate limiting (строгий для публичного endpoint)
    const rateLimitResult = rateLimit({ 
      maxRequests: 30, 
      windowMs: 60 * 1000,
      keyGenerator: (req) => `casino_account:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) return rateLimitResult

    const body = await request.json()
    let { user_id, casino_id, account_id } = body

    // 🛡️ Валидация и очистка входных данных
    if (!user_id || !casino_id || !account_id) {
      return NextResponse.json(
        createApiResponse(null, 'user_id, casino_id and account_id are required'),
        { status: 400 }
      )
    }

    // Проверка на SQL инъекции
    if (containsSQLInjection(user_id) || containsSQLInjection(casino_id) || containsSQLInjection(account_id)) {
      console.warn(`🚫 SQL injection attempt from ${getClientIP(request)}: user_id=${user_id}, casino_id=${casino_id}`)
      return NextResponse.json(
        createApiResponse(null, 'Invalid input'),
        { status: 400 }
      )
    }

    // Очистка и валидация
    user_id = sanitizeInput(user_id) as string
    casino_id = sanitizeInput(casino_id) as string
    account_id = sanitizeInput(account_id) as string

    // Проверка формата user_id (должен быть числом)
    if (!/^\d+$/.test(user_id)) {
      return NextResponse.json(
        createApiResponse(null, 'Invalid user_id format'),
        { status: 400 }
      )
    }

    // Проверка формата account_id (должен быть числом, но для телефона разрешаем формат +996XXXXXXXXX)
    if (casino_id.toLowerCase() !== 'phone') {
      // Для букмекера account_id должен быть числом
      if (!/^\d+$/.test(account_id)) {
        return NextResponse.json(
          createApiResponse(null, 'Invalid account_id format (must be numeric)'),
          { status: 400 }
        )
      }
    } else {
      // Для телефона проверяем формат +996XXXXXXXXX
      if (!/^\+996\d{9}$/.test(account_id)) {
        return NextResponse.json(
          createApiResponse(null, 'Invalid phone format (must be +996XXXXXXXXX)'),
          { status: 400 }
        )
      }
    }

    let userBigInt: bigint
    try {
      userBigInt = BigInt(user_id)
    } catch (e) {
      return NextResponse.json(
        createApiResponse(null, 'Invalid user_id'),
        { status: 400 }
      )
    }

    // Убеждаемся, что пользователь существует
    await prisma.botUser.upsert({
      where: { userId: userBigInt },
      update: {},
      create: {
        userId: userBigInt,
        language: 'ru',
      },
    })

    // Если сохраняется телефон (casino_id = 'phone')
    if (casino_id.toLowerCase() === 'phone') {
      await prisma.botUserData.upsert({
        where: {
          userId_dataType: {
            userId: userBigInt,
            dataType: 'saved_phone',
          },
        },
        update: {
          dataValue: account_id, // В этом случае account_id содержит телефон
        },
        create: {
          userId: userBigInt,
          dataType: 'saved_phone',
          dataValue: account_id,
        },
      })
    } else {
      // Сохраняем account_id для казино
      const dataType = `casino_account_id_${casino_id.toLowerCase()}`
      await prisma.botUserData.upsert({
        where: {
          userId_dataType: {
            userId: userBigInt,
            dataType,
          },
        },
        update: {
          dataValue: account_id,
        },
        create: {
          userId: userBigInt,
          dataType,
          dataValue: account_id,
        },
      })
    }

    return NextResponse.json(
      createApiResponse({
        success: true,
        message: 'Account ID saved successfully',
      })
    )
  } catch (error: any) {
    console.error('Save casino account API error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to save casino account'),
      { status: 500 }
    )
  }
}

