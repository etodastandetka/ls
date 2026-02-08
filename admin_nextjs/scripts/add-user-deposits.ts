#!/usr/bin/env tsx
/**
 * Скрипт для добавления подтвержденных заявок на депозит для пользователя
 * Использование: tsx scripts/add-user-deposits.ts <userId> <targetAmount>
 * Пример: tsx scripts/add-user-deposits.ts 8010292243 2300000
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
  } catch (error) {
    // Если .env файл не найден, это нормально - используем системные переменные
    console.log('⚠️  .env файл не найден, используем системные переменные окружения')
  }
}

// Загружаем .env перед инициализацией Prisma
loadEnvFile()

const prisma = new PrismaClient()

async function addUserDeposits(userId: string, targetAmount: number) {
  try {
    const userIdBigInt = BigInt(userId)
    
    // Проверяем существует ли пользователь
    const user = await prisma.botUser.findUnique({
      where: { userId: userIdBigInt },
      select: {
        userId: true,
        username: true,
        firstName: true,
        lastName: true,
        selectedBookmaker: true,
      }
    })
    
    if (!user) {
      console.error(`❌ Пользователь с ID ${userId} не найден`)
      process.exit(1)
    }
    
    console.log(`✅ Пользователь найден: ${user.username || user.firstName || `ID: ${userId}`}`)
    
    // Проверяем существующие депозиты для этого пользователя
    const existingDeposits = await prisma.request.findMany({
      where: {
        userId: userIdBigInt,
        requestType: 'deposit',
        status: {
          in: ['completed', 'approved', 'auto_completed', 'autodeposit_success']
        }
      },
      select: {
        amount: true
      }
    })
    
    const currentTotal = existingDeposits.reduce((sum, d) => {
      return sum + (d.amount ? parseFloat(d.amount.toString()) : 0)
    }, 0)
    
    console.log(`📊 Текущая сумма депозитов: ${currentTotal.toFixed(2)} сом`)
    console.log(`🎯 Целевая сумма: ${targetAmount.toFixed(2)} сом`)
    
    const neededAmount = targetAmount - currentTotal
    
    if (neededAmount <= 0) {
      console.log(`✅ Текущая сумма (${currentTotal.toFixed(2)} сом) уже больше или равна целевой (${targetAmount.toFixed(2)} сом)`)
      console.log(`   Не нужно добавлять депозиты.`)
      process.exit(0)
    }
    
    console.log(`💰 Нужно добавить: ${neededAmount.toFixed(2)} сом\n`)
    
    // Создаем несколько заявок с разными суммами и датами
    // Разбиваем на разные суммы для реалистичности
    const deposits: { amount: number; daysAgo: number }[] = []
    
    // Генерируем депозиты с разными суммами
    let remaining = neededAmount
    let daysAgo = 30 // Начинаем с 30 дней назад
    
    // Создаем депозиты разных размеров
    while (remaining > 0.01) { // Продолжаем пока есть хотя бы 1 копейка
      let depositAmount: number
      
      if (remaining > 200000) {
        // Большие депозиты (150k-200k)
        depositAmount = Math.min(150000 + Math.random() * 50000, remaining)
      } else if (remaining > 100000) {
        // Средние депозиты (80k-120k)
        depositAmount = Math.min(80000 + Math.random() * 40000, remaining)
      } else if (remaining > 50000) {
        // Средние депозиты (40k-70k)
        depositAmount = Math.min(40000 + Math.random() * 30000, remaining)
      } else if (remaining > 20000) {
        // Малые депозиты (15k-30k)
        depositAmount = Math.min(15000 + Math.random() * 15000, remaining)
      } else if (remaining > 5000) {
        // Небольшие депозиты (3k-8k)
        depositAmount = Math.min(3000 + Math.random() * 5000, remaining)
      } else if (remaining > 1000) {
        // Мелкие депозиты (500-2000)
        depositAmount = Math.min(500 + Math.random() * 1500, remaining)
      } else if (remaining > 100) {
        // Очень мелкие депозиты (50-500)
        depositAmount = Math.min(50 + Math.random() * 450, remaining)
      } else {
        // Остаток (мелкие суммы)
        depositAmount = remaining
      }
      
      // Округляем до 2 знаков после запятой
      depositAmount = Math.round(depositAmount * 100) / 100
      
      // Пропускаем нулевые суммы
      if (depositAmount < 0.01) {
        break
      }
      
      deposits.push({
        amount: depositAmount,
        daysAgo: daysAgo
      })
      
      remaining -= depositAmount
      daysAgo -= Math.floor(Math.random() * 3) + 1 // Случайный интервал 1-3 дня
      
      // Ограничиваем количество депозитов (максимум 100)
      if (deposits.length >= 100) {
        // Добавляем остаток к последнему депозиту, если он больше 0.01
        if (remaining > 0.01) {
          deposits[deposits.length - 1].amount += remaining
          deposits[deposits.length - 1].amount = Math.round(deposits[deposits.length - 1].amount * 100) / 100
        }
        break
      }
    }
    
    const now = new Date()
    const bookmakers = ['1WIN', '1XBET', 'MELBET', 'MOSTBET']
    const banks = ['DEMIRBANK', 'OPTIMA', 'MEGAPAY', 'ELQR', 'BAKAI', 'MBANK']
    const statuses = ['completed', 'approved', 'auto_completed', 'autodeposit_success']
    
    console.log(`📝 Создаю ${deposits.length} заявок на депозит...\n`)
    
    let createdCount = 0
    let totalAmount = 0
    
    for (const deposit of deposits) {
      const createdAt = new Date(now)
      createdAt.setDate(createdAt.getDate() - deposit.daysAgo)
      createdAt.setHours(10 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60), 0, 0)
      
      const processedAt = new Date(createdAt)
      processedAt.setMinutes(processedAt.getMinutes() + Math.floor(Math.random() * 60) + 5)
      
      const bookmaker = bookmakers[Math.floor(Math.random() * bookmakers.length)]
      const bank = banks[Math.floor(Math.random() * banks.length)]
      const status = statuses[Math.floor(Math.random() * statuses.length)]
      
      // Генерируем случайный accountId для реалистичности
      const accountId = `ACC${Math.floor(Math.random() * 1000000)}`
      
      try {
        const request = await prisma.request.create({
          data: {
            userId: userIdBigInt,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            bookmaker: bookmaker,
            accountId: accountId,
            amount: deposit.amount,
            requestType: 'deposit',
            status: status,
            statusDetail: status === 'auto_completed' || status === 'autodeposit_success' ? 'Автопополнение' : 'Обработано',
            processedBy: status === 'auto_completed' || status === 'autodeposit_success' ? 'автопополнение' : 'admin',
            bank: bank,
            createdAt: createdAt,
            processedAt: processedAt,
            updatedAt: processedAt,
          }
        })
        
        createdCount++
        totalAmount += deposit.amount
        
        console.log(`✅ Создана заявка #${request.id}: ${deposit.amount.toFixed(2)} сом (${bookmaker}, ${bank}) - ${createdAt.toLocaleDateString('ru-RU')} ${createdAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`)
      } catch (error: any) {
        console.error(`❌ Ошибка при создании заявки на ${deposit.amount.toFixed(2)} сом:`, error.message)
      }
    }
    
    // Проверяем итоговую сумму
    const updatedDeposits = await prisma.request.findMany({
      where: {
        userId: userIdBigInt,
        requestType: 'deposit',
        status: {
          in: ['completed', 'approved', 'auto_completed', 'autodeposit_success']
        }
      },
      select: {
        amount: true
      }
    })
    
    const finalTotal = updatedDeposits.reduce((sum, d) => {
      return sum + (d.amount ? parseFloat(d.amount.toString()) : 0)
    }, 0)
    
    console.log(`\n📊 Итоговая статистика:`)
    console.log(`   Создано заявок: ${createdCount}`)
    console.log(`   Добавленная сумма: ${totalAmount.toFixed(2)} сом`)
    console.log(`   Общая сумма депозитов: ${finalTotal.toFixed(2)} сом`)
    console.log(`   Прирост: ${(finalTotal - currentTotal).toFixed(2)} сом`)
    console.log(`   Отклонение от цели: ${Math.abs(finalTotal - targetAmount).toFixed(2)} сом`)
    
    console.log(`\n✅ Готово! Заявки успешно созданы.`)
    
  } catch (error: any) {
    console.error('❌ Ошибка:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Получаем аргументы из командной строки
const args = process.argv.slice(2)

if (args.length < 1) {
  console.error('Использование: tsx scripts/add-user-deposits.ts <userId> [targetAmount]')
  console.error('Пример: tsx scripts/add-user-deposits.ts 8010292243 2300000')
  process.exit(1)
}

const userId = args[0]
const targetAmount = args[1] ? parseFloat(args[1]) : 2300000

if (!/^\d+$/.test(userId)) {
  console.error('❌ Неверный ID пользователя. Должно быть число.')
  process.exit(1)
}

if (isNaN(targetAmount) || targetAmount <= 0) {
  console.error('❌ Неверная целевая сумма. Должно быть положительное число.')
  process.exit(1)
}

addUserDeposits(userId, targetAmount)

