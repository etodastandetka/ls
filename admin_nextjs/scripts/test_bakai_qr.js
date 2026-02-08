#!/usr/bin/env node
/**
 * Тестовый скрипт для генерации QR кода Bakai Bank
 * Использование: node scripts/test_bakai_qr.js
 */

const crypto = require('crypto')

// Пример base_hash из базы данных
const baseHash = '00020101021132460011qr.bakai.kg010131016124207011832911213021233120008BAKAIAPP5204653853034175908Ilyas%20T.54051005363044F76'

// Сумма для генерации
const amount = 500.21

console.log('='.repeat(80))
console.log('🧪 ТЕСТ ГЕНЕРАЦИИ QR КОДА ДЛЯ BAKAI BANK')
console.log('='.repeat(80))
console.log(`💰 Сумма: ${amount} сом`)
console.log(`📋 Base hash: ${baseHash.substring(0, 50)}...${baseHash.slice(-30)}`)
console.log()

// Извлекаем данные из base_hash
let merchantAccountValue = ''
let merchantName = 'BAKAIAPP'

// Извлекаем поле 32 (Merchant Account Information)
const field32Match = baseHash.match(/^00020101021132(\d{2})(.+?)(?=52)/)
if (field32Match) {
  merchantAccountValue = field32Match[2]
  console.log(`✅ Извлечено merchant account из base_hash`)
  console.log(`   Длина: ${merchantAccountValue.length}`)
  console.log(`   Значение: ${merchantAccountValue.substring(0, 50)}...`)
} else {
  // Пробуем альтернативный способ
  const alt32Match = baseHash.match(/32(\d{2})(.+?)(?=52|53|54|59|63)/)
  if (alt32Match) {
    merchantAccountValue = alt32Match[2]
    console.log(`✅ Извлечено merchant account (альтернативный способ)`)
  } else {
    merchantAccountValue = `0011qr.bakai.kg0101310116124207011832911213021233120008BAKAIAPP`
    console.log(`⚠️ Используется дефолтная структура merchant account`)
  }
}

// Извлекаем поле 59 (Merchant Name)
const field59Match = baseHash.match(/59(\d{2})(.+?)(?=54|63|$)/)
if (field59Match) {
  merchantName = field59Match[2]
  console.log(`✅ Извлечено merchant name: ${merchantName}`)
} else {
  console.log(`⚠️ Используется дефолтное merchant name: ${merchantName}`)
}

console.log()

// Конвертируем сумму в копейки
const amountCents = Math.round(amount * 100)
const amountStr = amountCents.toString()
const amountLen = amountStr.length.toString().padStart(2, '0')

console.log(`💵 Конвертация суммы:`)
console.log(`   ${amount} сом = ${amountCents} копеек`)
console.log(`   Строка суммы: ${amountStr} (длина: ${amountLen})`)
console.log()

// Формируем длины полей
const merchantAccountLen = merchantAccountValue.length.toString().padStart(2, '0')
const merchantNameLen = merchantName.length.toString().padStart(2, '0')

console.log(`📏 Длины полей:`)
console.log(`   Merchant Account: ${merchantAccountLen} (${merchantAccountValue.length})`)
console.log(`   Merchant Name: ${merchantNameLen} (${merchantName.length})`)
console.log(`   Amount: ${amountLen} (${amountStr.length})`)
console.log()

// Формируем payload БЕЗ контрольной суммы (поле 63)
const payload = (
  `000201` +  // 00 - Payload Format Indicator (версия 01)
  `010211` +  // 01 - Point of Initiation Method (11 = статический QR)
  `32${merchantAccountLen}${merchantAccountValue}` +  // 32 - Merchant Account
  `52046538` +  // 52 - Merchant Category Code (6538)
  `5303417` +   // 53 - Transaction Currency (417 = KGS)
  `59${merchantNameLen}${merchantName}` +  // 59 - Merchant Name
  `54${amountLen}${amountStr}`  // 54 - Amount (в копейках)
)

console.log(`📦 PAYLOAD СТРУКТУРА (без checksum):`)
console.log(`   00 (Version): 01`)
console.log(`   01 (Type): 11 (static)`)
console.log(`   32 (Merchant Account): length=${merchantAccountLen}, value=${merchantAccountValue.substring(0, 40)}...`)
console.log(`   52 (MCC): 6538`)
console.log(`   53 (Currency): 417 (KGS)`)
console.log(`   59 (Merchant Name): length=${merchantNameLen}, value=${merchantName}`)
console.log(`   54 (Amount): length=${amountLen}, value=${amountStr} (${amount} сом = ${amountCents} копеек)`)
console.log()
console.log(`📋 Полный payload: ${payload}`)
console.log()

// Вычисляем SHA256 контрольную сумму от payload (БЕЗ 6304)
const checksumFull = crypto.createHash('sha256').update(payload, 'utf8').digest('hex')
// Берем последние 4 символа в верхнем регистре
const checksum = checksumFull.slice(-4).toUpperCase()

console.log(`🔐 SHA-256 CHECKSUM:`)
console.log(`   Полный hash: ${checksumFull.substring(0, 20)}...${checksumFull.slice(-4)}`)
console.log(`   Последние 4 символа: ${checksum}`)
console.log()

// Полный QR хеш: payload + '6304' + checksum
const qrHash = payload + '6304' + checksum

console.log('='.repeat(80))
console.log('✅ QR КОД УСПЕШНО СГЕНЕРИРОВАН!')
console.log('='.repeat(80))
console.log()
console.log(`📱 QR HASH (полный):`)
console.log(qrHash)
console.log()
console.log(`🔗 ССЫЛКА ДЛЯ BAKAI:`)
console.log(`https://bakai24.app/#${qrHash}`)
console.log()
console.log(`📊 СТРУКТУРА QR HASH:`)
console.log(`   Начало: ${qrHash.substring(0, 50)}...`)
console.log(`   Конец: ...${qrHash.slice(-30)}`)
console.log(`   Длина: ${qrHash.length} символов`)
console.log()
console.log('='.repeat(80))













