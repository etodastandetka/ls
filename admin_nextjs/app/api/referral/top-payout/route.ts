import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/api-helpers'
import { sendTelegramGroupMessage } from '@/lib/telegram-group'

// Призы для топ-рефералов (топ-20)
const TOP_PRIZES = [
  20000, // 1 место
  10000, // 2 место
  5000,  // 3 место
  ...Array(17).fill(1000) // 4-20 места по 1000 сом
]

export async function POST(request: NextRequest) {
  try {
    requireAuth(request)
    
    // Получаем дату начала текущего месяца из конфигурации
    const monthStartConfig = await prisma.botConfiguration.findUnique({
      where: { key: 'referral_current_month_start' }
    })
    
    let monthStartDate: Date | null = null
    if (monthStartConfig && monthStartConfig.value) {
      try {
        monthStartDate = new Date(monthStartConfig.value as string)
      } catch (e) {
        console.warn('Failed to parse referral_current_month_start date, using current month')
      }
    }
    
    // Если дата не установлена, используем начало текущего месяца
    if (!monthStartDate) {
      const now = new Date()
      monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1)
      monthStartDate.setHours(0, 0, 0, 0)
    }
    
    // Получаем топ-20 реферов через агрегацию (только за текущий месяц)
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
        AND r.created_at >= ${monthStartDate}::timestamp
      GROUP BY br.referrer_id
      ORDER BY total_deposits DESC
      LIMIT 20
    `
    
    if (topReferrersRaw.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Нет топ-рефералов для выплаты'
      }, { status: 400 })
    }
    
    // Получаем данные пользователей для топ-20
    const topReferrerIds = topReferrersRaw.map(r => r.referrer_id)
    const topReferrerUsers = await prisma.botUser.findMany({
      where: {
        userId: { in: topReferrerIds }
      },
      select: {
        userId: true,
        username: true,
        firstName: true,
        lastName: true,
        selectedBookmaker: true
      }
    })
    
    const userMap = new Map(topReferrerUsers.map(u => [u.userId.toString(), u]))
    
    // Подготавливаем данные топ-рефералов
    const topReferrersWithData = topReferrersRaw.map((ref, index) => {
      const user = userMap.get(ref.referrer_id.toString())
      const rank = index + 1
      const prize = TOP_PRIZES[index] || 0
      
      return {
        userId: ref.referrer_id,
        username: user?.username || null,
        firstName: user?.firstName || null,
        lastName: user?.lastName || null,
        rank,
        prize,
        totalDeposits: parseFloat(ref.total_deposits.toString()),
        referralCount: parseInt(ref.referral_count.toString())
      }
    })
    
    const results = []
    const errors = []
    
    // Выполняем выплаты - добавляем деньги на баланс рефералов в системе
    for (const referrer of topReferrersWithData) {
      try {
        console.log(`[Top Payout] Добавление баланса для места ${referrer.rank}: UserId=${referrer.userId}, Amount=${referrer.prize}`)
        
        // Проверяем, не была ли уже выплата за этот месяц (чтобы избежать дублей)
        // Используем дату начала месяца из конфигурации
        const existingPayment = await prisma.botMonthlyPayment.findFirst({
          where: {
            userId: referrer.userId,
            position: referrer.rank,
            createdAt: {
              gte: monthStartDate
            },
            status: 'completed'
          }
        })
        
        if (existingPayment) {
          console.log(`⚠️ [Top Payout] Выплата для места ${referrer.rank} уже была выполнена в этом месяце`)
          errors.push({
            userId: referrer.userId.toString(),
            username: referrer.username || referrer.firstName || 'Неизвестно',
            rank: referrer.rank,
            error: 'Выплата уже была выполнена в этом месяце'
          })
          continue
        }
        
        // Создаем запись о заработке в BotReferralEarning (деньги добавляются на баланс)
        // Используем фиктивный referredId (самого пользователя) для топ-выплат
        const earning = await prisma.botReferralEarning.create({
          data: {
            referrerId: referrer.userId,
            referredId: referrer.userId, // Для топ-выплат используем самого пользователя
            amount: referrer.prize,
            commissionAmount: referrer.prize, // Комиссия равна сумме приза
            bookmaker: 'top_payout', // Специальный маркер для топ-выплат
            status: 'completed' // Сразу completed, чтобы деньги были доступны для вывода
          }
        })
        
        // Сохраняем информацию о выплате в BotMonthlyPayment
        await prisma.botMonthlyPayment.create({
          data: {
            userId: referrer.userId,
            position: referrer.rank,
            amount: referrer.prize,
            status: 'completed'
          }
        })
        
        results.push({
          userId: referrer.userId.toString(),
          username: referrer.username || referrer.firstName || 'Неизвестно',
          rank: referrer.rank,
          amount: referrer.prize,
          accountId: null, // Не нужно для баланса в системе
          bookmaker: null, // Не нужно для баланса в системе
          success: true
        })
        
        console.log(`✅ [Top Payout] Успешно добавлен баланс для места ${referrer.rank}: ${referrer.prize} сом (Earning ID: ${earning.id})`)
      } catch (error: any) {
        console.error(`❌ [Top Payout] Ошибка добавления баланса для места ${referrer.rank}:`, error)
        errors.push({
          userId: referrer.userId.toString(),
          username: referrer.username || referrer.firstName || 'Неизвестно',
          rank: referrer.rank,
          error: error.message || 'Неизвестная ошибка'
        })
      }
    }
    
    // Отправляем уведомление в группу
    const successCount = results.length
    const errorCount = errors.length
    let groupMessage = `🏆 <b>Выплата топ-рефералам</b>\n\n`
    
    if (successCount > 0) {
      groupMessage += `✅ <b>Успешно добавлен баланс (${successCount}):</b>\n`
      results.forEach(r => {
        groupMessage += `${r.rank} место: ${r.username} - ${r.amount.toLocaleString()} сом\n`
      })
      groupMessage += '\n'
      groupMessage += `💡 Теперь они могут создать заявку на вывод этих средств.\n\n`
    }
    
    if (errorCount > 0) {
      groupMessage += `❌ <b>Ошибки (${errorCount}):</b>\n`
      errors.forEach(e => {
        groupMessage += `${e.rank} место: ${e.username} - ${e.error}\n`
      })
    }
    
    sendTelegramGroupMessage(groupMessage).catch(err => {
      console.error('Failed to send top payout notification to group:', err)
    })
    
    return NextResponse.json({
      success: true,
      message: `Баланс добавлен: ${successCount} успешно, ${errorCount} ошибок. Теперь топ-рефералы могут создать заявку на вывод.`,
      results,
      errors: errors.length > 0 ? errors : undefined
    })
    
  } catch (error: any) {
    console.error('Top payout error:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to process top payout'
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'

