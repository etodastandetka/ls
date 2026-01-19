/**
 * Скрипт для получения конфигурации 1xbet Cashdesk API из базы данных
 * 
 * Использование:
 *   npx tsx scripts/get-1xbet-config.ts
 */

import { prisma } from '../lib/prisma'

async function get1xbetConfig() {
  try {
    console.log('🔍 Получаю конфигурацию 1xbet API...\n')

    // Получаем конфигурацию из базы данных
    const setting = await prisma.botConfiguration.findFirst({
      where: { key: '1xbet_api_config' },
    })

    if (!setting) {
      console.log('❌ Конфигурация 1xbet API не найдена в базе данных')
      console.log('\n📋 Используются значения по умолчанию из переменных окружения:')
      console.log(`  - Hash: ${process.env['1XBET_HASH'] || '97f471a9db92debbda38201af67e15f64d086e94ae4b919d8a6a4f64958912cf'}`)
      console.log(`  - Login: ${process.env['1XBET_LOGIN'] || 'zhenishbAd'}`)
      console.log(`  - Cashierpass: ${process.env['1XBET_CASHIERPASS'] || 'wiaWAfE9'}`)
      console.log(`  - Cashdesk ID: ${process.env['1XBET_CASHDESKID'] || '1388580'}`)
      return
    }

    const config = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value

    console.log('✅ Конфигурация 1xbet API найдена в базе данных:\n')
    console.log('📋 Данные для API 1xbet:')
    console.log('─'.repeat(60))
    console.log(`  Key: ${setting.key}`)
    console.log(`  Hash: ${config.hash || 'не указан'}`)
    console.log(`  Login: ${config.login || 'не указан'}`)
    console.log(`  Cashierpass: ${config.cashierpass || 'не указан'}`)
    console.log(`  Cashdesk ID: ${config.cashdeskid || 'не указан'}`)
    console.log('─'.repeat(60))
    
    console.log('\n📝 JSON формат (для копирования):')
    console.log(JSON.stringify(config, null, 2))
    
    console.log('\n📋 Формат для переменных окружения:')
    console.log(`1XBET_HASH=${config.hash || ''}`)
    console.log(`1XBET_LOGIN=${config.login || ''}`)
    console.log(`1XBET_CASHIERPASS=${config.cashierpass || ''}`)
    console.log(`1XBET_CASHDESKID=${config.cashdeskid || ''}`)

  } catch (error: any) {
    console.error('❌ Ошибка получения конфигурации 1xbet:', error)
    console.error('Error details:', error.message, error.stack)
  } finally {
    await prisma.$disconnect()
  }
}

get1xbetConfig()
  .then(() => {
    console.log('\n✅ Скрипт выполнен успешно')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Ошибка выполнения скрипта:', error)
    process.exit(1)
  })








































