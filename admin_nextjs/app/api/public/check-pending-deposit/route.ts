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

// Публичный эндпоинт для проверки наличия pending заявок на пополнение
export async function GET(request: NextRequest) {
  try {
    // 🛡️ МАКСИМАЛЬНАЯ ЗАЩИТА
    const protectionResult = protectAPI(request)
    if (protectionResult) return protectionResult

    // Rate limiting (строгий для публичного endpoint)
    const rateLimitResult = rateLimit({ 
      maxRequests: 30, 
      windowMs: 60 * 1000,
      keyGenerator: (req) => {
        const { searchParams } = new URL(req.url)
        const userId = searchParams.get('userId')
        return `check_pending:${userId || getClientIP(req)}`
      }
    })(request)
    if (rateLimitResult) return rateLimitResult

    const { searchParams } = new URL(request.url)
    let userId = searchParams.get('userId')

    // 🛡️ Валидация и очистка входных данных
    if (!userId) {
      return NextResponse.json(
        createApiResponse(null, 'User ID is required'),
        { status: 400 }
      )
    }

    // Проверка на SQL инъекции
    if (containsSQLInjection(userId)) {
      console.warn(`🚫 SQL injection attempt from ${getClientIP(request)}: ${userId}`)
      return NextResponse.json(
        createApiResponse(null, 'Invalid input'),
        { status: 400 }
      )
    }

    // Очистка и валидация
    userId = sanitizeInput(userId) as string

    // Проверка формата (должен быть числом)
    if (!/^\d+$/.test(userId)) {
      return NextResponse.json(
        createApiResponse(null, 'Invalid user ID format'),
        { status: 400 }
      )
    }

    // Ограничение длины
    if (userId.length > 20) {
      return NextResponse.json(
        createApiResponse(null, 'User ID too long'),
        { status: 400 }
      )
    }

    let userIdBigInt: bigint
    try {
      userIdBigInt = BigInt(userId)
    } catch (e) {
      return NextResponse.json(
        createApiResponse(null, 'Invalid user ID'),
        { status: 400 }
      )
    }

    // Проверяем наличие pending заявок на пополнение для этого пользователя
    const pendingDeposits = await prisma.request.findMany({
      where: {
        userId: userIdBigInt,
        requestType: 'deposit',
        status: 'pending',
      },
      select: {
        id: true,
        createdAt: true,
      },
      take: 1, // Нам нужно только знать, есть ли хотя бы одна
    })

    const hasPending = pendingDeposits.length > 0

    return NextResponse.json(
      createApiResponse({
        hasPending,
        count: pendingDeposits.length,
      })
    )
  } catch (error: any) {
    console.error('❌ Error checking pending deposits:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to check pending deposits'),
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'

