#!/usr/bin/env tsx
/**
 * Скрипт для вычитания баланса из реферальной программы (при обнаружении абуза)
 * Использование: npx tsx scripts/subtract-referral-balance.ts <userId> <amount> [reason]
 * Пример: npx tsx scripts/subtract-referral-balance.ts 8281001567 5000 "Абуз: подозрительная активность"
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function subtractReferralBalance(userId: string, amount: number, reason?: string) {
  try {
    const userIdBigInt = BigInt(userId)
    
    // Проверяем существует ли пользователь
    const user = await prisma.botUser.findUnique({
      where: { userId: userIdBigInt },
      select: {
        userId: true,
        username: true,
        firstName: true,
        lastName: true
      }
    })
    
    if (!user) {
      console.error(`❌ Пользователь с ID ${userId} не найден`)
      process.exit(1)
    }
    
    const displayName = user.username 
      ? `@${user.username}` 
      : user.firstName 
        ? `${user.firstName}${user.lastName ? ' ' + user.lastName : ''}`
        : `ID: ${userId}`
    
    console.log(`✅ Пользователь найден: ${displayName}`)
    
    // Проверяем текущий баланс
    const earnings = await prisma.botReferralEarning.findMany({
      where: {
        referrerId: userIdBigInt,
        status: 'completed'
      }
    })
    
    const totalEarned = earnings.reduce((sum, e) => {
      return sum + (e.commissionAmount ? parseFloat(e.commissionAmount.toString()) : 0)
    }, 0)
    
    const completedWithdrawals = await prisma.referralWithdrawalRequest.findMany({
      where: {
        userId: userIdBigInt,
        status: 'completed'
      }
    })
    
    const totalWithdrawn = completedWithdrawals.reduce((sum, w) => {
      return sum + (w.amount ? parseFloat(w.amount.toString()) : 0)
    }, 0)
    
    const availableBalance = totalEarned - totalWithdrawn
    
    console.log(`\n📊 Текущий баланс:`)
    console.log(`   Заработано: ${totalEarned.toFixed(2)} сом`)
    console.log(`   Выведено: ${totalWithdrawn.toFixed(2)} сом`)
    console.log(`   Доступно для вывода: ${availableBalance.toFixed(2)} сом`)
    
    if (amount > availableBalance) {
      console.error(`\n❌ Ошибка: Сумма вычета (${amount.toFixed(2)} сом) больше доступного баланса (${availableBalance.toFixed(2)} сом)`)
      console.error(`   Максимальная сумма для вычета: ${availableBalance.toFixed(2)} сом`)
      process.exit(1)
    }
    
    // Запрашиваем подтверждение
    console.log(`\n⚠️  ВНИМАНИЕ: Будет вычтено ${amount.toFixed(2)} сом из баланса пользователя`)
    if (reason) {
      console.log(`   Причина: ${reason}`)
    }
    console.log(`   Новый баланс будет: ${(availableBalance - amount).toFixed(2)} сом`)
    
    // Создаем отрицательную запись о вычете
    const deduction = await prisma.botReferralEarning.create({
      data: {
        referrerId: userIdBigInt,
        referredId: userIdBigInt, // Используем самого пользователя
        amount: -amount,
        commissionAmount: -amount, // Отрицательная сумма для вычитания
        bookmaker: reason ? `abuse_deduction: ${reason.substring(0, 30)}` : 'abuse_deduction', // Маркер вычета за абуз
        status: 'completed'
      }
    })
    
    console.log(`\n✅ Создана запись о вычете:`)
    console.log(`   ID: ${deduction.id}`)
    console.log(`   Сумма: -${amount.toFixed(2)} сом`)
    console.log(`   Статус: ${deduction.status}`)
    if (reason) {
      console.log(`   Причина: ${reason}`)
    }
    
    // Проверяем новый баланс
    const newEarnings = await prisma.botReferralEarning.findMany({
      where: {
        referrerId: userIdBigInt,
        status: 'completed'
      }
    })
    
    const newTotalEarned = newEarnings.reduce((sum, e) => {
      return sum + (e.commissionAmount ? parseFloat(e.commissionAmount.toString()) : 0)
    }, 0)
    
    const newAvailableBalance = newTotalEarned - totalWithdrawn
    
    console.log(`\n📊 Новый баланс:`)
    console.log(`   Заработано: ${newTotalEarned.toFixed(2)} сом`)
    console.log(`   Выведено: ${totalWithdrawn.toFixed(2)} сом`)
    console.log(`   Доступно для вывода: ${newAvailableBalance.toFixed(2)} сом`)
    
    console.log(`\n✅ Готово! Баланс успешно вычтен.`)
    
  } catch (error: any) {
    console.error('❌ Ошибка:', error.message)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Получаем аргументы из командной строки
const args = process.argv.slice(2)

if (args.length < 2) {
  console.error('Использование: npx tsx scripts/subtract-referral-balance.ts <userId> <amount> [reason]')
  console.error('Пример: npx tsx scripts/subtract-referral-balance.ts 8281001567 5000 "Абуз: подозрительная активность"')
  process.exit(1)
}

const userId = args[0]
const amount = parseFloat(args[1])
const reason = args[2] || undefined

if (isNaN(amount) || amount <= 0) {
  console.error('❌ Неверная сумма. Должно быть положительное число.')
  process.exit(1)
}

subtractReferralBalance(userId, amount, reason)

