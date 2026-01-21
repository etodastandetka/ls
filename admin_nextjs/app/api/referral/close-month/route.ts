import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

// Призы для топ-рефералов
const TOP_PRIZES = [10000, 5000, 2500, 1500, 1000]

export async function POST(request: NextRequest) {
  try {
    requireAuth(request)

    // Получаем текущую дату и определяем прошлый месяц
    const now = new Date()
    const currentMonth = now.getMonth()
    const currentYear = now.getFullYear()
    const currentDay = now.getDate()
    
    // Начало прошлого месяца
    const lastMonthStart = new Date(currentYear, currentMonth - 1, 1)
    lastMonthStart.setHours(0, 0, 0, 0)
    
    // Конец прошлого месяца (до начала сегодняшнего дня)
    const lastMonthEnd = new Date(currentYear, currentMonth, currentDay, 0, 0, 0, 0)
    lastMonthEnd.setMilliseconds(-1) // За секунду до начала сегодняшнего дня
    
    // Начало нового месяца - с сегодняшнего дня (00:00:00 сегодня)
    const newMonthStart = new Date(currentYear, currentMonth, currentDay, 0, 0, 0, 0)

    console.log(`📅 [Close Month] Закрытие месяца:`)
    console.log(`   Прошлый месяц: ${lastMonthStart.toISOString()} - ${lastMonthEnd.toISOString()}`)
    console.log(`   Новый месяц начинается: ${newMonthStart.toISOString()}`)

    // Получаем топ-5 реферов за прошлый месяц
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
        AND r.created_at >= ${lastMonthStart}::timestamp
        AND r.created_at <= ${lastMonthEnd}::timestamp
      GROUP BY br.referrer_id
      ORDER BY total_deposits DESC
      LIMIT 5
    `

    if (topReferrersRaw.length === 0) {
      return NextResponse.json(
        createApiResponse(null, 'Нет данных за прошлый месяц для закрытия'),
        { status: 400 }
      )
    }

    // Получаем данные пользователей для топ-5
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

    // Сохраняем данные за прошлый месяц
    const lastMonthData = topReferrersRaw.map((ref, index) => {
      const user = userMap.get(ref.referrer_id.toString())
      const rank = index + 1
      const prize = TOP_PRIZES[index] || 0

      return {
        userId: ref.referrer_id.toString(),
        username: user?.username || null,
        firstName: user?.firstName || null,
        lastName: user?.lastName || null,
        rank,
        prize,
        totalDeposits: parseFloat(ref.total_deposits.toString()),
        referralCount: parseInt(ref.referral_count.toString())
      }
    })

    // Сохраняем информацию о закрытом месяце в BotConfiguration
    const monthKey = `referral_month_${lastMonthStart.getFullYear()}_${lastMonthStart.getMonth() + 1}`
    await prisma.botConfiguration.upsert({
      where: { key: monthKey },
      update: {
        value: JSON.stringify({
          month: lastMonthStart.getMonth() + 1,
          year: lastMonthStart.getFullYear(),
          topPlayers: lastMonthData,
          closedAt: new Date().toISOString()
        })
      },
      create: {
        key: monthKey,
        value: JSON.stringify({
          month: lastMonthStart.getMonth() + 1,
          year: lastMonthStart.getFullYear(),
          topPlayers: lastMonthData,
          closedAt: new Date().toISOString()
        })
      }
    })

    // Устанавливаем дату начала нового месяца в конфигурации
    // Важно: сохраняем как строку в формате ISO
    const monthStartValue = newMonthStart.toISOString()
    console.log(`📅 [Close Month] Устанавливаем дату начала нового месяца: ${monthStartValue}`)
    
    await prisma.botConfiguration.upsert({
      where: { key: 'referral_current_month_start' },
      update: {
        value: monthStartValue
      },
      create: {
        key: 'referral_current_month_start',
        value: monthStartValue
      }
    })
    
    // Проверяем, что дата установлена правильно
    const verifyConfig = await prisma.botConfiguration.findUnique({
      where: { key: 'referral_current_month_start' }
    })
    console.log(`✅ [Close Month] Дата начала нового месяца установлена и проверена:`, {
      saved: verifyConfig?.value,
      expected: monthStartValue,
      match: verifyConfig?.value === monthStartValue
    })

    console.log(`✅ [Close Month] Месяц закрыт успешно. Топ-5 за прошлый месяц сохранен.`)

    // Вычитаем заработок за закрытый месяц из доступного баланса всех пользователей
    // Создаем отрицательные записи в BotReferralEarning для каждого пользователя
    console.log(`🔄 [Close Month] Вычитаем заработок за закрытый месяц из балансов...`)
    
    // Получаем всех пользователей, которые заработали за закрытый месяц
    // ИСКЛЮЧАЕМ призы за топ (top_payout) - они не должны вычитаться!
    const earningsForClosedMonth = await prisma.botReferralEarning.findMany({
      where: {
        status: 'completed',
        createdAt: {
          gte: lastMonthStart,
          lte: lastMonthEnd
        },
        bookmaker: {
          notIn: ['month_close', 'top_payout'] // Исключаем записи о закрытии месяца и призы за топ
        }
      },
      select: {
        referrerId: true,
        commissionAmount: true
      }
    })

    // Группируем по пользователям и суммируем заработок
    const earningsByUser = new Map<bigint, number>()
    for (const earning of earningsForClosedMonth) {
      const current = earningsByUser.get(earning.referrerId) || 0
      const amount = parseFloat(earning.commissionAmount.toString())
      earningsByUser.set(earning.referrerId, current + amount)
    }

    // Создаем отрицательные записи для каждого пользователя
    let resetCount = 0
    for (const [userId, totalEarned] of earningsByUser.entries()) {
      if (totalEarned > 0) {
        try {
          await prisma.botReferralEarning.create({
            data: {
              referrerId: userId,
              referredId: userId, // Используем самого пользователя
              amount: -totalEarned,
              commissionAmount: -totalEarned, // Отрицательная сумма для вычитания
              bookmaker: 'month_close', // Маркер закрытия месяца
              status: 'completed'
            }
          })
          resetCount++
          console.log(`  ✅ [Close Month] Вычтен заработок для пользователя ${userId}: ${totalEarned.toFixed(2)} сом`)
        } catch (error: any) {
          console.error(`  ❌ [Close Month] Ошибка при вычитании заработка для пользователя ${userId}:`, error)
        }
      }
    }

    console.log(`✅ [Close Month] Заработок за закрытый месяц вычтен для ${resetCount} пользователей`)

    return NextResponse.json(
      createApiResponse({
        message: `Месяц закрыт успешно. Новый месяц начат с ${newMonthStart.toLocaleDateString('ru-RU')}`,
        lastMonth: {
          month: lastMonthStart.getMonth() + 1,
          year: lastMonthStart.getFullYear(),
          topPlayers: lastMonthData
        },
        newMonthStart: newMonthStart.toISOString()
      })
    )

  } catch (error: any) {
    console.error('Close month error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to close month'),
      { status: 500 }
    )
  }
}

