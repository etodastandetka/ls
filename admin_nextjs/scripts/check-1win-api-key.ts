/**
 * Скрипт для проверки текущего API ключа 1win в базе данных
 * 
 * Использование:
 *   npx tsx scripts/check-1win-api-key.ts
 */

import { prisma } from '../lib/prisma'
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

// Загружаем .env перед проверкой
loadEnvFile()

async function main() {
  try {
    console.log('🔍 Проверка API ключа 1win в базе данных...\n')
    
    // Получаем конфигурацию 1win из БД
    const setting = await prisma.botConfiguration.findFirst({
      where: { key: '1win_api_config' },
    })

    if (!setting) {
      console.log('❌ Конфигурация 1win_api_config не найдена в базе данных')
      console.log('\n📝 Проверяю переменные окружения...')
      
      const envApiKey = process.env.ONEWIN_API_KEY || process.env['1WIN_API_KEY'] || ''
      if (envApiKey && envApiKey.trim() !== '') {
        console.log('✅ API ключ найден в переменных окружения:')
        console.log(`   Длина: ${envApiKey.length} символов`)
        console.log(`   Начало: ${envApiKey.substring(0, 20)}...`)
        console.log(`   Конец: ...${envApiKey.substring(envApiKey.length - 10)}`)
        console.log(`   Полный ключ: ${envApiKey}`)
      } else {
        console.log('❌ API ключ не найден ни в базе данных, ни в переменных окружения')
      }
      process.exit(1)
    }

    console.log('✅ Конфигурация найдена в базе данных')
    console.log(`   ID: ${setting.id}`)
    console.log(`   Ключ: ${setting.key}`)
    console.log(`   Описание: ${setting.description || 'Нет описания'}`)
    console.log(`   Создано: ${setting.createdAt}`)
    console.log(`   Обновлено: ${setting.updatedAt}`)
    console.log('')

    // Парсим значение
    let config: any = null
    try {
      config = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
    } catch (parseError: any) {
      console.error('❌ Ошибка парсинга JSON:', parseError.message)
      console.log('   Сырое значение:', setting.value)
      process.exit(1)
    }

    if (!config || !config.api_key) {
      console.log('❌ API ключ не найден в конфигурации')
      console.log('   Конфигурация:', config)
      process.exit(1)
    }

    const apiKey = config.api_key.trim()
    
    console.log('✅ API ключ найден:')
    console.log(`   Длина: ${apiKey.length} символов`)
    console.log(`   Начало: ${apiKey.substring(0, 20)}...`)
    console.log(`   Конец: ...${apiKey.substring(apiKey.length - 10)}`)
    console.log(`   Полный ключ: ${apiKey}`)
    console.log('')

    // Проверяем, совпадает ли с тем, что в скрипте add-1win-api-key.ts
    const scriptKey = 'f69190bced227b4d2ee16f614c64f777d1414435570efb430a6008242da0244c'
    if (apiKey === scriptKey) {
      console.log('⚠️  ВНИМАНИЕ: API ключ совпадает с тем, что в скрипте add-1win-api-key.ts')
      console.log('   Это может быть старый/недействительный ключ')
    } else {
      console.log('✅ API ключ отличается от ключа в скрипте add-1win-api-key.ts')
    }

    // Проверяем переменные окружения для сравнения
    const envApiKey = process.env.ONEWIN_API_KEY || process.env['1WIN_API_KEY'] || ''
    if (envApiKey && envApiKey.trim() !== '') {
      console.log('\n📝 Переменные окружения:')
      if (envApiKey.trim() === apiKey) {
        console.log('   ✅ API ключ в БД совпадает с переменной окружения')
      } else {
        console.log('   ⚠️  API ключ в БД НЕ совпадает с переменной окружения')
        console.log(`   Env ключ: ${envApiKey.substring(0, 20)}...${envApiKey.substring(envApiKey.length - 10)}`)
      }
    }

  } catch (error: any) {
    console.error('❌ Ошибка при проверке API ключа:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()

