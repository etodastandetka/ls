import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { 
  rateLimit, 
  sanitizeInput, 
  containsSQLInjection,
  getClientIP 
} from '@/lib/security'
import { SECURITY_CONFIG } from '@/config/app'

// Публичный эндпоинт для получения списка рефералов пользователя и их заработка
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
    // Rate limiting
    const rateLimitResult = rateLimit({ 
      maxRequests: Math.floor(SECURITY_CONFIG.RATE_LIMIT_MAX_REQUESTS / 3),
      windowMs: SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS,
      keyGenerator: (req) => `referral_my_referrals:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) {
      rateLimitResult.headers.set('Access-Control-Allow-Origin', '*')
      return rateLimitResult
    }

    const { searchParams } = new URL(request.url)
    let userId = searchParams.get('user_id')
    
    if (!userId) {
      const response = NextResponse.json({
        success: false,
        error: 'User ID is required'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }
    
    // Валидация
    if (containsSQLInjection(userId)) {
      console.warn(`🚫 SQL injection attempt from ${getClientIP(request)}`)
      const response = NextResponse.json({
        success: false,
        error: 'Invalid input'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    userId = sanitizeInput(userId) as string

    if (!/^\d+$/.test(userId)) {
      const response = NextResponse.json({
        success: false,
        error: 'Invalid user ID format'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    if (userId.length > 20) {
      const response = NextResponse.json({
        success: false,
        error: 'User ID too long'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }
    
    const userIdBigInt = BigInt(userId)
    
    // Получаем список рефералов пользователя
    const referrals = await prisma.botReferral.findMany({
      where: {
        referrerId: userIdBigInt
      },
      include: {
        referred: {
          select: {
            userId: true,
            username: true,
            firstName: true,
            lastName: true,
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    // Для каждого реферала получаем статистику депозитов и заработка
    const referralsWithStats = await Promise.all(
      referrals.map(async (ref) => {
        // Получаем все депозиты реферала
        const deposits = await prisma.request.findMany({
          where: {
            userId: ref.referredId,
            requestType: 'deposit',
            status: {
              in: ['completed', 'approved', 'auto_completed', 'autodeposit_success']
            }
          },
          select: {
            id: true,
            amount: true,
            bookmaker: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc'
          }
        })
        
        // Получаем реферальные заработки от этого реферала
        const earnings = await prisma.botReferralEarning.findMany({
          where: {
            referrerId: userIdBigInt,
            referredId: ref.referredId,
            status: 'completed'
          },
          select: {
            id: true,
            amount: true,
            commissionAmount: true,
            bookmaker: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc'
          }
        })
        
        // Вычисляем общую сумму депозитов
        const totalDeposits = deposits.reduce((sum, d) => {
          return sum + (d.amount ? parseFloat(d.amount.toString()) : 0)
        }, 0)
        
        // Вычисляем общий заработок от этого реферала
        const totalEarnings = earnings.reduce((sum, e) => {
          return sum + (e.commissionAmount ? parseFloat(e.commissionAmount.toString()) : 0)
        }, 0)
        
        return {
          referred_id: ref.referredId.toString(),
          referred_username: ref.referred?.username || null,
          referred_firstName: ref.referred?.firstName || null,
          referred_lastName: ref.referred?.lastName || null,
          displayName: ref.referred?.username 
            ? `@${ref.referred.username}` 
            : ref.referred?.firstName 
              ? `${ref.referred.firstName}${ref.referred.lastName ? ' ' + ref.referred.lastName : ''}`
              : `Игрок #${ref.referredId}`,
          createdAt: ref.createdAt.toISOString(),
          total_deposits: totalDeposits,
          total_earnings: totalEarnings,
          deposits_count: deposits.length,
          earnings_count: earnings.length,
          deposits: deposits.map(d => ({
            id: d.id,
            amount: parseFloat(d.amount?.toString() || '0'),
            bookmaker: d.bookmaker,
            createdAt: d.createdAt.toISOString(),
          })),
          earnings: earnings.map(e => ({
            id: e.id,
            deposit_amount: parseFloat(e.amount.toString()),
            commission_amount: parseFloat(e.commissionAmount.toString()),
            bookmaker: e.bookmaker,
            createdAt: e.createdAt.toISOString(),
          }))
        }
      })
    )
    
    // Вычисляем общую статистику
    const totalReferrals = referralsWithStats.length
    const totalDeposits = referralsWithStats.reduce((sum, r) => sum + r.total_deposits, 0)
    const totalEarnings = referralsWithStats.reduce((sum, r) => sum + r.total_earnings, 0)
    
    const response = NextResponse.json({
      success: true,
      total_referrals: totalReferrals,
      total_deposits: totalDeposits,
      total_earnings: totalEarnings,
      referrals: referralsWithStats
    })
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
    
  } catch (error: any) {
    console.error('❌ [My Referrals API] Ошибка:', {
      error: error.message,
      stack: error.stack,
      name: error.name
    })
    
    const errorResponse = NextResponse.json({
      success: false,
      error: error.message || 'Ошибка на сервере. Попробуйте позже.'
    }, { status: 500 })
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    return errorResponse
  }
}

export const dynamic = 'force-dynamic'































