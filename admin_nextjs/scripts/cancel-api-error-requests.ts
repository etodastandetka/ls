import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '@prisma/client'

// Загружаем переменные из .env файла
function loadEnvFile() {
  try {
    const envPath = join(process.cwd(), '.env')
    const envContent = readFileSync(envPath, 'utf-8')
    const lines = envContent.split('\n')
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=')
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').trim()
          // Убираем кавычки если есть
          const cleanValue = value.replace(/^["']|["']$/g, '')
          process.env[key.trim()] = cleanValue
        }
      }
    }
  } catch (error) {
    console.warn('⚠️ Не удалось загрузить .env файл:', error)
  }
}

// Загружаем переменные окружения
loadEnvFile()

const prisma = new PrismaClient()

/**
 * Скрипт для отмены всех заявок со статусом api_error
 * Меняет статус на rejected
 */
async function cancelApiErrorRequests() {
  try {
    console.log('🔍 Поиск заявок со статусом api_error...')
    
    // Находим все заявки со статусом api_error
    const apiErrorRequests = await prisma.request.findMany({
      where: {
        status: 'api_error'
      },
      select: {
        id: true,
        userId: true,
        requestType: true,
        amount: true,
        bookmaker: true,
        accountId: true,
        createdAt: true,
        status: true,
        statusDetail: true
      }
    })
    
    console.log(`📊 Найдено заявок со статусом api_error: ${apiErrorRequests.length}`)
    
    if (apiErrorRequests.length === 0) {
      console.log('✅ Заявок со статусом api_error не найдено')
      return
    }
    
    // Показываем информацию о найденных заявках
    console.log('\n📋 Список заявок для отмены:')
    apiErrorRequests.forEach((req, index) => {
      console.log(`${index + 1}. ID: ${req.id}, Тип: ${req.requestType}, Сумма: ${req.amount}, Казино: ${req.bookmaker || 'N/A'}, Дата: ${req.createdAt.toISOString()}`)
    })
    
    // Обновляем статус на rejected
    console.log('\n🔄 Обновление статуса на rejected...')
    const updateResult = await prisma.request.updateMany({
      where: {
        status: 'api_error'
      },
      data: {
        status: 'rejected',
        statusDetail: 'Отменено: ошибка API',
        processedAt: new Date(),
        updatedAt: new Date()
      }
    })
    
    console.log(`✅ Успешно отменено заявок: ${updateResult.count}`)
    
    // Проверяем результат
    const remainingApiError = await prisma.request.count({
      where: {
        status: 'api_error'
      }
    })
    
    if (remainingApiError === 0) {
      console.log('✅ Все заявки со статусом api_error успешно отменены')
    } else {
      console.log(`⚠️ Осталось заявок со статусом api_error: ${remainingApiError}`)
    }
    
  } catch (error: any) {
    console.error('❌ Ошибка при отмене заявок:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Запускаем скрипт
cancelApiErrorRequests()
  .then(() => {
    console.log('\n✅ Скрипт завершен успешно')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Скрипт завершен с ошибкой:', error)
    process.exit(1)
  })

