import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendTelegramGroupMessage } from '@/lib/telegram-group'
import { createApiResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/**
 * API для отправки отложенного уведомления о депозите
 * Вызывается через минуту после создания заявки, если автопополнение не сработало
 * GET /api/notifications/delayed-deposit?requestId=123
 */
export async function GET(req: NextRequest) {
  try {
    // ВАЖНО: Это внутренний endpoint, вызываемый через setTimeout из payment API
    // Проверяем, что это внутренний запрос (localhost или внутренний IP)
    // НО: не блокируем внешние запросы, так как они могут приходить через прокси/nginx
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
               req.headers.get('x-real-ip') || 
               req.headers.get('host')?.split(':')[0] ||
               'unknown'
    
    const isInternalRequest = ip === '127.0.0.1' || 
                             ip === '::1' || 
                             ip === 'localhost' ||
                             ip === '::ffff:127.0.0.1' ||
                             ip.startsWith('192.168.') || 
                             ip.startsWith('10.') || 
                             ip.startsWith('172.16.')
    
    // Логируем для отладки
    console.log(`📧 [Delayed Notification] Request received:`, {
      requestId: req.nextUrl.searchParams.get('requestId'),
      ip,
      isInternal: isInternalRequest,
      userAgent: req.headers.get('user-agent'),
      host: req.headers.get('host')
    })
    
    const searchParams = req.nextUrl.searchParams
    const requestId = searchParams.get('requestId')

    if (!requestId) {
      console.error('❌ [Delayed Notification] Missing requestId parameter')
      return NextResponse.json(
        createApiResponse(null, 'Missing requestId parameter'),
        { status: 400 }
      )
    }

    const requestIdNum = parseInt(requestId, 10)
    if (isNaN(requestIdNum) || requestIdNum <= 0) {
      console.error(`❌ [Delayed Notification] Invalid requestId: ${requestId}`)
      return NextResponse.json(
        createApiResponse(null, 'Invalid requestId'),
        { status: 400 }
      )
    }

    // Получаем заявку с обработкой ошибок
    let request
    try {
      request = await prisma.request.findUnique({
        where: { id: requestIdNum },
      })
    } catch (dbError: any) {
      console.error(`❌ [Delayed Notification] Database error fetching request ${requestIdNum}:`, dbError)
      return NextResponse.json(
        createApiResponse(null, `Database error: ${dbError.message || 'Unknown error'}`),
        { status: 500 }
      )
    }

    if (!request) {
      console.warn(`⚠️ [Delayed Notification] Request ${requestIdNum} not found`)
      return NextResponse.json(
        createApiResponse(null, 'Request not found'),
        { status: 404 }
      )
    }

    // Проверяем, что это депозит
    if (request.requestType !== 'deposit') {
      return NextResponse.json(
        createApiResponse(null, 'Not a deposit request'),
        { status: 400 }
      )
    }

    // Проверяем статус - если уже обработано (автопополнение сработало), не отправляем уведомление
    if (
      request.status === 'completed' ||
      request.status === 'approved' ||
      request.status === 'autodeposit_success' ||
      request.status === 'auto_completed'
    ) {
      console.log(`ℹ️ [Delayed Notification] Request ${requestId} already processed (status: ${request.status}), skipping notification`)
      return NextResponse.json(
        createApiResponse({ skipped: true, reason: 'Already processed' }, undefined, 'Notification skipped - request already processed')
      )
    }

    // Если заявка все еще pending - отправляем уведомление
    if (request.status === 'pending') {
      const amountStr = request.amount ? parseFloat(request.amount.toString()).toFixed(2) : '0.00'
      const bookmakerStr = request.bookmaker || 'не указано'
      const usernameStr = request.username || request.firstName || 'Пользователь'
      const accountIdStr = request.accountId || 'не указан'
      
      const groupMessage = `🟢 <b>Новая заявка на пополнение</b>\n\n` +
        `👤 Пользователь: ${usernameStr}\n` +
        `💰 Сумма: ${amountStr} сом\n` +
        `🎰 Букмекер: ${bookmakerStr}\n` +
        `🆔 ID аккаунта: ${accountIdStr}\n` +
        `📋 ID заявки: #${request.id}\n\n` +
        `Статус: ожидает обработки`
      
      let sent = false
      try {
        sent = await sendTelegramGroupMessage(groupMessage)
      } catch (telegramError: any) {
        console.error(`❌ [Delayed Notification] Telegram API error for request ${requestId}:`, telegramError)
        // Не возвращаем ошибку 500, так как это не критично
        // Возвращаем успешный ответ, но с флагом, что отправка не удалась
        return NextResponse.json(
          createApiResponse({ sent: false, error: telegramError.message }, undefined, 'Notification failed to send'),
          { status: 200 } // Возвращаем 200, чтобы не вызывать повторные попытки
        )
      }
      
      if (sent) {
        console.log(`✅ [Delayed Notification] Sent notification for request ${requestId}`)
        return NextResponse.json(
          createApiResponse({ sent: true }, undefined, 'Notification sent successfully')
        )
      } else {
        console.error(`❌ [Delayed Notification] Failed to send notification for request ${requestId} (sendTelegramGroupMessage returned false)`)
        // Возвращаем 200, чтобы не вызывать повторные попытки
        return NextResponse.json(
          createApiResponse({ sent: false }, undefined, 'Notification failed to send'),
          { status: 200 }
        )
      }
    }

    // Если статус другой (например, rejected, api_error) - не отправляем
    console.log(`ℹ️ [Delayed Notification] Request ${requestId} has status ${request.status}, skipping notification`)
    return NextResponse.json(
      createApiResponse({ skipped: true, reason: `Status: ${request.status}` }, undefined, 'Notification skipped')
    )
  } catch (error: any) {
    console.error('❌ [Delayed Notification] Unexpected error:', error)
    // Логируем полный стек ошибки для отладки
    if (error.stack) {
      console.error('❌ [Delayed Notification] Error stack:', error.stack)
    }
    // Возвращаем более информативный ответ
    const errorMessage = error.message || 'Unknown error occurred'
    const errorResponse = NextResponse.json(
      createApiResponse(null, `Error: ${errorMessage}`),
      { status: 500 }
    )
    // Добавляем заголовки для отладки
    errorResponse.headers.set('X-Error-Type', error.name || 'Error')
    return errorResponse
  }
}

