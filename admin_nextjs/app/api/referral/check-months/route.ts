import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

// Призы для топ-рефералов
const TOP_PRIZES = [10000, 5000, 2500, 1500, 1000]

export async function GET(request: NextRequest) {
  try {
    requireAuth(request)

    const result: any = {
      closedMonths: [],
      currentMonthStart: null,
      topPlayersForPeriod: [],
      paymentsForPeriod: []
    }

    // 1. Получаем все закрытые месяцы
    const allConfigs = await prisma.botConfiguration.findMany({
      where: {
        key: {
          startsWith: 'referral_month_'
        }
      }
    })

    result.closedMonths = allConfigs.map(config => {
      try {
        const data = JSON.parse(config.value)
        return {
          key: config.key,
          month: data.month,
          year: data.year,
          closedAt: data.closedAt,
          topPlayers: data.topPlayers || []
        }
      } catch (e) {
        return {
          key: config.key,
          error: 'Ошибка парсинга данных'
        }
      }
    })

    // 2. Получаем текущую дату начала месяца
    const monthStartConfig = await prisma.botConfiguration.findUnique({
      where: { key: 'referral_current_month_start' }
    })

    if (monthStartConfig && monthStartConfig.value) {
      try {
        result.currentMonthStart = new Date(monthStartConfig.value as string).toISOString()
      } catch (e) {
        result.currentMonthStart = null
      }
    }

    // 3. Получаем топ-5 игроков за период с 21 декабря 2024 до 21 января 2025
    const periodStart = new Date('2024-12-21T00:00:00.000Z')
    const periodEnd = new Date('2025-01-21T00:00:00.000Z')

    const topReferrersRaw = await prisma.$queryRaw<Array<{
      referrer_id: bigint,
      total_deposits: number | bigint,
      referral_count: bigint
    }>>`
      SELECT 
        br.referrer_id,
        COALESCE(SUM(r.amount), 0)::numeric as total_deposits,
        COUNT(DISTINCT br.referred_id) as referral_count
      FROM "referrals" br
      LEFT JOIN "requests" r ON r.user_id = br.referred_id 
        AND r.request_type = 'deposit'
        AND r.status IN ('completed', 'approved', 'auto_completed', 'autodeposit_success')
        AND r.amount > 0
        AND r.created_at >= ${periodStart}::timestamp
        AND r.created_at < ${periodEnd}::timestamp
      GROUP BY br.referrer_id
      ORDER BY total_deposits DESC
      LIMIT 5
    `

    if (topReferrersRaw.length > 0) {
      // Получаем данные пользователей
      const topReferrerIds = topReferrersRaw.map(r => r.referrer_id)
      const topReferrerUsers = await prisma.botUser.findMany({
        where: {
          userId: { in: topReferrerIds }
        },
        select: {
          userId: true,
          username: true,
          firstName: true,
          lastName: true
        }
      })

      const userMap = new Map(topReferrerUsers.map(u => [u.userId.toString(), u]))

      // Проверяем, были ли уже начислены призы
      for (const ref of topReferrersRaw) {
        const index = topReferrersRaw.indexOf(ref)
        const user = userMap.get(ref.referrer_id.toString())
        const rank = index + 1
        const prize = TOP_PRIZES[index] || 0

        const displayName = user?.username 
          ? `@${user.username}` 
          : user?.firstName 
            ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
            : `ID: ${ref.referrer_id}`

        // Проверяем, был ли уже начислен приз
        const existingEarning = await prisma.botReferralEarning.findFirst({
          where: {
            referrerId: ref.referrer_id,
            bookmaker: 'top_payout',
            status: 'completed',
            createdAt: {
              gte: periodStart
            }
          }
        })

        result.topPlayersForPeriod.push({
          rank,
          userId: ref.referrer_id.toString(),
          displayName,
          username: user?.username || null,
          firstName: user?.firstName || null,
          lastName: user?.lastName || null,
          totalDeposits: parseFloat(ref.total_deposits.toString()),
          referralCount: parseInt(ref.referral_count.toString()),
          prize,
          prizeAlreadyPaid: !!existingEarning,
          earningId: existingEarning?.id || null
        })
      }
    }

    // 4. Проверяем выплаты в BotMonthlyPayment за этот период
    const payments = await prisma.botMonthlyPayment.findMany({
      where: {
        createdAt: {
          gte: periodStart,
          lt: periodEnd
        }
      },
      include: {
        user: {
          select: {
            userId: true,
            username: true,
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    result.paymentsForPeriod = payments.map(payment => {
      const user = payment.user
      const displayName = user?.username 
        ? `@${user.username}` 
        : user?.firstName 
          ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
          : `ID: ${user.userId}`

      return {
        id: payment.id,
        userId: user.userId.toString(),
        displayName,
        position: payment.position,
        amount: parseFloat(payment.amount.toString()),
        status: payment.status,
        createdAt: payment.createdAt.toISOString()
      }
    })

    return NextResponse.json(createApiResponse(result))

  } catch (error: any) {
    console.error('Check months error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to check months'),
      { status: 500 }
    )
  }
}

