const correct = '00020101021132460011qr.bakai.kg010131016124207011832911213021233120008BAKAIAPP5204653853034175908Ilyas%20T.54051005363044F76'
const mine = '00020101021132620011qr.bakai.kg010131016124207011832911213021233120008BAKAIAPP5204653853034175910Ilyas%20T.5405500216304587E'

console.log('=== АНАЛИЗ ПРАВИЛЬНОГО QR ===')
const field32Correct = correct.match(/32(\d{2})(.+?)(?=52)/)
const field59Correct = correct.match(/59(\d{2})(.+?)(?=54)/)
const field54Correct = correct.match(/54(\d{2})(.+?)(?=63)/)

console.log('Field 32 (Merchant Account):')
console.log('  Длина в QR:', field32Correct[1])
console.log('  Значение:', field32Correct[2])
console.log('  Фактическая длина строки:', field32Correct[2].length)
console.log('  Декодированное:', decodeURIComponent(field32Correct[2]))
console.log('  Длина декодированного:', decodeURIComponent(field32Correct[2]).length)

console.log('\nField 59 (Merchant Name):')
console.log('  Длина в QR:', field59Correct[1])
console.log('  Значение:', field59Correct[2])
console.log('  Фактическая длина строки:', field59Correct[2].length)
console.log('  Декодированное:', decodeURIComponent(field59Correct[2]))
console.log('  Длина декодированного:', decodeURIComponent(field59Correct[2]).length)

console.log('\nField 54 (Amount):')
console.log('  Длина в QR:', field54Correct[1])
console.log('  Значение:', field54Correct[2])

console.log('\n=== АНАЛИЗ МОЕГО QR ===')
const field32Mine = mine.match(/32(\d{2})(.+?)(?=52)/)
const field59Mine = mine.match(/59(\d{2})(.+?)(?=54)/)
const field54Mine = mine.match(/54(\d{2})(.+?)(?=63)/)

console.log('Field 32 (Merchant Account):')
console.log('  Длина в QR:', field32Mine[1])
console.log('  Значение:', field32Mine[2])
console.log('  Фактическая длина строки:', field32Mine[2].length)

console.log('\nField 59 (Merchant Name):')
console.log('  Длина в QR:', field59Mine[1])
console.log('  Значение:', field59Mine[2])
console.log('  Фактическая длина строки:', field59Mine[2].length)

console.log('\n=== ПРОБЛЕМА ===')
console.log('Merchant Account:')
console.log('  Правильная длина:', field32Correct[1], 'vs Моя:', field32Mine[1])
console.log('  Правильное значение:', field32Correct[2])
console.log('  Мое значение:', field32Mine[2])
console.log('  Совпадают?', field32Correct[2] === field32Mine[2])

console.log('\nMerchant Name:')
console.log('  Правильная длина:', field59Correct[1], 'vs Моя:', field59Mine[1])
console.log('  Правильное значение:', field59Correct[2])
console.log('  Мое значение:', field59Mine[2])
console.log('  Совпадают?', field59Correct[2] === field59Mine[2])














