import { prisma } from './prisma'
import { AUTO_DEPOSIT_CONFIG } from '@/config/app'
import { processReferralEarning } from './referral-earnings'

/**
 * ЕДИНСТВЕННАЯ функция автопополнения - работает только здесь
 * Все вызовы должны использовать эту функцию из ./auto-deposit
 * Работает секунду в секунду - мгновенно
 * ВАЖНО: Гарантирует что статус заявки ОБЯЗАТЕЛЬНО обновится на autodeposit_success
 */
export async function matchAndProcessPayment(paymentId: number, amount: number) {
  console.log(`🔍 [Auto-Deposit] matchAndProcessPayment called: paymentId=${paymentId}, amount=${amount}`)
  
  // КРИТИЧЕСКИ ВАЖНО: Атомарная блокировка платежа для предотвращения параллельной обработки
  // Используем атомарную операцию updateMany с условием, чтобы гарантировать, что только один процесс обработает платеж
  const lockResult = await prisma.$transaction(async (tx) => {
    // Сначала получаем информацию о платеже
    const payment = await tx.incomingPayment.findUnique({
      where: { id: paymentId },
      select: { 
        paymentDate: true, 
        createdAt: true, 
        isProcessed: true,
        requestId: true,
        updatedAt: true
      },
    })
    
    if (!payment) {
      return { locked: false, reason: 'payment_not_found', payment: null }
    }
    
    // Если платеж уже обработан - сразу выходим
    if (payment.isProcessed) {
      console.log(`⚠️ [Auto-Deposit] Payment ${paymentId} already processed (requestId: ${payment.requestId}), skipping`)
      return { locked: false, reason: 'payment_already_processed', payment }
    }
    
    // Атомарно пытаемся заблокировать платеж, обновляя updatedAt только если isProcessed = false
    // Это гарантирует, что только один процесс сможет заблокировать платеж
    // Проверяем также, не обрабатывается ли платеж прямо сейчас (обновлен менее 30 секунд назад с установленным requestId)
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000)
    const isRecentlyUpdated = payment.updatedAt && payment.updatedAt > thirtySecondsAgo && payment.requestId !== null
    
    if (isRecentlyUpdated) {
      console.log(`⚠️ [Auto-Deposit] Payment ${paymentId} is being processed by another process (updated ${Math.floor((Date.now() - payment.updatedAt.getTime()) / 1000)}s ago), skipping`)
      return { locked: false, reason: 'payment_being_processed', payment }
    }
    
    // Атомарно обновляем updatedAt только если isProcessed = false
    const updateResult = await tx.incomingPayment.updateMany({
      where: {
        id: paymentId,
        isProcessed: false,
      },
      data: {
        updatedAt: new Date(), // Обновляем время для блокировки
      },
    })
    
    // Если не удалось обновить (count = 0) - значит платеж уже обработан другим процессом
    if (updateResult.count === 0) {
      // Проверяем текущее состояние еще раз
      const currentPayment = await tx.incomingPayment.findUnique({
        where: { id: paymentId },
        select: { isProcessed: true, requestId: true, updatedAt: true },
      })
      
      if (currentPayment?.isProcessed) {
        console.log(`⚠️ [Auto-Deposit] Payment ${paymentId} was processed by another process, skipping`)
        return { locked: false, reason: 'payment_processed_by_another', payment: currentPayment }
      }
      
      console.log(`⚠️ [Auto-Deposit] Could not lock payment ${paymentId} (already being processed)`)
      return { locked: false, reason: 'lock_failed', payment }
    }
    
    return { locked: true, payment }
  }, {
    isolationLevel: 'Serializable', // Максимальная изоляция для предотвращения race conditions
  })
  
  if (!lockResult.locked || !lockResult.payment) {
    // Если не удалось заблокировать - возвращаем null (платеж уже обрабатывается)
    return null
  }
  
  // Получаем полную информацию о платеже после блокировки
  const payment = await prisma.incomingPayment.findUnique({
    where: { id: paymentId },
    select: { 
      paymentDate: true, 
      createdAt: true, 
      isProcessed: true,
      requestId: true 
    },
  })
  
  if (!payment || payment.isProcessed) {
    console.log(`⚠️ [Auto-Deposit] Payment ${paymentId} was processed while locking, skipping`)
    return null
  }
  
  const paymentDate = payment.paymentDate
  const paymentCreatedAt = payment.createdAt
  const paymentDateDiffMs = Math.abs(paymentDate.getTime() - paymentCreatedAt.getTime())
  const useCreatedAtAsBase = paymentDate < paymentCreatedAt &&
    paymentDateDiffMs > AUTO_DEPOSIT_CONFIG.REQUEST_SEARCH_WINDOW_MS
  const baseTime = useCreatedAtAsBase ? paymentCreatedAt : paymentDate
  
  console.log(`📅 [Auto-Deposit] Payment ${paymentId} date: ${paymentDate.toISOString()} (UTC)`)
  console.log(`📅 [Auto-Deposit] Payment ${paymentId} createdAt: ${paymentCreatedAt.toISOString()} (UTC)`)
  if (useCreatedAtAsBase) {
    console.log(`⚠️ [Auto-Deposit] Using createdAt as base time (paymentDate differs by ${Math.floor(paymentDateDiffMs / 1000)}s)`)
  }
  
  // Ищем заявки на пополнение со статусом pending в окне ±5 минут от платежа
  // Это защищает от случайного пополнения если пользователь не пополнял
  // И предотвращает обработку старых заявок с одинаковыми суммами
  // ВАЖНО: Используем окно ±5 минут от paymentDate, чтобы найти заявки созданные до или после платежа
  // ВАЖНО: НЕ ограничиваем окно текущим временем, чтобы находить заявки созданные после обработки платежа
  const searchWindowMs = AUTO_DEPOSIT_CONFIG.REQUEST_SEARCH_WINDOW_MS
  const searchWindowStart = new Date(paymentDate.getTime() - searchWindowMs) // 5 минут ДО paymentDate
  const searchWindowEnd = new Date(paymentDate.getTime() + searchWindowMs) // 5 минут ПОСЛЕ paymentDate
  
  // Используем paymentDate как базовое время для окна поиска
  // Это позволяет находить заявки созданные до или после фактического времени платежа
  console.log(`🔍 [Auto-Deposit] Search window: ${searchWindowStart.toISOString()} to ${searchWindowEnd.toISOString()} (based on paymentDate: ${paymentDate.toISOString()})`)

  // НЕ ограничиваем окно текущим временем - заявки могут быть созданы позже обработки платежа
  const actualSearchEnd = searchWindowEnd

  // Оптимизированный поиск заявок - минимум запросов для максимальной скорости
  // Ищем заявки в окне ±5 минут от платежа
  // ВАЖНО: Исключаем заявки со статусом api_error и deposit_failed - они обрабатываются вручную
  const matchingRequests = await prisma.request.findMany({
    where: {
      requestType: 'deposit',
      status: 'pending', // Только pending заявки - api_error и deposit_failed обрабатываются вручную
      createdAt: { 
        gte: searchWindowStart, // 5 минут ДО платежа
        lte: actualSearchEnd, // 5 минут ПОСЛЕ платежа (но не в будущем)
      },
      incomingPayments: { none: { isProcessed: true } },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      accountId: true,
      bookmaker: true,
      amount: true,
      status: true,
      createdAt: true,
      incomingPayments: { select: { id: true, isProcessed: true } },
    },
  })

  // Быстрая фильтрация по точному совпадению суммы и времени
  const exactMatches = matchingRequests.filter((req) => {
    if (req.status !== 'pending' || !req.amount) return false
    
    // Пропускаем заявки, у которых уже есть обработанный платеж
    const hasProcessedPayment = req.incomingPayments?.some(p => p.isProcessed === true)
    if (hasProcessedPayment) {
      console.log(`⚠️ [Auto-Deposit] Request ${req.id} already has processed payment, skipping`)
      return false
    }
    
    // Проверяем разницу времени между заявкой и paymentDate (реальным временем платежа)
    // Разрешаем сопоставление если заявка создана в пределах ±5 минут от paymentDate
    const timeDiff = paymentDate.getTime() - req.createdAt.getTime()
    const timeDiffAbs = Math.abs(timeDiff)
    const maxTimeDiff = AUTO_DEPOSIT_CONFIG.REQUEST_SEARCH_WINDOW_MS // 5 минут
    
    // Если разница больше 5 минут - пропускаем
    if (timeDiffAbs > maxTimeDiff) {
      const minutesDiff = Math.floor(timeDiffAbs / 60000)
      const direction = timeDiff > 0 ? 'after' : 'before'
      console.log(`⚠️ [Auto-Deposit] Request ${req.id} created ${minutesDiff} minutes ${direction} paymentDate ${paymentId} (too far apart), skipping`)
      return false
    }
    
    // Дополнительная проверка: заявка не должна быть слишком старой (более 8 часов)
    // Но только если заявка в прошлом (не в будущем)
    const now = Date.now()
    const requestAge = now - req.createdAt.getTime()
    if (requestAge > 0) { // Только если заявка в прошлом
      const maxAge = AUTO_DEPOSIT_CONFIG.MAX_REQUEST_AGE_MS
      if (requestAge > maxAge) {
        console.log(`⚠️ [Auto-Deposit] Request ${req.id} is too old (${Math.floor(requestAge / 1000)}s), skipping`)
        return false
      }
    }
    
    // Проверяем, что платеж поступил не слишком давно (максимум 8 часов после создания заявки)
    // Но только если платеж после заявки
    if (timeDiff > 0) {
      const maxPaymentDelay = AUTO_DEPOSIT_CONFIG.PAYMENT_DATE_MAX_DELAY_MS
      if (timeDiff > maxPaymentDelay) {
        const minutesDelay = Math.floor(timeDiff / 60000)
        console.log(`⚠️ [Auto-Deposit] Payment ${paymentId} arrived ${minutesDelay} minutes after request ${req.id} (too late), skipping`)
        return false
      }
    }
    
    const reqAmount = parseFloat(req.amount.toString())
    const diff = Math.abs(reqAmount - amount)
    const matches = diff < 0.01 // Точность до 1 копейки
    
    if (matches) {
      const timeDiff = baseTime.getTime() - req.createdAt.getTime()
      const secondsDiff = Math.floor(timeDiff / 1000)
      const hoursDiff = (timeDiff / (1000 * 60 * 60)).toFixed(2)
      console.log(`✅ [Auto-Deposit] Exact match: Request ${req.id} (${reqAmount}) ≈ Payment ${amount} (diff: ${diff.toFixed(4)})`)
      console.log(`   ⏰ Time diff: ${secondsDiff}s (${hoursDiff}h) - Request: ${req.createdAt.toISOString()}, Payment: ${paymentDate.toISOString()}`)
    }
    
    return matches
  })

  if (exactMatches.length === 0) {
    console.log(`ℹ️ [Auto-Deposit] No exact matches found for payment ${paymentId} (amount: ${amount})`)
    return null
  }
  
  console.log(`🎯 [Auto-Deposit] Found ${exactMatches.length} exact match(es) for payment ${paymentId}`)

  // Берем самую первую заявку (самую старую по времени создания)
  const request = exactMatches[0]
  
  // Быстрая проверка обязательных полей
  if (!request.accountId || !request.bookmaker || !request.amount) {
    console.error(`❌ [Auto-Deposit] Request ${request.id} missing required fields`)
    return null
  }

  const requestAmount = parseFloat(request.amount.toString())
  
  console.log(`💸 [Auto-Deposit] Processing: Request ${request.id}, ${request.bookmaker}, Account ${request.accountId}, Amount ${requestAmount}`)

  // Оптимизированная обработка: все в одной транзакции для максимальной скорости
  try {
    // КРИТИЧЕСКИ ВАЖНО: Атомарная проверка - используем транзакцию для блокировки строки
    // Это предотвращает дублирование пополнений в букмекере при параллельных вызовах
    const preCheckResult = await prisma.$transaction(async (tx) => {
      // Проверяем текущее состояние заявки и платежа атомарно
      const [currentRequest, currentPayment, otherPayments] = await Promise.all([
        tx.request.findUnique({
          where: { id: request.id },
          select: { status: true, processedBy: true },
        }),
        tx.incomingPayment.findUnique({
          where: { id: paymentId },
          select: { isProcessed: true, requestId: true },
        }),
        // КРИТИЧЕСКИ ВАЖНО: Проверяем, нет ли у заявки ДРУГИХ платежей, которые уже обрабатываются или обработаны
        // Это предотвращает обработку одной заявки несколькими платежами одновременно
        tx.incomingPayment.findMany({
          where: {
            requestId: request.id,
            id: { not: paymentId }, // Исключаем текущий платеж
            isProcessed: true, // Только обработанные платежи
          },
          select: { id: true, isProcessed: true },
        }),
      ])
      
      // Если платеж уже обработан - пропускаем
      if (currentPayment?.isProcessed) {
        return { skip: true, reason: 'payment_already_processed' }
      }
      
      // КРИТИЧЕСКИ ВАЖНО: Если у заявки уже есть ДРУГОЙ обработанный платеж - пропускаем
      // Это предотвращает обработку одной заявки несколькими платежами
      if (otherPayments && otherPayments.length > 0) {
        console.log(`⚠️ [Auto-Deposit] Request ${request.id} already has ${otherPayments.length} processed payment(s) from other payment(s), skipping payment ${paymentId}`)
        // Привязываем текущий платеж к заявке, но не обрабатываем его
        await tx.incomingPayment.update({
          where: { id: paymentId },
          data: {
            requestId: request.id,
            isProcessed: true,
          },
        })
        return { skip: true, reason: 'request_already_has_processed_payment', paymentLinked: true }
      }
      
      // Если заявка уже обработана автопополнением - пропускаем пополнение
      if (currentRequest?.status === 'autodeposit_success' || 
          currentRequest?.status === 'auto_completed' ||
          currentRequest?.processedBy === 'автопополнение') {
        // Все равно привязываем платеж к заявке
        await tx.incomingPayment.update({
          where: { id: paymentId },
          data: {
            requestId: request.id,
            isProcessed: true,
          },
        })
        return { skip: true, reason: 'request_already_processed', paymentLinked: true }
      }
      
      return { skip: false }
    })
    
    if (preCheckResult.skip) {
      console.log(`⚠️ [Auto-Deposit] Request ${request.id} skipped: ${preCheckResult.reason}`)
      return {
        requestId: request.id,
        success: true,
        statusUpdated: false,
        paymentLinked: preCheckResult.paymentLinked || false,
        skipped: true,
        reason: preCheckResult.reason
      }
    }
    
    const { depositToCasino } = await import('./deposit-balance')
    
    // Получаем текущий статус для проверки перед пополнением
    const requestStatusBeforeDeposit = await prisma.request.findUnique({
      where: { id: request.id },
      select: { status: true, statusDetail: true, processedAt: true, updatedAt: true },
    })
    
    // ВАЖНО: Если заявка имеет статус api_error, проверяем, не был ли депозит фактически выполнен
    // Это может произойти если API вернул ошибку "уже был проведен" или "Слишком много запросов"
    // но депозит на самом деле был успешно выполнен
    if (requestStatusBeforeDeposit?.status === 'api_error') {
      const errorMessage = requestStatusBeforeDeposit.statusDetail || ''
      const isDepositAlreadyDoneError = 
        errorMessage.includes('уже был проведен') || 
        errorMessage.includes('уже был') ||
        errorMessage.includes('Слишком много запросов') ||
        errorMessage.includes('Попробуйте позже')
      
      if (isDepositAlreadyDoneError) {
        console.log(`🔍 [Auto-Deposit] Request ${request.id} has api_error with "already done" message. Checking if deposit was actually successful...`)
        
        // Проверяем, был ли действительно выполнен депозит для этого accountId и суммы в последние 5 минут
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
        const recentSuccessfulDeposits = await prisma.request.findMany({
          where: {
            accountId: String(request.accountId),
            bookmaker: request.bookmaker,
            requestType: 'deposit',
            status: {
              in: ['completed', 'approved', 'auto_completed', 'autodeposit_success']
            },
            processedAt: {
              gte: fiveMinutesAgo
            },
            id: {
              not: request.id // Исключаем текущую заявку
            }
          },
          select: {
            id: true,
            amount: true,
            processedAt: true,
          },
          orderBy: {
            processedAt: 'desc'
          },
          take: 1
        })
        
        // Проверяем, есть ли пополнение с такой же суммой
        const duplicateDeposit = recentSuccessfulDeposits.find(deposit => {
          const depositAmount = typeof deposit.amount === 'string' 
            ? parseFloat(deposit.amount) 
            : (deposit.amount as any).toNumber ? (deposit.amount as any).toNumber() : Number(deposit.amount)
          return Math.abs(depositAmount - requestAmount) < 0.01 // Разница не более 1 копейки
        })
        
        if (duplicateDeposit) {
          console.log(`✅ [Auto-Deposit] Found successful deposit for accountId ${request.accountId}, amount ${requestAmount} (Request ID: ${duplicateDeposit.id}). Updating status from api_error to autodeposit_success.`)
          
          // Обновляем статус на autodeposit_success и привязываем платеж
          await prisma.$transaction(async (tx) => {
            await tx.request.update({
              where: { id: request.id },
              data: {
                status: 'autodeposit_success',
                statusDetail: null,
                processedBy: 'автопополнение' as any,
                processedAt: new Date(),
                updatedAt: new Date(),
              } as any,
            })
            
            await tx.incomingPayment.update({
              where: { id: paymentId },
              data: {
                requestId: request.id,
                isProcessed: true,
              },
            })
          })
          
          console.log(`✅ [Auto-Deposit] Request ${request.id} status updated from api_error to autodeposit_success (deposit was actually successful)`)
          
          return {
            requestId: request.id,
            success: true,
            statusUpdated: true,
            paymentLinked: true,
            skipped: false,
            reason: 'api_error_corrected_to_success'
          }
        } else {
          console.log(`⚠️ [Auto-Deposit] Request ${request.id} has api_error but no successful deposit found. Keeping api_error status.`)
        }
      }
    }
    
    // ВАЖНО: Заявки со статусом api_error и deposit_failed обрабатываются вручную администратором
    // Автопополнение не должно пытаться пополнить баланс для таких заявок
    // Также проверяем, не был ли депозит уже выполнен (статусы completed, approved, autodeposit_success)
    const skipStatuses = ['api_error', 'deposit_failed', 'completed', 'approved', 'autodeposit_success', 'auto_completed']
    if (requestStatusBeforeDeposit?.status && skipStatuses.includes(requestStatusBeforeDeposit.status)) {
      console.log(`⚠️ [Auto-Deposit] Request ${request.id} has status ${requestStatusBeforeDeposit.status}. Skipping auto-deposit.`)
      
      // Если заявка уже успешно обработана - привязываем платеж и выходим
      if (['completed', 'approved', 'autodeposit_success', 'auto_completed'].includes(requestStatusBeforeDeposit.status)) {
        await prisma.incomingPayment.update({
          where: { id: paymentId },
          data: {
            requestId: request.id,
            isProcessed: true,
          },
        })
        return {
          requestId: request.id,
          success: true,
          statusUpdated: false,
          paymentLinked: true,
          skipped: true,
          reason: `request_already_${requestStatusBeforeDeposit.status}`
        }
      }
      
      // Для api_error и deposit_failed - привязываем платеж, но не пополняем
      await prisma.incomingPayment.update({
        where: { id: paymentId },
        data: {
          requestId: request.id,
          isProcessed: true,
        },
      })
      
      return {
        requestId: request.id,
        success: false,
        statusUpdated: false,
        paymentLinked: true,
        skipped: true,
        reason: `manual_processing_required_${requestStatusBeforeDeposit.status}`
      }
    }
    
    // Дополнительная проверка: проверяем, не было ли уже успешного пополнения для этого accountId и суммы в последние 5 минут
    // Это защищает от повторных пополнений даже если заявка имеет статус pending
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    const recentSuccessfulDeposits = await prisma.request.findMany({
      where: {
        accountId: String(request.accountId),
        bookmaker: request.bookmaker,
        requestType: 'deposit',
        status: {
          in: ['completed', 'approved', 'auto_completed', 'autodeposit_success']
        },
        processedAt: {
          gte: fiveMinutesAgo
        },
        id: {
          not: request.id // Исключаем текущую заявку
        }
      },
      select: {
        id: true,
        amount: true,
        processedAt: true,
      },
      orderBy: {
        processedAt: 'desc'
      },
      take: 1
    })
    
    // Проверяем, есть ли пополнение с такой же суммой
    const duplicateDeposit = recentSuccessfulDeposits.find(deposit => {
      const depositAmount = typeof deposit.amount === 'string' 
        ? parseFloat(deposit.amount) 
        : (deposit.amount as any).toNumber ? (deposit.amount as any).toNumber() : Number(deposit.amount)
      return Math.abs(depositAmount - requestAmount) < 0.01 // Разница не более 1 копейки
    })
    
    if (duplicateDeposit) {
      const timeDiff = Math.floor((Date.now() - duplicateDeposit.processedAt!.getTime()) / 1000 / 60)
      const remainingMinutes = Math.max(0, 5 - timeDiff)
      console.warn(`⚠️ [Auto-Deposit] Duplicate deposit detected! Found recent successful deposit for accountId ${request.accountId}, amount ${requestAmount}, ${timeDiff} minutes ago (Request ID: ${duplicateDeposit.id}). Skipping.`)
      
      // Привязываем платеж к заявке, но не пытаемся пополнить баланс
      await prisma.incomingPayment.update({
        where: { id: paymentId },
        data: {
          requestId: request.id,
          isProcessed: true,
        },
      })
      
      return {
        requestId: request.id,
        success: false,
        statusUpdated: false,
        paymentLinked: true,
        skipped: true,
        reason: `duplicate_deposit_detected_${remainingMinutes}_minutes_remaining`
      }
    }
    
    // Если заявка уже completed/approved, временно обновляем статус на pending,
    // чтобы depositToCasino не считал её дубликатом
    if (requestStatusBeforeDeposit?.status === 'completed' || requestStatusBeforeDeposit?.status === 'approved') {
      console.log(`⚠️ [Auto-Deposit] Request ${request.id} already ${requestStatusBeforeDeposit.status}, temporarily updating to pending for deposit check`)
      await prisma.request.update({
        where: { id: request.id },
        data: {
          status: 'pending' as any,
          updatedAt: new Date(),
        } as any,
      })
    }
    
    // Сразу пополняем баланс через букмекер API (самое важное - делаем мгновенно)
    // Передаем request.id чтобы исключить текущую заявку из проверки на дублирование
    const depositResult = await depositToCasino(
      request.bookmaker,
      request.accountId,
      requestAmount,
      request.id
    )

    if (!depositResult.success) {
      const errorMessage = depositResult.message || 'Deposit failed'
      console.error(`❌ [Auto-Deposit] Deposit failed: ${errorMessage}`)
      
      // ВАЖНО: Проверяем, не был ли депозит уже выполнен другим процессом
      // Это может произойти если два процесса пытались пополнить одновременно
      const currentRequestCheck = await prisma.request.findUnique({
        where: { id: request.id },
        select: { status: true, processedBy: true },
      })
      
      // Если заявка уже успешно обработана - не устанавливаем api_error
      if (currentRequestCheck?.status === 'autodeposit_success' || 
          currentRequestCheck?.status === 'completed' || 
          currentRequestCheck?.status === 'approved' ||
          currentRequestCheck?.status === 'auto_completed') {
        console.log(`⚠️ [Auto-Deposit] Request ${request.id} was already processed (status: ${currentRequestCheck.status}) by another process. Not setting api_error.`)
        
        // Привязываем платеж к заявке
        await prisma.incomingPayment.update({
          where: { id: paymentId },
          data: {
            requestId: request.id,
            isProcessed: true,
          },
        })
        
        return {
          requestId: request.id,
          success: true,
          statusUpdated: false,
          paymentLinked: true,
          skipped: true,
          reason: 'deposit_already_completed_by_another_process'
        }
      }
      
      // Восстанавливаем исходный статус если был изменен
      if (requestStatusBeforeDeposit?.status === 'completed' || requestStatusBeforeDeposit?.status === 'approved') {
        await prisma.request.update({
          where: { id: request.id },
          data: {
            status: requestStatusBeforeDeposit.status as any,
            updatedAt: new Date(),
          } as any,
        })
      }
      
      // Сохраняем ошибку в БД для отображения в админке
      // НО только если заявка все еще в статусе pending
      if (currentRequestCheck?.status === 'pending') {
        try {
          await prisma.request.update({
            where: { id: request.id },
            data: {
              status: 'api_error',
              statusDetail: errorMessage.length > 50 ? errorMessage.substring(0, 50) : errorMessage,
              processedAt: new Date(),
              updatedAt: new Date(),
            } as any,
          })
          console.log(`⚠️ [Auto-Deposit] Saved error to request ${request.id}: ${errorMessage}`)
        } catch (dbError: any) {
          console.error(`❌ [Auto-Deposit] Failed to save error to DB:`, dbError.message)
        }
      }
      
      // Освобождаем блокировку платежа перед выбросом ошибки
      await prisma.incomingPayment.update({
        where: { id: paymentId },
        data: {
          requestId: null, // Сбрасываем временный маркер
        },
      })
      
      throw new Error(errorMessage)
    }
    
    // После успешного пополнения - атомарно обновляем все в одной транзакции
    // ВАЖНО: Если пополнение успешно, статус ОБЯЗАТЕЛЬНО должен обновиться на autodeposit_success
    // ВАЖНО: Платеж ОБЯЗАТЕЛЬНО должен быть привязан к заявке
    // ВАЖНО: Используем транзакцию чтобы гарантировать что все обновится атомарно
    const updateResult = await prisma.$transaction(async (tx) => {
      // Проверяем текущее состояние заявки и платежа
      const [currentRequest, currentPayment] = await Promise.all([
        tx.request.findUnique({
          where: { id: request.id },
          select: { status: true, processedBy: true },
        }),
        tx.incomingPayment.findUnique({
          where: { id: paymentId },
          select: { isProcessed: true, requestId: true },
        }),
      ])
      
      // КРИТИЧЕСКИ ВАЖНО: Если платеж уже обработан другим процессом - пропускаем (защита от двойного пополнения)
      if (currentPayment?.isProcessed && currentPayment.requestId !== request.id) {
        console.log(`⚠️ [Auto-Deposit] Payment ${paymentId} already processed by another process (requestId: ${currentPayment.requestId}), skipping`)
        return { skipped: true, reason: 'payment_already_processed_by_another_process' }
      }
      
      // Если заявка уже успешно обработана другим процессом - просто привязываем платеж
      if (currentRequest?.status === 'autodeposit_success' || 
          currentRequest?.status === 'completed' || 
          currentRequest?.status === 'approved' ||
          currentRequest?.status === 'auto_completed') {
        console.log(`⚠️ [Auto-Deposit] Request ${request.id} already processed (status: ${currentRequest.status}), but deposit was successful. Linking payment.`)
        await tx.incomingPayment.update({
          where: { id: paymentId },
          data: {
            requestId: request.id,
            isProcessed: true,
          },
        })
        return { skipped: true, reason: 'request_already_processed', paymentLinked: true }
      }
      
      // Если заявка уже обработана автопополнением - все равно привязываем платеж
      if (currentRequest?.processedBy === 'автопополнение' || currentRequest?.status === 'autodeposit_success') {
        console.log(`⚠️ [Auto-Deposit] Request ${request.id} already processed by autodeposit (status: ${currentRequest?.status}), but linking payment anyway`)
        // ВСЕГДА привязываем платеж к заявке, даже если заявка уже обработана
        await tx.incomingPayment.update({
          where: { id: paymentId },
          data: {
            requestId: request.id,
            isProcessed: true,
          },
        })
        console.log(`✅ [Auto-Deposit] Payment ${paymentId} linked to request ${request.id} (request already processed)`)
        return { skipped: true, reason: 'request_already_processed', paymentLinked: true }
      }
      
      // Если заявка уже completed/approved вручную - обновляем статус на autodeposit_success
      // Это важно, чтобы показать, что пополнение было автоматическим
      if (currentRequest?.status === 'completed' || currentRequest?.status === 'approved') {
        console.log(`⚠️ [Auto-Deposit] Request ${request.id} already completed/approved (status: ${currentRequest?.status}), but deposit was successful. Updating to autodeposit_success.`)
        // Обновляем статус на autodeposit_success, чтобы показать что это автопополнение
        await Promise.all([
          tx.request.update({
            where: { id: request.id },
            data: {
              status: 'autodeposit_success',
              statusDetail: null,
              processedBy: 'автопополнение' as any,
              processedAt: new Date(),
              updatedAt: new Date(),
            } as any,
          }),
          tx.incomingPayment.update({
            where: { id: paymentId },
            data: {
              requestId: request.id,
              isProcessed: true,
            },
          }),
        ])
        console.log(`✅ [Auto-Deposit] Request ${request.id} updated to autodeposit_success (was: ${currentRequest?.status}), payment ${paymentId} linked`)
        return { skipped: false, requestUpdated: true, paymentLinked: true }
      }
      
      // Обновляем заявку и платеж атомарно - ВАЖНО: это должно обязательно выполниться
      console.log(`🔄 [Auto-Deposit] Updating request ${request.id} and payment ${paymentId} in transaction...`)
      const [updatedRequest, updatedPayment] = await Promise.all([
        tx.request.update({
          where: { id: request.id },
          data: {
            status: 'autodeposit_success',
            statusDetail: null,
            processedBy: 'автопополнение' as any,
            processedAt: new Date(),
            updatedAt: new Date(),
          } as any,
        }),
        tx.incomingPayment.update({
          where: { id: paymentId },
          data: {
            requestId: request.id,
            isProcessed: true,
          },
        }),
      ])
      
      console.log(`✅ [Auto-Deposit] Transaction SUCCESS: Request ${request.id} status updated to autodeposit_success (was: ${currentRequest?.status})`)
      console.log(`✅ [Auto-Deposit] Transaction SUCCESS: Payment ${paymentId} linked to request ${request.id} and marked as processed`)
      
      return { updatedRequest, updatedPayment, skipped: false }
    })
    
    // Проверяем результат транзакции
    if (updateResult?.skipped) {
      const reason = updateResult.reason || 'unknown'
      const paymentLinked = updateResult.paymentLinked || false
      const requestUpdated = (updateResult as any)?.requestUpdated || false
      
      if (paymentLinked && requestUpdated) {
        // Статус обновлен и платеж привязан - все хорошо
        console.log(`✅ [Auto-Deposit] Payment ${paymentId} linked to request ${request.id}, status updated to autodeposit_success`)
        return {
          requestId: request.id,
          success: true,
          paymentLinked: true,
          statusUpdated: true,
          reason
        }
      } else if (paymentLinked) {
        console.log(`✅ [Auto-Deposit] Payment ${paymentId} linked to request ${request.id} (skipped status update: ${reason})`)
        // Платеж привязан, но статус не обновлен - это нормально если заявка уже обработана
        return {
          requestId: request.id,
          success: true,
          paymentLinked: true,
          statusUpdated: false,
          reason
        }
      } else {
        console.log(`⚠️ [Auto-Deposit] Transaction skipped for request ${request.id} (reason: ${reason})`)
        return null
      }
    }
    
    if (!updateResult?.updatedRequest || !updateResult?.updatedPayment) {
      console.error(`❌ [Auto-Deposit] Transaction failed to update request ${request.id} or payment ${paymentId}`)
      throw new Error('Failed to update request status or payment in transaction')
    }
    
    // Дополнительная проверка что статус действительно обновился
    let verifyRequest = await prisma.request.findUnique({
      where: { id: request.id },
      select: { status: true, processedBy: true },
    })
    
    // Проверяем что платеж привязан
    let verifyPayment = await prisma.incomingPayment.findUnique({
      where: { id: paymentId },
      select: { requestId: true, isProcessed: true },
    })
    
    // КРИТИЧЕСКАЯ ЗАЩИТА: Если статус не обновился, пытаемся обновить вручную
    if (verifyRequest?.status !== 'autodeposit_success') {
      console.error(`❌ [Auto-Deposit] CRITICAL: Request ${request.id} status is ${verifyRequest?.status}, expected autodeposit_success`)
      console.log(`🔄 [Auto-Deposit] Attempting manual status update for request ${request.id}...`)
      
      try {
        // Пытаемся обновить статус вручную как последнюю попытку
        const manualUpdate = await prisma.request.update({
          where: { id: request.id },
          data: {
            status: 'autodeposit_success',
            statusDetail: null,
            processedBy: 'автопополнение' as any,
            processedAt: new Date(),
            updatedAt: new Date(),
          } as any,
        })
        
        // Проверяем еще раз
        verifyRequest = await prisma.request.findUnique({
          where: { id: request.id },
          select: { status: true, processedBy: true },
        })
        
        if (verifyRequest?.status === 'autodeposit_success') {
          console.log(`✅ [Auto-Deposit] Manual update successful: Request ${request.id} → autodeposit_success`)
        } else {
          console.error(`❌ [Auto-Deposit] Manual update failed: Request ${request.id} status is still ${verifyRequest?.status}`)
          throw new Error(`Failed to update request status: current status is ${verifyRequest?.status}`)
        }
      } catch (manualUpdateError: any) {
        console.error(`❌ [Auto-Deposit] Manual update error:`, manualUpdateError.message)
        throw new Error(`Failed to update request status: ${manualUpdateError.message}`)
      }
    } else {
      console.log(`✅ [Auto-Deposit] SUCCESS: Request ${request.id} → autodeposit_success (verified)`)
    }
    
    // Проверяем что платеж привязан
    if (!verifyPayment?.requestId || verifyPayment.requestId !== request.id) {
      console.error(`❌ [Auto-Deposit] CRITICAL: Payment ${paymentId} not linked to request ${request.id} (requestId: ${verifyPayment?.requestId})`)
      console.log(`🔄 [Auto-Deposit] Attempting manual payment link for payment ${paymentId}...`)
      
      try {
        await prisma.incomingPayment.update({
          where: { id: paymentId },
          data: {
            requestId: request.id,
            isProcessed: true,
          },
        })
        console.log(`✅ [Auto-Deposit] Manual payment link successful: Payment ${paymentId} → Request ${request.id}`)
      } catch (paymentLinkError: any) {
        console.error(`❌ [Auto-Deposit] Manual payment link error:`, paymentLinkError.message)
        throw new Error(`Failed to link payment: ${paymentLinkError.message}`)
      }
    } else {
      console.log(`✅ [Auto-Deposit] SUCCESS: Payment ${paymentId} linked to request ${request.id} (verified)`)
    }

    // Финальная проверка что все обновлено
    const finalCheck = await prisma.request.findUnique({
      where: { id: request.id },
      select: { status: true, processedBy: true },
    })
    
    const finalPaymentCheck = await prisma.incomingPayment.findUnique({
      where: { id: paymentId },
      select: { requestId: true, isProcessed: true },
    })
    
    const statusOk = finalCheck?.status === 'autodeposit_success'
    const paymentOk = finalPaymentCheck?.requestId === request.id && finalPaymentCheck?.isProcessed === true
    
    // Начисляем реферальные бонусы (2% от депозита) если депозит успешно обработан
    if (statusOk && !updateResult?.skipped && request.userId && request.amount) {
      processReferralEarning(
        request.userId,
        requestAmount,
        request.bookmaker || null,
        request.id,
        request.createdAt || undefined // Передаем дату создания депозита для защиты от абуза
      ).catch(error => {
        console.error(`❌ [Auto-Deposit] Failed to process referral earning:`, error)
        // Не блокируем выполнение, если начисление бонусов не удалось
      })
    }

    // Отправляем уведомление пользователю в бот, если заявка создана через бот
    // ВАЖНО: Отправляем только если статус действительно обновился на autodeposit_success
    // ВАЖНО: Проверяем, не было ли уже отправлено уведомление (чтобы избежать дубликатов)
    if (statusOk && !updateResult?.skipped) {
      try {
        // КРИТИЧЕСКИ ВАЖНО: Атомарная проверка - убеждаемся, что мы первые, кто обновляет статус
        // Это предотвращает отправку уведомления дважды при параллельных вызовах
        const notificationCheck = await prisma.$transaction(async (tx) => {
          const currentRequest = await tx.request.findUnique({
            where: { id: request.id },
            select: {
              status: true,
              processedAt: true,
              updatedAt: true,
            },
          })
          
          if (!currentRequest || currentRequest.status !== 'autodeposit_success') {
            return { shouldSend: false, reason: 'status_not_autodeposit_success' }
          }
          
          // Проверяем, не было ли уведомление уже отправлено (processedAt был обновлен недавно)
          // Если processedAt был обновлен более 10 секунд назад, значит это не наш вызов
          const processedAtTime = currentRequest.processedAt?.getTime() || 0
          const now = Date.now()
          const timeSinceProcessed = now - processedAtTime
          
          // Если processedAt был обновлен более 10 секунд назад, значит уведомление уже могло быть отправлено
          if (timeSinceProcessed > 10000) {
            return { shouldSend: false, reason: 'notification_already_sent' }
          }
          
          return { shouldSend: true }
        })
        
        if (!notificationCheck.shouldSend) {
          console.log(`⚠️ [Auto-Deposit] Skipping notification for request ${request.id}: ${notificationCheck.reason}`)
          return {
            requestId: request.id,
            success: statusOk && paymentOk,
            statusUpdated: statusOk,
            paymentLinked: paymentOk,
          }
        }
        
        const fullRequest = await prisma.request.findUnique({
          where: { id: request.id },
          select: {
            userId: true,
            source: true,
            amount: true,
            bookmaker: true,
            createdAt: true,
          },
        })
        
        if (fullRequest) {
          const source = (fullRequest as any).source
          const isFromBot = source === 'bot' || !source
          
          if (isFromBot && fullRequest.userId) {
            // Вычисляем время с момента создания заявки
            const timeSinceCreation = Date.now() - new Date(fullRequest.createdAt).getTime()
            
            // Если заявка только что создана (меньше 2 секунд), добавляем задержку
            // чтобы уведомление "Заявка отправлена!" успело отправиться первым
            const delay = timeSinceCreation < 2000 ? 1500 : 500 // 1.5 сек если новая заявка, иначе 0.5 сек
            
            // Отправляем уведомление с задержкой, чтобы оно пришло после "Заявка отправлена!"
            setTimeout(async () => {
              // Дополнительная проверка перед отправкой - убеждаемся, что статус все еще autodeposit_success
              const finalCheck = await prisma.request.findUnique({
                where: { id: request.id },
                select: { status: true },
              })
              
              if (finalCheck?.status !== 'autodeposit_success') {
                console.log(`⚠️ [Auto-Deposit] Status changed before notification send, skipping for request ${request.id}`)
                return
              }
              
              const notificationMessage = `✅ <b>Ваш баланс пополнен!</b>\n\n` +
                `💰 Сумма: ${fullRequest.amount} сом\n` +
                `🎰 Счет: ${fullRequest.bookmaker?.toUpperCase() || 'N/A'}\n` +
                `⏱ Закрыта за: 1с`
              
              // Отправляем уведомление напрямую через Telegram API
              const botToken = process.env.BOT_TOKEN
              if (botToken) {
                const sendMessageUrl = `https://api.telegram.org/bot${botToken}/sendMessage`
                fetch(sendMessageUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: fullRequest.userId.toString(),
                    text: notificationMessage,
                    parse_mode: 'HTML',
                  }),
                }).then(() => {
                  console.log(`✅ [Auto-Deposit] Notification sent successfully for request ${request.id}`)
                }).catch((error: any) => {
                  console.error(`❌ [Auto-Deposit] Failed to send notification for request ${request.id}:`, error)
                })
              }
            }, delay)
          }
        }
      } catch (notificationError: any) {
        // Не блокируем выполнение если уведомление не отправилось
        console.error(`❌ [Auto-Deposit] Error sending notification for request ${request.id}:`, notificationError)
      }
    }
    
    console.log(`📊 [Auto-Deposit] Final check for request ${request.id}:`, {
      status: finalCheck?.status,
      statusOk,
      paymentLinked: paymentOk,
      paymentRequestId: finalPaymentCheck?.requestId
    })
    
    if (!statusOk || !paymentOk) {
      console.error(`❌ [Auto-Deposit] FINAL CHECK FAILED:`, {
        statusOk,
        paymentOk,
        currentStatus: finalCheck?.status,
        paymentRequestId: finalPaymentCheck?.requestId
      })
    }
    
    return {
      requestId: request.id,
      success: statusOk && paymentOk,
      statusUpdated: statusOk,
      paymentLinked: paymentOk,
    }
  } catch (error: any) {
    console.error(`❌ [Auto-Deposit] FAILED for request ${request.id}:`, error.message)
    
    // ВАЖНО: Блокировка автоматически освободится через 30 секунд (через проверку updatedAt)
    // Но если платеж не был обработан, можно явно сбросить requestId
    try {
      const currentPayment = await prisma.incomingPayment.findUnique({
        where: { id: paymentId },
        select: { requestId: true, isProcessed: true },
      })
      
      // Если платеж не был обработан и requestId установлен - сбрасываем его
      if (currentPayment && !currentPayment.isProcessed && currentPayment.requestId !== null) {
        // Проверяем, не был ли requestId установлен другим процессом
        const requestCheck = await prisma.request.findUnique({
          where: { id: currentPayment.requestId },
          select: { id: true },
        })
        
        // Если requestId не соответствует реальной заявке - сбрасываем
        if (!requestCheck) {
          await prisma.incomingPayment.update({
            where: { id: paymentId },
            data: {
              requestId: null,
            },
          })
          console.log(`🔓 [Auto-Deposit] Released lock on payment ${paymentId} after error`)
        }
      }
    } catch (unlockError: any) {
      console.error(`❌ [Auto-Deposit] Failed to release lock on payment ${paymentId}:`, unlockError.message)
    }
    
    throw error
  }
}

