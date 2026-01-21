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
        // Получаем дату начала текущего месяца из конфигурации (21 января - 21 февраля и т.д.)
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
        
        // Если дата не установлена, используем начало текущего месяца (fallback)
        if (!monthStartDate || isNaN(monthStartDate.getTime())) {
          const nowDate = new Date()
          monthStartDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1)
          monthStartDate.setHours(0, 0, 0, 0)
          console.log('📅 [Referral Data API] Используем начало текущего месяца (по умолчанию, top_only):', monthStartDate.toISOString())
        }
        
        const currentMonthStart = monthStartDate
        
        console.log('📅 [Referral Data API] Фильтрация топ-5 с даты:', currentMonthStart.toISOString())
        
        // Получаем топ-20 реферов через агрегацию (только за текущий месяц с 1 числа)
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
            AND r.created_at >= ${currentMonthStart}::timestamp
            AND r.created_at >= br.created_at
          GROUP BY br.referrer_id
          ORDER BY total_deposits DESC
          LIMIT 20
        `
        
        // Получаем данные пользователей для топ-20
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
      
      // Призы для топ-20: 1 место - 20000, 2 место - 10000, 3 место - 5000, 4-20 места - по 1000
      const prizeDistribution = [
        20000, // 1 место
        10000, // 2 место
        5000,  // 3 место
        ...Array(17).fill(1000) // 4-20 места по 1000 сом
      ]
      
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
      const nowDateTop = new Date()
      const currentDay = nowDateTop.getDate()
      let nextPayoutDate: Date
      
      if (currentDay < 21) {
        nextPayoutDate = new Date(nowDateTop.getFullYear(), nowDateTop.getMonth(), 21)
      } else {
        nextPayoutDate = new Date(nowDateTop.getFullYear(), nowDateTop.getMonth() + 1, 21)
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
          total_prize_pool: 52000, // 20000 + 10000 + 5000 + 17*1000 = 52000
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
            first_place_prize: 20000,
            second_place_prize: 10000,
            third_place_prize: 5000,
            fourth_place_prize: 1000,
            fifth_place_prize: 1000,
            total_prize_pool: 52000,
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
    
    // Получаем дату начала текущего месяца из конфигурации (21 января - 21 февраля и т.д.)
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
    
    // Если дата не установлена, используем начало текущего месяца (fallback)
    if (!monthStartDate || isNaN(monthStartDate.getTime())) {
      const now = new Date()
      monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1)
      monthStartDate.setHours(0, 0, 0, 0)
      console.log('📅 [Referral Data API] Используем начало текущего месяца (по умолчанию):', monthStartDate.toISOString())
    }
    
    const currentMonthStart = monthStartDate
    
    // ОПТИМИЗИРОВАННЫЕ ЗАПРОСЫ: Используем параллельные запросы и агрегацию
    const [referrals, earningsCurrentMonth, earningsAll, statsCurrentMonth, statsAll] = await Promise.all([
      // Получаем только количество рефералов (без include для скорости)
      prisma.botReferral.count({
        where: {
          referrerId: userIdBigInt
        }
      }),
      // Получаем заработанные комиссии за текущий месяц (с 1 числа текущего месяца)
      // Исключаем записи month_close (закрытие месяца)
      // ЗАЩИТА ОТ АБУЗА: учитываем только заработок от депозитов, сделанных после создания реферальной связи
      // НО: для записей где referred_id = referrer_id (призы за топ, восстановления) - не требуем JOIN
      prisma.$queryRaw<Array<{
        total: number | bigint
      }>>`
        SELECT COALESCE(SUM(bre.commission_amount), 0)::numeric as total
        FROM "referral_earnings" bre
        LEFT JOIN "referrals" br ON br.referred_id = bre.referred_id AND br.referrer_id = bre.referrer_id
        WHERE bre.referrer_id = ${userIdBigInt}
          AND bre.status = 'completed'
          AND bre.created_at >= ${currentMonthStart}::timestamp
          AND (bre.bookmaker IS NULL OR bre.bookmaker != 'month_close')
          AND (
            -- Для обычных заработков - проверяем дату создания реферальной связи
            (bre.referred_id != bre.referrer_id AND bre.created_at >= br.created_at)
            OR
            -- Для призов за топ, восстановлений и вычетов за абуз (referred_id = referrer_id) - не требуем JOIN
            (bre.referred_id = bre.referrer_id AND (
              bre.bookmaker = 'top_payout' 
              OR bre.bookmaker = 'top_payout_restore' 
              OR bre.bookmaker = 'test'
              OR bre.bookmaker LIKE 'abuse_deduction%'
            ))
          )
      `,
      // Получаем ВСЕ заработанные комиссии (для расчета доступного баланса - накопленные за все время)
      // ЗАЩИТА ОТ АБУЗА: учитываем только заработок от депозитов, сделанных после создания реферальной связи
      // НО: для записей где referred_id = referrer_id (призы за топ, восстановления) - не требуем JOIN
      prisma.$queryRaw<Array<{
        total: number | bigint
      }>>`
        SELECT COALESCE(SUM(bre.commission_amount), 0)::numeric as total
        FROM "referral_earnings" bre
        LEFT JOIN "referrals" br ON br.referred_id = bre.referred_id AND br.referrer_id = bre.referrer_id
        WHERE bre.referrer_id = ${userIdBigInt}
          AND bre.status = 'completed'
          AND (
            -- Для обычных заработков - проверяем дату создания реферальной связи
            (bre.referred_id != bre.referrer_id AND bre.created_at >= br.created_at)
            OR
            -- Для призов за топ, восстановлений и вычетов за абуз (referred_id = referrer_id) - не требуем JOIN
            (bre.referred_id = bre.referrer_id AND (
              bre.bookmaker = 'top_payout' 
              OR bre.bookmaker = 'top_payout_restore' 
              OR bre.bookmaker = 'test'
              OR bre.bookmaker LIKE 'abuse_deduction%'
            ))
          )
      `,
      // Получаем статистику депозитов рефералов за текущий месяц (с 1 числа)
      // ЗАЩИТА ОТ АБУЗА: учитываем только депозиты, сделанные ПОСЛЕ создания реферальной связи
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
          AND r.created_at >= ${currentMonthStart}::timestamp
          AND r.created_at >= br.created_at
      `,
      // Получаем статистику депозитов рефералов за все время
      // ЗАЩИТА ОТ АБУЗА: учитываем только депозиты, сделанные ПОСЛЕ создания реферальной связи
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
          AND r.created_at >= br.created_at
      `
    ])
    
    const referralCount = referrals
    // earned - заработок за текущий месяц (с 1 числа текущего месяца)
    const earned = earningsCurrentMonth.length > 0 && earningsCurrentMonth[0].total 
      ? parseFloat(earningsCurrentMonth[0].total.toString()) 
      : 0
    // totalEarned - весь заработок за все время (для расчета доступного баланса)
    const totalEarned = earningsAll.length > 0 && earningsAll[0].total 
      ? parseFloat(earningsAll[0].total.toString()) 
      : 0
    const activeReferralCountCurrentMonth = statsCurrentMonth.length > 0 ? parseInt(statsCurrentMonth[0].active_referrals.toString()) : 0
    const totalDepositsCurrentMonth = statsCurrentMonth.length > 0 ? parseFloat(statsCurrentMonth[0].total_deposits.toString()) : 0
    const activeReferralCountAll = statsAll.length > 0 ? parseInt(statsAll[0].active_referrals.toString()) : 0
    const totalDepositsAll = statsAll.length > 0 ? parseFloat(statsAll[0].total_deposits.toString()) : 0
    
    console.log('📊 [Referral Data API] Найдено рефералов:', referralCount)
    console.log('📊 [Referral Data API] Активных рефералов (текущий месяц):', activeReferralCountCurrentMonth)
    console.log('📊 [Referral Data API] Активных рефералов (все время):', activeReferralCountAll)
    console.log('📊 [Referral Data API] Заработано (текущий месяц):', earned)
    console.log('📊 [Referral Data API] Заработано (все время):', totalEarned)
    
    // ОПТИМИЗИРОВАННАЯ ЛОГИКА: Используем агрегацию на уровне БД для скорости
    // Получаем топ-5 реферов через агрегацию (быстрее чем обработка в памяти)
    // Используем текущий месяц (с 1 числа)
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
        AND r.created_at >= ${currentMonthStart}::timestamp
        AND r.created_at >= br.created_at
      GROUP BY br.referrer_id
      ORDER BY total_deposits DESC
      LIMIT 20
    `
    
    // Получаем данные пользователей для топ-20
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
          AND r.created_at >= ${currentMonthStart}::timestamp
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
      } else if (totalDepositsCurrentMonth === 0) {
        notInTopReason = 'no_deposits' // Рефералы не делали депозиты
      } else {
        notInTopReason = 'low_amount' // Сумма депозитов меньше, чем у топ-20
      }
    }
    
    // Если пользователь не в топ-20, но есть данные, показываем его место
    const userInTop20 = userRank > 0 && userRank <= 20
    
    // Настройки призового фонда: топ-20 мест
    const prizeDistribution = [
      20000, // 1 место
      10000, // 2 место
      5000,  // 3 место
      ...Array(17).fill(1000) // 4-20 места по 1000 сом
    ]
    
    // Добавляем призы к топ-20 реферам
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
    const nowDate = new Date()
    const currentDay = nowDate.getDate()
    let nextPayoutDate: Date
    
    if (currentDay < 21) {
      // Если сегодняшнее число меньше 21, следующая выплата будет 21 числа текущего месяца
      nextPayoutDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), 21)
    } else {
      // Если сегодняшнее число больше или равно 21, следующая выплата будет 21 числа следующего месяца
      nextPayoutDate = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 21)
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
        // ЗАЩИТА ОТ АБУЗА: учитываем только депозиты, сделанные ПОСЛЕ создания реферальной связи
        const referralCreatedAt = ref.createdAt
        
        // Получаем общую сумму депозитов реферала (все время, но только после создания реферальной связи)
        const depositsStatsAll = await prisma.request.aggregate({
          where: {
            userId: ref.referredId,
            requestType: 'deposit',
            status: {
              in: ['completed', 'approved', 'auto_completed', 'autodeposit_success']
            },
            createdAt: {
              gte: referralCreatedAt // Только депозиты после создания реферальной связи
            }
          },
          _sum: {
            amount: true
          },
          _count: {
            id: true
          }
        })
        
        // Получаем сумму депозитов реферала за текущий месяц (с 1 числа, но только после создания реферальной связи)
        const depositsStatsCurrentMonth = await prisma.request.aggregate({
          where: {
            userId: ref.referredId,
            requestType: 'deposit',
            status: {
              in: ['completed', 'approved', 'auto_completed', 'autodeposit_success']
            },
            createdAt: {
              gte: currentMonthStart > referralCreatedAt ? currentMonthStart : referralCreatedAt // Максимум из двух дат
            }
          },
          _sum: {
            amount: true
          },
          _count: {
            id: true
          }
        })
        
        // Получаем общий заработок от этого реферала (все время, но только после создания реферальной связи)
        // ЗАЩИТА ОТ АБУЗА: учитываем только заработок от депозитов, сделанных после создания реферальной связи
        const earningsStatsAll = await prisma.botReferralEarning.aggregate({
          where: {
            referrerId: userIdBigInt,
            referredId: ref.referredId,
            status: 'completed',
            createdAt: {
              gte: referralCreatedAt // Только заработок после создания реферальной связи
            }
          },
          _sum: {
            commissionAmount: true
          },
          _count: {
            id: true
          }
        })
        
        // Получаем заработок от этого реферала за текущий месяц (с 1 числа, но только после создания реферальной связи)
        // Исключаем записи month_close (закрытие месяца)
        const earningsStatsCurrentMonth = await prisma.botReferralEarning.aggregate({
          where: {
            referrerId: userIdBigInt,
            referredId: ref.referredId,
            status: 'completed',
            createdAt: {
              gte: currentMonthStart > referralCreatedAt ? currentMonthStart : referralCreatedAt // Максимум из двух дат
            },
            bookmaker: {
              not: 'month_close'
            }
          },
          _sum: {
            commissionAmount: true
          },
          _count: {
            id: true
          }
        })
        
        const totalDeposits = depositsStatsAll._sum.amount ? parseFloat(depositsStatsAll._sum.amount.toString()) : 0
        const totalDepositsCurrentMonth = depositsStatsCurrentMonth._sum.amount ? parseFloat(depositsStatsCurrentMonth._sum.amount.toString()) : 0
        const totalEarnings = earningsStatsAll._sum.commissionAmount ? parseFloat(earningsStatsAll._sum.commissionAmount.toString()) : 0
        const totalEarningsCurrentMonth = earningsStatsCurrentMonth._sum.commissionAmount ? parseFloat(earningsStatsCurrentMonth._sum.commissionAmount.toString()) : 0
        const depositsCount = depositsStatsAll._count.id || 0
        const depositsCountCurrentMonth = depositsStatsCurrentMonth._count.id || 0
        const earningsCount = earningsStatsAll._count.id || 0
        const earningsCountCurrentMonth = earningsStatsCurrentMonth._count.id || 0
        
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
          total_deposits: totalDeposits, // Все депозиты
          total_deposits_current_month: totalDepositsCurrentMonth, // Депозиты за текущий месяц
          total_earnings: totalEarnings, // Весь заработок
          total_earnings_current_month: totalEarningsCurrentMonth, // Заработок за текущий месяц
          deposits_count: depositsCount, // Количество депозитов (все время)
          deposits_count_current_month: depositsCountCurrentMonth, // Количество депозитов за текущий месяц
          earnings_count: earningsCount, // Количество заработков (все время)
          earnings_count_current_month: earningsCountCurrentMonth // Количество заработков за текущий месяц
        }
      })
    )
    
    const responseData = {
      success: true,
      earned: earned, // Заработок за текущий месяц (с 1 числа)
      earned_all: totalEarned, // Весь заработок за все время
      available_balance: availableBalance, // Доступный баланс для вывода
      has_pending_withdrawal: hasPendingWithdrawal, // Есть ли pending заявка
      referral_count: activeReferralCountCurrentMonth, // Количество рефералов, которые сделали депозиты за текущий месяц
      referral_count_all: activeReferralCountAll, // Количество рефералов, которые сделали депозиты за все время
      total_referrals: referralCount, // Общее количество рефералов (включая тех, кто не делал депозиты)
      total_deposits_current_month: totalDepositsCurrentMonth, // Сумма депозитов за текущий месяц
      total_deposits_all: totalDepositsAll, // Сумма депозитов за все время
      referrals: referralsList, // Список рефералов пользователя
      top_players: topReferrersWithPrizes, // Топ-20 реферов
      user_rank: userRank > 0 ? userRank : null, // Место в рейтинге (null если не в топе)
      user_in_top20: userInTop20, // В топ-20 или нет
      user_total_deposits: userTotalDeposits, // Сумма всех депозитов рефералов пользователя за текущий месяц
      not_in_top_reason: notInTopReason, // Причина, почему не в топе (если не в топе)
      // Минимальная сумма для попадания в топ-20 (сумма 20-го места)
      min_amount_for_top20: topReferrersWithPrizes.length >= 20 
        ? topReferrersWithPrizes[19].total_deposits 
        : (topReferrersWithPrizes.length > 0 
          ? topReferrersWithPrizes[topReferrersWithPrizes.length - 1].total_deposits 
          : 0),
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

