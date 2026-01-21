import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Призы для топ-рефералов
const TOP_PRIZES = [10000, 5000, 2500, 1500, 1000]

async function main() {
  try {
    console.log('🔍 Проверка закрытых месяцев и топ-игроков...\n')

    // 1. Получаем все закрытые месяцы
    const allConfigs = await prisma.botConfiguration.findMany({
      where: {
        key: {
          startsWith: 'referral_month_'
        }
      }
    })

    console.log('📅 Закрытые месяцы:')
    if (allConfigs.length === 0) {
      console.log('   Нет закрытых месяцев\n')
    } else {
      for (const config of allConfigs) {
        try {
          const data = JSON.parse(config.value)
          console.log(`   ${config.key}:`)
          console.log(`      Месяц: ${data.month}/${data.year}`)
          console.log(`      Закрыт: ${data.closedAt}`)
          console.log(`      Топ-игроков: ${data.topPlayers?.length || 0}`)
          if (data.topPlayers && data.topPlayers.length > 0) {
            console.log(`      Игроки:`)
            data.topPlayers.forEach((player: any, index: number) => {
              const displayName = player.username 
                ? `@${player.username}` 
                : player.firstName 
                  ? `${player.firstName}${player.lastName ? ' ' + player.lastName : ''}`
                  : `ID: ${player.userId}`
              console.log(`         ${player.rank}. ${displayName} - ${player.totalDeposits.toFixed(2)} сом (приз: ${player.prize} сом)`)
            })
          }
          console.log('')
        } catch (e) {
          console.log(`   ${config.key}: Ошибка парсинга данных`)
        }
      }
    }

    // 2. Получаем текущую дату начала месяца
    const monthStartConfig = await prisma.botConfiguration.findUnique({
      where: { key: 'referral_current_month_start' }
    })

    let currentMonthStart: Date | null = null
    if (monthStartConfig && monthStartConfig.value) {
      try {
        currentMonthStart = new Date(monthStartConfig.value as string)
        console.log(`📅 Текущая дата начала месяца: ${currentMonthStart.toISOString()}`)
      } catch (e) {
        console.log('⚠️ Не удалось распарсить дату начала месяца')
      }
    }
    console.log('')

    // 3. Получаем топ-5 игроков за период с 21 декабря 2024 до 21 января 2025
    const periodStart = new Date('2024-12-21T00:00:00.000Z')
    const periodEnd = new Date('2025-01-21T00:00:00.000Z')

    console.log(`📊 Топ-5 игроков за период:`)
    console.log(`   С: ${periodStart.toISOString()}`)
    console.log(`   До: ${periodEnd.toISOString()}\n`)

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

    if (topReferrersRaw.length === 0) {
      console.log('   Нет данных за этот период\n')
    } else {
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

      console.log('🏆 Топ-5 игроков:')
      topReferrersRaw.forEach((ref, index) => {
        const user = userMap.get(ref.referrer_id.toString())
        const rank = index + 1
        const prize = TOP_PRIZES[index] || 0
        
        const displayName = user?.username 
          ? `@${user.username}` 
          : user?.firstName 
            ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
            : `ID: ${ref.referrer_id}`

        console.log(`   ${rank}. ${displayName}`)
        console.log(`      User ID: ${ref.referrer_id}`)
        console.log(`      Сумма депозитов: ${parseFloat(ref.total_deposits.toString()).toFixed(2)} сом`)
        console.log(`      Количество рефералов: ${parseInt(ref.referral_count.toString())}`)
        console.log(`      Приз: ${prize.toLocaleString()} сом`)
        
        // Проверяем, был ли уже начислен приз
        prisma.botReferralEarning.findFirst({
          where: {
            referrerId: ref.referrer_id,
            bookmaker: 'top_payout',
            status: 'completed',
            createdAt: {
              gte: periodStart
            }
          }
        }).then(earning => {
          if (earning) {
            console.log(`      ⚠️ Приз уже начислен (Earning ID: ${earning.id})`)
          } else {
            console.log(`      ❌ Приз НЕ начислен`)
          }
        }).catch(() => {})
        
        console.log('')
      })
    }

    // 4. Проверяем выплаты в BotMonthlyPayment за этот период
    console.log('💰 Выплаты в BotMonthlyPayment за период:')
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

    if (payments.length === 0) {
      console.log('   Нет выплат за этот период\n')
    } else {
      console.log(`   Всего выплат: ${payments.length}\n`)
      payments.forEach((payment, index) => {
        const user = payment.user
        const displayName = user?.username 
          ? `@${user.username}` 
          : user?.firstName 
            ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
            : `ID: ${user.userId}`
        
        console.log(`   ${index + 1}. ${displayName} (${payment.position} место)`)
        console.log(`      Сумма: ${parseFloat(payment.amount.toString()).toFixed(2)} сом`)
        console.log(`      Статус: ${payment.status}`)
        console.log(`      Дата: ${payment.createdAt.toISOString()}`)
        console.log('')
      })
    }

  } catch (error: any) {
    console.error('❌ Ошибка:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

