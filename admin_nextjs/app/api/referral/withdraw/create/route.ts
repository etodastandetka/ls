import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendTelegramGroupMessage } from '@/lib/telegram-group'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const userId = body.user_id || body.userId
    const bookmaker = body.bookmaker || ''
    const accountId = body.account_id || body.accountId || ''
    const amount = parseFloat(body.amount || 0)
    
    if (!userId) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'User ID is required'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    if (!bookmaker || !accountId) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'Bookmaker and account ID are required'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    if (isNaN(amount) || amount <= 0) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'Invalid amount'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    // Минимальная сумма вывода - 100 сом
    const minWithdrawalAmount = 100
    if (amount < minWithdrawalAmount) {
      const errorResponse = NextResponse.json({
        success: false,
        error: `Минимальная сумма вывода: ${minWithdrawalAmount} сом`
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    // Проверяем, есть ли у пользователя достаточно средств для вывода
    const earnings = await prisma.botReferralEarning.findMany({
      where: {
        referrer: {
          userId: BigInt(userId)
        },
        status: 'completed'
      }
    })
    
    const totalEarned = earnings.reduce((sum, e) => {
      return sum + (e.commissionAmount ? parseFloat(e.commissionAmount.toString()) : 0)
    }, 0)
    
    // Получаем уже выведенные средства (только completed - подтвержденные админом и выплаченные)
    const completedWithdrawals = await prisma.referralWithdrawalRequest.findMany({
      where: {
        userId: BigInt(userId),
        status: 'completed'
      }
    })
    
    const totalWithdrawn = completedWithdrawals.reduce((sum, w) => {
      return sum + (w.amount ? parseFloat(w.amount.toString()) : 0)
    }, 0)
    
    // Доступный баланс = заработанное - выведенное (pending заявки НЕ учитываются - деньги остаются на балансе)
    const availableBalance = totalEarned - totalWithdrawn
    
    console.log(`[Referral Withdraw Create] User ${userId}: Earned=${totalEarned.toFixed(2)}, Withdrawn=${totalWithdrawn.toFixed(2)}, Available=${availableBalance.toFixed(2)}`)
    
    if (availableBalance <= 0) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'Нет доступных средств для вывода'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    // Проверяем, что запрашиваемая сумма не превышает доступный баланс
    if (amount > availableBalance) {
      const errorResponse = NextResponse.json({
        success: false,
        error: `Недостаточно средств. Доступно: ${availableBalance.toFixed(2)} сом`
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    // Получаем данные пользователя из Telegram
    const tg = body.telegram_data || {}
    const username = body.username || tg.username || null
    const firstName = body.first_name || tg.first_name || null
    const lastName = body.last_name || tg.last_name || null
    const phoneNumber = body.phone_number || tg.phone_number || null
    
    // Создаем заявку на вывод (деньги НЕ списываются, остаются на балансе до подтверждения админом)
    const withdrawalRequest = await prisma.referralWithdrawalRequest.create({
      data: {
        userId: BigInt(userId),
        username: username,
        firstName: firstName,
        lastName: lastName,
        phoneNumber: phoneNumber,
        amount: amount,
        currency: 'KGS',
        bookmaker: bookmaker.toLowerCase(),
        bookmakerAccountId: accountId,
        paymentMethod: 'casino_deposit', // Пополнение в казино
        walletDetails: `Account ID: ${accountId}`,
        status: 'pending'
      }
    })
    
    console.log(`✅ [Referral Withdraw Create] Заявка #${withdrawalRequest.id} создана успешно. Сумма ${amount.toFixed(2)} сом НЕ списана (остается на балансе до подтверждения админом).`)
    
    // Отправляем уведомление в группу о новой заявке на вывод
    const amountStr = parseFloat(withdrawalRequest.amount.toString()).toFixed(2)
    const usernameStr = withdrawalRequest.username || withdrawalRequest.firstName || 'Пользователь'
    
    const groupMessage = `🔴 <b>Новая заявка на вывод (реферальная)</b>\n\n` +
      `👤 Пользователь: ${usernameStr}\n` +
      `💰 Сумма: ${amountStr} ${withdrawalRequest.currency}\n` +
      `🎰 Казино: ${withdrawalRequest.bookmaker}\n` +
      `🆔 ID аккаунта: ${withdrawalRequest.bookmakerAccountId}\n` +
      `📋 ID заявки: #${withdrawalRequest.id}\n\n` +
      `Статус: ожидает обработки`
    
    sendTelegramGroupMessage(groupMessage).catch(err => {
      console.error('Failed to send referral withdrawal notification to group:', err)
    })
    
    const response = NextResponse.json({
      success: true,
      request_id: withdrawalRequest.id,
      message: 'Заявка на вывод создана успешно'
    })
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
    
  } catch (error: any) {
    console.error('Referral withdrawal create error:', error)
    const errorResponse = NextResponse.json({
      success: false,
      error: error.message || 'Failed to create withdrawal request'
    }, { status: 500 })
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    return errorResponse
  }
}

export const dynamic = 'force-dynamic'

