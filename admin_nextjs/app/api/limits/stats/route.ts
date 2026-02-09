import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'
import { Prisma } from '@prisma/client'
// Импортируем планировщик для автоматического запуска
import '@/lib/shift-scheduler'

export const dynamic = 'force-dynamic'

// Константы для расчета прибыли (должны совпадать с формулой в close-daily-shift.ts)
const PROFIT_DEPOSIT_PERCENT = 0.08 // 8% от пополнений
const PROFIT_WITHDRAWAL_PERCENT = 0.02 // 2% от выводов

interface PlatformStats {
  key: string
  name: string
  depositsSum: number
  depositsCount: number
  withdrawalsSum: number
  withdrawalsCount: number
}

export async function GET(request: NextRequest) {
  try {
    // Проверяем авторизацию
    try {
      requireAuth(request)
    } catch (authError: any) {
      console.error('❌ [Limits Stats] Auth error:', authError)
      return NextResponse.json(
        createApiResponse(null, authError.message || 'Unauthorized'),
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('start')
    const endDate = searchParams.get('end')

    // Статусы для подсчета (учитываем все успешные статусы, включая ручную обработку)
    // ВАЖНО: Эти статусы должны совпадать с теми, что используются при закрытии смены
    // Используем все успешные статусы для точного подсчета
    const depositSuccessStatuses = ['autodeposit_success', 'auto_completed', 'completed', 'approved']
    const withdrawalSuccessStatuses = ['completed', 'approved', 'autodeposit_success', 'auto_completed']

    let totalDepositsSum = 0
    let totalDepositsCount = 0
    let totalWithdrawalsSum = 0
    let totalWithdrawalsCount = 0
    let approximateIncome = 0

    if (startDate && endDate) {
      // Период выбран - ВСЕГДА считаем напрямую из requests для точности и актуальности
      // Упрощенная логика: не смешиваем закрытые смены с актуальными данными
      const start = new Date(startDate)
      start.setHours(0, 0, 0, 0)
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      
      // Если период включает сегодня, считаем до текущего момента
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const now = new Date()
      const filterEnd = end >= today ? now : end

      // Считаем статистику напрямую из requests за весь период
      const [depositStats, withdrawalStats] = await Promise.all([
        prisma.request.aggregate({
          where: {
            requestType: 'deposit',
            status: { in: depositSuccessStatuses },
            createdAt: {
              gte: start,
              lte: filterEnd,
            },
          },
          _count: { id: true },
          _sum: { amount: true },
        }),
        prisma.request.aggregate({
          where: {
            requestType: 'withdraw',
            status: { in: withdrawalSuccessStatuses },
            createdAt: {
              gte: start,
              lte: filterEnd,
            },
          },
          _count: { id: true },
          _sum: { amount: true },
        }),
      ])

      totalDepositsCount = depositStats._count.id || 0
      totalDepositsSum = parseFloat(depositStats._sum.amount?.toString() || '0')
      totalWithdrawalsCount = withdrawalStats._count.id || 0
      totalWithdrawalsSum = parseFloat(withdrawalStats._sum.amount?.toString() || '0')
      approximateIncome = totalDepositsSum * PROFIT_DEPOSIT_PERCENT + totalWithdrawalsSum * PROFIT_WITHDRAWAL_PERCENT
    } else {
      // Период не выбран - показываем данные за сегодня (с 00:00 сегодня)
      // ВАЖНО: Для сегодняшнего дня всегда считаем актуальные данные из requests,
      // независимо от того, закрыта смена или нет. Закрытая смена - это для исторических данных.
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const now = new Date()

      // Всегда считаем данные напрямую из requests за сегодня для актуальности
      const todayFilter = {
        createdAt: {
          gte: today,
          lte: now,
        },
      }

      const [depositStats, withdrawalStats] = await Promise.all([
        prisma.request.aggregate({
          where: {
            requestType: 'deposit',
            status: { in: depositSuccessStatuses },
            ...todayFilter,
          },
          _count: { id: true },
          _sum: { amount: true },
        }),
        prisma.request.aggregate({
          where: {
            requestType: 'withdraw',
            status: { in: withdrawalSuccessStatuses },
            ...todayFilter,
          },
          _count: { id: true },
          _sum: { amount: true },
        }),
      ])

      totalDepositsCount = depositStats._count.id || 0
      totalDepositsSum = parseFloat(depositStats._sum.amount?.toString() || '0')
      totalWithdrawalsCount = withdrawalStats._count.id || 0
      totalWithdrawalsSum = parseFloat(withdrawalStats._sum.amount?.toString() || '0')
      approximateIncome = totalDepositsSum * PROFIT_DEPOSIT_PERCENT + totalWithdrawalsSum * PROFIT_WITHDRAWAL_PERCENT
    }

    // Для статистики по платформам используем ТОЧНО ТЕ ЖЕ данные, что и для общей статистики
    // Если общая статистика берется из DailyShift, то статистика по платформам тоже должна учитывать это
    // Но DailyShift не хранит разбивку по платформам, поэтому всегда берем из requests
    // НО используем те же фильтры дат, что и для общей статистики
    let dateFilterForStats: any = {}
    let useDirectRequests = true // Флаг: использовать ли данные напрямую из requests
    
    if (startDate && endDate) {
      const start = new Date(startDate)
      start.setHours(0, 0, 0, 0)
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      
      // Если период включает сегодня, считаем до текущего момента
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const now = new Date()
      const filterEnd = end >= today ? now : end
      
      console.log(`📊 [Limits Stats] Period selected: ${startDate} - ${endDate}`)
      console.log(`📊 [Limits Stats] Date filter for platform stats: gte=${start.toISOString()}, lte=${filterEnd.toISOString()}`)
      
      dateFilterForStats = {
        createdAt: {
          gte: start,
          lte: filterEnd,
        },
      }
      // Для периода всегда используем requests напрямую (DailyShift не хранит разбивку по платформам)
      useDirectRequests = true
    } else {
      // Период не выбран - используем актуальные данные за сегодня
      // ВАЖНО: Всегда используем актуальные данные из requests за сегодня
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const now = new Date()
      
      // Всегда используем актуальные данные за сегодня (до текущего момента)
      dateFilterForStats = {
        createdAt: {
          gte: today,
          lte: now,
        },
      }
      useDirectRequests = true
    }

    // Данные для графика - вычисляем даты заранее
    let chartStartDate: Date
    let chartEndDate: Date
    
    if (startDate && endDate) {
      chartStartDate = new Date(startDate)
      chartStartDate.setHours(0, 0, 0, 0)
      chartEndDate = new Date(endDate)
      chartEndDate.setHours(23, 59, 59, 999)
    } else {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      chartStartDate = thirtyDaysAgo
      chartEndDate = new Date()
    }
    
    // Получаем настройки казино, статистику по платформам и данные графика параллельно
    // Лимиты платформ загружаем отдельно с таймаутом, чтобы не блокировать основной ответ
    const [casinoSettingsConfig, platformStatsQuery, chartData] = await Promise.all([
      prisma.botConfiguration.findFirst({
        where: { key: 'casinos' },
      }),
      // Выполняем запрос статистики по платформам параллельно
      (async () => {
        // Строим условия для дат
        // ВАЖНО: Используем строковое представление даты в формате, который PostgreSQL понимает как локальное время
        // Это избегает проблем с часовыми поясами при передаче Date объектов
        let dateCondition = ''
        const dateParams: any[] = []
        
        // Функция для форматирования Date в строку для PostgreSQL (локальное время)
        const formatDateForPostgres = (date: Date): string => {
          const year = date.getFullYear()
          const month = String(date.getMonth() + 1).padStart(2, '0')
          const day = String(date.getDate()).padStart(2, '0')
          const hours = String(date.getHours()).padStart(2, '0')
          const minutes = String(date.getMinutes()).padStart(2, '0')
          const seconds = String(date.getSeconds()).padStart(2, '0')
          const ms = String(date.getMilliseconds()).padStart(3, '0')
          return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`
        }
        
        if (dateFilterForStats.createdAt?.gte) {
          const gteDate = dateFilterForStats.createdAt.gte instanceof Date 
            ? formatDateForPostgres(dateFilterForStats.createdAt.gte)
            : dateFilterForStats.createdAt.gte
          dateCondition += ` AND created_at >= $${dateParams.length + 1}::timestamp`
          dateParams.push(gteDate)
          console.log(`📊 [Limits Stats] Platform stats date filter gte: ${gteDate}`)
        }
        if (dateFilterForStats.createdAt?.lt) {
          const ltDate = dateFilterForStats.createdAt.lt instanceof Date 
            ? formatDateForPostgres(dateFilterForStats.createdAt.lt)
            : dateFilterForStats.createdAt.lt
          dateCondition += ` AND created_at < $${dateParams.length + 1}::timestamp`
          dateParams.push(ltDate)
          console.log(`📊 [Limits Stats] Platform stats date filter lt: ${ltDate}`)
        } else if (dateFilterForStats.createdAt?.lte) {
          const lteDate = dateFilterForStats.createdAt.lte instanceof Date 
            ? formatDateForPostgres(dateFilterForStats.createdAt.lte)
            : dateFilterForStats.createdAt.lte
          dateCondition += ` AND created_at <= $${dateParams.length + 1}::timestamp`
          dateParams.push(lteDate)
          console.log(`📊 [Limits Stats] Platform stats date filter lte: ${lteDate}`)
        }
        
        console.log(`📊 [Limits Stats] Platform stats date condition: ${dateCondition}`)
        console.log(`📊 [Limits Stats] Platform stats date params count: ${dateParams.length}`)
        if (dateParams.length > 0) {
          console.log(`📊 [Limits Stats] Platform stats date params:`, dateParams)
        }
        
        return await prisma.$queryRawUnsafe<Array<{
          platform_key: string;
          deposits_count: bigint;
          deposits_sum: string | null;
          withdrawals_count: bigint;
          withdrawals_sum: string | null;
        }>>(`
          SELECT 
            platform_key,
            SUM(CASE WHEN request_type = 'deposit' THEN 1 ELSE 0 END)::bigint as deposits_count,
            COALESCE(SUM(CASE WHEN request_type = 'deposit' THEN amount ELSE 0 END), 0)::text as deposits_sum,
            SUM(CASE WHEN request_type = 'withdraw' THEN 1 ELSE 0 END)::bigint as withdrawals_count,
            COALESCE(SUM(CASE WHEN request_type = 'withdraw' THEN amount ELSE 0 END), 0)::text as withdrawals_sum
          FROM (
            SELECT 
              CASE 
                WHEN LOWER(TRIM(bookmaker)) = '1xbet' THEN '1xbet'
                WHEN LOWER(TRIM(bookmaker)) = '1win' THEN '1win'
                WHEN LOWER(TRIM(bookmaker)) = 'melbet' THEN 'melbet'
                WHEN LOWER(TRIM(bookmaker)) = 'mostbet' THEN 'mostbet'
                WHEN LOWER(TRIM(bookmaker)) = 'winwin' THEN 'winwin'
                WHEN LOWER(TRIM(bookmaker)) = '888starz' THEN '888starz'
                WHEN LOWER(TRIM(bookmaker)) LIKE '%1xbet%' OR LOWER(TRIM(bookmaker)) LIKE '%xbet%' THEN '1xbet'
                WHEN LOWER(TRIM(bookmaker)) LIKE '%1win%' OR LOWER(TRIM(bookmaker)) LIKE '%onewin%' THEN '1win'
                WHEN LOWER(TRIM(bookmaker)) LIKE '%melbet%' THEN 'melbet'
                WHEN LOWER(TRIM(bookmaker)) LIKE '%mostbet%' THEN 'mostbet'
                WHEN LOWER(TRIM(bookmaker)) LIKE '%winwin%' OR LOWER(TRIM(bookmaker)) LIKE '%win win%' THEN 'winwin'
                WHEN LOWER(TRIM(bookmaker)) LIKE '%888starz%' OR LOWER(TRIM(bookmaker)) LIKE '%888%' THEN '888starz'
                ELSE NULL
              END as platform_key,
              request_type,
              status,
              amount,
              created_at
            FROM requests
            WHERE bookmaker IS NOT NULL
              AND TRIM(bookmaker) != ''
              AND (
                (request_type = 'deposit' AND status IN ('autodeposit_success', 'auto_completed', 'completed', 'approved'))
                OR
                (request_type = 'withdraw' AND status IN ('completed', 'approved', 'autodeposit_success', 'auto_completed'))
              )
              ${dateCondition}
          ) as platform_requests
          WHERE platform_key IS NOT NULL
          GROUP BY platform_key
        `, ...dateParams)
      })(),
      // Выполняем запрос данных графика параллельно
      // ВАЖНО: Теперь считаем суммы вместо количества операций
      prisma.$queryRaw<Array<{ 
        date: string; 
        deposit_sum: string | null;
        withdrawal_sum: string | null;
      }>>`
        SELECT 
          DATE(created_at)::text as date,
          COALESCE(SUM(CASE WHEN request_type = 'deposit' AND status IN ('autodeposit_success', 'auto_completed', 'completed', 'approved') THEN amount ELSE 0 END), 0)::text as deposit_sum,
          COALESCE(SUM(CASE WHEN request_type = 'withdraw' AND status IN ('completed', 'approved', 'autodeposit_success', 'auto_completed') THEN amount ELSE 0 END), 0)::text as withdrawal_sum
        FROM requests
        WHERE created_at >= ${chartStartDate}::timestamp
          AND created_at <= ${chartEndDate}::timestamp
          AND (
            (request_type = 'deposit' AND status IN ('autodeposit_success', 'auto_completed', 'completed', 'approved'))
            OR
            (request_type = 'withdraw' AND status IN ('completed', 'approved', 'autodeposit_success', 'auto_completed'))
          )
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `,
    ])
    
    // Загружаем лимиты платформ с увеличенным таймаутом (внешние API могут быть медленными)
    let platformLimits: any[] = []
    try {
      const { getPlatformLimits } = await import('../../../../lib/casino-api')
      // Увеличиваем таймаут до 10 секунд для запросов к внешним API казино
      const timeoutPromise = new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 10000)
      )
      const limitsPromise = getPlatformLimits()
      platformLimits = await Promise.race([limitsPromise, timeoutPromise]) as any[]
      console.log(`✅ [Limits Stats] Platform limits loaded: ${platformLimits.length} platforms`)
    } catch (error: any) {
      console.warn('⚠️ [Limits Stats] Failed to load platform limits:', error?.message || error)
      // Если не удалось загрузить, используем дефолтный список платформ для отображения статистики
      // Но не устанавливаем limit: 0, чтобы не показывать N/A - лучше показать пустой массив
      // и на фронтенде показать "Загрузка..." или попробовать загрузить отдельно
      platformLimits = [
        { key: '1xbet', name: '1xbet', limit: 0, balance: 0 },
        { key: '888starz', name: '888starz', limit: 0, balance: 0 },
        { key: 'melbet', name: 'Melbet', limit: 0, balance: 0 },
        { key: '1win', name: '1WIN', limit: 0, balance: 0 },
        { key: 'winwin', name: 'Winwin', limit: 0, balance: 0 },
        { key: 'mostbet', name: 'Mostbet', limit: 0, balance: 0 },
      ]
      console.warn('⚠️ [Limits Stats] Using default platform list with zero limits')
    }
    
    let casinoSettings: Record<string, boolean> = {
      '1xbet': true,
      '888starz': true,
      '1win': true,
      melbet: true,
      mostbet: true,
      winwin: true,
    }
    
    if (casinoSettingsConfig) {
      try {
        const parsed = typeof casinoSettingsConfig.value === 'string' 
          ? JSON.parse(casinoSettingsConfig.value) 
          : casinoSettingsConfig.value
        casinoSettings = { ...casinoSettings, ...parsed }
      } catch (e) {
        console.error('Failed to parse casino settings:', e)
      }
    }
    
    // Фильтруем платформы: показываем только те, которые включены в настройках
    platformLimits = platformLimits.filter((platform) => {
      const key = platform.key.toLowerCase()
      // Маппинг ключей платформ на настройки
      const settingKey = key === '1xbet' ? '1xbet' 
        : key === '888starz' ? '888starz'
        : key === '1win' ? '1win'
        : key === 'melbet' ? 'melbet'
        : key === 'mostbet' ? 'mostbet'
        : key === 'winwin' ? 'winwin'
        : key
      
      const isEnabled = casinoSettings[settingKey] !== false
      return isEnabled
    })

    // Обрабатываем данные графика (получены параллельно выше)
    // ВАЖНО: Теперь используем суммы вместо количества
    const chartDataSafe = chartData || []
    const depositsByDate = chartDataSafe.map((d: any) => ({ date: d.date, sum: parseFloat(d.deposit_sum || '0') }))
    const withdrawalsByDate = chartDataSafe.map((d: any) => ({ date: d.date, sum: parseFloat(d.withdrawal_sum || '0') }))

    // Форматируем даты для графика (YYYY-MM-DD -> dd.mm)
    const formatDate = (dateStr: string) => {
      const [year, month, day] = dateStr.split('-')
      return `${day}.${month}`
    }

    const depositsLabels = depositsByDate.map((d: any) => formatDate(d.date))
    const depositsData = depositsByDate.map((d: any) => d.sum)
    const withdrawalsLabels = withdrawalsByDate.map((d: any) => formatDate(d.date))
    const withdrawalsData = withdrawalsByDate.map((d: any) => d.sum)

    // Создаем мапу для быстрого доступа
    const depositsDateMap = new Map<string, string>()
    depositsByDate.forEach((d: any) => {
      depositsDateMap.set(formatDate(d.date), d.date)
    })
    
    const withdrawalsDateMap = new Map<string, string>()
    withdrawalsByDate.forEach((d: any) => {
      withdrawalsDateMap.set(formatDate(d.date), d.date)
    })

    // Объединяем метки и сортируем по исходной дате
    const allLabelsSet = new Set([...depositsLabels, ...withdrawalsLabels])
    const allLabels = Array.from(allLabelsSet).sort((a: string, b: string) => {
      const dateA = depositsDateMap.get(a) || withdrawalsDateMap.get(a) || ''
      const dateB = depositsDateMap.get(b) || withdrawalsDateMap.get(b) || ''
      return dateA.localeCompare(dateB)
    })

    // Синхронизируем данные
    const depositsDict = Object.fromEntries(
      depositsLabels.map((label: string, i: number) => [label, depositsData[i]])
    )
    const withdrawalsDict = Object.fromEntries(
      withdrawalsLabels.map((label: string, i: number) => [label, withdrawalsData[i]])
    )

    const synchronizedDeposits = allLabels.map((label: string) => depositsDict[label] || 0)
    const synchronizedWithdrawals = allLabels.map((label: string) => withdrawalsDict[label] || 0)
    
    // Преобразуем результаты в нужный формат
    const platformStatsMap = new Map<string, PlatformStats>()
    
    // Логируем для отладки
    console.log(`📊 [Limits Stats] Platform stats query returned ${platformStatsQuery.length} rows`)
    console.log(`📊 [Limits Stats] Platform limits loaded: ${platformLimits.length} platforms`)
    
    platformStatsQuery.forEach((row) => {
      // Ищем платформу по ключу (без учета регистра)
      const platform = platformLimits.find(p => p.key.toLowerCase() === row.platform_key.toLowerCase())
      
      if (platform) {
        platformStatsMap.set(platform.key, {
          key: platform.key,
          name: platform.name,
          depositsSum: parseFloat(row.deposits_sum || '0'),
          depositsCount: Number(row.deposits_count || 0),
          withdrawalsSum: parseFloat(row.withdrawals_sum || '0'),
          withdrawalsCount: Number(row.withdrawals_count || 0),
        })
        console.log(`✅ [Limits Stats] Mapped ${row.platform_key}: deposits=${row.deposits_sum}, withdrawals=${row.withdrawals_sum}`)
      } else {
        // Если платформа не найдена в limits, создаем запись напрямую из SQL результата
        const platformName = row.platform_key.charAt(0).toUpperCase() + row.platform_key.slice(1).toLowerCase()
        platformStatsMap.set(row.platform_key, {
          key: row.platform_key,
          name: platformName,
          depositsSum: parseFloat(row.deposits_sum || '0'),
          depositsCount: Number(row.deposits_count || 0),
          withdrawalsSum: parseFloat(row.withdrawals_sum || '0'),
          withdrawalsCount: Number(row.withdrawals_count || 0),
        })
        console.log(`⚠️ [Limits Stats] Platform ${row.platform_key} not found in limits, using SQL data directly`)
      }
    })
    
    // Формируем финальный список статистики по платформам
    // Если есть данные из SQL, показываем их; если нет - показываем все платформы из limits с нулями
    const platformStats: PlatformStats[] = []
    
    // Сначала добавляем все платформы из SQL запроса (с данными)
    platformStatsMap.forEach((stats, key) => {
      platformStats.push(stats)
    })
    
    // Затем добавляем платформы из limits, которых нет в SQL (с нулями)
    platformLimits.forEach(platform => {
      if (!platformStatsMap.has(platform.key)) {
        platformStats.push({
          key: platform.key,
          name: platform.name,
          depositsSum: 0,
          depositsCount: 0,
          withdrawalsSum: 0,
          withdrawalsCount: 0,
        })
      }
    })
    
    // Сортируем по ключу для консистентности
    platformStats.sort((a, b) => a.key.localeCompare(b.key))
    
    console.log(`📊 [Limits Stats] Final platform stats: ${platformStats.length} platforms`)
    
    // Убрали отладочные запросы для ускорения

    const response = NextResponse.json(
      createApiResponse({
        platformLimits,
        platformStats,
        totalDepositsCount,
        totalDepositsSum,
        totalWithdrawalsCount,
        totalWithdrawalsSum,
        approximateIncome,
        chart: {
          labels: allLabels,
          deposits: synchronizedDeposits,
          withdrawals: synchronizedWithdrawals,
        },
      })
    )
    
    // Умное кеширование для баланса между актуальностью и производительностью
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    if (startDate && endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      
      // Если период полностью в прошлом - кешируем на 2 минуты (данные не меняются)
      if (end < today) {
        response.headers.set('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=300')
      } 
      // Если период включает сегодня - минимальное кеширование (10 секунд)
      else {
        response.headers.set('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30')
      }
    } else {
      // Сегодняшний день - очень короткое кеширование (3 секунды) для актуальности
      response.headers.set('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=10')
    }
    
    return response
  } catch (error: any) {
    console.error('Limits stats error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to fetch limits stats'),
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}

