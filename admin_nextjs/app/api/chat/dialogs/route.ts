import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// Получение списка диалогов (пользователей с сообщениями)
export async function GET(request: NextRequest) {
  try {
    requireAuth(request)

    const { searchParams } = new URL(request.url)
    const channel = searchParams.get('channel') || 'bot'
    const search = searchParams.get('search') || ''
    const limit = parseInt(searchParams.get('limit') || '50', 10)

    // Получаем последние сообщения для каждого пользователя
    // Сначала получаем все сообщения, затем группируем по userId
    let allMessages
    try {
      const whereClause: any = {
        isDeleted: false,
      }
      
      if (channel !== 'all') {
        whereClause.channel = channel
      }

      allMessages = await prisma.chatMessage.findMany({
        where: whereClause,
        orderBy: {
          createdAt: 'desc',
        },
        take: limit * 20, // Берем больше, чтобы потом отфильтровать уникальных пользователей
      })
    } catch (error: any) {
      // Если колонка channel не существует, делаем запрос без фильтра по channel
      if (error.code === 'P2022' && error.meta?.column === 'chat_messages.channel') {
        allMessages = await prisma.chatMessage.findMany({
          where: {
            isDeleted: false,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: limit * 20,
        })
      } else {
        throw error
      }
    }

    // Группируем по userId и берем последнее сообщение для каждого пользователя
    const userMap = new Map<bigint, typeof allMessages[0]>()
    for (const msg of allMessages) {
      if (!userMap.has(msg.userId)) {
        userMap.set(msg.userId, msg)
      }
    }
    
    const lastMessages = Array.from(userMap.values()).slice(0, limit)

    // Получаем информацию о пользователях
    const userIds = lastMessages.map(msg => msg.userId)
    const users = await prisma.botUser.findMany({
      where: {
        userId: { in: userIds },
        ...(search ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: {
        userId: true,
        username: true,
        firstName: true,
        lastName: true,
      },
    })

    // Объединяем данные
    const dialogs = lastMessages
      .map(msg => {
        const user = users.find(u => u.userId === msg.userId)
        if (!user && search) {
          return null // Пропускаем, если не соответствует поиску
        }
        return {
          userId: msg.userId.toString(),
          username: user?.username || null,
          firstName: user?.firstName || null,
          lastName: user?.lastName || null,
          lastMessage: {
            id: msg.id,
            text: msg.messageText,
            type: msg.messageType,
            direction: msg.direction,
            createdAt: msg.createdAt.toISOString(),
          },
        }
      })
      .filter((dialog): dialog is NonNullable<typeof dialog> => dialog !== null)
      .sort((a, b) => {
        // Сортируем по времени последнего сообщения (новые сверху)
        return new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
      })

    return NextResponse.json(
      createApiResponse({
        dialogs,
        total: dialogs.length,
      })
    )
  } catch (error: any) {
    console.error('Dialogs API error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to fetch dialogs'),
      { status: 500 }
    )
  }
}

