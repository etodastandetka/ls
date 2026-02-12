import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'
import { prisma } from '@/lib/prisma'
import { getMiniAppUrl } from '@/config/domains'
import { readFileSync } from 'fs'
import { join } from 'path'

export const dynamic = 'force-dynamic'

// Загружаем переменные из .env файла (если не загружены)
function loadEnvFile() {
  try {
    const envPath = join(process.cwd(), '.env')
    const envContent = readFileSync(envPath, 'utf-8')
    const lines = envContent.split('\n')
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      // Пропускаем комментарии и пустые строки
      if (!trimmedLine || trimmedLine.startsWith('#')) continue
      
      const match = trimmedLine.match(/^([^=]+)=(.*)$/)
      if (match) {
        const key = match[1].trim()
        let value = match[2].trim()
        
        // Убираем кавычки если есть
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        
        // Устанавливаем переменную окружения только если она еще не установлена
        if (!process.env[key]) {
          process.env[key] = value
        }
      }
    }
  } catch (error) {
    // Если .env файл не найден, это нормально - используем системные переменные
    console.log('⚠️ [Broadcast] .env file not found, using system environment variables')
  }
}

// Загружаем .env перед использованием
loadEnvFile()

// Отправка рассылки всем пользователям (поддерживает текст и фото)
export async function POST(request: NextRequest) {
  try {
    requireAuth(request)

    // Поддерживаем как JSON (только текст), так и FormData (текст + фото)
    let message: string = ''
    let photoFile: File | null = null
    let photoBuffer: Buffer | null = null
    let photoMimeType: string | null = null
    let includeMiniAppButton: boolean = true // По умолчанию включено

    const contentType = request.headers.get('content-type') || ''
    
    try {
      // Если это FormData (содержит multipart/form-data)
      if (contentType.includes('multipart/form-data')) {
        const formData = await request.formData()
        const messageField = formData.get('message')
        message = typeof messageField === 'string' ? messageField : (messageField?.toString() || '')
        
        const includeButtonField = formData.get('includeMiniAppButton')
        if (includeButtonField !== null) {
          includeMiniAppButton = includeButtonField === 'true' || includeButtonField.toString() === 'true'
        }
        
        const photo = formData.get('photo')
        
        // Проверяем что photo существует, это File, и имеет размер > 0
        if (photo && photo instanceof File && photo.size > 0) {
          photoFile = photo
          try {
            const arrayBuffer = await photo.arrayBuffer()
            photoBuffer = Buffer.from(arrayBuffer)
            photoMimeType = photo.type || 'image/jpeg'
            console.log(`📷 [Broadcast] Photo loaded: ${photo.name}, size: ${photo.size} bytes, type: ${photoMimeType}`)
          } catch (photoError: any) {
            console.error(`❌ [Broadcast] Failed to process photo:`, photoError.message)
            // Продолжаем без фото, если не удалось обработать
            photoBuffer = null
            photoFile = null
          }
        } else {
          console.log(`ℹ️ [Broadcast] No photo in FormData or photo is empty`)
        }
      } else {
        // JSON - только текст
        try {
          const body = await request.json()
          message = body.message || ''
          includeMiniAppButton = body.includeMiniAppButton !== undefined ? body.includeMiniAppButton : true
        } catch (jsonError: any) {
          // Если не JSON, пробуем FormData (на случай если content-type не установлен правильно)
          try {
            const formData = await request.formData()
            const messageField = formData.get('message')
            message = typeof messageField === 'string' ? messageField : (messageField?.toString() || '')
            
            const includeButtonField = formData.get('includeMiniAppButton')
            if (includeButtonField !== null) {
              includeMiniAppButton = includeButtonField === 'true' || includeButtonField.toString() === 'true'
            }
            
            const photo = formData.get('photo') as File | null
            if (photo && photo.size > 0 && photo instanceof File) {
              photoFile = photo
              const arrayBuffer = await photo.arrayBuffer()
              photoBuffer = Buffer.from(arrayBuffer)
              photoMimeType = photo.type || 'image/jpeg'
            }
          } catch (formDataError: any) {
            console.error('❌ [Broadcast] Failed to parse request body:', formDataError.message)
            return NextResponse.json(
              createApiResponse(null, 'Неверный формат запроса. Ожидается JSON или FormData.'),
              { status: 400 }
            )
          }
        }
      }
    } catch (error: any) {
      console.error('❌ [Broadcast] Error parsing request:', error.message)
      return NextResponse.json(
        createApiResponse(null, `Ошибка обработки запроса: ${error.message}`),
        { status: 400 }
      )
    }

    if (!message || !message.trim()) {
      return NextResponse.json(
        createApiResponse(null, 'Сообщение не может быть пустым'),
        { status: 400 }
      )
    }

    // Получаем токен из переменных окружения или используем токен основного бота
    let botToken = process.env.BOT_TOKEN
    
    // Fallback на токен основного бота, если не найден в .env
    if (!botToken) {
      botToken = '8237362899:AAECnIbU7QQaFUonr85eiosXU79f9SbBc5s'
      console.log('⚠️ [Broadcast] BOT_TOKEN not found in .env, using default token from bot_1xbet')
    }

    console.log(`🔑 [Broadcast] BOT_TOKEN check: ${botToken ? 'exists' : 'missing'}, length: ${botToken?.length || 0}`)

    if (!botToken) {
      console.error('❌ [Broadcast] BOT_TOKEN is not configured in environment variables')
      return NextResponse.json(
        createApiResponse(null, 'BOT_TOKEN not configured in server environment'),
        { status: 500 }
      )
    }

    // Проверяем формат токена (обычно это числа:буквы, минимум 10 символов)
    if (botToken.length < 10 || !botToken.includes(':')) {
      const tokenPreview = botToken.substring(0, 5) + '...' + botToken.substring(botToken.length - 3)
      console.error(`❌ [Broadcast] BOT_TOKEN format is invalid:`, {
        length: botToken.length,
        hasColon: botToken.includes(':'),
        preview: tokenPreview
      })
      return NextResponse.json(
        createApiResponse(null, `BOT_TOKEN format is invalid (length: ${botToken.length}, expected format: number:letters)`),
        { status: 500 }
      )
    }

    // Логируем начало рассылки (без токена)
    const tokenPreview = botToken.substring(0, 10) + '...' + botToken.substring(botToken.length - 5)
    console.log(`📢 [Broadcast] BOT_TOKEN loaded: ${tokenPreview}`)
    
    // Проверяем токен через getMe перед началом рассылки
    try {
      const testUrl = `https://api.telegram.org/bot${botToken}/getMe`
      const testController = new AbortController()
      const testTimeoutId = setTimeout(() => testController.abort(), 5000) // 5 секунд таймаут
      
      const testResponse = await fetch(testUrl, {
        method: 'GET',
        signal: testController.signal
      })
      
      clearTimeout(testTimeoutId)
      
      if (!testResponse.ok) {
        const errorText = await testResponse.text()
        console.error(`❌ [Broadcast] BOT_TOKEN validation failed:`, {
          status: testResponse.status,
          error: errorText
        })
        return NextResponse.json(
          createApiResponse(null, `BOT_TOKEN недействителен: ${testResponse.status === 404 ? 'Токен не найден' : 'Ошибка проверки токена'}`),
          { status: 500 }
        )
      }
      
      const testData = await testResponse.json()
      if (!testData.ok) {
        console.error(`❌ [Broadcast] BOT_TOKEN validation failed:`, testData)
        return NextResponse.json(
          createApiResponse(null, `BOT_TOKEN недействителен: ${testData.description || 'Неизвестная ошибка'}`),
          { status: 500 }
        )
      }
      
      console.log(`✅ [Broadcast] BOT_TOKEN validated, bot username: @${testData.result.username || 'N/A'}`)
    } catch (error: any) {
      const errorMsg = error.name === 'AbortError' ? 'Таймаут при проверке токена' : error.message || 'Неизвестная ошибка'
      console.error(`❌ [Broadcast] Failed to validate BOT_TOKEN:`, errorMsg)
      return NextResponse.json(
        createApiResponse(null, `Ошибка проверки BOT_TOKEN: ${errorMsg}`),
        { status: 500 }
      )
    }

    // URL мини-приложения для кнопки (из централизованной конфигурации)
    const miniAppUrl = getMiniAppUrl()

    // Получаем всех пользователей и фильтруем только валидные userId
    const allUsers = await prisma.botUser.findMany({
      select: {
        userId: true,
      },
    })

    // Фильтруем только пользователей с валидными числовыми userId (Telegram ID)
    const validUsers = allUsers.filter(user => {
      if (!user.userId) return false
      const userIdString = user.userId.toString().trim()
      // Проверяем, что userId является числом (Telegram ID всегда числовой)
      return userIdString !== '' && /^\d+$/.test(userIdString)
    })

    // ВАЖНО: Убираем дубликаты userId - используем Set для отслеживания уникальных ID
    const seenUserIds = new Set<string>()
    const users = validUsers.filter(user => {
      const userIdString = user.userId.toString()
      if (seenUserIds.has(userIdString)) {
        return false // Пропускаем дубликат
      }
      seenUserIds.add(userIdString)
      return true
    })

    const duplicateCount = validUsers.length - users.length
    if (duplicateCount > 0) {
      console.warn(`⚠️ [Broadcast] Removed ${duplicateCount} duplicate userId(s). Proceeding with ${users.length} unique users.`)
    }

    if (users.length === 0) {
      const invalidCount = allUsers.length - validUsers.length
      if (invalidCount > 0) {
        console.warn(`⚠️ [Broadcast] Filtered out ${invalidCount} users with invalid userId format`)
      }
      return NextResponse.json(
        createApiResponse(null, 'Нет пользователей с валидными ID для рассылки'),
        { status: 400 }
      )
    }

    if (allUsers.length > users.length) {
      const invalidCount = allUsers.length - validUsers.length
      const totalFiltered = invalidCount + duplicateCount
      console.warn(`⚠️ [Broadcast] Filtered out ${totalFiltered} users (${invalidCount} invalid format, ${duplicateCount} duplicates). Proceeding with ${users.length} unique valid users.`)
    }

    let successCount = 0
    let errorCount = 0
    const errors: string[] = []

    console.log(`📢 [Broadcast] Starting broadcast to ${users.length} users`)

    // Отправляем сообщение всем пользователям с кнопкой WebApp
    for (let i = 0; i < users.length; i++) {
      const user = users[i]
      try {
        // Проверяем что токен не пустой перед каждым запросом
        if (!botToken || botToken.trim() === '') {
          console.error(`❌ [Broadcast] BOT_TOKEN is empty for user ${user.userId}`)
          errorCount++
          errors.push(`User ${user.userId}: BOT_TOKEN is empty`)
          continue
        }

        // Валидация userId - должен быть числом (Telegram ID)
        if (!user.userId) {
          console.error(`❌ [Broadcast] Invalid userId for user at index ${i}: userId is null/undefined`)
          errorCount++
          errors.push(`User at index ${i}: Invalid userId (null/undefined)`)
          continue
        }
        
        const userIdString = user.userId.toString().trim()
        if (userIdString === '' || !/^\d+$/.test(userIdString)) {
          console.error(`❌ [Broadcast] Invalid userId format for user at index ${i}: "${userIdString}" (not a valid number)`)
          errorCount++
          errors.push(`User at index ${i}: Invalid userId format "${userIdString}"`)
          continue
        }

        // Определяем endpoint и способ отправки (с фото или без)
        let apiEndpoint: string
        let requestBody: BodyInit
        let requestHeaders: HeadersInit
        
        // Создаем replyMarkup только если включена кнопка мини-приложения
        const replyMarkup = includeMiniAppButton ? {
          inline_keyboard: [
            [
              {
                text: '🚀 Открыть приложение',
                web_app: {
                  url: miniAppUrl
                }
              }
            ]
          ]
        } : undefined

        if (photoBuffer && photoMimeType) {
          // Отправка с фото через FormData
          apiEndpoint = `https://api.telegram.org/bot${botToken}/sendPhoto`
          
          const formData = new FormData()
          formData.append('chat_id', user.userId.toString())
          // Конвертируем Buffer в Uint8Array для Blob
          const uint8Array = new Uint8Array(photoBuffer)
          formData.append('photo', new Blob([uint8Array], { type: photoMimeType }), photoFile?.name || 'photo.jpg')
          if (message.trim()) {
            formData.append('caption', message)
          }
          formData.append('parse_mode', 'HTML')
          if (replyMarkup) {
            formData.append('reply_markup', JSON.stringify(replyMarkup))
          }
          
          requestBody = formData
          requestHeaders = {} // FormData сам установит Content-Type с boundary
        } else {
          // Отправка только текста через JSON
          apiEndpoint = `https://api.telegram.org/bot${botToken}/sendMessage`
          
          const messageBody: any = {
            chat_id: user.userId.toString(),
            text: message,
            parse_mode: 'HTML',
          }
          
          if (replyMarkup) {
            messageBody.reply_markup = replyMarkup
          }
          
          requestBody = JSON.stringify(messageBody)
          requestHeaders = {
            'Content-Type': 'application/json',
          }
        }
        
        // Логируем первый запрос для отладки
        if (i === 0) {
          console.log(`🔍 [Broadcast] First request to user ${user.userId}, method: ${photoBuffer ? 'sendPhoto' : 'sendMessage'}`)
        }
        
        // Добавляем таймаут для запроса
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 секунд таймаут
        
        const telegramResponse = await fetch(apiEndpoint, {
          method: 'POST',
          headers: requestHeaders,
          body: requestBody,
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (!telegramResponse.ok) {
          const errorText = await telegramResponse.text()
          let errorJson: any = {}
          try {
            errorJson = JSON.parse(errorText)
          } catch (e) {
            // Если не JSON, используем текст как есть
          }
          
          console.error(`❌ [Broadcast] HTTP error for user ${user.userId}:`, {
            status: telegramResponse.status,
            statusText: telegramResponse.statusText,
            errorCode: errorJson.error_code,
            description: errorJson.description,
            endpoint: apiEndpoint.substring(0, 60) + '...' // Показываем начало URL без токена
          })
          
          errorCount++
          errors.push(`User ${user.userId}: HTTP ${telegramResponse.status} - ${errorJson.description || errorText.substring(0, 100)}`)
          
          // Если все запросы дают 404, возможно проблема с токеном или пользователями
          if (i < 5 && telegramResponse.status === 404) {
            console.error(`❌ [Broadcast] CRITICAL: Request ${i + 1} returned 404 for user ${user.userId}`)
            console.error(`❌ [Broadcast] Error details:`, {
              errorCode: errorJson.error_code,
              description: errorJson.description,
              userId: user.userId,
              userIdType: typeof user.userId,
              userIdString: user.userId.toString(),
              hasPhoto: !!photoBuffer
            })
            
            // Если первые несколько запросов все 404, останавливаем рассылку
            if (i === 4 && errorCount === 5) {
              console.error(`❌ [Broadcast] CRITICAL: All first 5 requests returned 404. Stopping broadcast!`)
              console.error(`❌ [Broadcast] Possible issues:`)
              console.error(`  1. BOT_TOKEN is incorrect or invalid`)
              console.error(`  2. User IDs in database are incorrect`)
              console.error(`  3. Bot was deleted or blocked`)
              return NextResponse.json(
                createApiResponse(null, `Критическая ошибка: все запросы возвращают 404. Проверьте BOT_TOKEN и данные пользователей. Ошибок: ${errorCount}`),
                { status: 500 }
              )
            }
          }
          
          continue
        }

        const telegramData = await telegramResponse.json()
        
        // Логируем первый успешный ответ для отладки
        if (i === 0 && telegramData.ok) {
          console.log(`✅ [Broadcast] First message sent successfully to user ${user.userId}`)
        }

        if (telegramData.ok) {
          successCount++
          // Логируем первый успешный запрос
          if (successCount === 1) {
            console.log(`✅ [Broadcast] First message sent successfully to user ${user.userId}`)
          }
          if ((i + 1) % 100 === 0) {
            console.log(`✅ [Broadcast] Progress: ${i + 1}/${users.length} sent (${successCount} success, ${errorCount} errors)`)
          }
        } else {
          const errorMsg = telegramData.description || 'Unknown error'
          console.error(`❌ [Broadcast] Telegram API error for user ${user.userId}: ${errorMsg} (error_code: ${telegramData.error_code || 'N/A'})`)
          errorCount++
          errors.push(`User ${user.userId}: ${errorMsg}`)
          
          // Если пользователь заблокировал бота (403) или неверный запрос (400), пропускаем
          if (telegramData.error_code === 403) {
            // Пользователь заблокировал бота - не критично
            console.log(`⚠️ [Broadcast] User ${user.userId} blocked the bot`)
            continue
          }
          
          if (telegramData.error_code === 400) {
            // Неверный запрос (возможно, неверный chat_id) - пропускаем
            console.log(`⚠️ [Broadcast] Invalid request for user ${user.userId}: ${errorMsg}`)
            continue
          }
          
          // Если rate limit (429), делаем паузу и повторяем
          if (telegramData.error_code === 429) {
            const retryAfter = telegramData.parameters?.retry_after || 1
            console.log(`⏸️ [Broadcast] Rate limit hit, waiting ${retryAfter} seconds...`)
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
            // Пробуем еще раз
            i--
            continue
          }
        }
        
        // Небольшая задержка между запросами чтобы не попасть в rate limit
        // Telegram позволяет до 30 сообщений в секунду, используем 35ms = ~28 сообщений/сек для безопасности
        if (i < users.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 35)) // 35ms = ~28 сообщений/сек
        }
      } catch (error: any) {
        errorCount++
        const errorMsg = error.name === 'AbortError' ? 'Request timeout' : error.message || 'Unknown error'
        console.error(`❌ [Broadcast] Exception for user ${user.userId}: ${errorMsg}`)
        errors.push(`User ${user.userId}: ${errorMsg}`)
      }
    }

    console.log(`📢 [Broadcast] Completed: ${successCount} success, ${errorCount} errors out of ${users.length} total`)
    if (errors.length > 0 && errors.length <= 10) {
      console.log(`❌ [Broadcast] Errors:`, errors.slice(0, 10))
    }

    // Сохраняем в историю рассылок с детальной статистикой
    const hasPhotoText = photoBuffer ? ' (с фото)' : ''
    const broadcastTitle = `Рассылка ${successCount} из ${users.length} пользователям${hasPhotoText} - ${new Date().toLocaleString('ru-RU')}`
    await prisma.broadcastMessage.create({
      data: {
        title: broadcastTitle,
        message: message,
        isSent: true,
        sentAt: new Date(),
      },
    })

    const successRate = users.length > 0 ? ((successCount / users.length) * 100).toFixed(1) : '0'
    
    return NextResponse.json(
      createApiResponse({
        success: true,
        message: `Рассылка завершена. Успешно отправлено: ${successCount} из ${users.length} (${successRate}%)`,
        sentCount: successCount,
        errorCount: errorCount,
        totalUsers: users.length,
        successRate: parseFloat(successRate),
      })
    )
  } catch (error: any) {
    console.error('❌ [Broadcast] API error:', {
      message: error.message,
      stack: error.stack?.substring(0, 500),
      name: error.name
    })
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to send broadcast'),
      { status: 500 }
    )
  }
}

