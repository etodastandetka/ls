#!/usr/bin/env tsx
/**
 * Скрипт для восстановления баланса призов за топ, которые были неправильно вычтены при закрытии месяца
 * Использование: npx tsx scripts/restore-top-prizes.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function restoreTopPrizes() {
  try {
    console.log('🔍 Поиск призов за топ, которые могли быть вычтены...\n')
    
    // Находим все записи с призами за топ
    const topPrizes = await prisma.botReferralEarning.findMany({
      where: {
        bookmaker: 'top_payout',
        status: 'completed'
      },
      select: {
        id: true,
        referrerId: true,
        commissionAmount: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    })
    
    if (topPrizes.length === 0) {
      console.log('❌ Призы за топ не найдены')
      process.exit(0)
    }
    
    console.log(`✅ Найдено ${topPrizes.length} призов за топ\n`)
    
    // Группируем по пользователям
    const prizesByUser = new Map<bigint, Array<{ id: number, amount: number, date: Date }>>()
    for (const prize of topPrizes) {
      const amount = parseFloat(prize.commissionAmount.toString())
      if (!prizesByUser.has(prize.referrerId)) {
        prizesByUser.set(prize.referrerId, [])
      }
      prizesByUser.get(prize.referrerId)!.push({
        id: prize.id,
        amount,
        date: prize.createdAt
      })
    }
    
    console.log(`📊 Найдено ${prizesByUser.size} пользователей с призами за топ\n`)
    
    // Для каждого пользователя проверяем, были ли вычтены призы
    let restoredCount = 0
    let totalRestored = 0
    
    for (const [userId, prizes] of prizesByUser.entries()) {
      const totalPrizeAmount = prizes.reduce((sum, p) => sum + p.amount, 0)
      
      // Проверяем, есть ли отрицательные записи month_close, которые могли вычесть призы
      const monthCloseDeductions = await prisma.botReferralEarning.findMany({
        where: {
          referrerId: userId,
          bookmaker: 'month_close',
          status: 'completed',
          commissionAmount: {
            lt: 0
          }
        },
        select: {
          id: true,
          commissionAmount: true,
          createdAt: true
        }
      })
      
      if (monthCloseDeductions.length === 0) {
        console.log(`✅ Пользователь ${userId}: призы не вычитались (нет записей month_close)`)
        continue
      }
      
      // Суммируем все вычеты
      const totalDeduction = monthCloseDeductions.reduce((sum, d) => {
        return sum + Math.abs(parseFloat(d.commissionAmount.toString()))
      }, 0)
      
      console.log(`\n👤 Пользователь ${userId}:`)
      console.log(`   Призы за топ: ${totalPrizeAmount.toFixed(2)} сом`)
      console.log(`   Вычеты month_close: ${totalDeduction.toFixed(2)} сом`)
      
      // Проверяем, были ли выведены средства после вычета призов
      const withdrawals = await prisma.referralWithdrawalRequest.findMany({
        where: {
          userId: userId,
          status: 'completed'
        },
        select: {
          amount: true,
          createdAt: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
      
      const totalWithdrawn = withdrawals.reduce((sum, w) => {
        return sum + parseFloat(w.amount.toString())
      }, 0)
      
      // Если вычеты больше или равны призам, возможно призы были вычтены
      // Восстанавливаем баланс, создавая положительную запись
      if (totalDeduction >= totalPrizeAmount * 0.9) { // 90% совпадение (с учетом возможных округлений)
        const restoreAmount = totalPrizeAmount
        
        // Проверяем, не была ли уже создана запись о восстановлении
        const existingRestore = await prisma.botReferralEarning.findFirst({
          where: {
            referrerId: userId,
            bookmaker: 'top_payout_restore',
            status: 'completed'
          }
        })
        
        if (existingRestore) {
          console.log(`   ⚠️  Баланс уже был восстановлен ранее`)
          continue
        }
        
        // Проверяем текущий баланс
        const allEarnings = await prisma.botReferralEarning.findMany({
          where: {
            referrerId: userId,
            status: 'completed'
          },
          select: {
            commissionAmount: true
          }
        })
        
        const currentEarned = allEarnings.reduce((sum, e) => {
          return sum + parseFloat(e.commissionAmount.toString())
        }, 0)
        
        const currentAvailable = currentEarned - totalWithdrawn
        
        console.log(`   💰 Текущий баланс: ${currentEarned.toFixed(2)} сом`)
        console.log(`   💸 Выведено: ${totalWithdrawn.toFixed(2)} сом`)
        console.log(`   💵 Доступно: ${currentAvailable.toFixed(2)} сом`)
        
        // Создаем запись о восстановлении баланса
        await prisma.botReferralEarning.create({
          data: {
            referrerId: userId,
            referredId: userId,
            amount: restoreAmount,
            commissionAmount: restoreAmount,
            bookmaker: 'top_payout_restore', // Маркер восстановления
            status: 'completed'
          }
        })
        
        restoredCount++
        totalRestored += restoreAmount
        
        const newAvailable = currentEarned + restoreAmount - totalWithdrawn
        console.log(`   ✅ Баланс восстановлен: ${restoreAmount.toFixed(2)} сом`)
        console.log(`   💵 Новый доступный баланс: ${newAvailable.toFixed(2)} сом`)
        
        if (totalWithdrawn > 0) {
          console.log(`   ⚠️  Внимание: пользователь уже вывел ${totalWithdrawn.toFixed(2)} сом`)
        }
      } else {
        console.log(`   ℹ️  Вычеты меньше призов, возможно призы не были вычтены`)
      }
    }
    
    console.log(`\n✅ Восстановление завершено:`)
    console.log(`   Пользователей: ${restoredCount}`)
    console.log(`   Сумма: ${totalRestored.toFixed(2)} сом`)
    
  } catch (error: any) {
    console.error('❌ Ошибка:', error.message)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Запускаем скрипт
restoreTopPrizes()

