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

    // 🔄 ВСЕГДА генерируем случайные копейки, игнорируя копейки пользователя
    // Это защита от скама - пользователь не может передать точную сумму с копейками
    const baseAmount = Math.floor(amount) // Берем только целую часть, игнорируя копейки пользователя
    const MAX_ATTEMPTS = 10
    let adjustedAmount = amount
    let attempts = 0
    
    while (attempts < MAX_ATTEMPTS) {
      // Генерируем случайные копейки (от 1 до 99)
      const randomCents = Math.floor(Math.random() * 99) + 1
      adjustedAmount = baseAmount + (randomCents / 100)
      
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
        console.log(`🎲 [Generate QR] Generated random cents: ${randomCents} (${amount} → ${adjustedAmount})`)
        amount = adjustedAmount
        break
      }
      
      // Сумма занята, пробуем другую комбинацию копеек
      attempts++
    }
    
    if (attempts >= MAX_ATTEMPTS) {
      // Если не удалось найти свободную сумму, просто используем последнюю сгенерированную
      console.warn(`⚠️ [Generate QR] Could not find free amount after ${MAX_ATTEMPTS} attempts, using last generated: ${adjustedAmount}`)
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
    
    // Если банк кошелька Bakai, генерируем QR с нуля в формате Bakai
    // Сравниваем без учета регистра
    if (requisiteBank && requisiteBank.toUpperCase() === 'BAKAI') {
      console.log('✅ Detected BAKAI bank, generating QR from scratch using Bakai format')
      
      // Для Bakai requisite - это base_hash (шаблон), из которого извлекаем данные
      // Пример: 00020101021132460011qr.bakai.kg010131016124207011832911213021233120008BAKAIAPP5204653853034175908Ilyas%20T.54051005363044F76
      
      // Извлекаем данные из base_hash
      // 🔐 КРИТИЧНО: Длина в QR коде должна быть в байтах UTF-8 ПОСЛЕ декодирования процентного кодирования
      let merchantAccountValue = ''
      let merchantAccountLen = '46' // Дефолтная длина
      let merchantName = 'BAKAIAPP'
      let merchantNameLen = '08' // Дефолтная длина
      
      // Извлекаем поле 32 (Merchant Account Information) с длиной
      const field32Match = requisite.match(/^00020101021132(\d{2})(.+?)(?=52)/)
      if (field32Match) {
        // Используем длину из base_hash (она уже правильная - в байтах после декодирования)
        merchantAccountLen = field32Match[1]
        merchantAccountValue = field32Match[2] // Значение (может содержать процентное кодирование)
        console.log(`🔍 Extracted merchant account from base_hash: length=${merchantAccountLen}, value=${merchantAccountValue.substring(0, 50)}...`)
      } else {
        // Если не нашли, формируем из requisite (если это номер кошелька)
        if (/^\d+$/.test(requisite)) {
          // requisite - это номер кошелька, формируем merchant account
          const walletLen = requisite.length.toString().padStart(2, '0')
          merchantAccountValue = `0011qr.bakai.kg01013101${walletLen}${requisite}20008BAKAIAPP`
          // Декодируем и считаем байты для длины (на случай процентного кодирования)
          let decoded: string
          try {
            decoded = decodeURIComponent(merchantAccountValue)
          } catch (e) {
            decoded = merchantAccountValue
          }
          merchantAccountLen = Buffer.from(decoded, 'utf8').length.toString().padStart(2, '0')
        } else {
          // requisite - это base_hash, но не в ожидаемом формате, пробуем извлечь
          const alt32Match = requisite.match(/32(\d{2})(.+?)(?=52|53|54|59|63)/)
          if (alt32Match) {
            merchantAccountLen = alt32Match[1]
            merchantAccountValue = alt32Match[2]
          } else {
            // Используем дефолтную структуру
            merchantAccountValue = `0011qr.bakai.kg0101310116124207011832911213021233120008BAKAIAPP`
            let decoded: string
            try {
              decoded = decodeURIComponent(merchantAccountValue)
            } catch (e) {
              decoded = merchantAccountValue
            }
            merchantAccountLen = Buffer.from(decoded, 'utf8').length.toString().padStart(2, '0')
          }
        }
      }
      
      // Извлекаем поле 59 (Merchant Name) с длиной
      const field59Match = requisite.match(/59(\d{2})(.+?)(?=54|63|$)/)
      if (field59Match) {
        // Используем длину из base_hash (она уже правильная - в байтах после декодирования)
        merchantNameLen = field59Match[1]
        merchantName = field59Match[2] // Значение (может содержать процентное кодирование, например %20)
        console.log(`🔍 Extracted merchant name from base_hash: length=${merchantNameLen}, value=${merchantName}`)
      } else {
        // Для дефолтного merchant name декодируем и считаем байты
        let decoded: string
        try {
          decoded = decodeURIComponent(merchantName)
        } catch (e) {
          decoded = merchantName
        }
        merchantNameLen = Buffer.from(decoded, 'utf8').length.toString().padStart(2, '0')
      }
      
      // Конвертируем сумму в копейки
      const amountCents = Math.round(amount * 100)
      const amountStr = amountCents.toString()
      const amountLen = amountStr.length.toString().padStart(2, '0')
      
      // Формируем payload БЕЗ контрольной суммы (поле 63)
      const payload = (
        `000201` +  // 00 - Payload Format Indicator (версия 01)
        `010211` +  // 01 - Point of Initiation Method (11 = статический QR)
        `32${merchantAccountLen}${merchantAccountValue}` +  // 32 - Merchant Account
        `52046538` +  // 52 - Merchant Category Code (6538)
        `5303417` +   // 53 - Transaction Currency (417 = KGS)
        `59${merchantNameLen}${merchantName}` +  // 59 - Merchant Name (уже содержит %20 если нужно)
        `54${amountLen}${amountStr}`  // 54 - Amount (в копейках)
      )
      
      console.log(`📦 BAKAI Payload structure:`)
      console.log(`   00 (Version): 01`)
      console.log(`   01 (Type): 11 (static)`)
      console.log(`   32 (Merchant Account): length=${merchantAccountLen}, value=${merchantAccountValue.substring(0, 40)}...`)
      console.log(`   52 (MCC): 6538`)
      console.log(`   53 (Currency): 417 (KGS)`)
      console.log(`   59 (Merchant Name): length=${merchantNameLen}, value=${merchantName}`)
      console.log(`   54 (Amount): length=${amountLen}, value=${amountStr} (${amount} сом = ${amountCents} копеек)`)
      
      // Вычисляем SHA256 контрольную сумму от payload (БЕЗ 6304)
      const checksumFull = createHash('sha256').update(payload, 'utf8').digest('hex')
      // Берем последние 4 символа в верхнем регистре
      const checksum = checksumFull.slice(-4).toUpperCase()
      
      console.log(`🔐 SHA-256 checksum calculated: ${checksumFull.substring(0, 20)}...${checksumFull.slice(-4)} (last 4: ${checksum})`)
      
      // Полный QR хеш: payload + '6304' + checksum
      qrHash = payload + '6304' + checksum
      
      console.log(`✅ BAKAI QR hash generated successfully`)
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

