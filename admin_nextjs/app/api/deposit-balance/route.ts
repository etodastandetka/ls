import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { depositToCasino } from '@/lib/deposit-balance'
import { processReferralEarning } from '@/lib/referral-earnings'

// Функция для отправки уведомления пользователю в Telegram
async function sendTelegramNotification(userId: bigint, message: string) {
  try {
    const botToken = process.env.BOT_TOKEN
    if (!botToken) {
      console.warn('⚠️ BOT_TOKEN not configured, skipping Telegram notification')
      return
    }

    const sendMessageUrl = `https://api.telegram.org/bot${botToken}/sendMessage`
    const response = await fetch(sendMessageUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: userId.toString(),
        text: message,
        parse_mode: 'HTML',
      }),
    })

    if (!response.ok) {
      const errorData = await response.json()
      console.error('❌ Failed to send Telegram notification:', errorData)
      return
    }

    const data = await response.json()
    if (data.ok) {
      console.log(`✅ Telegram notification sent to user ${userId}`)
    }
  } catch (error) {
    console.error('❌ Error sending Telegram notification:', error)
  }
}

export const dynamic = 'force-dynamic'

// API для пополнения баланса игрока
export async function POST(request: NextRequest) {
  try {
    const authUser = requireAuth(request)

    const body = await request.json()
    const { requestId, bookmaker, accountId, amount } = body

    if (!requestId || !bookmaker || !accountId || !amount) {
      return NextResponse.json(
        createApiResponse(null, 'Missing required fields: requestId, bookmaker, accountId, amount'),
        { status: 400 }
      )
    }

    // Получаем заявку
    const requestData = await prisma.request.findUnique({
      where: { id: parseInt(requestId) },
    })

    if (!requestData) {
      return NextResponse.json(
        createApiResponse(null, 'Request not found'),
        { status: 404 }
      )
    }
    
    // Защита от повторных пополнений - проверяем статус заявки
    if (requestData.status === 'completed' || requestData.status === 'approved' || requestData.status === 'autodeposit_success') {
      console.warn(`⚠️ [Deposit Balance] Request ${requestId} already processed (status: ${requestData.status}), skipping deposit`)
      return NextResponse.json(
        createApiResponse(null, `Заявка уже обработана (статус: ${requestData.status}). Повторное пополнение невозможно.`),
        { status: 400 }
      )
    }

    // ВАЖНО: Используем accountId (ID букмекера), а не userId (Telegram ID)
    // accountId - это ID игрока в букмекере (например, ID счета 1xbet, Melbet и т.д.)
    console.log(`[Deposit Balance] Bookmaker: ${bookmaker}, Casino Account ID: ${accountId}, Amount: ${amount}, Request ID: ${requestId}`)
    
    // Пополняем баланс через API букмекера
    const depositResult = await depositToCasino(bookmaker, accountId, parseFloat(amount), parseInt(requestId))

    if (!depositResult.success) {
      const errorMessage = depositResult.message || 'Failed to deposit balance'
      console.error(`[Deposit Balance] Failed for ${bookmaker}, accountId: ${accountId}`, depositResult)
      
      // Сохраняем ошибку в БД для отображения в админке
      if (requestId) {
        try {
          await prisma.request.update({
            where: { id: parseInt(requestId) },
            data: {
              status: 'api_error',
              statusDetail: errorMessage.length > 50 ? errorMessage.substring(0, 50) : errorMessage,
              processedAt: new Date(),
              updatedAt: new Date(),
            } as any,
          })
          console.log(`⚠️ [Deposit Balance] Saved error to request ${requestId}: ${errorMessage}`)
        } catch (dbError: any) {
          console.error(`❌ [Deposit Balance] Failed to save error to DB:`, dbError.message)
        }
      }
      
      return NextResponse.json(
        createApiResponse(null, errorMessage),
        { status: 500 }
      )
    }
    
    console.log(`[Deposit Balance] Success for ${bookmaker}, accountId: ${accountId}`, depositResult)

    // Обновляем статус заявки на completed
    // processedBy устанавливается из токена админа (ручное подтверждение)
    const updatedRequest = await prisma.request.update({
      where: { id: parseInt(requestId) },
      data: {
        status: 'completed',
        processedAt: new Date(),
        processedBy: authUser.username as any,
      },
    })

    // Начисляем реферальные бонусы (2% от депозита)
    if (requestData.userId && requestData.amount) {
      processReferralEarning(
        requestData.userId,
        parseFloat(requestData.amount.toString()),
        requestData.bookmaker,
        parseInt(requestId),
        requestData.createdAt || undefined // Передаем дату создания депозита для защиты от абуза
      ).catch(error => {
        console.error(`❌ [Deposit Balance] Failed to process referral earning:`, error)
        // Не блокируем ответ, если начисление бонусов не удалось
      })
    }

    // Отправляем уведомление пользователю в бот, если заявка создана через бот
    const source = (requestData as any).source
    const isFromBot = source === 'bot' || !source
    
    if (isFromBot && requestData.userId) {
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

      const closedDuration = formatDuration(requestData.createdAt, updatedRequest.processedAt || new Date())
      const notificationMessage = `✅ <b>Ваш баланс пополнен!</b>\n\n` +
        `💰 Сумма: ${amount} сом\n` +
        `🎰 Букмекер: ${bookmaker.toUpperCase()}` +
        (closedDuration ? `\n⏱ Закрыта за: ${closedDuration}` : '')
      
      // Отправляем уведомление асинхронно, не блокируя ответ
      sendTelegramNotification(requestData.userId, notificationMessage)
        .catch(error => {
          console.error(`❌ Failed to send notification for request ${requestId}:`, error)
        })
    }

    // Преобразуем BigInt в строки для JSON сериализации
    const serializeBigInt = (obj: any): any => {
      if (obj === null || obj === undefined) return obj
      if (typeof obj === 'bigint') return obj.toString()
      if (Array.isArray(obj)) return obj.map(serializeBigInt)
      if (typeof obj === 'object') {
        const serialized: any = {}
        for (const [key, value] of Object.entries(obj)) {
          serialized[key] = serializeBigInt(value)
        }
        return serialized
      }
      return obj
    }

    const serializedRequest = serializeBigInt(updatedRequest)

    return NextResponse.json(
      createApiResponse({
        success: true,
        message: depositResult.message,
        request: serializedRequest,
      })
    )
  } catch (error: any) {
    console.error('Deposit balance API error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to deposit balance'),
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}

