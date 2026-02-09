const correct = '00020101021132460011qr.bakai.kg010131016124207011832911213021233120008BAKAIAPP5204653853034175908Ilyas%20T.54051005363044F76'

// Разбираем по полям
console.log('=== РАЗБОР ПРАВИЛЬНОГО QR ===\n')

// Поле 00 - Версия
const field00 = correct.match(/^00(\d{2})(.+?)(?=01)/)
console.log('00 (Version):', field00 ? field00[2] : 'не найдено')

// Поле 01 - Тип
const field01 = correct.match(/01(\d{2})(.+?)(?=32)/)
console.log('01 (Type):', field01 ? field01[2] : 'не найдено')

// Поле 32 - Merchant Account
const field32 = correct.match(/32(\d{2})(.+?)(?=52)/)
if (field32) {
  const len = field32[1]
  const value = field32[2]
  console.log('\n32 (Merchant Account):')
  console.log('  Длина в QR:', len)
  console.log('  Значение:', value)
  console.log('  Фактическая длина строки:', value.length)
  
  // Пробуем декодировать
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch (e) {
    decoded = value
  }
  console.log('  Декодированное:', decoded)
  console.log('  Длина декодированного:', decoded.length)
  console.log('  Длина в байтах UTF-8:', Buffer.from(decoded, 'utf8').length)
  
  // Проверяем, есть ли процентное кодирование
  const hasPercent = value.includes('%')
  console.log('  Содержит %:', hasPercent)
  if (hasPercent) {
    const percentMatches = value.match(/%[0-9A-Fa-f]{2}/g)
    console.log('  Процентные последовательности:', percentMatches)
  }
}

// Поле 52 - MCC
const field52 = correct.match(/52(\d{2})(.+?)(?=53)/)
console.log('\n52 (MCC):', field52 ? field52[2] : 'не найдено')

// Поле 53 - Currency
const field53 = correct.match(/53(\d{2})(.+?)(?=59)/)
console.log('53 (Currency):', field53 ? field53[2] : 'не найдено')

// Поле 59 - Merchant Name
const field59 = correct.match(/59(\d{2})(.+?)(?=54)/)
if (field59) {
  const len = field59[1]
  const value = field59[2]
  console.log('\n59 (Merchant Name):')
  console.log('  Длина в QR:', len)
  console.log('  Значение:', value)
  console.log('  Фактическая длина строки:', value.length)
  
  // Декодируем
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch (e) {
    decoded = value
  }
  console.log('  Декодированное:', decoded)
  console.log('  Длина декодированного:', decoded.length)
  console.log('  Длина в байтах UTF-8:', Buffer.from(decoded, 'utf8').length)
}

// Поле 54 - Amount
const field54 = correct.match(/54(\d{2})(.+?)(?=63)/)
if (field54) {
  console.log('\n54 (Amount):')
  console.log('  Длина в QR:', field54[1])
  console.log('  Значение:', field54[2])
}

// Поле 63 - Checksum
const field63 = correct.match(/63(\d{2})(.+?)$/)
if (field63) {
  console.log('\n63 (Checksum):')
  console.log('  Длина в QR:', field63[1])
  console.log('  Значение:', field63[2])
}

// Проверяем payload для checksum
const payloadEnd = correct.lastIndexOf('63')
const payload = correct.substring(0, payloadEnd)
console.log('\n=== PAYLOAD ДЛЯ CHECKSUM ===')
console.log('Payload (до 63):', payload)
console.log('Длина payload:', payload.length)















