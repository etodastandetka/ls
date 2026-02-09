import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { DATABASE_CONFIG } from '@/config/app'

// Получение истории чата с пользователем или сохраненного account_id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> | { userId: string } }
) {
  try {
    requireAuth(request)

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
    const casinoId = searchParams.get('casino_id')
    
    // Если запрашивается account_id для конкретного букмекера
    if (casinoId) {
      const dataType = `casino_account_id_${casinoId.toLowerCase()}`
      const userData = await prisma.botUserData.findUnique({
        where: {
          userId_dataType: {
            userId,
            dataType,
          },
        },
      })
      
      return NextResponse.json(
        createApiResponse({
          accountId: userData?.dataValue || null,
        })
      )
    }

    // Иначе возвращаем историю чата
    const limit = parseInt(searchParams.get('limit') || DATABASE_CONFIG.CHAT_MESSAGES_LIMIT.toString())
    const channel = searchParams.get('channel') || 'bot'

    let messages
    try {
      messages = await prisma.chatMessage.findMany({
        where: { 
          userId, 
          channel,
          isDeleted: false,
          // Фильтруем команды пользователя (сообщения, начинающиеся с /)
          NOT: [
            { 
              AND: [
                { direction: 'in' },
                { messageText: { startsWith: '/' } }
              ]
            }
          ]
        },
        include: {
          replyTo: {
            select: {
              id: true,
              userId: true,
              messageText: true,
              messageType: true,
              mediaUrl: true,
              direction: true,
              isDeleted: true,
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
    } catch (error: any) {
      // Если колонка channel не существует (P2022), делаем запрос без фильтра по channel
      if (error.code === 'P2022' && error.meta?.column === 'chat_messages.channel') {
        console.warn('⚠️ Channel column not found, querying messages without channel filter')
        messages = await prisma.chatMessage.findMany({
          where: { 
            userId,
            isDeleted: false,
            // Фильтруем команды пользователя
            NOT: [
              { 
                AND: [
                  { direction: 'in' },
                  { messageText: { startsWith: '/' } }
                ]
              }
            ]
          },
          include: {
            replyTo: {
              select: {
                id: true,
                userId: true,
                messageText: true,
                messageType: true,
                mediaUrl: true,
                direction: true,
                isDeleted: true,
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
      } else {
        throw error
      }
    }

    return NextResponse.json(
      createApiResponse({
        messages: messages.map(msg => ({
          ...msg,
          userId: msg.userId.toString(),
          telegramMessageId: msg.telegramMessageId?.toString(),
          replyTo: msg.replyTo ? {
            ...msg.replyTo,
            userId: msg.replyTo.userId?.toString(),
          } : null,
        })),
      })
    )
  } catch (error: any) {
    console.error('Chat history API error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to fetch chat history'),
      { status: 500 }
    )
  }
}

// Сохранение account_id для букмекера
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> | { userId: string } }
) {
  try {
    requireAuth(request)

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

    const body = await request.json()
    const { casino_id, account_id } = body

    if (!casino_id || !account_id) {
      return NextResponse.json(
        createApiResponse(null, 'casino_id and account_id are required'),
        { status: 400 }
      )
    }

    // Убеждаемся, что пользователь существует
    await prisma.botUser.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        language: 'ru',
      },
    })

    // Сохраняем account_id для казино
    const dataType = `casino_account_id_${casino_id.toLowerCase()}`
    await prisma.botUserData.upsert({
      where: {
        userId_dataType: {
          userId,
          dataType,
        },
      },
      update: {
        dataValue: account_id,
      },
      create: {
        userId,
        dataType,
        dataValue: account_id,
      },
    })

    return NextResponse.json(
      createApiResponse({
        success: true,
        message: 'Account ID saved successfully',
      })
    )
  } catch (error: any) {
    console.error('Save account ID API error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to save account ID'),
      { status: 500 }
    )
  }
}

