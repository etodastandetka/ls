import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { 
  rateLimit, 
  sanitizeInput, 
  containsSQLInjection,
  getClientIP 
} from '@/lib/security'
import { SECURITY_CONFIG } from '@/config/app'

// Публичный эндпоинт для получения данных реферальной программы (без авторизации)
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
    // 🛡️ ПУБЛИЧНЫЙ API - защита отключена для корректной работы из браузера
    // Для публичного API referral-data отключаем protectAPI, т.к. запросы идут из браузера
    // (Telegram WebApp открывается в браузере и не всегда имеет правильный user-agent)
    // Защита обеспечивается через rate limiting и валидацию входных данных

    // Rate limiting (строгий для публичного endpoint)
    const rateLimitResult = rateLimit({ 
      maxRequests: Math.floor(SECURITY_CONFIG.RATE_LIMIT_MAX_REQUESTS / 3), // Строже для публичного endpoint
      windowMs: SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS,
      keyGenerator: (req) => `referral_data:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) {
      // Добавляем CORS заголовки к ответу rate limiting
      rateLimitResult.headers.set('Access-Control-Allow-Origin', '*')
      return rateLimitResult
    }

    const { searchParams } = new URL(request.url)
    let userId = searchParams.get('user_id')
    const topOnly = searchParams.get('top_only') === 'true'
    
    const clientIP = getClientIP(request)
    const userAgent = request.headers.get('user-agent') || ''
    
    console.log('📋 [Referral Data API] Запрос данных рефералов:', { 
      userId, 
      topOnly,
      ip: clientIP,
      userAgent: userAgent.substring(0, 100), // Первые 100 символов
      url: request.url
    })
    
    // Если запрашивается только топ, пропускаем проверку user_id
    if (!topOnly && !userId) {
      console.log('❌ [Referral Data API] User ID не предоставлен')
      const response = NextResponse.json({
        success: false,
        error: 'User ID is required'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }
    
    // Если только топ, возвращаем только топ игроков
    if (topOnly) {
      try {
        // Получаем дату начала текущего месяца из конфигурации
        const monthStartConfig = await prisma.botConfiguration.findUnique({
          where: { key: 'referral_current_month_start' }
        })
        
        let monthStartDate: Date | null = null
        if (monthStartConfig && monthStartConfig.value) {
          try {
            const configValue = typeof monthStartConfig.value === 'string' 
              ? monthStartConfig.value 
              : JSON.stringify(monthStartConfig.value)
            monthStartDate = new Date(configValue)
            console.log('📅 [Referral Data API] Дата начала месяца из конфигурации (top_only):', monthStartDate.toISOString())
          } catch (e) {
            console.warn('⚠️ [Referral Data API] Failed to parse referral_current_month_start date:', e)
          }
        }
        
        // Если дата не установлена, используем начало текущего месяца
        if (!monthStartDate || isNaN(monthStartDate.getTime())) {
          const now = new Date()
          monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1)
          monthStartDate.setHours(0, 0, 0, 0)
          console.log('📅 [Referral Data API] Используем начало текущего месяца (по умолчанию, top_only):', monthStartDate.toISOString())
        }
        
        console.log('📅 [Referral Data API] Фильтрация топ-5 с даты:', monthStartDate.toISOString())
        
        // Получаем топ-5 реферов через агрегацию (только за текущий месяц)
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
          LIMIT 5
        `
        
        // Получаем данные пользователей для топ-5
        const topReferrerIds = topReferrersRaw.length > 0 
          ? topReferrersRaw.map(r => r.referrer_id)
          : []
        
        const topReferrerUsers = topReferrerIds.length > 0
          ? await prisma.botUser.findMany({
              where: {
                userId: { in: topReferrerIds }
              },
              select: {
                userId: true,
                username: true,
                firstName: true
              }
            })
          : []
      
      const userMap = new Map(topReferrerUsers.map(u => [u.userId.toString(), u]))
      
      const prizeDistribution = [10000, 5000, 2500, 1500, 1000]
      
      const topReferrers = topReferrersRaw.map((ref, index) => {
        const user = userMap.get(ref.referrer_id.toString())
        const displayName = user?.username 
          ? `@${user.username}` 
          : user?.firstName 
            ? user.firstName 
            : `Игрок #${ref.referrer_id}`
        
        return {
          id: ref.referrer_id.toString(),
          username: displayName,
          total_deposits: parseFloat(ref.total_deposits.toString()),
          referral_count: parseInt(ref.referral_count.toString()),
          rank: index + 1,
          prize: prizeDistribution[index] || 0
        }
      })
      
      // Рассчитываем дату следующей выплаты
      const now = new Date()
      const currentDay = now.getDate()
      let nextPayoutDate: Date
      
      if (currentDay < 21) {
        nextPayoutDate = new Date(now.getFullYear(), now.getMonth(), 21)
      } else {
        nextPayoutDate = new Date(now.getFullYear(), now.getMonth() + 1, 21)
      }
      
      const monthNames = [
        'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
      ]
      const nextPayoutDateFormatted = `${nextPayoutDate.getDate()} ${monthNames[nextPayoutDate.getMonth()]}`
      
      const response = NextResponse.json({
        success: true,
        top_players: topReferrers,
        settings: {
          referral_percentage: 2,
          min_payout: 100,
          first_place_prize: prizeDistribution[0],
          second_place_prize: prizeDistribution[1],
          third_place_prize: prizeDistribution[2],
          fourth_place_prize: prizeDistribution[3],
          fifth_place_prize: prizeDistribution[4],
          total_prize_pool: 20000,
          next_payout_date: nextPayoutDateFormatted
        }
      })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
      } catch (error: any) {
        console.error('❌ [Referral Data API] Ошибка при загрузке топа:', error)
        // Возвращаем пустой топ вместо ошибки
        const response = NextResponse.json({
          success: true,
          top_players: [],
          settings: {
            referral_percentage: 2,
            min_payout: 100,
            first_place_prize: 10000,
            second_place_prize: 5000,
            third_place_prize: 2500,
            fourth_place_prize: 1500,
            fifth_place_prize: 1000,
            total_prize_pool: 20000,
            next_payout_date: '1 ноября'
          }
        })
        response.headers.set('Access-Control-Allow-Origin', '*')
        return response
      }
    }

    // 🛡️ Валидация и очистка
    if (userId && containsSQLInjection(userId)) {
      console.warn(`🚫 SQL injection attempt from ${getClientIP(request)}`)
      const response = NextResponse.json({
        success: false,
        error: 'Invalid input'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    userId = sanitizeInput(userId || '') as string

    // Telegram user_id должен состоять только из цифр
    if (!/^\d+$/.test(userId)) {
      const response = NextResponse.json({
        success: false,
        error: 'Invalid user ID format'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    // Ограничение длины
    if (userId.length > 20) {
      const response = NextResponse.json({
        success: false,
        error: 'User ID too long'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }
    
    const userIdBigInt = BigInt(userId)
    
    console.log('🔍 [Referral Data API] Поиск рефералов для пользователя:', userIdBigInt.toString())
    
    // Получаем дату начала текущего месяца из конфигурации
    const monthStartConfig = await prisma.botConfiguration.findUnique({
      where: { key: 'referral_current_month_start' }
    })
    
    let monthStartDate: Date | null = null
    if (monthStartConfig && monthStartConfig.value) {
      try {
        const configValue = typeof monthStartConfig.value === 'string' 
          ? monthStartConfig.value 
          : JSON.stringify(monthStartConfig.value)
        monthStartDate = new Date(configValue)
        console.log('📅 [Referral Data API] Дата начала месяца из конфигурации:', monthStartDate.toISOString())
      } catch (e) {
        console.warn('⚠️ [Referral Data API] Failed to parse referral_current_month_start date:', e)
      }
    }
    
    // Если дата не установлена, используем начало текущего месяца
    if (!monthStartDate || isNaN(monthStartDate.getTime())) {
      const now = new Date()
      monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1)
      monthStartDate.setHours(0, 0, 0, 0)
      console.log('📅 [Referral Data API] Используем начало текущего месяца (по умолчанию):', monthStartDate.toISOString())
    }
    
    console.log('📅 [Referral Data API] Фильтрация данных с даты:', monthStartDate.toISOString())
    
    // ОПТИМИЗИРОВАННЫЕ ЗАПРОСЫ: Используем параллельные запросы и агрегацию
    const [referrals, earningsCurrentMonth, earningsAll, stats] = await Promise.all([
      // Получаем только количество рефералов (без include для скорости)
      prisma.botReferral.count({
        where: {
          referrerId: userIdBigInt
        }
      }),
      // Получаем заработанные комиссии за текущий месяц (для отображения earned)
      prisma.botReferralEarning.aggregate({
        where: {
          referrerId: userIdBigInt,
          status: 'completed',
          createdAt: {
            gte: monthStartDate
          }
        },
        _sum: {
          commissionAmount: true
        }
      }),
      // Получаем ВСЕ заработанные комиссии (для расчета доступного баланса - накопленные за все время)
      prisma.botReferralEarning.aggregate({
        where: {
          referrerId: userIdBigInt,
          status: 'completed'
        },
        _sum: {
          commissionAmount: true
        }
      }),
      // Получаем статистику депозитов рефералов через агрегацию (только за текущий месяц)
      prisma.$queryRaw<Array<{
        active_referrals: bigint,
        total_deposits: number
      }>>`
        SELECT 
          COUNT(DISTINCT r.user_id) as active_referrals,
          COALESCE(SUM(r.amount), 0) as total_deposits
        FROM "referrals" br
        INNER JOIN "requests" r ON r.user_id = br.referred_id
        WHERE br.referrer_id = ${userIdBigInt}
          AND r.request_type = 'deposit'
          AND r.status IN ('completed', 'approved', 'auto_completed', 'autodeposit_success')
          AND r.amount > 0
          AND r.created_at >= ${monthStartDate}::timestamp
      `
    ])
    
    const referralCount = referrals
    // earned - заработок за текущий месяц (для отображения)
    const earned = earningsCurrentMonth._sum.commissionAmount ? parseFloat(earningsCurrentMonth._sum.commissionAmount.toString()) : 0
    // totalEarned - весь заработок за все время (для расчета доступного баланса)
    const totalEarned = earningsAll._sum.commissionAmount ? parseFloat(earningsAll._sum.commissionAmount.toString()) : 0
    const activeReferralCount = stats.length > 0 ? parseInt(stats[0].active_referrals.toString()) : 0
    const totalDeposits = stats.length > 0 ? parseFloat(stats[0].total_deposits.toString()) : 0
    
    console.log('📊 [Referral Data API] Найдено рефералов:', referralCount)
    console.log('📊 [Referral Data API] Активных рефералов:', activeReferralCount)
    console.log('📊 [Referral Data API] Заработано:', earned)
    
    // ОПТИМИЗИРОВАННАЯ ЛОГИКА: Используем агрегацию на уровне БД для скорости
    // Получаем топ-5 реферов через агрегацию (быстрее чем обработка в памяти)
    // Учитываем дату начала месяца
    const topReferrersRaw = await prisma.$queryRaw<Array<{
      referrer_id: bigint,
      total_deposits: number,
      referral_count: bigint
    }>>`
      SELECT 
        br.referrer_id,
        COALESCE(SUM(r.amount), 0) as total_deposits,
        COUNT(DISTINCT br.referred_id) as referral_count
      FROM "referrals" br
      LEFT JOIN "requests" r ON r.user_id = br.referred_id 
        AND r.request_type = 'deposit'
        AND r.status IN ('completed', 'approved', 'auto_completed', 'autodeposit_success')
        AND r.amount > 0
        AND r.created_at >= ${monthStartDate}::timestamp
      GROUP BY br.referrer_id
      ORDER BY total_deposits DESC
      LIMIT 5
    `
    
    // Получаем данные пользователей для топ-5
    const topReferrerIds = topReferrersRaw.map(r => r.referrer_id)
    const topReferrerUsers = await prisma.botUser.findMany({
      where: {
        userId: { in: topReferrerIds }
      },
      select: {
        userId: true,
        username: true,
        firstName: true
      }
    })
    
    const userMap = new Map(topReferrerUsers.map(u => [u.userId.toString(), u]))
    
    const topReferrers = topReferrersRaw.map((ref, index) => {
      const user = userMap.get(ref.referrer_id.toString())
      const displayName = user?.username 
        ? `@${user.username}` 
        : user?.firstName 
          ? user.firstName 
          : `Игрок #${ref.referrer_id}`
      
      return {
        id: ref.referrer_id.toString(),
        username: displayName,
        total_deposits: parseFloat(ref.total_deposits.toString()),
        referral_count: parseInt(ref.referral_count.toString()),
        rank: index + 1
      }
    })
    
    // Находим место текущего пользователя через отдельный запрос (только за текущий месяц)
    const userRankData = await prisma.$queryRaw<Array<{
      referrer_id: bigint,
      total_deposits: number,
      rank: bigint
    }>>`
      WITH ranked_referrers AS (
        SELECT 
          br.referrer_id,
          COALESCE(SUM(r.amount), 0) as total_deposits,
          ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(r.amount), 0) DESC) as rank
        FROM "referrals" br
        LEFT JOIN "requests" r ON r.user_id = br.referred_id 
          AND r.request_type = 'deposit'
          AND r.status IN ('completed', 'approved', 'auto_completed', 'autodeposit_success')
          AND r.amount > 0
          AND r.created_at >= ${monthStartDate}::timestamp
        GROUP BY br.referrer_id
      )
      SELECT referrer_id, total_deposits, rank
      FROM ranked_referrers
      WHERE referrer_id = ${userIdBigInt}
    `
    
    let userRank = 0
    let userTotalDeposits = 0
    if (userRankData.length > 0) {
      userRank = parseInt(userRankData[0].rank.toString())
      userTotalDeposits = parseFloat(userRankData[0].total_deposits.toString())
    }
    
    // Определяем причину, почему пользователь не в топе (если не в топе)
    let notInTopReason: string | null = null
    if (userRank === 0) {
      if (referralCount === 0) {
        notInTopReason = 'no_referrals' // Нет рефералов
      } else if (totalDeposits === 0) {
        notInTopReason = 'no_deposits' // Рефералы не делали депозиты
      } else {
        notInTopReason = 'low_amount' // Сумма депозитов меньше, чем у топ-5
      }
    }
    
    // Если пользователь не в топ-5, но есть данные, показываем его место
    const userInTop5 = userRank > 0 && userRank <= 5
    
    // Настройки призового фонда: 20,000 сом распределены между 5 местами
    const prizeDistribution = [
      10000, // 1 место
      5000,  // 2 место
      2500,  // 3 место
      1500,  // 4 место
      1000   // 5 место
    ]
    
    // Добавляем призы к топ-5 реферам
    const topReferrersWithPrizes = topReferrers.map((ref, index) => ({
      ...ref,
      prize: prizeDistribution[index] || 0
    }))
    
    // Получаем ВСЕ выводы со статусом 'completed' (без фильтрации по дате)
    // Ограничиваем сумму выводов суммой earnings, чтобы не было отрицательного баланса
    const allCompletedWithdrawals = await prisma.referralWithdrawalRequest.findMany({
      where: {
        userId: userIdBigInt,
        status: 'completed'
      },
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        id: true,
        amount: true,
        createdAt: true,
        processedAt: true
      }
    })
    
    // Считаем сумму всех выводов (реальная сумма всех выводов со статусом 'completed')
    const totalWithdrawn = allCompletedWithdrawals.reduce((sum, w) => {
      return sum + (w.amount ? parseFloat(w.amount.toString()) : 0)
    }, 0)
    
    console.log(`📋 [Referral Data API] Всего completed выводов: ${allCompletedWithdrawals.length}, сумма: ${totalWithdrawn.toFixed(2)}`)
    
    // Доступный баланс = весь заработок за все время - выведенное
    // earned - это только текущий месяц (для отображения в рейтинге), а для баланса используем totalEarned
    // Баланс не может быть отрицательным - минимальное значение 0
    let availableBalance = totalEarned - totalWithdrawn
    if (availableBalance < 0) {
      console.log(`⚠️ [Referral Data API] Баланс отрицательный (${availableBalance.toFixed(2)}), устанавливаем 0`)
      availableBalance = 0
    }
    
    console.log(`💰 [Referral Data API] Earned (текущий месяц для рейтинга): ${earned.toFixed(2)}`)
    console.log(`💰 [Referral Data API] Total Earned (весь заработок за все время): ${totalEarned.toFixed(2)}`)
    console.log(`💰 [Referral Data API] Total Withdrawn (все выведенное): ${totalWithdrawn.toFixed(2)}`)
    console.log(`💰 [Referral Data API] Available Balance (реальный баланс): ${availableBalance.toFixed(2)}`)
    console.log(`📋 [Referral Data API] Всего completed выводов: ${allCompletedWithdrawals.length}`)
    if (allCompletedWithdrawals.length > 0) {
      allCompletedWithdrawals.forEach((w, idx) => {
        const amount = w.amount ? parseFloat(w.amount.toString()) : 0
        console.log(`   Вывод #${idx + 1}: ID=${w.id}, Amount=${amount.toFixed(2)}, CreatedAt=${w.createdAt.toISOString()}, ProcessedAt=${w.processedAt?.toISOString() || 'null'}`)
      })
    }
    
    // Проверяем, есть ли pending заявки (для информации, но они не влияют на баланс)
    const pendingWithdrawals = await prisma.referralWithdrawalRequest.findMany({
      where: {
        userId: userIdBigInt,
        status: 'pending'
      }
    })
    
    const hasPendingWithdrawal = pendingWithdrawals.length > 0
    
    console.log('📊 [Referral Data API] Заработано:', earned)
    console.log('📊 [Referral Data API] Выведено (completed):', totalWithdrawn)
    console.log('📊 [Referral Data API] Доступный баланс:', availableBalance)
    console.log('📊 [Referral Data API] Есть pending заявка:', hasPendingWithdrawal, `(${pendingWithdrawals.length} заявок)`)
    
    // Рассчитываем дату следующей выплаты (21 число каждого месяца)
    const now = new Date()
    const currentDay = now.getDate()
    let nextPayoutDate: Date
    
    if (currentDay < 21) {
      // Если сегодняшнее число меньше 21, следующая выплата будет 21 числа текущего месяца
      nextPayoutDate = new Date(now.getFullYear(), now.getMonth(), 21)
    } else {
      // Если сегодняшнее число больше или равно 21, следующая выплата будет 21 числа следующего месяца
      nextPayoutDate = new Date(now.getFullYear(), now.getMonth() + 1, 21)
    }
    
    // Форматируем дату на русском языке
    const monthNames = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ]
    const nextPayoutDateFormatted = `${nextPayoutDate.getDate()} ${monthNames[nextPayoutDate.getMonth()]}`
    
    // Получаем список рефералов пользователя с информацией о заработке
    const userReferrals = await prisma.botReferral.findMany({
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
      take: 50, // Берем до 50 рефералов
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    // Для каждого реферала получаем статистику депозитов и заработка
    const referralsList = await Promise.all(
      userReferrals.map(async (ref) => {
        // Получаем общую сумму депозитов реферала
        const depositsStats = await prisma.request.aggregate({
          where: {
            userId: ref.referredId,
            requestType: 'deposit',
            status: {
              in: ['completed', 'approved', 'auto_completed', 'autodeposit_success']
            }
          },
          _sum: {
            amount: true
          },
          _count: {
            id: true
          }
        })
        
        // Получаем общий заработок от этого реферала
        const earningsStats = await prisma.botReferralEarning.aggregate({
          where: {
            referrerId: userIdBigInt,
            referredId: ref.referredId,
            status: 'completed'
          },
          _sum: {
            commissionAmount: true
          },
          _count: {
            id: true
          }
        })
        
        const totalDeposits = depositsStats._sum.amount ? parseFloat(depositsStats._sum.amount.toString()) : 0
        const totalEarnings = earningsStats._sum.commissionAmount ? parseFloat(earningsStats._sum.commissionAmount.toString()) : 0
        const depositsCount = depositsStats._count.id || 0
        const earningsCount = earningsStats._count.id || 0
        
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
          deposits_count: depositsCount,
          earnings_count: earningsCount
        }
      })
    )
    
    const responseData = {
      success: true,
      earned: earned,
      available_balance: availableBalance, // Доступный баланс для вывода
      has_pending_withdrawal: hasPendingWithdrawal, // Есть ли pending заявка
      referral_count: activeReferralCount, // Количество рефералов, которые сделали депозиты
      total_referrals: referralCount, // Общее количество рефералов (включая тех, кто не делал депозиты)
      referrals: referralsList, // Список рефералов пользователя
      top_players: topReferrersWithPrizes, // Топ-5 реферов
      user_rank: userRank > 0 ? userRank : null, // Место в рейтинге (null если не в топе)
      user_in_top5: userInTop5, // В топ-5 или нет
      user_total_deposits: userTotalDeposits, // Сумма всех депозитов рефералов пользователя
      not_in_top_reason: notInTopReason, // Причина, почему не в топе (если не в топе)
      // Минимальная сумма для попадания в топ-5 (сумма 5-го места)
      min_amount_for_top5: topReferrersWithPrizes.length >= 5 
        ? topReferrersWithPrizes[4].total_deposits 
        : 0,
      settings: {
        referral_percentage: 2,
        min_payout: 100,
        first_place_prize: prizeDistribution[0],
        second_place_prize: prizeDistribution[1],
        third_place_prize: prizeDistribution[2],
        fourth_place_prize: prizeDistribution[3],
        fifth_place_prize: prizeDistribution[4],
        total_prize_pool: 20000,
        next_payout_date: nextPayoutDateFormatted
      }
    }
    
    console.log('✅ [Referral Data API] Отправка данных:', {
      earned: responseData.earned,
      total_referrals: responseData.total_referrals,
      referral_count: responseData.referral_count,
      user_rank: responseData.user_rank
    })
    
    const response = NextResponse.json(responseData)
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
    
  } catch (error: any) {
    console.error('❌ [Referral Data API] Критическая ошибка:', {
      error: error.message,
      stack: error.stack,
      name: error.name
    })
    
    // Возвращаем более информативную ошибку
    const errorResponse = NextResponse.json({
      success: false,
      error: error.message || 'Ошибка на сервере. Попробуйте позже.'
    }, { status: 500 })
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    return errorResponse
  }
}

export const dynamic = 'force-dynamic'

