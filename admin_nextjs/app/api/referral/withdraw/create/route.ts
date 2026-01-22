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
    
    console.log('📋 [Referral Withdraw Create] Request data:', {
      userId: userId ? String(userId).substring(0, 10) + '...' : 'null',
      bookmaker,
      accountId: accountId ? accountId.substring(0, 5) + '...' : 'null',
      amount,
      hasTelegramData: !!body.telegram_data
    })
    
    if (!userId) {
      console.error('❌ [Referral Withdraw Create] User ID is missing')
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
    
    // Используем ту же логику расчета баланса, что и в /api/public/referral-data
    const userIdBigInt = BigInt(userId)
    
    // Получаем ВСЕ заработанные комиссии (для расчета доступного баланса - накопленные за все время)
    // ЗАЩИТА ОТ АБУЗА: учитываем только заработок от депозитов, сделанных после создания реферальной связи
    // НО: для записей где referred_id = referrer_id (призы за топ, восстановления, вычеты за абуз) - не требуем JOIN
    const earningsResult = await prisma.$queryRaw<Array<{
      total: number | bigint
    }>>`
      SELECT COALESCE(SUM(bre.commission_amount), 0)::numeric as total
      FROM "referral_earnings" bre
      LEFT JOIN "referrals" br ON br.referred_id = bre.referred_id AND br.referrer_id = bre.referrer_id
      WHERE bre.referrer_id = ${userIdBigInt}
        AND bre.status = 'completed'
        AND (
          -- Для обычных заработков - проверяем дату создания реферальной связи
          (br.id IS NOT NULL AND bre.referred_id != bre.referrer_id AND bre.created_at >= br.created_at)
          OR
          -- Для призов за топ, восстановлений, тестовых записей и вычетов за абуз (referred_id = referrer_id) - не требуем JOIN
          (bre.referred_id = bre.referrer_id AND (
            bre.bookmaker = 'top_payout' 
            OR bre.bookmaker = 'top_payout_restore' 
            OR bre.bookmaker = 'test'
            OR bre.bookmaker LIKE 'abuse_deduction%'
          ))
        )
    `
    
    const totalEarned = earningsResult[0]?.total ? parseFloat(earningsResult[0].total.toString()) : 0
    
    // Получаем уже выведенные средства (только completed - подтвержденные админом и выплаченные)
    const completedWithdrawals = await prisma.referralWithdrawalRequest.findMany({
      where: {
        userId: userIdBigInt,
        status: 'completed'
      }
    })
    
    const totalWithdrawn = completedWithdrawals.reduce((sum, w) => {
      return sum + (w.amount ? parseFloat(w.amount.toString()) : 0)
    }, 0)
    
    // Доступный баланс = заработанное - выведенное (pending заявки НЕ учитываются - деньги остаются на балансе)
    const availableBalance = totalEarned - totalWithdrawn
    
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
    
    // АВТОМАТИЧЕСКИЙ ВЫВОД - сразу пополняем баланс в казино
    const { depositToCasino } = await import('../../../../../lib/deposit-balance')
    
    try {
      await depositToCasino(
        withdrawalRequest.bookmaker,
        withdrawalRequest.bookmakerAccountId,
        amount,
        undefined // Для referral withdrawal не передаем requestId, так как это другая таблица
      )
      
      // Обновляем статус заявки на completed (деньги автоматически выведены)
      const updatedRequest = await prisma.referralWithdrawalRequest.update({
        where: { id: withdrawalRequest.id },
        data: {
          status: 'completed',
          processedAt: new Date(),
          updatedAt: new Date()
        }
      })
      
      // Отправляем уведомление в группу об успешном автоматическом выводе
      const amountStr = parseFloat(updatedRequest.amount.toString()).toFixed(2)
      const usernameStr = updatedRequest.username || updatedRequest.firstName || 'Пользователь'
      
      const groupMessage = `✅ <b>Реферальный вывод (автоматический)</b>\n\n` +
        `👤 Пользователь: ${usernameStr}\n` +
        `💰 Сумма: ${amountStr} ${updatedRequest.currency}\n` +
        `🎰 Казино: ${updatedRequest.bookmaker}\n` +
        `🆔 ID аккаунта: ${updatedRequest.bookmakerAccountId}\n` +
        `📋 ID заявки: #${updatedRequest.id}\n\n` +
        `Статус: автоматически пополнен ✅`
      
      sendTelegramGroupMessage(groupMessage).catch(() => {})
      
      const response = NextResponse.json({
        success: true,
        request_id: withdrawalRequest.id,
        message: 'Вывод выполнен автоматически и успешно',
        auto_processed: true
      })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
      
    } catch (casinoError: any) {
      // Обновляем статус на rejected, если не удалось пополнить
      await prisma.referralWithdrawalRequest.update({
        where: { id: withdrawalRequest.id },
        data: {
          status: 'rejected',
          adminComment: `Ошибка автоматического пополнения: ${casinoError.message}`,
          processedAt: new Date(),
          updatedAt: new Date()
        }
      })
      
      // Отправляем уведомление об ошибке
      const amountStr = amount.toFixed(2)
      const usernameStr = withdrawalRequest.username || withdrawalRequest.firstName || 'Пользователь'
      
      const errorMessage = `❌ <b>Ошибка реферального вывода</b>\n\n` +
        `👤 Пользователь: ${usernameStr}\n` +
        `💰 Сумма: ${amountStr} ${withdrawalRequest.currency}\n` +
        `🎰 Казино: ${withdrawalRequest.bookmaker}\n` +
        `📋 ID заявки: #${withdrawalRequest.id}\n` +
        `⚠️ Ошибка: ${casinoError.message || 'Неизвестная ошибка'}`
      
      sendTelegramGroupMessage(errorMessage).catch(() => {})
      
      const errorResponse = NextResponse.json({
        success: false,
        error: `Ошибка автоматического вывода: ${casinoError.message || 'Не удалось пополнить баланс'}`,
        request_id: withdrawalRequest.id
      }, { status: 500 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
  } catch (error: any) {
    const errorResponse = NextResponse.json({
      success: false,
      error: error.message || 'Failed to create withdrawal request'
    }, { status: 500 })
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    return errorResponse
  }
}

export const dynamic = 'force-dynamic'

