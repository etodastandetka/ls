import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { emitToUser } from '@/lib/socket-server'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

// Отправка сообщения пользователю через бота (поддерживает текст, фото и видео)
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

    const botToken = process.env.BOT_TOKEN

    // Логируем токен для отладки (первые 10 символов для безопасности)
    console.log('🔑 BOT_TOKEN used:', botToken ? `${botToken.substring(0, 15)}...` : 'NOT SET')

    if (!botToken) {
      return NextResponse.json(
        createApiResponse(null, 'BOT_TOKEN not configured'),
        { status: 500 }
      )
    }

    const { searchParams } = new URL(request.url)
    const channel = searchParams.get('channel') || 'bot'
    // В режиме mini_app (чат оператора) сообщения НЕ отправляются в бот, только сохраняются локально
    // В режиме bot (чат из деталей заявки) сообщения отправляются в бот
    const isBridgeMode = channel === 'mini_app' || process.env.CHAT_BRIDGE_MODE === 'true'

    // Проверяем, есть ли файл в запросе (FormData)
    const contentType = request.headers.get('content-type') || ''
    let message: string | null = null
    let file: File | null = null
    let fileType: string | null = null
    let mediaUrl: string | null = null
    let messageType = 'text'

    let replyToId: number | null = null

    if (contentType.includes('multipart/form-data')) {
      // Обрабатываем FormData
      const formData = await request.formData()
      message = formData.get('message') as string | null
      file = formData.get('file') as File | null
      fileType = formData.get('fileType') as string | null
      const replyToIdStr = formData.get('replyToId') as string | null
      if (replyToIdStr) {
        replyToId = parseInt(replyToIdStr)
      }

      if (!message?.trim() && !file) {
        return NextResponse.json(
          createApiResponse(null, 'Message or file is required'),
          { status: 400 }
        )
      }
    } else {
      // Обрабатываем JSON (обратная совместимость)
      const body = await request.json()
      message = body.message

      if (!message || !message.trim()) {
        return NextResponse.json(
          createApiResponse(null, 'Message is required'),
          { status: 400 }
        )
      }
    }

    let telegramData: any = null
    let telegramMessageId: bigint | null = null

    const saveLocalFile = async (upload: File, mime?: string): Promise<{ url: string; type: string }> => {
      const uploadDir = path.join(process.cwd(), 'tmp', 'chat_uploads')
      await fs.promises.mkdir(uploadDir, { recursive: true })
      const ext = upload.name.includes('.') ? upload.name.substring(upload.name.lastIndexOf('.')) : ''
      const fileId = `${Date.now()}-${randomUUID()}${ext}`
      const dest = path.join(uploadDir, fileId)
      const arrayBuffer = await upload.arrayBuffer()
      await fs.promises.writeFile(dest, Buffer.from(arrayBuffer))
      const kind = mime?.startsWith('image/')
        ? 'photo'
        : mime?.startsWith('video/')
        ? 'video'
        : mime?.startsWith('audio/')
        ? 'audio'
        : 'document'
      return { url: `/api/chat/file/${fileId}`, type: kind }
    }

    if (isBridgeMode) {
      // Bridge mode: не шлём через бота, сохраняем сообщение и файл локально
      if (file) {
        const saved = await saveLocalFile(file, fileType || undefined)
        mediaUrl = saved.url
        messageType = saved.type
      }
    } else {
      if (file) {
        // Определяем тип файла
        const isVideo = fileType?.startsWith('video/')
        const isPhoto = fileType?.startsWith('image/')
        const isAudio = fileType?.startsWith('audio/')
        // Для document все остальное (pdf, doc, etc.)
        const isDocument = !isPhoto && !isVideo && !isAudio

        // Конвертируем файл в Blob для отправки
        const arrayBuffer = await file.arrayBuffer()
        const blob = new Blob([arrayBuffer], { type: fileType || 'application/octet-stream' })

        // Получаем telegramMessageId сообщения, на которое отвечаем
        let replyToTelegramMessageId: number | undefined
        if (replyToId) {
          const replyToMessage = await prisma.chatMessage.findUnique({
            where: { id: replyToId },
            select: { telegramMessageId: true },
          })
          if (replyToMessage?.telegramMessageId) {
            replyToTelegramMessageId = Number(replyToMessage.telegramMessageId)
          }
        }

        // Создаем FormData для Telegram API
        const telegramFormData = new FormData()
        telegramFormData.append('chat_id', userId.toString())
        if (message?.trim()) {
          // caption поддерживается photo/video/audio/document
          telegramFormData.append('caption', message)
        }
        if (replyToTelegramMessageId) {
          telegramFormData.append('reply_to_message_id', replyToTelegramMessageId.toString())
        }

        let apiEndpoint = `https://api.telegram.org/bot${botToken}/sendMessage`
        if (isPhoto) {
          telegramFormData.append('photo', blob, file.name)
          apiEndpoint = `https://api.telegram.org/bot${botToken}/sendPhoto`
        } else if (isVideo) {
          telegramFormData.append('video', blob, file.name)
          apiEndpoint = `https://api.telegram.org/bot${botToken}/sendVideo`
        } else if (isAudio) {
          // Для голосовых/аудио
          telegramFormData.append('audio', blob, file.name)
          apiEndpoint = `https://api.telegram.org/bot${botToken}/sendAudio`
        } else if (isDocument) {
          telegramFormData.append('document', blob, file.name)
          apiEndpoint = `https://api.telegram.org/bot${botToken}/sendDocument`
        }

        const telegramResponse = await fetch(apiEndpoint, {
          method: 'POST',
          body: telegramFormData,
        })

        telegramData = await telegramResponse.json()

        if (!telegramData.ok) {
          return NextResponse.json(
            createApiResponse(null, telegramData.description || 'Failed to send media'),
            { status: 500 }
          )
        }

        if (isPhoto) messageType = 'photo'
        else if (isVideo) messageType = 'video'
        else if (isAudio) messageType = 'audio'
        else messageType = 'document'
        telegramMessageId = BigInt(telegramData.result.message_id)
        
        // Получаем URL медиа из ответа Telegram
        const media =
          telegramData.result.photo?.[telegramData.result.photo.length - 1] ||
          telegramData.result.video ||
          telegramData.result.audio ||
          telegramData.result.document
        if (media?.file_id) {
          // Получаем путь к файлу
          const getFileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${media.file_id}`
          const fileResponse = await fetch(getFileUrl)
          const fileData = await fileResponse.json()
          
          if (fileData.ok && fileData.result?.file_path) {
            mediaUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`
          }
        }
      } else {
        // Отправляем текстовое сообщение
        const sendMessageUrl = `https://api.telegram.org/bot${botToken}/sendMessage`
        const telegramResponse = await fetch(sendMessageUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: userId.toString(),
            text: message,
            parse_mode: 'HTML'
          })
        })

        telegramData = await telegramResponse.json()

        if (!telegramData.ok) {
          return NextResponse.json(
            createApiResponse(null, telegramData.description || 'Failed to send message'),
            { status: 500 }
          )
        }

        telegramMessageId = BigInt(telegramData.result.message_id)
      }
    }

    // Сохраняем сообщение в БД
    let saved
    try {
      saved = await prisma.chatMessage.create({
        data: {
          userId,
          messageText: message,
          messageType,
          direction: 'out', // Сообщение от админа к пользователю
          telegramMessageId,
          mediaUrl,
          channel,
          replyToId: replyToId || undefined,
        },
      })
    } catch (error: any) {
      // Если колонка channel не существует (P2022), создаем без channel
      if (error.code === 'P2022' && error.meta?.column === 'chat_messages.channel') {
        console.warn('⚠️ Channel column not found, creating message without channel field')
        saved = await prisma.chatMessage.create({
          data: {
            userId,
            messageText: message,
            messageType,
            direction: 'out',
            telegramMessageId,
            mediaUrl,
          } as any, // Type assertion to omit channel field
        })
      } else {
        throw error
      }
    }

    // Отправляем событие через Socket.IO
    try {
      emitToUser(resolvedParams.userId, 'message:new', {
        id: saved.id,
        userId: resolvedParams.userId,
        messageText: saved.messageText,
        messageType: saved.messageType,
        direction: saved.direction,
        mediaUrl: saved.mediaUrl,
        createdAt: saved.createdAt.toISOString(),
      })
    } catch (socketError) {
      console.warn('⚠️ Failed to emit Socket.IO event:', socketError)
    }

    return NextResponse.json(
      createApiResponse({
        success: true,
        messageId: telegramMessageId ? Number(telegramMessageId) : saved.id,
        mediaUrl,
      })
    )
  } catch (error: any) {
    console.error('Send message API error:', error)
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to send message'),
      { status: 500 }
    )
  }
}

