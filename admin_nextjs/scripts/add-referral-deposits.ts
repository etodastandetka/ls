#!/usr/bin/env tsx
/**
 * Скрипт для добавления подтвержденных заявок на депозит для реферала
 * Использование: tsx scripts/add-referral-deposits.ts <referredUserId>
 * Пример: tsx scripts/add-referral-deposits.ts 8049922593
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function addReferralDeposits(referredUserId: string) {
  try {
    const userIdBigInt = BigInt(referredUserId)
    
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
      console.error(`❌ Пользователь с ID ${referredUserId} не найден`)
      process.exit(1)
    }
    
    console.log(`✅ Пользователь найден: ${user.username || user.firstName || `ID: ${referredUserId}`}`)
    
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
    
    // Нужно добавить примерно 357,297.11 сом чтобы достичь ~560,000 сом
    // Создаем несколько заявок с разными суммами и датами
    // Используем даты в прошлом (относительно текущей даты), чтобы они отображались в истории
    const targetAmount = 357297.11
    const deposits = [
      { amount: 50000, daysAgo: 15 },
      { amount: 45000, daysAgo: 14 },
      { amount: 60000, daysAgo: 13 },
      { amount: 55000, daysAgo: 12 },
      { amount: 48000, daysAgo: 11 },
      { amount: 52000, daysAgo: 10 },
      { amount: 44197.11, daysAgo: 9 }, // Остаток для точной суммы
    ]
    
    const now = new Date()
    const bookmakers = ['1WIN', '1XBET', 'MELBET']
    
    console.log(`\n📝 Создаю ${deposits.length} заявок на депозит...\n`)
    
    let createdCount = 0
    let totalAmount = 0
    
    for (const deposit of deposits) {
      const createdAt = new Date(now)
      createdAt.setDate(createdAt.getDate() - deposit.daysAgo)
      createdAt.setHours(12 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60), 0, 0)
      
      const processedAt = new Date(createdAt)
      processedAt.setMinutes(processedAt.getMinutes() + Math.floor(Math.random() * 30) + 1)
      
      const bookmaker = bookmakers[Math.floor(Math.random() * bookmakers.length)]
      
      try {
        const request = await prisma.request.create({
          data: {
            userId: userIdBigInt,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            bookmaker: bookmaker,
            amount: deposit.amount,
            requestType: 'deposit',
            status: 'auto_completed',
            statusDetail: 'Автопополнение',
            processedBy: 'автопополнение',
            bank: 'DEMIRBANK',
            createdAt: createdAt,
            processedAt: processedAt,
            updatedAt: processedAt,
          }
        })
        
        createdCount++
        totalAmount += deposit.amount
        
        console.log(`✅ Создана заявка #${request.id}: ${deposit.amount.toFixed(2)} сом (${bookmaker}) - ${createdAt.toLocaleDateString('ru-RU')}`)
      } catch (error: any) {
        console.error(`❌ Ошибка при создании заявки на ${deposit.amount} сом:`, error.message)
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
  console.error('Использование: tsx scripts/add-referral-deposits.ts <referredUserId>')
  console.error('Пример: tsx scripts/add-referral-deposits.ts 8049922593')
  process.exit(1)
}

const referredUserId = args[0]

if (!/^\d+$/.test(referredUserId)) {
  console.error('❌ Неверный ID пользователя. Должно быть число.')
  process.exit(1)
}

addReferralDeposits(referredUserId)

