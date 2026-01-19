import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/**
 * Закрывает смену за указанную дату
 * Вызывается автоматически в 23:59 или вручную
 */
export async function POST(request: NextRequest) {
  try {
    requireAuth(request)

    const body = await request.json()
    const { date } = body // Дата в формате YYYY-MM-DD

    if (!date) {
      return NextResponse.json(
        createApiResponse(null, 'Date is required'),
        { status: 400 }
      )
    }

    // Получаем начало и конец дня (00:00:00 - 23:59:59)
    const shiftDate = new Date(date)
    shiftDate.setHours(0, 0, 0, 0)
    
    const shiftStart = new Date(shiftDate)
    const shiftEnd = new Date(shiftDate)
    shiftEnd.setHours(23, 59, 59, 999)

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

    return NextResponse.json(
      createApiResponse({
        shift: {
          id: shift.id,
          date: shift.shiftDate.toISOString().split('T')[0],
          depositsSum: shift.depositsSum.toString(),
          withdrawalsSum: shift.withdrawalsSum.toString(),
          netProfit: shift.netProfit.toString(),
          depositsCount: shift.depositsCount,
          withdrawalsCount: shift.withdrawalsCount,
          isClosed: shift.isClosed,
          closedAt: shift.closedAt?.toISOString(),
        },
      })
    )
  } catch (error: any) {
    console.error('Close shift error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to close shift'),
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}


















































