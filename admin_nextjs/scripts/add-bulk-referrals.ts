#!/usr/bin/env tsx
/**
 * Скрипт для массового добавления рефералов
 * Использование: tsx scripts/add-bulk-referrals.ts <referrerId> <count>
 * Пример: tsx scripts/add-bulk-referrals.ts 8281001567 400
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

// Загружаем переменные окружения из .env файла
try {
  const envPath = resolve(__dirname, '../.env')
  const envFile = readFileSync(envPath, 'utf-8')
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim()
    if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('=')) {
      const [key, ...valueParts] = trimmedLine.split('=')
      const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '')
      if (key && value) {
        process.env[key.trim()] = value
      }
    }
  })
} catch (error) {
  console.warn('⚠️ Не удалось загрузить .env файл, используем переменные окружения системы')
}

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function addBulkReferrals(referrerId: string, count: number) {
  try {
    const referrerIdBigInt = BigInt(referrerId)
    
    // Проверяем существует ли рефер
    const referrer = await prisma.botUser.findUnique({
      where: { userId: referrerIdBigInt }
    })
    
    if (!referrer) {
      // Создаем рефера, если его нет
      console.log(`📝 Создание рефера ${referrerId}...`)
      await prisma.botUser.create({
        data: {
          userId: referrerIdBigInt,
          username: null,
          firstName: null,
          lastName: null,
          language: 'ru'
        }
      })
      console.log(`✅ Рефер ${referrerId} создан`)
    } else {
      console.log(`✅ Рефер найден: ${referrer.username || referrer.firstName || `ID: ${referrerId}`}`)
    }
    
    // Получаем максимальный существующий userId для генерации новых
    const maxUser = await prisma.botUser.findFirst({
      orderBy: { userId: 'desc' },
      select: { userId: true }
    })
    
    // Начинаем с большого числа, чтобы не пересекаться с реальными пользователями
    // Используем диапазон 9000000000 - 9999999999 для тестовых пользователей
    let startId = 9000000000n
    if (maxUser && maxUser.userId > startId) {
      startId = maxUser.userId + 1n
    }
    
    console.log(`\n🔄 Начинаем создание ${count} рефералов...`)
    console.log(`📊 Начальный ID: ${startId.toString()}`)
    
    let created = 0
    let skipped = 0
    let errors = 0
    
    // Создаем рефералов батчами по 50 для оптимизации
    const batchSize = 50
    
    for (let i = 0; i < count; i += batchSize) {
      const batchCount = Math.min(batchSize, count - i)
      const batch: Array<{ userId: bigint }> = []
      
      // Генерируем ID для батча
      for (let j = 0; j < batchCount; j++) {
        const referredId = startId + BigInt(i + j)
        batch.push({ userId: referredId })
      }
      
      // Создаем пользователей батчем
      try {
        await prisma.botUser.createMany({
          data: batch.map(b => ({
            userId: b.userId,
            username: null,
            firstName: `Реферал${b.userId.toString().slice(-4)}`,
            lastName: null,
            language: 'ru'
          })),
          skipDuplicates: true
        })
      } catch (error: any) {
        console.error(`⚠️ Ошибка при создании пользователей батча ${i}-${i + batchCount}:`, error.message)
      }
      
      // Создаем реферальные связи
      for (const user of batch) {
        try {
          // Проверяем, не существует ли уже связь
          const existing = await prisma.botReferral.findUnique({
            where: { referredId: user.userId }
          })
          
          if (existing) {
            if (existing.referrerId === referrerIdBigInt) {
              skipped++
              continue
            } else {
              console.log(`⚠️ Пользователь ${user.userId} уже привязан к другому реферу`)
              skipped++
              continue
            }
          }
          
          // Создаем реферальную связь
          await prisma.botReferral.create({
            data: {
              referrerId: referrerIdBigInt,
              referredId: user.userId
            }
          })
          
          created++
          
          if (created % 50 === 0) {
            console.log(`✅ Создано: ${created}/${count} рефералов...`)
          }
        } catch (error: any) {
          if (error.code === 'P2002') {
            // Уникальное ограничение - уже существует
            skipped++
          } else {
            console.error(`❌ Ошибка при создании связи для ${user.userId}:`, error.message)
            errors++
          }
        }
      }
    }
    
    console.log(`\n✅ Готово!`)
    console.log(`📊 Статистика:`)
    console.log(`   - Создано рефералов: ${created}`)
    console.log(`   - Пропущено (уже существуют): ${skipped}`)
    console.log(`   - Ошибок: ${errors}`)
    console.log(`   - Всего обработано: ${created + skipped + errors}`)
    
    // Проверяем итоговое количество рефералов
    const totalReferrals = await prisma.botReferral.count({
      where: { referrerId: referrerIdBigInt }
    })
    
    console.log(`\n📈 Итого рефералов у пользователя ${referrerId}: ${totalReferrals}`)
    
  } catch (error: any) {
    console.error('❌ Ошибка:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Получаем аргументы командной строки
const referrerId = process.argv[2]
const count = parseInt(process.argv[3] || '400', 10)

if (!referrerId) {
  console.error('❌ Использование: tsx scripts/add-bulk-referrals.ts <referrerId> <count>')
  console.error('   Пример: tsx scripts/add-bulk-referrals.ts 8281001567 400')
  process.exit(1)
}

if (isNaN(count) || count <= 0) {
  console.error('❌ Количество должно быть положительным числом')
  process.exit(1)
}

if (count > 10000) {
  console.error('❌ Максимальное количество: 10000')
  process.exit(1)
}

addBulkReferrals(referrerId, count)

