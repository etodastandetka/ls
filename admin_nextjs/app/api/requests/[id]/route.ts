import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'
import { sendTelegramGroupMessage } from '@/lib/telegram-group'

// Функция для отправки уведомления пользователю в Telegram
async function sendTelegramNotification(userId: bigint, message: string, withMenuButton: boolean = false) {
  try {
    const botToken = process.env.BOT_TOKEN
    if (!botToken) {
      console.error('❌ [Telegram Notification] BOT_TOKEN not configured, skipping notification')
      throw new Error('BOT_TOKEN not configured')
    }

    // Проверяем формат токена
    if (botToken.length < 10 || !botToken.includes(':')) {
      console.error(`❌ [Telegram Notification] BOT_TOKEN format is invalid (length: ${botToken.length})`)
      throw new Error('BOT_TOKEN format is invalid')
    }

    const sendMessageUrl = `https://api.telegram.org/bot${botToken}/sendMessage`
    const chatId = userId.toString()
    
    console.log(`📤 [Telegram Notification] Sending to chat_id: ${chatId}, message length: ${message.length}`)
    
    const body: any = {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    }

    // Инлайн-кнопки убраны - кнопки "Пополнить" и "Вывести" теперь только в Reply клавиатуре
    // Параметр withMenuButton оставлен для совместимости, но не используется

    const response = await fetch(sendMessageUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const responseData = await response.json()
    
    if (!response.ok) {
      console.error(`❌ [Telegram Notification] HTTP error for ${chatId}:`, {
        status: response.status,
        statusText: response.statusText,
        errorCode: responseData.error_code,
        description: responseData.description
      })
      throw new Error(`Telegram API error: ${responseData.description || response.statusText}`)
    }

    if (responseData.ok) {
      console.log(`✅ [Telegram Notification] Sent successfully to user ${userId} (chat_id: ${chatId})`)
      return true
    } else {
      console.error(`❌ [Telegram Notification] API returned error for ${chatId}:`, responseData)
      throw new Error(`Telegram API error: ${responseData.description || 'Unknown error'}`)
    }
  } catch (error: any) {
    console.error('❌ [Telegram Notification] Error sending notification:', {
      userId: userId.toString(),
      error: error.message,
      stack: error.stack?.substring(0, 200)
    })
    throw error // Пробрасываем ошибку дальше для обработки
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Обработка Next.js 15+ где params может быть Promise
    const resolvedParams = params instanceof Promise ? await params : params
    const id = parseInt(resolvedParams.id)
    
    if (isNaN(id) || id <= 0) {
      return NextResponse.json(
        createApiResponse(null, 'Invalid request ID'),
        { status: 400 }
      )
    }

    const requestData = await prisma.request.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        username: true,
        firstName: true,
        lastName: true,
        bookmaker: true,
        accountId: true,
        amount: true,
        requestType: true,
        status: true,
        statusDetail: true,
        processedBy: true,
        bank: true,
        phone: true,
        withdrawalCode: true,
        photoFileUrl: true, // Добавляем photoFileUrl для отображения фото чеков (deposit) и QR-кодов (withdraw)
        paymentMethod: true,
        createdAt: true,
        updatedAt: true,
        processedAt: true,
        cryptoPayment: {
          select: {
            id: true,
            invoice_id: true,
            amount: true,
            fee_amount: true,
            asset: true,
            status: true,
            request_id: true,
          },
        },
      },
    })

    if (!requestData) {
      return NextResponse.json(
        createApiResponse(null, 'Request not found'),
        { status: 404 }
      )
    }

    // Оптимизация: загружаем дополнительные данные только если они действительно нужны
    // Matching payments нужны для всех депозитов (независимо от статуса)
    const isDeposit = requestData.requestType === 'deposit'
    const requestAmountInt = requestData.amount ? Math.floor(parseFloat(requestData.amount.toString())) : null
    
    // Загружаем только критичные данные в основном запросе
    // Остальное загружаем асинхронно через отдельные endpoints если нужно
    const [matchingPaymentsResult, casinoTransactionsResult, userResult] = await Promise.all([
      // Matching payments - для депозитов с суммой
      // Показываем ВСЕ платежи с той же целой частью суммы (независимо от копеек)
      // Показываем и обработанные, и необработанные
      // Показываем за ВСЕ время (без ограничения по дате)
      (isDeposit && requestAmountInt) ? prisma.incomingPayment.findMany({
          where: {
            amount: {
              gte: requestAmountInt,
              lt: requestAmountInt + 1,
            },
            // Показываем все платежи (и обработанные, и необработанные)
            // Убрали фильтр isProcessed: false
            // Убрали ограничение по paymentDate - показываем за все время
          },
          orderBy: { paymentDate: 'desc' },
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            requestId: true,
            isProcessed: true,
            bank: true,
          },
        }) : Promise.resolve([]),
      
      // Casino transactions - только для pending заявок или если явно нужны
      // Для завершенных заявок не загружаем - это экономит время
      (requestData.status === 'pending' && requestData.accountId && requestData.bookmaker) ? prisma.request.findMany({
          where: {
            accountId: requestData.accountId,
            bookmaker: requestData.bookmaker,
            // Исключаем текущую заявку
            id: { not: requestData.id },
          },
          orderBy: { createdAt: 'desc' },
          take: 3, // Только первые 3 для ускорения
          select: {
            id: true,
            userId: true,
            username: true,
            firstName: true,
            lastName: true,
            amount: true,
            requestType: true,
            status: true,
            createdAt: true,
            bookmaker: true,
            accountId: true,
          },
        }) : Promise.resolve([]),
      
      // User note - загружаем всегда, но это быстрый запрос с индексом
      prisma.botUser.findUnique({
          where: { userId: requestData.userId },
          select: { note: true },
        }),
    ])

    const matchingPayments = matchingPaymentsResult.map(p => ({
      ...p,
      amount: p.amount.toString(),
    }))

    const casinoTransactions = casinoTransactionsResult.map(t => ({
      ...t,
      userId: t.userId.toString(),
      amount: t.amount ? t.amount.toString() : null,
    }))

    // Включаем photoFileUrl в основной ответ для отображения фото чеков (deposit) и QR-кодов (withdraw)
    // Фото загружается вместе с данными заявки для удобства отображения в админке
    const responseData = {
      ...requestData,
      userId: requestData.userId.toString(),
      amount: requestData.amount ? requestData.amount.toString() : null,
      photoFileUrl: requestData.photoFileUrl || null, // Включаем photoFileUrl из запроса для отображения фото чеков
      paymentMethod: requestData.paymentMethod || null,
      cryptoPayment: requestData.cryptoPayment ? {
        ...requestData.cryptoPayment,
        amount: requestData.cryptoPayment.amount.toString(),
        fee_amount: requestData.cryptoPayment.fee_amount?.toString() || null,
      } : null,
      incomingPayments: [],
      matchingPayments,
      casinoTransactions,
      userNote: userResult?.note || null,
    }
    
    const response = NextResponse.json(createApiResponse(responseData))
    // Добавляем кэширование для быстрой загрузки
    // Для pending заявок кэш короче (3 сек), для остальных дольше (15 сек)
    // Используем stale-while-revalidate для мгновенной загрузки из кэша
    const cacheTime = requestData.status === 'pending' ? 3 : 15
    response.headers.set('Cache-Control', `public, s-maxage=${cacheTime}, stale-while-revalidate=${cacheTime * 3}`)
    return response
  } catch (error: any) {
    console.error('❌ [GET /api/requests/[id]] Error:', {
      error: error.message,
      stack: error.stack,
      name: error.name
    })
    
    // Более детальная обработка ошибок
    if (error.message === 'Unauthorized') {
      return NextResponse.json(
        createApiResponse(null, 'Unauthorized'),
        { status: 401 }
      )
    }
    
    // Ошибки базы данных
    if (error.code === 'P2002' || error.code?.startsWith('P')) {
      return NextResponse.json(
        createApiResponse(null, 'Database error'),
        { status: 500 }
      )
    }
    
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to fetch request'),
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const formatDuration = (start?: Date | string | null, end?: Date | string | null) => {
    if (!start || !end) return null
    const startDate = typeof start === 'string' ? new Date(start) : start
    const endDate = typeof end === 'string' ? new Date(end) : end
    const diffMs = endDate.getTime() - startDate.getTime()
    if (Number.isNaN(diffMs) || diffMs < 0) return null
    const totalSeconds = Math.round(diffMs / 1000)
    if (totalSeconds < 60) return `${totalSeconds}с`
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (minutes < 60) return `${minutes}м ${seconds}с`
    const hours = Math.floor(minutes / 60)
    const remMinutes = minutes % 60
    return `${hours}ч ${remMinutes}м`
  }

  try {
    const authUser = requireAuth(request)

    // Обработка Next.js 15+ где params может быть Promise
    const resolvedParams = params instanceof Promise ? await params : params
    const id = parseInt(resolvedParams.id)
    const body = await request.json()

    const updateData: any = {}
    if (body.status) updateData.status = body.status
    if (body.statusDetail) updateData.statusDetail = body.statusDetail
    if (body.processedAt !== undefined) {
      updateData.processedAt = body.processedAt ? new Date(body.processedAt) : null
    }
    // Обновление фото чека
    if (body.photoFileUrl !== undefined) {
      updateData.photoFileUrl = body.photoFileUrl
    }

    // Получаем заявку до обновления для отправки уведомления
    const requestBeforeUpdate = await prisma.request.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        requestType: true,
        amount: true,
        bookmaker: true,
        status: true,
        createdAt: true,
        source: true, // Добавляем source для проверки источника заявки
      },
    })

    if (!requestBeforeUpdate) {
      return NextResponse.json(
        createApiResponse(null, 'Request not found'),
        { status: 404 }
      )
    }

    // ЗАЩИТА: Выводы могут быть отклонены ТОЛЬКО администратором через админку
    // Запрещаем автоматическую отмену выводов
    if (body.status === 'rejected' && requestBeforeUpdate.requestType === 'withdraw') {
      // Проверяем, что это запрос от авторизованного администратора (requireAuth уже проверил)
      // Дополнительная проверка: отклонение выводов разрешено только через админку
      console.log(`[Request ${id}] Withdrawal rejection by admin: ${authUser.username}`)
    }

    if (body.status && ['completed', 'rejected', 'approved'].includes(body.status)) {
      updateData.processedAt = new Date()
      // Сохраняем логин админа, который закрыл заявку
      updateData.processedBy = authUser.username
    }

    const updatedRequest = await prisma.request.update({
      where: { id },
      data: updateData,
    })

    // Отправляем уведомления при изменении статуса
    // ВАЖНО: Отправляем уведомления для ВСЕХ заявок с userId (и из бота, и из мини-приложения)
    // Пользователи должны получать уведомления независимо от источника заявки
    const successStatuses = ['completed', 'rejected', 'approved', 'autodeposit_success', 'auto_completed']
    if (body.status && successStatuses.includes(body.status)) {
      // Отправляем уведомление если есть userId (независимо от source)
      if (requestBeforeUpdate.userId) {
        let notificationMessage = ''
        
        const isAutoDepositStatus = body.status === 'autodeposit_success' || body.status === 'auto_completed'
        const closedDuration = isAutoDepositStatus
          ? '1с'
          : formatDuration(
              requestBeforeUpdate.createdAt,
              updateData.processedAt || updatedRequest.processedAt || new Date()
            )

        if (body.status === 'completed' || body.status === 'approved' || body.status === 'autodeposit_success' || body.status === 'auto_completed') {
          if (requestBeforeUpdate.requestType === 'deposit') {
            notificationMessage = `✅ <b>Ваш баланс пополнен!</b>\n\n` +
              `💰 Сумма: ${requestBeforeUpdate.amount} сом\n` +
              `🎰 Казино: ${requestBeforeUpdate.bookmaker?.toUpperCase() || 'N/A'}` +
              (closedDuration ? `\n⏱ Закрыта за: ${closedDuration}` : '')
          } else if (requestBeforeUpdate.requestType === 'withdraw') {
            notificationMessage = `✅ <b>Заявка на вывод одобрена!</b>\n\n` +
              `💰 Сумма: ${requestBeforeUpdate.amount} сом\n` +
              `🎰 Казино: ${requestBeforeUpdate.bookmaker?.toUpperCase() || 'N/A'}` +
              (closedDuration ? `\n⏱ Закрыта за: ${closedDuration}` : '')
          }
        } else if (body.status === 'rejected') {
          notificationMessage = `❌ <b>Заявка отклонена</b>\n\n` +
            `💰 Сумма: ${requestBeforeUpdate.amount} сом\n` +
            `🎰 Казино: ${requestBeforeUpdate.bookmaker?.toUpperCase() || 'N/A'}` +
            (closedDuration ? `\n⏱ Закрыта за: ${closedDuration}` : '')
          
          if (body.statusDetail) {
            notificationMessage += `\n\nПричина: ${body.statusDetail}`
          }
        }
        
        if (notificationMessage) {
          const source = requestBeforeUpdate.source || 'unknown'
          console.log(`📤 [Request ${id}] Sending notification to user ${requestBeforeUpdate.userId}, status: ${body.status}, type: ${requestBeforeUpdate.requestType}, source: ${source}`)
          
          // Отправляем уведомление с обработкой ошибок
          sendTelegramNotification(requestBeforeUpdate.userId, notificationMessage, false)
            .then(() => {
              console.log(`✅ [Request ${id}] Notification sent successfully to user ${requestBeforeUpdate.userId}`)
            })
            .catch(error => {
              console.error(`❌ [Request ${id}] Failed to send notification to user ${requestBeforeUpdate.userId}:`, error)
            })
        } else {
          console.warn(`⚠️ [Request ${id}] No notification message generated for status: ${body.status}, type: ${requestBeforeUpdate.requestType}`)
        }
      } else {
        console.log(`⚠️ [Request ${id}] Skipping notification - no userId`)
      }
    }

    // Уведомления в группу для выводов отключены по запросу пользователя

    const response = NextResponse.json(
      createApiResponse({
        ...updatedRequest,
        userId: updatedRequest.userId.toString(),
        amount: updatedRequest.amount ? updatedRequest.amount.toString() : null,
      })
    )
    
    // Инвалидируем кэш для списка заявок, чтобы дашборд обновился сразу
    response.headers.set('Cache-Control', 'no-store, must-revalidate')
    
    return response
  } catch (error: any) {
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to update request'),
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}

