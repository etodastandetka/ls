import { prisma } from './prisma'

/**
 * Начисляет реферальные бонусы (2% от депозита) реферу пользователя
 * @param userId - ID пользователя, который сделал депозит
 * @param depositAmount - Сумма депозита
 * @param bookmaker - Букмекер
 * @param requestId - ID заявки на депозит (для логирования)
 * @returns true если бонус начислен, false если нет рефера
 */
export async function processReferralEarning(
  userId: bigint,
  depositAmount: number,
  bookmaker: string | null,
  requestId?: number
): Promise<boolean> {
  try {
    // Проверяем, есть ли у пользователя рефер
    const referral = await prisma.botReferral.findUnique({
      where: {
        referredId: userId
      },
      select: {
        referrerId: true
      }
    })
    
    if (!referral) {
      // У пользователя нет рефера - ничего не делаем
      return false
    }
    
    const referrerId = referral.referrerId
    
    // Вычисляем 2% от суммы депозита
    const commissionAmount = depositAmount * 0.02
    
    // Проверяем, не была ли уже создана запись для этого депозита
    // (защита от дублирования при повторных вызовах)
    const existingEarning = await prisma.botReferralEarning.findFirst({
      where: {
        referrerId: referrerId,
        referredId: userId,
        amount: depositAmount,
        bookmaker: bookmaker || null,
        createdAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000) // Последние 5 минут
        }
      }
    })
    
    if (existingEarning) {
      console.log(`⚠️ [Referral Earnings] Бонус уже начислен для депозита (requestId: ${requestId}, earningId: ${existingEarning.id})`)
      return true
    }
    
    // Создаем запись о заработке рефера
    const earning = await prisma.botReferralEarning.create({
      data: {
        referrerId: referrerId,
        referredId: userId,
        amount: depositAmount,
        commissionAmount: commissionAmount,
        bookmaker: bookmaker || null,
        status: 'completed', // Сразу completed, т.к. депозит уже подтвержден
      }
    })
    
    console.log(`✅ [Referral Earnings] Начислен реферальный бонус:`, {
      referrerId: referrerId.toString(),
      referredId: userId.toString(),
      depositAmount: depositAmount,
      commissionAmount: commissionAmount,
      bookmaker: bookmaker,
      requestId: requestId,
      earningId: earning.id
    })
    
    return true
  } catch (error: any) {
    console.error(`❌ [Referral Earnings] Ошибка при начислении реферального бонуса:`, {
      error: error.message,
      userId: userId.toString(),
      depositAmount: depositAmount,
      requestId: requestId
    })
    // Не бросаем ошибку, чтобы не блокировать обработку депозита
    return false
  }
}

