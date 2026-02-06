import { NextRequest, NextResponse } from 'next/server'
import { createApiResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

// Проверка, является ли это первым сообщением от пользователя
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> | { userId: string } }
) {
  try {
    // Обработка Next.js 15+ где params может быть Promise
    const resolvedParams = params instanceof Promise ? await params : params

    let userId: bigint
    try {
      userId = BigInt(resolvedParams.userId)
    } catch (e) {
      return NextResponse.json(
        createApiResponse(null, 'Invalid user ID'),
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const channel = searchParams.get('channel') || 'bot'

    // Проверяем, есть ли уже сообщения от этого пользователя
    let messageCount
    try {
      messageCount = await prisma.chatMessage.count({
        where: {
          userId,
          channel,
          direction: 'in', // Только входящие сообщения от пользователя
        },
      })
    } catch (error: any) {
      // Если колонка channel не существует (P2022), делаем запрос без фильтра по channel
      if (error.code === 'P2022' && error.meta?.column === 'chat_messages.channel') {
        messageCount = await prisma.chatMessage.count({
          where: {
            userId,
            direction: 'in',
          },
        })
      } else {
        throw error
      }
    }

    const isFirst = messageCount === 0

    return NextResponse.json(
      createApiResponse({
        isFirst,
        messageCount,
      })
    )
  } catch (error: any) {
    console.error('First message check API error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to check first message'),
      { status: 500 }
    )
  }
}




