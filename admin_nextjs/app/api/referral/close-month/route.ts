import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'
import { sendTelegramGroupMessage } from '@/lib/telegram-group'

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

    // Формируем сообщение для канала
    const monthNames = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ]
    const monthName = monthNames[lastMonthStart.getMonth()]
    const year = lastMonthStart.getFullYear()

    let channelMessage = `🎉 <b>Месяц успешно закрыт!</b>\n\n`
    channelMessage += `📅 Период: ${monthName} ${year}\n\n`
    channelMessage += `🏆 <b>Топ-5 рефералов месяца:</b>\n`
    
    lastMonthData.forEach((player, index) => {
      const displayName = player.username 
        ? `@${player.username}` 
        : player.firstName 
          ? `${player.firstName}${player.lastName ? ' ' + player.lastName : ''}`
          : `ID: ${player.userId}`
      channelMessage += `${index + 1}. ${displayName} - ${player.totalDeposits.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} сом\n`
    })
    
    channelMessage += `\n💰 <b>Призы:</b>\n`
    channelMessage += `🥇 1 место: ${TOP_PRIZES[0].toLocaleString()} сом\n`
    channelMessage += `🥈 2 место: ${TOP_PRIZES[1].toLocaleString()} сом\n`
    channelMessage += `🥉 3 место: ${TOP_PRIZES[2].toLocaleString()} сом\n`
    channelMessage += `4 место: ${TOP_PRIZES[3].toLocaleString()} сом\n`
    channelMessage += `5 место: ${TOP_PRIZES[4].toLocaleString()} сом\n`
    
    channelMessage += `\n✨ <b>Новый месяц начался!</b>\n\n`
    channelMessage += `💵 Теперь вы снова можете зарабатывать <b>2%</b> с каждого депозита ваших рефералов!\n\n`
    channelMessage += `📊 Приглашайте друзей и зарабатывайте вместе с нами!`

    // Отправляем сообщение в канал (используется CHANNEL_ID или GROUP_CHAT_ID)
    const channelId = process.env.CHANNEL_ID || process.env.GROUP_CHAT_ID
    if (channelId) {
      sendTelegramGroupMessage(channelMessage, channelId).catch(err => {
        console.error('❌ [Close Month] Failed to send channel notification:', err)
      })
    } else {
      console.warn('⚠️ [Close Month] CHANNEL_ID or GROUP_CHAT_ID not configured, skipping channel notification')
    }

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

