/**
 * Скрипт для обновления ID казино в заявке
 * Использование: npx tsx scripts/update-request-account-id.ts <requestId> <newAccountId>
 * Пример: npx tsx scripts/update-request-account-id.ts 12575 727560649
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'
import { join } from 'path'

// Загружаем переменные из .env файла
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
    console.log('✅ Environment variables loaded from .env file')
  } catch (error: any) {
    // Если .env файл не найден, используем переменные окружения системы
    if (error.code === 'ENOENT') {
      console.log('ℹ️ .env file not found, using system environment variables')
    } else {
      console.warn('⚠️ Failed to load .env file:', error.message)
    }
  }
}

// Загружаем переменные окружения перед созданием Prisma клиента
loadEnvFile()

// Если DATABASE_URL не установлен, используем значение по умолчанию
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://gen_user:dastan10dz@89.23.117.61:5432/default_db'
  console.log('ℹ️ Using default DATABASE_URL')
}

const prisma = new PrismaClient()

async function updateRequestAccountId() {
  const args = process.argv.slice(2)
  
  if (args.length < 2) {
    console.error('❌ Ошибка: Недостаточно аргументов')
    console.log('📋 Использование: npx tsx scripts/update-request-account-id.ts <requestId> <newAccountId>')
    console.log('📋 Пример: npx tsx scripts/update-request-account-id.ts 12575 727560649')
    process.exit(1)
  }

  const requestId = parseInt(args[0])
  const newAccountId = args[1]

  if (isNaN(requestId) || requestId <= 0) {
    console.error(`❌ Ошибка: Неверный ID заявки: ${args[0]}`)
    process.exit(1)
  }

  if (!newAccountId || newAccountId.trim() === '') {
    console.error(`❌ Ошибка: Неверный ID казино: ${newAccountId}`)
    process.exit(1)
  }

  console.log(`🔍 Ищу заявку ${requestId}...`)

  try {
    // Получаем текущую заявку
    const request = await prisma.request.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        accountId: true,
        bookmaker: true,
        amount: true,
        status: true,
        requestType: true,
      },
    })

    if (!request) {
      console.error(`❌ Заявка ${requestId} не найдена`)
      process.exit(1)
    }

    console.log(`📋 Текущие данные заявки:`)
    console.log(`   ID: ${request.id}`)
    console.log(`   ID казино: ${request.accountId || '(не указан)'}`)
    console.log(`   Казино: ${request.bookmaker || '(не указано)'}`)
    console.log(`   Сумма: ${request.amount || '(не указана)'}`)
    console.log(`   Статус: ${request.status}`)
    console.log(`   Тип: ${request.requestType}`)
    console.log('')

    // Обновляем accountId
    const updatedRequest = await prisma.request.update({
      where: { id: requestId },
      data: {
        accountId: newAccountId,
      },
    })

    console.log(`✅ Успешно обновлено!`)
    console.log(`📋 Новые данные заявки:`)
    console.log(`   ID: ${updatedRequest.id}`)
    console.log(`   ID казино: ${updatedRequest.accountId}`)
    console.log(`   Казино: ${updatedRequest.bookmaker || '(не указано)'}`)
    console.log(`   Сумма: ${updatedRequest.amount || '(не указана)'}`)
    console.log(`   Статус: ${updatedRequest.status}`)
    console.log('')

    process.exit(0)
  } catch (error: any) {
    console.error(`❌ Ошибка при обновлении заявки:`, error.message)
    if (error.code === 'P2025') {
      console.error(`   Заявка ${requestId} не найдена в базе данных`)
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

updateRequestAccountId()

