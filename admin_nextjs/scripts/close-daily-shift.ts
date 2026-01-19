/**
 * Скрипт для автоматического закрытия дневной смены
 * Должен запускаться в 23:59 каждый день через cron или scheduled task
 * 
 * Использование:
 * - Через cron: 59 23 * * * node scripts/close-daily-shift.js
 * - Или через node-cron в приложении
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function closeDailyShift() {
  try {
    // Получаем вчерашнюю дату (смена закрывается в 23:59, значит закрываем за вчера)
    // Или текущую дату, если запускаем в 23:59
    const today = new Date()
    const shiftDate = new Date(today)
    shiftDate.setHours(0, 0, 0, 0)

    // Получаем начало и конец дня (00:00:00 - 23:59:59)
    const shiftStart = new Date(shiftDate)
    const shiftEnd = new Date(shiftDate)
    shiftEnd.setHours(23, 59, 59, 999)

    console.log(`🔄 Закрытие смены за ${shiftDate.toISOString().split('T')[0]}`)

    // Статусы для подсчета (ВАЖНО: должны совпадать с /api/limits/stats)
    // Учитываем все успешные статусы, включая ручную обработку (completed, approved)
    const depositSuccessStatuses = ['autodeposit_success', 'auto_completed', 'completed', 'approved']
    const withdrawalSuccessStatuses = ['completed', 'approved', 'autodeposit_success', 'auto_completed']

    // Получаем статистику за день
    const [depositStats, withdrawalStats] = await Promise.all([
      prisma.request.aggregate({
        where: {
          requestType: 'deposit',
          status: { in: depositSuccessStatuses },
          createdAt: {
            gte: shiftStart,
            lte: shiftEnd,
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
            gte: shiftStart,
            lte: shiftEnd,
          },
        },
        _count: { id: true },
        _sum: { amount: true },
      }),
    ])

    const depositsSum = parseFloat(depositStats._sum.amount?.toString() || '0')
    const withdrawalsSum = parseFloat(withdrawalStats._sum.amount?.toString() || '0')
    const depositsCount = depositStats._count.id || 0
    const withdrawalsCount = withdrawalStats._count.id || 0

    // Чистая прибыль: 8% от пополнений + 2% от выводов
    // ВАЖНО: Эти проценты должны совпадать с константами в /api/limits/stats
    const PROFIT_DEPOSIT_PERCENT = 0.08 // 8% от пополнений
    const PROFIT_WITHDRAWAL_PERCENT = 0.02 // 2% от выводов
    const netProfit = depositsSum * PROFIT_DEPOSIT_PERCENT + withdrawalsSum * PROFIT_WITHDRAWAL_PERCENT

    // Создаем или обновляем смену
    const shift = await prisma.dailyShift.upsert({
      where: {
        shiftDate: shiftDate,
      },
      create: {
        shiftDate: shiftDate,
        depositsSum: depositsSum,
        withdrawalsSum: withdrawalsSum,
        netProfit: netProfit,
        depositsCount: depositsCount,
        withdrawalsCount: withdrawalsCount,
        isClosed: true,
        closedAt: new Date(),
      },
      update: {
        depositsSum: depositsSum,
        withdrawalsSum: withdrawalsSum,
        netProfit: netProfit,
        depositsCount: depositsCount,
        withdrawalsCount: withdrawalsCount,
        isClosed: true,
        closedAt: new Date(),
      },
    })

    console.log(`✅ Смена закрыта:`, {
      date: shift.shiftDate.toISOString().split('T')[0],
      depositsSum: shift.depositsSum.toString(),
      withdrawalsSum: shift.withdrawalsSum.toString(),
      netProfit: shift.netProfit.toString(),
      depositsCount: shift.depositsCount,
      withdrawalsCount: shift.withdrawalsCount,
    })
  } catch (error) {
    console.error('❌ Ошибка при закрытии смены:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Запускаем скрипт
if (require.main === module) {
  closeDailyShift()
    .then(() => {
      console.log('✅ Скрипт завершен успешно')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ Ошибка выполнения скрипта:', error)
      process.exit(1)
    })
}

export default closeDailyShift


















































