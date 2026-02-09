import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiResponse } from '@/lib/api-helpers'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    // Обработка Next.js 15+ где params может быть Promise
    const resolvedParams = params instanceof Promise ? await params : params
    const id = parseInt(resolvedParams.id)
    
    // Получаем основную заявку для получения данных
    const requestData = await prisma.request.findUnique({
      where: { id },
      select: {
        amount: true,
        accountId: true,
        bookmaker: true,
        userId: true,
      },
    })

    if (!requestData) {
      return NextResponse.json(
        createApiResponse(null, 'Request not found'),
        { status: 404 }
      )
    }

    const requestAmountInt = requestData.amount ? Math.floor(parseFloat(requestData.amount.toString())) : null
    
    // Загружаем дополнительные данные параллельно с таймаутами
    const [matchingPaymentsResult, casinoTransactionsResult, userResult] = await Promise.all([
      // Входящие платежи (с таймаутом 200ms - уменьшен для скорости)
      requestAmountInt ? Promise.race([
        prisma.incomingPayment.findMany({
          where: {
            amount: {
              gte: requestAmountInt,
              lt: requestAmountInt + 1,
            },
          },
          orderBy: { paymentDate: 'desc' },
          take: 3, // Уменьшено с 5 до 3
          select: {
            id: true,
            amount: true,
            paymentDate: true,
            requestId: true,
            isProcessed: true,
            bank: true,
          },
        }),
        new Promise(resolve => setTimeout(() => resolve([]), 200))
      ]) as Promise<any[]> : Promise.resolve([]),
      
      // Транзакции букмекера (с таймаутом 200ms - уменьшен для скорости)
      requestData.accountId && requestData.bookmaker ? Promise.race([
        prisma.request.findMany({
          where: {
            accountId: requestData.accountId,
            bookmaker: requestData.bookmaker,
          },
          orderBy: { createdAt: 'desc' },
          take: 3, // Уменьшено с 5 до 3
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
        }),
        new Promise(resolve => setTimeout(() => resolve([]), 200))
      ]) as Promise<any[]> : Promise.resolve([]),
      
      // Заметка пользователя (с таймаутом 150ms - уменьшен для скорости)
      Promise.race([
        prisma.botUser.findUnique({
          where: { userId: requestData.userId },
          select: { note: true },
        }),
        new Promise(resolve => setTimeout(() => resolve(null), 150))
      ]) as Promise<any>,
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

    return NextResponse.json(
      createApiResponse({
        matchingPayments,
        casinoTransactions,
        userNote: userResult?.note || null,
      })
    )
  } catch (error: any) {
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to fetch additional data'),
      { status: 500 }
    )
  }
}

