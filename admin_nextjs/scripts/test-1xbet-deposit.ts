/**
 * Тестовый скрипт для пополнения баланса в 1xbet
 * Использование: 
 *   cd admin_nextjs
 *   npx tsx scripts/test-1xbet-deposit.ts
 */

import { depositCashdeskAPI } from '../lib/casino-deposit'

async function testDeposit() {
  const accountId = '1530777653' // ID казино
  const amount = 5000.45 // Сумма в сомах
  const bookmaker = '1xbet'

  // Конфигурация из casino_api_config.py
  const config = {
    hash: '97f471a9db92debbda38201af67e15f64d086e94ae4b919d8a6a4f64958912cf',
    cashierpass: 'wiaWAfE9',
    login: 'zhenishbAd',
    cashdeskid: '1388580',
  }

  console.log('🚀 Начинаем тест пополнения баланса...')
  console.log(`📋 Параметры:`)
  console.log(`   Казино: ${bookmaker}`)
  console.log(`   ID казино: ${accountId}`)
  console.log(`   Сумма: ${amount} сом`)
  console.log('')

  try {
    const result = await depositCashdeskAPI(bookmaker, accountId, amount, config)

    console.log('')
    if (result.success) {
      console.log('✅ УСПЕХ! Баланс пополнен')
      console.log('📊 Результат:', JSON.stringify(result.data, null, 2))
    } else {
      console.log('❌ ОШИБКА!')
      console.log('📝 Сообщение:', result.message)
      if (result.data) {
        console.log('📊 Данные:', JSON.stringify(result.data, null, 2))
      }
    }
  } catch (error: any) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА:', error)
    console.error('Стек:', error.stack)
  }

  process.exit(0)
}

// Запускаем тест
testDeposit().catch((error) => {
  console.error('Критическая ошибка:', error)
  process.exit(1)
})

