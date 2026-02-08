#!/usr/bin/env tsx
/**
 * Скрипт для удаления заявок с нулевой суммой
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
      if (!trimmedLine || trimmedLine.startsWith('#')) continue
      
      const match = trimmedLine.match(/^([^=]+)=(.*)$/)
      if (match) {
        const key = match[1].trim()
        let value = match[2].trim()
        
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        
        if (!process.env[key]) {
          process.env[key] = value
        }
      }
    }
  } catch (error) {
    console.log('⚠️  .env файл не найден, используем системные переменные окружения')
  }
}

loadEnvFile()

const prisma = new PrismaClient()

async function deleteZeroDeposits(userId: string) {
  try {
    const userIdBigInt = BigInt(userId)
    
    // Находим заявки с нулевой суммой
    const zeroRequests = await prisma.request.findMany({
      where: {
        userId: userIdBigInt,
        requestType: 'deposit',
        OR: [
          { amount: 0 },
          { amount: null }
        ]
      }
    })
    
    if (zeroRequests.length === 0) {
      console.log('✅ Нет заявок с нулевой суммой')
      return
    }
    
    console.log(`📊 Найдено заявок с нулевой суммой: ${zeroRequests.length}`)
    
    // Удаляем заявки
    const result = await prisma.request.deleteMany({
      where: {
        userId: userIdBigInt,
        requestType: 'deposit',
        OR: [
          { amount: 0 },
          { amount: null }
        ]
      }
    })
    
    console.log(`✅ Удалено заявок: ${result.count}`)
    
  } catch (error: any) {
    console.error('❌ Ошибка:', error.message)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

const args = process.argv.slice(2)
const userId = args[0] || '8281001567'

deleteZeroDeposits(userId)

