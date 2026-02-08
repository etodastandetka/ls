const crypto = require('crypto')

// Правильный base_hash
const baseHash = '00020101021132460011qr.bakai.kg010131016124207011832911213021233120008BAKAIAPP5204653853034175908Ilyas%20T.54051005363044F76'

// Извлекаем поле 32
const field32Match = baseHash.match(/^00020101021132(\d{2})(.+?)(?=52)/)
const merchantAccountValue = field32Match[2]
const merchantAccountLenInQR = field32Match[1]

console.log('Merchant Account из base_hash:')
console.log('  Длина в QR:', merchantAccountLenInQR)
console.log('  Значение:', merchantAccountValue)
console.log('  Фактическая длина:', merchantAccountValue.length)

// Декодируем
let merchantAccountDecoded
try {
  merchantAccountDecoded = decodeURIComponent(merchantAccountValue)
} catch (e) {
  merchantAccountDecoded = merchantAccountValue
}

console.log('  Декодированное:', merchantAccountDecoded)
console.log('  Длина декодированного:', merchantAccountDecoded.length)
console.log('  Длина в байтах UTF-8:', Buffer.from(merchantAccountDecoded, 'utf8').length)

// Извлекаем поле 59
const field59Match = baseHash.match(/59(\d{2})(.+?)(?=54|63|$)/)
const merchantName = field59Match[2]
const merchantNameLenInQR = field59Match[1]

console.log('\nMerchant Name из base_hash:')
console.log('  Длина в QR:', merchantNameLenInQR)
console.log('  Значение:', merchantName)
console.log('  Фактическая длина:', merchantName.length)

// Декодируем
let merchantNameDecoded
try {
  merchantNameDecoded = decodeURIComponent(merchantName)
} catch (e) {
  merchantNameDecoded = merchantName
}

console.log('  Декодированное:', merchantNameDecoded)
console.log('  Длина декодированного:', merchantNameDecoded.length)
console.log('  Длина в байтах UTF-8:', Buffer.from(merchantNameDecoded, 'utf8').length)

// Тест генерации для суммы 500.21
const amount = 500.21
const amountCents = Math.round(amount * 100)
const amountStr = amountCents.toString()
const amountLen = amountStr.length.toString().padStart(2, '0')

console.log('\n=== ГЕНЕРАЦИЯ ДЛЯ 500.21 ===')
console.log('Amount:', amountCents, 'копеек, длина:', amountLen)

// Используем правильные длины из base_hash
const merchantAccountLen = merchantAccountLenInQR // 46
const merchantNameLen = merchantNameLenInQR // 08

const payload = (
  `000201` +
  `010211` +
  `32${merchantAccountLen}${merchantAccountValue}` +
  `52046538` +
  `5303417` +
  `59${merchantNameLen}${merchantName}` +
  `54${amountLen}${amountStr}`
)

console.log('\nPayload:', payload)

// Checksum
const checksumFull = crypto.createHash('sha256').update(payload, 'utf8').digest('hex')
const checksum = checksumFull.slice(-4).toUpperCase()

const qrHash = payload + '6304' + checksum

console.log('\nQR Hash:', qrHash)
console.log('URL: https://bakai24.app/#' + qrHash)














