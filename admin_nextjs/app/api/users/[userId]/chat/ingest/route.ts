import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { emitToUser } from '@/lib/socket-server'

// Публичный эндпоинт для сохранения входящих сообщений от пользователя (вызывается ботом)
export async function POST(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    let userId: bigint
    try {
      userId = BigInt(params.userId)
    } catch (e) {
      return NextResponse.json(
        { success: false, error: 'Invalid user ID' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const channel = searchParams.get('channel') || 'bot'

    const body = await request.json()
    const {
      message_text,
      message_type = 'text',
      media_url,
      telegram_message_id,
    } = body

    console.log(`📨 Chat ingest: userId=${userId}, message_text="${message_text?.substring(0, 50)}", message_type=${message_type}, media_url=${media_url ? 'present' : 'none'}, telegram_message_id=${telegram_message_id}`)

    // Проверяем, что сообщение не пустое или есть медиа
    if (!message_text?.trim() && !media_url) {
      console.log('⚠️ Chat ingest: Empty message (no text and no media)')
      return NextResponse.json(
        { success: false, error: 'Message text or media is required' },
        { status: 400 }
      )
    }

    // Проверяем, не существует ли уже сообщение с таким telegram_message_id (избегаем дубликатов)
    if (telegram_message_id) {
      const existingMessage = await prisma.chatMessage.findFirst({
        where: {
          telegramMessageId: BigInt(telegram_message_id),
        },
      })

      if (existingMessage) {
        // Сообщение уже существует, возвращаем успех
        return NextResponse.json({
          success: true,
          message: 'Message already exists',
          messageId: existingMessage.id,
        })
      }
    }

    // Получаем URL медиа из Telegram, если нужно
    let finalMediaUrl = media_url
    if (media_url && !media_url.startsWith('http')) {
      // Если это file_id, нужно получить URL через Telegram API
      const botToken = process.env.BOT_TOKEN
      if (botToken) {
        try {
          const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${media_url}`
          const fileResponse = await fetch(getFileUrl)
          const fileData = await fileResponse.json()

          if (fileData.ok && fileData.result?.file_path) {
            finalMediaUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
          }
        } catch (error) {
          console.error('Error getting file URL from Telegram:', error)
          // Продолжаем без URL, сохраним file_id
        }
      }
    }

    // Сохраняем сообщение в БД
    let message
    try {
      message = await prisma.chatMessage.create({
        data: {
          userId,
          messageText: message_text || null,
          messageType: message_type,
          direction: 'in', // Входящее от пользователя
          telegramMessageId: telegram_message_id ? BigInt(telegram_message_id) : null,
          mediaUrl: finalMediaUrl || null,
          channel,
        },
      })
    } catch (error: any) {
      // Если колонка channel не существует (P2022), создаем без channel
      if (error.code === 'P2022' && error.meta?.column === 'chat_messages.channel') {
        console.warn('⚠️ Channel column not found, creating message without channel field')
        message = await prisma.chatMessage.create({
          data: {
            userId,
            messageText: message_text || null,
            messageType: message_type,
            direction: 'in',
            telegramMessageId: telegram_message_id ? BigInt(telegram_message_id) : null,
            mediaUrl: finalMediaUrl || null,
          } as any, // Type assertion to omit channel field
        })
      } else {
        throw error
      }
    }

    console.log(`✅ Chat ingest: Сообщение сохранено в БД с ID ${message.id}, direction='in'`)

    // Отправляем событие через Socket.IO
    try {
      emitToUser(userId.toString(), 'message:new', {
        id: message.id,
        userId: userId.toString(),
        messageText: message.messageText,
        messageType: message.messageType,
        direction: message.direction,
        mediaUrl: message.mediaUrl,
        createdAt: message.createdAt.toISOString(),
      })
    } catch (socketError) {
      console.warn('⚠️ Failed to emit Socket.IO event:', socketError)
    }

    return NextResponse.json({
      success: true,
      messageId: message.id,
    })
  } catch (error: any) {
    console.error('Chat ingest API error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save message' },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'

