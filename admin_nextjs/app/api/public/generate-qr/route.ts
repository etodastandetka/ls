import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createHash } from 'crypto'
import { 
  protectAPI, 
  rateLimit, 
  sanitizeInput, 
  containsSQLInjection,
  containsXSS,
  getClientIP 
} from '@/lib/security'

// Публичный эндпоинт для генерации QR кода (без авторизации)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    // 🛡️ МАКСИМАЛЬНАЯ ЗАЩИТА
    const protectionResult = protectAPI(request)
    if (protectionResult) return protectionResult

    // Rate limiting (строгий для публичного endpoint)
    const { SECURITY_CONFIG } = await import('@/config/app')
    const rateLimitResult = rateLimit({ 
      maxRequests: Math.floor(SECURITY_CONFIG.RATE_LIMIT_MAX_REQUESTS / 3), // Строже для публичного endpoint
      windowMs: SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS,
      keyGenerator: (req) => `generate_qr:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) {
      const errorResponse = NextResponse.json(
        { success: false, error: 'Rate limit exceeded' },
        { status: 429 }
      )
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }

    const body = await request.json()
    
    // 🛡️ Валидация и очистка всех входных данных
    const sanitizedBody = sanitizeInput(body)
    
    // Проверка на SQL инъекции и XSS
    const stringFields = [sanitizedBody.playerId, sanitizedBody.bank].filter(Boolean)
    for (const field of stringFields) {
      if (typeof field === 'string') {
        if (containsSQLInjection(field) || containsXSS(field)) {
          console.warn(`🚫 Security threat from ${getClientIP(request)}`)
          const errorResponse = NextResponse.json(
            { success: false, error: 'Invalid input detected' },
            { status: 400 }
          )
          errorResponse.headers.set('Access-Control-Allow-Origin', '*')
          return errorResponse
        }
      }
    }
    
    let amount = parseFloat(String(sanitizedBody.amount || 0))
    const playerId = sanitizedBody.playerId || ''
    const bank = sanitizedBody.bank || 'demirbank'
    
    // Валидация
    if (isNaN(amount) || amount <= 0) {
      const errorResponse = NextResponse.json(
        { success: false, error: 'Invalid amount' },
        { status: 400 }
      )
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }

    // 🔄 Автоматическая корректировка копеек для избежания конфликтов
    // ВАЖНО: Если сумма уже содержит копейки (от клиентского сайта), проверяем только на конфликт
    // Если копеек нет (от бота), генерируем их автоматически
    const hasCents = amount % 1 !== 0 // Проверяем, есть ли копейки (остаток от деления на 1)
    const MAX_ATTEMPTS = 10
    let adjustedAmount = amount
    let attempts = 0
    const originalAmount = amount
    
    while (attempts < MAX_ATTEMPTS) {
      // Проверяем, есть ли активная заявка с такой же суммой
      const existingRequest = await prisma.request.findFirst({
        where: {
          requestType: 'deposit',
          amount: adjustedAmount,
          status: {
            in: ['pending', 'processing', 'deferred'] // Активные статусы
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      })
      
      if (!existingRequest) {
        // Сумма свободна, используем её
        if (adjustedAmount !== originalAmount) {
          console.log(`✅ [Generate QR] Amount adjusted: ${originalAmount} → ${adjustedAmount} (to avoid conflict)`)
        }
        amount = adjustedAmount
        break
      }
      
      // Сумма занята
      // Если копейки уже были (от клиентского сайта), просто увеличиваем на 0.01
      // Если копеек не было (от бота), генерируем рандомные копейки
      attempts++
      if (hasCents) {
        // Копейки уже есть - просто увеличиваем на 0.01
        adjustedAmount = Math.round((adjustedAmount + 0.01) * 100) / 100
      } else {
        // Копеек не было - генерируем рандомные (от 0.01 до 0.99)
        const randomCents = Math.floor(Math.random() * 99) + 1
        adjustedAmount = Math.floor(originalAmount) + (randomCents / 100)
        console.log(`🎲 [Generate QR] Generated random cents: ${randomCents} (${originalAmount} → ${adjustedAmount})`)
      }
    }
    
    if (attempts >= MAX_ATTEMPTS) {
      console.warn(`⚠️ [Generate QR] Could not find free amount after ${MAX_ATTEMPTS} attempts, using last checked: ${adjustedAmount}`)
      amount = adjustedAmount
    }
    
    // Получаем активный реквизит с retry логикой и альтернативными способами
    let requisite = null
    let requisiteBank = null
    const maxRetries = 3
    let lastError: any = null
    
    // Способ 1: Пытаемся получить через findFirst (основной способ)
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const activeRequisite = await prisma.botRequisite.findFirst({
          where: { isActive: true }
        })
        if (activeRequisite) {
          requisite = activeRequisite.value
          requisiteBank = activeRequisite.bank
          console.log(`✅ Using active requisite: ${activeRequisite.name || `#${activeRequisite.id}`} - Bank: ${requisiteBank || 'N/A'} - ${requisite.slice(0, 4)}****${requisite.slice(-4)}`)
          break // Успешно получили реквизит, выходим из цикла
        } else {
          console.error(`❌ No active requisite found in database (attempt ${attempt}/${maxRetries})`)
          // Если реквизит не найден, это не временная ошибка, выходим
          break
        }
      } catch (error: any) {
        lastError = error
        const errorMessage = error?.message || String(error)
        const isConnectionError = errorMessage.includes('timeout') || 
                                  errorMessage.includes('ECONNREFUSED') ||
                                  errorMessage.includes('ETIMEDOUT') ||
                                  errorMessage.includes('Connection') ||
                                  errorMessage.includes('P1001') || // Prisma connection error
                                  errorMessage.includes('P1017')    // Prisma server closed connection
        
        console.error(`❌ Error fetching requisite (attempt ${attempt}/${maxRetries}):`, errorMessage)
        
        // Если это ошибка подключения и есть еще попытки, ждем и повторяем
        if (isConnectionError && attempt < maxRetries) {
          const delay = attempt * 200 // Экспоненциальная задержка: 200ms, 400ms, 600ms
          console.log(`⏳ Retrying in ${delay}ms...`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
        
        // Если это не ошибка подключения или закончились попытки, пробуем альтернативный способ
        break
      }
    }
    
    // Способ 2: Если основной способ не сработал, пробуем через findMany (альтернативный способ)
    if (!requisite) {
      console.log('🔄 Trying alternative method: findMany with filter...')
      try {
        const allRequisites = await prisma.botRequisite.findMany({
          where: { isActive: true },
          take: 1, // Берем только первый
          orderBy: { id: 'desc' } // Берем последний созданный
        })
        
        if (allRequisites.length > 0) {
          const activeRequisite = allRequisites[0]
          requisite = activeRequisite.value
          requisiteBank = activeRequisite.bank
          console.log(`✅ Using active requisite (alternative method): ${activeRequisite.name || `#${activeRequisite.id}`} - Bank: ${requisiteBank || 'N/A'} - ${requisite.slice(0, 4)}****${requisite.slice(-4)}`)
        } else {
          console.error('❌ No active requisite found using alternative method')
        }
      } catch (error: any) {
        console.error('❌ Alternative method also failed:', error?.message || String(error))
        lastError = error
      }
    }
    
    // Способ 3: Если и альтернативный способ не сработал, пробуем получить все и найти активный вручную
    if (!requisite) {
      console.log('🔄 Trying fallback method: findMany all and filter manually...')
      try {
        const allRequisites = await prisma.botRequisite.findMany({
          orderBy: { id: 'desc' },
          take: 10 // Берем последние 10 реквизитов
        })
        
        const activeRequisite = allRequisites.find(r => r.isActive === true)
        if (activeRequisite) {
          requisite = activeRequisite.value
          requisiteBank = activeRequisite.bank
          console.log(`✅ Using active requisite (fallback method): ${activeRequisite.name || `#${activeRequisite.id}`} - Bank: ${requisiteBank || 'N/A'} - ${requisite.slice(0, 4)}****${requisite.slice(-4)}`)
        } else {
          console.error('❌ No active requisite found using fallback method')
        }
      } catch (error: any) {
        console.error('❌ Fallback method also failed:', error?.message || String(error))
        lastError = error
      }
    }
    
    // Если не нашли реквизит после всех попыток, возвращаем ошибку на русском языке
    if (!requisite) {
      // Логируем детали ошибки для отладки
      if (lastError) {
        console.error('🔍 Detailed error info:', {
          message: lastError?.message,
          code: lastError?.code,
          meta: lastError?.meta,
          stack: lastError?.stack?.split('\n').slice(0, 3)
        })
      }
      
      // Проверяем, есть ли вообще реквизиты в базе (для диагностики)
      try {
        const count = await prisma.botRequisite.count()
        console.log(`📊 Total requisites in database: ${count}`)
        if (count > 0) {
          const anyRequisite = await prisma.botRequisite.findFirst()
          console.log(`📊 Sample requisite isActive status: ${anyRequisite?.isActive}`)
        }
      } catch (e) {
        console.error('❌ Could not check requisites count:', e)
      }
      
      const errorResponse = NextResponse.json(
        { 
          success: false, 
          error: 'Активный кошелек не настроен.',
          message: 'Обратитесь в поддержку.'
        },
        { status: 400 }
      )
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    let qrHash: string
    
    // Логируем для отладки
    console.log(`🔍 Processing QR generation - RequisiteBank: ${requisiteBank || 'null'}, Amount: ${amount}`)
    
    // Если банк кошелька Bakai, используем base_hash напрямую с обновлением суммы
    // Сравниваем без учета регистра
    if (requisiteBank && requisiteBank.toUpperCase() === 'BAKAI') {
      console.log('✅ Detected BAKAI bank, using base_hash update logic')
      // Проверяем, что base_hash не содержит данные DemirBank (это было бы ошибкой)
      if (requisite.includes('qr.demirbank.kg') || requisite.toUpperCase().includes('DEMIRBANK')) {
        const errorResponse = NextResponse.json(
          { success: false, error: 'Base_hash для Bakai содержит данные DemirBank. Проверьте настройки кошелька в админке.' },
          { status: 400 }
        )
        errorResponse.headers.set('Access-Control-Allow-Origin', '*')
        return errorResponse
      }
      
      // Для Bakai base_hash может быть любым валидным QR-кодом, поэтому проверяем только наличие полей 54 и 63
      
      // Конвертируем сумму в копейки
      const amountCents = Math.round(amount * 100)
      const amountStr = amountCents.toString()
      const amountLen = amountStr.length.toString().padStart(2, '0')
      
      // Находим последнее поле 54 перед полем 63 (контрольная сумма)
      const field54Pattern = /54(\d{2})(\d+)/g
      const field54Matches: Array<{ index: number; fullMatch: string }> = []
      let match54
      while ((match54 = field54Pattern.exec(requisite)) !== null) {
        field54Matches.push({
          index: match54.index,
          fullMatch: match54[0]
        })
      }
      
      console.log(`🔍 Found ${field54Matches.length} field 54 matches in base_hash`)
      
      if (field54Matches.length === 0) {
        const errorResponse = NextResponse.json(
          { success: false, error: 'Не найдено поле 54 в base_hash для Bakai' },
          { status: 400 }
        )
        errorResponse.headers.set('Access-Control-Allow-Origin', '*')
        return errorResponse
      }
      
      // Находим индекс последнего поля 63 (контрольная сумма) в исходном requisite
      const originalLast63Index = requisite.lastIndexOf('6304')
      if (originalLast63Index === -1) {
        const errorResponse = NextResponse.json(
          { success: false, error: 'Не найдено поле 63 в base_hash для Bakai' },
          { status: 400 }
        )
        errorResponse.headers.set('Access-Control-Allow-Origin', '*')
        return errorResponse
      }
      
      // Проверяем, что поле 63 действительно находится после всех полей 54
      const lastField54Index = field54Matches[field54Matches.length - 1].index
      if (originalLast63Index <= lastField54Index) {
        console.warn(`⚠️ Field 63 (index ${originalLast63Index}) is before last field 54 (index ${lastField54Index})`)
      }
      
      console.log(`🔍 Field 63 found at index ${originalLast63Index}`)
      console.log(`🔍 Last field 54 at index ${lastField54Index}, field 63 at index ${originalLast63Index}`)
      console.log(`🔍 Requisite structure: ...${requisite.substring(Math.max(0, lastField54Index - 10), originalLast63Index + 20)}...`)
      
      // Находим последнее поле 54 перед полем 63
      const lastField54Before63 = field54Matches
        .filter(m => m.index < originalLast63Index)
        .sort((a, b) => b.index - a.index)[0]
      
      if (!lastField54Before63) {
        const errorResponse = NextResponse.json(
          { success: false, error: 'Не найдено поле 54 перед полем 63 в base_hash для Bakai' },
          { status: 400 }
        )
        errorResponse.headers.set('Access-Control-Allow-Origin', '*')
        return errorResponse
      }
      
      console.log(`🔍 Last field 54 before 63: "${lastField54Before63.fullMatch}" at index ${lastField54Before63.index}`)
      console.log(`🔍 Requisite before update: ${requisite.substring(0, 50)}...${requisite.slice(-30)}`)
      
      // Заменяем последнее поле 54 на новое значение
      const oldField54 = lastField54Before63.fullMatch
      const newField54 = `54${amountLen}${amountStr}`
      
      console.log(`💰 Updating field 54: "${oldField54}" -> "${newField54}" (amount: ${amount}, cents: ${amountCents})`)
      console.log(`🔍 Old field 54 length: ${oldField54.length}, new field 54 length: ${newField54.length}`)
      
      // Заменяем последнее вхождение поля 54 (перед полем 63)
      const before54 = requisite.substring(0, lastField54Before63.index)
      const after54 = requisite.substring(lastField54Before63.index + oldField54.length)
      let updatedHash = before54 + newField54 + after54
      
      console.log(`🔍 Replacement details:`)
      console.log(`   Before 54: ...${before54.slice(-20)}`)
      console.log(`   New 54: ${newField54}`)
      console.log(`   After 54: ${after54.substring(0, 30)}...`)
      
      // 🔐 КРИТИЧНО: Пересчитываем индекс поля 63 после замены поля 54
      // Длина нового поля 54 может отличаться от старого, поэтому индекс 63 может сместиться
      const lengthDiff = newField54.length - oldField54.length
      const calculatedNew63Index = originalLast63Index + lengthDiff
      
      console.log(`🔍 Field 54 length change: ${oldField54.length} -> ${newField54.length} (diff: ${lengthDiff})`)
      console.log(`🔍 Field 63 calculated index: ${originalLast63Index} -> ${calculatedNew63Index}`)
      console.log(`🔍 Updated hash preview: ${updatedHash.substring(0, 50)}...${updatedHash.slice(-30)}`)
      
      // 🔐 КРИТИЧНО: Находим поле 63 в обновленном hash заново (не полагаемся только на расчет)
      // Ищем последнее вхождение "6304" в обновленном hash
      let newLast63Index = updatedHash.lastIndexOf('6304')
      
      // Если не нашли по последнему вхождению, пробуем найти по расчетному индексу
      if (newLast63Index === -1) {
        console.warn(`⚠️ Field 63 not found at last index, trying calculated index ${calculatedNew63Index}`)
        if (calculatedNew63Index >= 0 && calculatedNew63Index < updatedHash.length && 
            updatedHash.substring(calculatedNew63Index, calculatedNew63Index + 4) === '6304') {
          newLast63Index = calculatedNew63Index
          console.log(`✅ Field 63 found at calculated index ${newLast63Index}`)
        } else {
          // Пробуем найти любое вхождение 6304 после замены поля 54
          const all63Matches: number[] = []
          let searchIndex = 0
          while ((searchIndex = updatedHash.indexOf('6304', searchIndex)) !== -1) {
            all63Matches.push(searchIndex)
            searchIndex += 4
          }
          console.log(`🔍 All 6304 matches found: ${all63Matches.join(', ')}`)
          
          if (all63Matches.length === 0) {
            const errorResponse = NextResponse.json(
              { success: false, error: 'Ошибка: поле 63 не найдено после замены поля 54' },
              { status: 500 }
            )
            errorResponse.headers.set('Access-Control-Allow-Origin', '*')
            return errorResponse
          }
          
          // Используем последнее вхождение
          newLast63Index = all63Matches[all63Matches.length - 1]
          console.log(`✅ Using last 6304 match at index ${newLast63Index}`)
        }
      }
      
      // Проверяем, что поле 63 найдено и валидно
      if (newLast63Index === -1 || updatedHash.substring(newLast63Index, newLast63Index + 4) !== '6304') {
        const errorResponse = NextResponse.json(
          { success: false, error: 'Ошибка: поле 63 не найдено после замены поля 54' },
          { status: 500 }
        )
        errorResponse.headers.set('Access-Control-Allow-Origin', '*')
        return errorResponse
      }
      
      console.log(`✅ Field 63 confirmed at index ${newLast63Index} in updated hash`)
      
      // 🔐 КРИТИЧНО: Находим длину старого поля 63 (обычно 8 символов: 6304 + 4 hex)
      // Извлекаем старое поле 63 из исходного requisite для определения его длины
      const oldField63Match = requisite.substring(originalLast63Index).match(/^6304([0-9A-Fa-f]{4})/)
      const oldField63Length = oldField63Match ? oldField63Match[0].length : 8 // По умолчанию 8 символов
      
      // Сохраняем все что было после старого поля 63 в исходном requisite
      const dataAfterOld63 = requisite.substring(originalLast63Index + oldField63Length)
      
      console.log(`🔍 Old field 63 length: ${oldField63Length}, data after: "${dataAfterOld63.substring(0, 20)}..."`)
      
      // Извлекаем данные до последнего объекта 63 (ID "00" - "90", исключая ID 63)
      // ВАЖНО: Используем новый индекс после замены поля 54
      let dataBefore63 = updatedHash.substring(0, newLast63Index)
      
      // 🔐 КРИТИЧЕСКАЯ ПРОВЕРКА: Убеждаемся, что сумма (поле 54) включена в данные для hash
      if (!dataBefore63.includes(newField54)) {
        const errorResponse = NextResponse.json(
          { success: false, error: 'Ошибка: сумма не включена в данные для контрольной суммы' },
          { status: 500 }
        )
        errorResponse.headers.set('Access-Control-Allow-Origin', '*')
        return errorResponse
      }
      
      console.log(`🔍 Data before field 63 length: ${dataBefore63.length} chars`)
      console.log(`✅ Проверка: сумма (${newField54}) включена в данные для hash`)
      
      // 🔐 АЛГОРИТМ ФОРМИРОВАНИЯ КОНТРОЛЬНОЙ СУММЫ (поле 63):
      // 1. Все значения деталей платежа до объекта 63 (ID "00" - "90", исключая ID 63) 
      //    преобразуются в одну строку (уже есть в dataBefore63)
      // 2. Строка данных переводится в массив байт с кодировкой UTF-8
      // 3. Вычисляется хеш массива, используя алгоритм SHA256
      // 4. Массив байт преобразуется в строку (hex)
      // 5. Удаляются все символы "-", если они есть
      // 6. Из строки берутся последние 4 символа
      
      // Шаг 2: Декодируем процентное кодирование (%20 -> пробел и т.д.)
      // ВАЖНО: Процентное кодирование используется для символов, выходящих за пределы ASCII
      // Символы, которые НЕ кодируются: ":", "/", "?", "#", "[", "]", "@", "!", "$", "&", 
      // "'", " ", "(", ")", "*", "+", ",", ";", "=", ALPHA, DIGIT, HEXDIG, "-", ".", "_", "~"
      let decodedDataBefore63: string
      try {
        // Декодируем процентное кодирование (например, %20 -> пробел)
        decodedDataBefore63 = decodeURIComponent(dataBefore63)
        console.log(`🔍 Percent-encoded data decoded: ${dataBefore63.length} -> ${decodedDataBefore63.length} chars`)
      } catch (e: any) {
        // Если декодирование не удалось (невалидные последовательности), используем исходную строку
        console.warn(`⚠️ Could not decode URI component: ${e?.message}, using original string`)
        decodedDataBefore63 = dataBefore63
      }
      
      // Шаг 3: Вычисляем SHA256 хеш от массива байт UTF-8
      // createHash('sha256').update() автоматически конвертирует строку в UTF-8 байты
      // Сумма уже включена в decodedDataBefore63 через поле 54, поэтому hash защищает от изменения суммы
      const checksumFull = createHash('sha256').update(decodedDataBefore63, 'utf8').digest('hex')
      
      // Шаг 4: Массив байт уже преобразован в строку (hex) через .digest('hex')
      // Шаг 5: Удаляем все символы "-" если есть (хотя в hex их обычно нет)
      const checksumCleaned = checksumFull.replace(/-/g, '')
      
      // Шаг 6: Из строки берутся последние 4 символа (в верхнем регистре для hex)
      const checksum = checksumCleaned.slice(-4).toUpperCase()
      
      console.log(`🔐 SHA-256 checksum calculated:`)
      console.log(`   Full hash: ${checksumFull.substring(0, 20)}...${checksumFull.slice(-4)}`)
      console.log(`   After removing "-": ${checksumCleaned.substring(0, 20)}...${checksumCleaned.slice(-4)}`)
      console.log(`   Last 4 chars (checksum): ${checksum}`)
      
      // Заменяем последнее поле 63 (контрольная сумма) - формат: 6304 + 4 символа hex
      // Формат поля 63: ID "63" + длина "04" + значение (4 hex символа: буквы A-F и цифры 0-9)
      // ВАЖНО: Используем новый индекс после замены поля 54
      // 🔐 КРИТИЧНО: Сохраняем все что было после старого поля 63
      const newField63 = `6304${checksum}`
      
      // Проверяем, что checksum содержит только hex символы (0-9, A-F)
      if (!/^[0-9A-F]{4}$/.test(checksum)) {
        const errorResponse = NextResponse.json(
          { success: false, error: `Ошибка: невалидный checksum для поля 63: ${checksum}` },
          { status: 500 }
        )
        errorResponse.headers.set('Access-Control-Allow-Origin', '*')
        return errorResponse
      }
      
      qrHash = updatedHash.substring(0, newLast63Index) + newField63 + dataAfterOld63
      
      console.log(`✅ BAKAI QR hash generated successfully`)
      console.log(`   Old field 63: ${requisite.substring(originalLast63Index, originalLast63Index + oldField63Length)}`)
      console.log(`   New field 63: ${newField63} (ID: 63, Length: 04, Value: ${checksum})`)
      console.log(`   Data after field 63: "${dataAfterOld63.substring(0, 20)}${dataAfterOld63.length > 20 ? '...' : ''}"`)
      console.log(`   Final hash preview: ${qrHash.substring(0, 50)}...${qrHash.slice(-20)}`)
    } else {
      // Для Demir Bank используем существующую логику
      // Проверяем, что реквизит - это 16 цифр
      if (!/^\d{16}$/.test(requisite)) {
        const errorResponse = NextResponse.json(
          { success: false, error: 'Реквизит для Demir Bank должен содержать 16 цифр' },
          { status: 400 }
        )
        errorResponse.headers.set('Access-Control-Allow-Origin', '*')
        return errorResponse
      }
      
      // Конвертируем сумму в центы и форматируем
      const amountCents = Math.round(amount * 100)
      const amountStr = amountCents.toString().padStart(5, '0')
      const amountLen = amountStr.length.toString().padStart(2, '0')
      
      // Формируем TLV структуру
      const requisiteLen = requisite.length.toString().padStart(2, '0')
      
      const merchantAccountValue = (
        `0015qr.demirbank.kg` +  // Под-тег 00: домен
        `01047001` +              // Под-тег 01: короткий тип (7001)
        `10${requisiteLen}${requisite}` +  // Под-тег 10: реквизит
        `120211130212`            // Под-теги 12, 13: дополнительные поля
      )
      const merchantAccountLen = merchantAccountValue.length.toString().padStart(2, '0')
      
      // Payload БЕЗ контрольной суммы и без 6304
      // 🔐 ВАЖНО: Сумма (поле 54) включена в payload, поэтому hash защищает от изменения суммы
      const payload = (
        `000201` +  // 00 - Payload Format Indicator
        `010211` +  // 01 - Point of Initiation Method (статический QR)
        `32${merchantAccountLen}${merchantAccountValue}` +  // 32 - Merchant Account
        `52044829` +  // 52 - Merchant Category Code
        `5303417` +   // 53 - Transaction Currency
        `54${amountLen}${amountStr}` +  // 54 - Amount (СУММА ВКЛЮЧЕНА В HASH)
        `5909DEMIRBANK`  // 59 - Merchant Name
      )
      
      // 🔐 КРИТИЧЕСКАЯ ПРОВЕРКА: Убеждаемся, что сумма включена в payload
      const amountField = `54${amountLen}${amountStr}`
      if (!payload.includes(amountField)) {
        const errorResponse = NextResponse.json(
          { success: false, error: 'Ошибка: сумма не включена в payload для контрольной суммы' },
          { status: 500 }
        )
        errorResponse.headers.set('Access-Control-Allow-Origin', '*')
        return errorResponse
      }
      
      console.log(`✅ Проверка: сумма (${amountField}, ${amount} сом) включена в payload для hash`)
      
      // Вычисляем SHA256 контрольную сумму от payload (БЕЗ 6304)
      // Сумма уже включена в payload через поле 54, поэтому hash защищает от изменения суммы
      const checksumFull = createHash('sha256').update(payload, 'utf8').digest('hex')
      // Берем последние 4 символа в нижнем регистре
      const checksum = checksumFull.slice(-4).toLowerCase()
      
      console.log(`🔐 SHA-256 checksum calculated: ${checksumFull.substring(0, 20)}...${checksumFull.slice(-4)} (last 4: ${checksum})`)
      console.log(`🔒 Hash включает сумму ${amount} сом (${amountCents} копеек) - изменение суммы приведет к невалидному hash`)
      
      // Полный QR хеш: payload + '6304' + checksum
      // Hash защищает от изменения суммы, так как сумма включена в payload через поле 54
      qrHash = payload + '6304' + checksum
    }
    
    // Создаем ссылки для всех банков
    const bankLinks: Record<string, string> = {
      'DemirBank': `https://retail.demirbank.kg/#${qrHash}`,
      'O!Money': `https://api.dengi.o.kg/ru/qr/#${qrHash}`,
      'Balance.kg': `https://balance.kg/#${qrHash}`,
      'Bakai': `https://bakai24.app/#${qrHash}`,
      'MegaPay': `https://megapay.kg/get#${qrHash}`,
      'MBank': `https://app.mbank.kg/qr/#${qrHash}`,
      // Также добавляем варианты с нижним регистром для совместимости
      'demirbank': `https://retail.demirbank.kg/#${qrHash}`,
      'omoney': `https://api.dengi.o.kg/ru/qr/#${qrHash}`,
      'balance': `https://balance.kg/#${qrHash}`,
      'bakai': `https://bakai24.app/#${qrHash}`,
      'megapay': `https://megapay.kg/get#${qrHash}`,
      'mbank': `https://app.mbank.kg/qr/#${qrHash}`
    }
    
    // Получаем настройки депозитов для определения включенных банков
    let enabledBanks = ['demirbank', 'omoney', 'balance', 'bakai', 'megapay', 'mbank']
    try {
      const depositConfig = await prisma.botConfiguration.findFirst({
        where: { key: { in: ['deposits', 'deposit_settings'] } }
      })
      if (depositConfig) {
        const depositSettings = typeof depositConfig.value === 'string' 
          ? JSON.parse(depositConfig.value) 
          : depositConfig.value
        if (depositSettings?.banks && Array.isArray(depositSettings.banks)) {
          enabledBanks = depositSettings.banks
        }
      }
    } catch (error) {
      console.error('Error fetching deposit settings:', error)
    }
    
    // Определяем primary_url на основе переданного bank
    const primaryBankMap: Record<string, string> = {
      'demirbank': 'DemirBank',
      'omoney': 'O!Money',
      'balance': 'Balance.kg',
      'bakai': 'Bakai',
      'megapay': 'MegaPay',
      'mbank': 'MBank'
    }
    const primaryBank = primaryBankMap[bank.toLowerCase()] || 'DemirBank'
    const primaryUrl = bankLinks[primaryBank] || bankLinks['DemirBank']
    
    console.log(`✅ QR generation successful - Primary URL: ${primaryUrl.substring(0, 50)}...`)
    console.log(`✅ Bakai URL: ${bankLinks['Bakai']?.substring(0, 50)}...`)
    
    const response = NextResponse.json({
      success: true,
      qr_hash: qrHash,
      primary_url: primaryUrl,
      all_bank_urls: bankLinks,
      amount: amount, // Возвращаем скорректированную сумму с копейками
      settings: {
        enabled_banks: enabledBanks,
        deposits_enabled: true
      }
    })
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
    
  } catch (error: any) {
    console.error('Generate QR API error:', error)
    const errorResponse = NextResponse.json(
      { success: false, error: error.message || 'Failed to generate QR code' },
      { status: 500 }
    )
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    return errorResponse
  }
}

export const dynamic = 'force-dynamic'

