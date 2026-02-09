import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/**
 * API endpoint для автоматического закрытия смены
 * Вызывается автоматически через cron в 23:59 каждый день
 * Можно защитить секретным ключом через заголовок X-Cron-Secret
 */
export async function POST(request: NextRequest) {
  try {
    // Опциональная защита через секретный ключ (можно установить в env)
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const providedSecret = request.headers.get('X-Cron-Secret')
      if (providedSecret !== cronSecret) {
        return NextResponse.json(
          createApiResponse(null, 'Unauthorized'),
          { status: 401 }
        )
      }
    }

    // Получаем текущую дату (смена закрывается в 23:59, значит закрываем за сегодня)
    const today = new Date()
    const shiftDate = new Date(today)
    shiftDate.setHours(0, 0, 0, 0)

    // Получаем начало и конец дня (00:00:00 - 23:59:59)
    const shiftStart = new Date(shiftDate)
    const shiftEnd = new Date(shiftDate)
    shiftEnd.setHours(23, 59, 59, 999)

    console.log(`🔄 [Auto Close Shift] Закрытие смены за ${shiftDate.toISOString().split('T')[0]}`)

    // Статусы для подсчета
    const depositSuccessStatuses = ['autodeposit_success', 'auto_completed']
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
    const netProfit = depositsSum * 0.08 + withdrawalsSum * 0.02

    // Проверяем, не закрыта ли уже смена
    const existingShift = await prisma.dailyShift.findUnique({
      where: {
        shiftDate: shiftDate,
      },
    })

    if (existingShift && existingShift.isClosed) {
      console.log(`ℹ️ [Auto Close Shift] Смена за ${shiftDate.toISOString().split('T')[0]} уже закрыта`)
      return NextResponse.json(
        createApiResponse({
          shift: {
            id: existingShift.id,
            date: existingShift.shiftDate.toISOString().split('T')[0],
            depositsSum: existingShift.depositsSum.toString(),
            withdrawalsSum: existingShift.withdrawalsSum.toString(),
            netProfit: existingShift.netProfit.toString(),
            depositsCount: existingShift.depositsCount,
            withdrawalsCount: existingShift.withdrawalsCount,
            isClosed: existingShift.isClosed,
            closedAt: existingShift.closedAt?.toISOString(),
          },
          message: 'Shift already closed',
        })
      )
    }

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

    console.log(`✅ [Auto Close Shift] Смена закрыта:`, {
      date: shift.shiftDate.toISOString().split('T')[0],
      depositsSum: shift.depositsSum.toString(),
      withdrawalsSum: shift.withdrawalsSum.toString(),
      netProfit: shift.netProfit.toString(),
      depositsCount: shift.depositsCount,
      withdrawalsCount: shift.withdrawalsCount,
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
        message: 'Shift closed successfully',
      })
    )
  } catch (error: any) {
    console.error('❌ [Auto Close Shift] Ошибка при закрытии смены:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to close shift'),
      { status: 500 }
    )
  }
}




















































































