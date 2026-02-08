#!/usr/bin/env tsx
/**
 * Скрипт для получения информации о пользователях Telegram (username, firstName, lastName)
 * Использование: tsx scripts/get-user-info.ts
 * Или с ID: tsx scripts/get-user-info.ts 8010292243 8281001567 ...
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

// Список ID пользователей из запроса
const userIds = [
  '8010292243',
  '8281001567',
  '6878551455',
  '8203434235',
  '834708811',
  '6027007341',
  '7405516596',
  '519867558',
  '8020129297',
  '8049922593',
  '7663342245',
  '1326203470',
  '1752339046',
  '8368623425',
  '7732505304',
  '7659220565',
  '7733283242',
  '7374979792',
  '8132989828',
  '8377017254',
]

interface UserInfo {
  userId: string
  username: string | null
  firstName: string | null
  lastName: string | null
}

async function getUserInfo(userIds: string[]) {
  try {
    console.log(`🔍 Получаю информацию о ${userIds.length} пользователях...\n`)
    
    const userInfos: UserInfo[] = []
    
    for (const userId of userIds) {
      try {
        const userIdBigInt = BigInt(userId)
        
        // Получаем информацию о пользователе из BotUser
        const user = await prisma.botUser.findUnique({
          where: { userId: userIdBigInt },
          select: {
            userId: true,
            username: true,
            firstName: true,
            lastName: true,
          }
        })
        
        if (user) {
          userInfos.push({
            userId: userId,
            username: user.username || null,
            firstName: user.firstName || null,
            lastName: user.lastName || null,
          })
        } else {
          // Если пользователь не найден в BotUser, пробуем найти в Request
          const latestRequest = await prisma.request.findFirst({
            where: { userId: userIdBigInt },
            orderBy: { createdAt: 'desc' },
            select: {
              username: true,
              firstName: true,
              lastName: true,
            }
          })
          
          if (latestRequest) {
            userInfos.push({
              userId: userId,
              username: latestRequest.username || null,
              firstName: latestRequest.firstName || null,
              lastName: latestRequest.lastName || null,
            })
          } else {
            // Пользователь не найден нигде
            userInfos.push({
              userId: userId,
              username: null,
              firstName: null,
              lastName: null,
            })
          }
        }
      } catch (error: any) {
        console.error(`❌ Ошибка при получении информации о пользователе ${userId}:`, error.message)
        userInfos.push({
          userId: userId,
          username: null,
          firstName: null,
          lastName: null,
        })
      }
    }
    
    // Выводим результаты в табличном формате
    console.log('\n📋 Результаты:\n')
    console.log('┌─────────────┬──────────────────────┬──────────────────┬──────────────────┐')
    console.log('│ ID          │ Username              │ First Name       │ Last Name        │')
    console.log('├─────────────┼──────────────────────┼──────────────────┼──────────────────┤')
    
    for (const info of userInfos) {
      const id = info.userId.padEnd(11)
      const username = (info.username || '—').padEnd(20).substring(0, 20)
      const firstName = (info.firstName || '—').padEnd(16).substring(0, 16)
      const lastName = (info.lastName || '—').padEnd(16).substring(0, 16)
      
      console.log(`│ ${id} │ ${username} │ ${firstName} │ ${lastName} │`)
    }
    
    console.log('└─────────────┴──────────────────────┴──────────────────┴──────────────────┘')
    
    // Также выводим в формате списка для удобства копирования
    console.log('\n📝 Список пользователей:\n')
    for (let i = 0; i < userInfos.length; i++) {
      const info = userInfos[i]
      const num = (i + 1).toString().padStart(2)
      console.log(`#${num} ID ${info.userId}`)
      console.log(`   Username: ${info.username || '—'}`)
      console.log(`   Имя: ${info.firstName || '—'}`)
      console.log(`   Фамилия: ${info.lastName || '—'}`)
      console.log('')
    }
    
    // Выводим в CSV формате
    console.log('\n📄 CSV формат:\n')
    console.log('ID,Username,FirstName,LastName')
    for (const info of userInfos) {
      const username = info.username || ''
      const firstName = info.firstName || ''
      const lastName = info.lastName || ''
      console.log(`${info.userId},"${username}","${firstName}","${lastName}"`)
    }
    
    console.log('\n✅ Готово!')
    
  } catch (error: any) {
    console.error('❌ Ошибка:', error.message)
    console.error(error.stack)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Получаем аргументы из командной строки (если есть)
const args = process.argv.slice(2)

// Если переданы ID в аргументах, используем их, иначе используем список из кода
const userIdsToQuery = args.length > 0 ? args : userIds

// Проверяем валидность всех ID
for (const userId of userIdsToQuery) {
  if (!/^\d+$/.test(userId)) {
    console.error(`❌ Неверный ID пользователя: ${userId}. Должно быть число.`)
    process.exit(1)
  }
}

getUserInfo(userIdsToQuery)





