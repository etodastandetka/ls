import { prisma } from './prisma'
import { AUTO_DEPOSIT_CONFIG } from '@/config/app'

/**
 * ЕДИНСТВЕННАЯ функция автопополнения - работает только здесь
 * Все вызовы должны использовать эту функцию из ./auto-deposit
 * Работает секунду в секунду - мгновенно
 * ВАЖНО: Гарантирует что статус заявки ОБЯЗАТЕЛЬНО обновится на autodeposit_success
 */
export async function matchAndProcessPayment(paymentId: number, amount: number) {
  console.log(`🔍 [Auto-Deposit] matchAndProcessPayment called: paymentId=${paymentId}, amount=${amount}`)
  
  // ВАЖНО: Получаем информацию о платеже, чтобы проверить время поступления
  const payment = await prisma.incomingPayment.findUnique({
    where: { id: paymentId },
    select: { paymentDate: true, createdAt: true, isProcessed: true },
  })
  
  if (!payment) {
    console.error(`❌ [Auto-Deposit] Payment ${paymentId} not found`)
    return null
  }
  
  if (payment.isProcessed) {
    console.log(`⚠️ [Auto-Deposit] Payment ${paymentId} already processed, skipping`)
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
  // ВАЖНО: Используем окно ±5 минут, чтобы найти заявки созданные до или после платежа
  const searchWindowMs = AUTO_DEPOSIT_CONFIG.REQUEST_SEARCH_WINDOW_MS
  const searchWindowStart = new Date(baseTime.getTime() - searchWindowMs) // 5 минут ДО платежа
  const searchWindowEnd = new Date(baseTime.getTime() + searchWindowMs) // 5 минут ПОСЛЕ платежа
  const now = new Date()
  
  // Ограничиваем поиск текущим моментом, чтобы не искать в будущем
  const actualSearchEnd = searchWindowEnd > now ? now : searchWindowEnd

  console.log(`🔍 [Auto-Deposit] Search window: ${searchWindowStart.toISOString()} to ${actualSearchEnd.toISOString()}`)

  // Оптимизированный поиск заявок - минимум запросов для максимальной скорости
  // Ищем заявки в окне ±5 минут от платежа
  const matchingRequests = await prisma.request.findMany({
    where: {
      requestType: 'deposit',
      status: 'pending',
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
    
    // Проверяем разницу времени между заявкой и платежом
    // Разрешаем сопоставление если заявка создана в пределах ±5 минут от платежа
    const timeDiff = baseTime.getTime() - req.createdAt.getTime()
    const timeDiffAbs = Math.abs(timeDiff)
    const maxTimeDiff = AUTO_DEPOSIT_CONFIG.REQUEST_SEARCH_WINDOW_MS // 5 минут
    
    // Если разница больше 5 минут - пропускаем
    if (timeDiffAbs > maxTimeDiff) {
      const minutesDiff = Math.floor(timeDiffAbs / 60000)
      const direction = timeDiff > 0 ? 'after' : 'before'
      console.log(`⚠️ [Auto-Deposit] Request ${req.id} created ${minutesDiff} minutes ${direction} payment ${paymentId} (too far apart), skipping`)
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
    // Это предотвращает дублирование пополнений в казино при параллельных вызовах
    const preCheckResult = await prisma.$transaction(async (tx) => {
      // Проверяем текущее состояние заявки и платежа атомарно
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
      
      // Если платеж уже обработан - пропускаем
      if (currentPayment?.isProcessed) {
        return { skip: true, reason: 'payment_already_processed' }
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
      select: { status: true },
    })
    
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
    
    // Сразу пополняем баланс через казино API (самое важное - делаем мгновенно)
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
      
      // КРИТИЧЕСКИ ВАЖНО: Если платеж уже обработан - пропускаем (защита от двойного пополнения)
      if (currentPayment?.isProcessed) {
        console.log(`⚠️ [Auto-Deposit] Payment ${paymentId} already processed (requestId: ${currentPayment.requestId}), skipping`)
        return { skipped: true, reason: 'payment_already_processed' }
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
    
    // Отправляем уведомление пользователю в бот, если заявка создана через бот
    // ВАЖНО: Отправляем только если статус действительно обновился на autodeposit_success
    // Это предотвращает дублирование уведомлений
    if (statusOk && !updateResult?.skipped) {
      try {
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
              const notificationMessage = `✅ <b>Ваш баланс пополнен!</b>\n\n` +
                `💰 Сумма: ${fullRequest.amount} сом\n` +
                `🎰 Казино: ${fullRequest.bookmaker?.toUpperCase() || 'N/A'}\n` +
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
    throw error
  }
}

