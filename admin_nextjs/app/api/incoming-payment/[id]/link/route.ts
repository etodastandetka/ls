import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'
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

/**
 * API endpoint для привязки входящего платежа к заявке
 * POST /api/incoming-payment/[id]/link
 * Body: { requestId }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authUser = requireAuth(request)

    const paymentId = parseInt(params.id)
    const body = await request.json()
    const { requestId } = body

    if (!requestId) {
      return NextResponse.json(
        createApiResponse(null, 'requestId is required'),
        { status: 400 }
      )
    }

    // Проверяем, что платеж существует
    const payment = await prisma.incomingPayment.findUnique({
      where: { id: paymentId },
    })

    if (!payment) {
      return NextResponse.json(
        createApiResponse(null, 'Payment not found'),
        { status: 404 }
      )
    }

    // Проверяем, что платеж еще не обработан для другой заявки
    if (payment.isProcessed && payment.requestId && payment.requestId !== requestId) {
      return NextResponse.json(
        createApiResponse(null, 'Payment is already processed for another request'),
        { status: 400 }
      )
    }

    // Привязываем платеж к заявке
    const updatedPayment = await prisma.incomingPayment.update({
      where: { id: paymentId },
      data: {
        requestId: parseInt(requestId),
        isProcessed: true,
      },
    })

    // Проверяем, совпадает ли сумма платежа с суммой заявки
    const linkedRequest = await prisma.request.findUnique({
      where: { id: parseInt(requestId) },
    })

    if (linkedRequest) {
      const paymentAmount = parseFloat(updatedPayment.amount.toString())
      const requestAmount = parseFloat(linkedRequest.amount?.toString() || '0')
      
      // Если сумма совпадает (с точностью до 1 копейки), автоматически обновляем статус заявки
      if (Math.abs(paymentAmount - requestAmount) < 0.01) {
        // Обновляем статус заявки на completed (успешно)
        // Сохраняем логин админа, который привязал платеж
        const updatedRequest = await prisma.request.update({
          where: { id: parseInt(requestId) },
          data: {
            status: 'completed',
            statusDetail: null,
            processedBy: authUser.username as any,
            processedAt: new Date(),
            updatedAt: new Date(),
          } as any,
        })

        
        // Если это депозит, пополняем баланс через казино API
        if (linkedRequest.requestType === 'deposit' && linkedRequest.bookmaker && linkedRequest.accountId) {
          try {
            const { depositToCasino } = await import('../../../../../lib/deposit-balance')
            await depositToCasino(
              linkedRequest.bookmaker,
              linkedRequest.accountId,
              requestAmount,
              parseInt(requestId) // Передаем requestId чтобы исключить текущую заявку из проверки на дублирование
            )
            console.log(`✅ Auto-deposit successful after linking payment: Request ${requestId}, Account ${linkedRequest.accountId}`)
            
            // Начисляем реферальные бонусы (2% от депозита)
            if (linkedRequest.userId && linkedRequest.amount) {
              processReferralEarning(
                linkedRequest.userId,
                requestAmount,
                linkedRequest.bookmaker,
                parseInt(requestId),
                linkedRequest.createdAt || undefined // Передаем дату создания депозита для защиты от абуза
              ).catch(error => {
                console.error(`❌ [Link Payment] Failed to process referral earning:`, error)
                // Не блокируем выполнение, если начисление бонусов не удалось
              })
            }
          } catch (error: any) {
            console.error(`❌ Auto-deposit failed after linking payment:`, error)
            // Не возвращаем ошибку, т.к. платеж уже привязан
          }
        } else if (linkedRequest.requestType === 'deposit' && linkedRequest.userId && linkedRequest.amount) {
          // Если это депозит, но нет accountId/bookmaker, все равно начисляем реферальные бонусы
          processReferralEarning(
            linkedRequest.userId,
            requestAmount,
            linkedRequest.bookmaker,
            parseInt(requestId),
            linkedRequest.createdAt || undefined // Передаем дату создания депозита для защиты от абуза
          ).catch(error => {
            console.error(`❌ [Link Payment] Failed to process referral earning:`, error)
            // Не блокируем выполнение, если начисление бонусов не удалось
          })
        }
      }
    }

    return NextResponse.json(
      createApiResponse({
        id: updatedPayment.id,
        requestId: updatedPayment.requestId,
        isProcessed: updatedPayment.isProcessed,
      }, 'Payment linked to request')
    )
  } catch (error: any) {
    console.error('❌ Error linking payment:', error)
    return NextResponse.json(
      createApiResponse(null, `Error: ${error.message}`),
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}

