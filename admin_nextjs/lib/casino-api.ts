/**
 * API клиенты для получения балансов и лимитов платформ
 */

interface CashdeskConfig {
  hash: string
  cashierpass: string
  login: string
  cashdeskid: number
}

interface MostbetConfig {
  api_key: string
  secret: string
  cashpoint_id: string
}

interface BalanceResult {
  balance: number
  limit: number
}

// Конфигурация для API (из переменных окружения или дефолтные значения)
const CASHDESK_CONFIG: Record<string, CashdeskConfig> = {
  '1xbet': {
    hash: process.env['1XBET_HASH'] || '97f471a9db92debbda38201af67e15f64d086e94ae4b919d8a6a4f64958912cf',
    cashierpass: process.env['1XBET_CASHIERPASS'] || 'wiaWAfE9',
    login: process.env['1XBET_LOGIN'] || 'zhenishbAd',
    cashdeskid: parseInt(process.env['1XBET_CASHDESKID'] || '1388580'),
  },
  melbet: {
    hash: process.env.MELBET_HASH || 'f788cc308d9de930b292873b2cf79526da363cb24a85883575426cc7f3c4553d',
    cashierpass: process.env.MELBET_CASHIERPASS || '3nKS3!b7',
    login: process.env.MELBET_LOGIN || 'burgoevk',
    cashdeskid: parseInt(process.env.MELBET_CASHDESKID || '1415842'),
  },
  winwin: {
    hash: process.env.WINWIN_HASH || 'ca4c49cea830e2fbebf7e3894659df1cd74abb2e0e79d58b17ecf82ea148cf2d',
    cashierpass: process.env.WINWIN_CASHIERPASS || 'yYRbyQeX',
    login: process.env.WINWIN_LOGIN || 'burgoevkan',
    cashdeskid: parseInt(process.env.WINWIN_CASHDESKID || '1416579'),
  },
  '888starz': {
    hash: process.env['888STARZ_HASH'] || '6e978b90d2e3d7010390c680cf036b49e521bf91e32839021db8c3637f1cbc56',
    cashierpass: process.env['888STARZ_CASHIERPASS'] || 'ydsuHiK^',
    login: process.env['888STARZ_LOGIN'] || 'burgoevka',
    cashdeskid: parseInt(process.env['888STARZ_CASHDESKID'] || '1416358'),
  },
}

const MOSTBET_CONFIG: MostbetConfig = {
  api_key: process.env.MOSTBET_API_KEY || 'api-key:62e9da4c-52e3-4d0f-b579-c9e7805f711d',
  secret: process.env.MOSTBET_SECRET || '94f63f7e-b7ff-4ef9-bccc-d05efa22301d',
  cashpoint_id: process.env.MOSTBET_CASHPOINT_ID || 'C131864', // Полный cashpoint_id с буквой C
}

/**
 * Получение баланса и лимита через Cashdesk API (1xbet, Melbet, Winwin, 888starz)
 */
async function getCashdeskBalance(
  casino: '1xbet' | 'melbet' | 'winwin' | '888starz',
  cfg: CashdeskConfig
): Promise<BalanceResult> {
  try {
    const crypto = require('crypto')
    
    // Формируем дату в UTC в формате 'YYYY.MM.DD HH:MM:SS'
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const day = String(now.getUTCDate()).padStart(2, '0')
    const hours = String(now.getUTCHours()).padStart(2, '0')
    const minutes = String(now.getUTCMinutes()).padStart(2, '0')
    const seconds = String(now.getUTCSeconds()).padStart(2, '0')
    const formattedDt = `${year}.${month}.${day} ${hours}:${minutes}:${seconds}`

    // confirm = MD5(cashdeskid:hash) - одинаково для всех
    const confirmStr = `${cfg.cashdeskid}:${cfg.hash}`
    const confirm = crypto.createHash('md5').update(confirmStr).digest('hex')
    
    // Согласно документации для баланса:
    // 1. SHA256(hash={hash}&cashdeskid={cashdeskid}&dt={dt})
    // 2. MD5(dt={dt}&cashierpass={cashierpass}&cashdeskid={cashdeskid})
    // 3. SHA256(результаты 1 и 2 объединены)
    
    console.log(`[${casino} Balance] Config:`, {
      hash: cfg.hash,
      login: cfg.login,
      cashierpass: '***',
      cashdeskid: cfg.cashdeskid,
    })
    
    console.log(`[${casino} Balance] Confirm calculation: MD5(${cfg.cashdeskid}:${cfg.hash.substring(0, 20)}...) = ${confirm}`)

    // Подпись для баланса согласно документации CashdeskBotAPI пункт 1.1:
    // a. SHA256(hash={hash}&cashierpass={cashierpass}&dt={dt})
    // b. MD5(dt={dt}&cashierpass={cashierpass}&cashdeskid={cashdeskid})
    // c. SHA256(step1 + step2)
    const step1 = `hash=${cfg.hash}&cashierpass=${cfg.cashierpass}&dt=${formattedDt}`
    const sha1 = crypto.createHash('sha256').update(step1).digest('hex')

    // 2. MD5(dt={dt}&cashierpass={cashierpass}&cashdeskid={cashdeskid}) - одинаково для всех
    const step2 = `dt=${formattedDt}&cashierpass=${cfg.cashierpass}&cashdeskid=${cfg.cashdeskid}`
    const md5Hash = crypto.createHash('md5').update(step2).digest('hex')

    // 3. SHA256(результаты 1 и 2 объединены)
    const combined = sha1 + md5Hash
    const sign = crypto.createHash('sha256').update(combined).digest('hex')
    
    console.log(`[${casino} Balance] Signature calculation:`, {
      step1_full: step1,
      step1_hash: sha1,
      step2_full: step2,
      step2_hash: md5Hash,
      combined: combined.substring(0, 100) + '...',
      final_sign: sign,
    })

    const url = `https://partners.servcul.com/CashdeskBotAPI/Cashdesk/${cfg.cashdeskid}/Balance?confirm=${confirm}&dt=${encodeURIComponent(formattedDt)}`
    
    // Добавляем Basic Auth для всех букмекеров (включая 888starz)
    const authString = `${cfg.login}:${cfg.cashierpass}`
    const authBase64 = Buffer.from(authString).toString('base64')
    const authHeader = `Basic ${authBase64}`
    
    // Логируем данные для отладки (особенно для 888starz)
    if (casino === '888starz') {
      console.log(`🔍 [888starz Balance] Auth details:`, {
        login: cfg.login,
        cashierpass_length: cfg.cashierpass.length,
        cashierpass_preview: cfg.cashierpass.substring(0, 3) + '***',
        authString: `${cfg.login}:***`,
        authHeader_preview: authHeader.substring(0, 20) + '...',
      })
    }
    
    // Заголовки для запроса
    // Согласно документации: "ensure that the request headers include the generated signature sign"
    // Authorization нужен для всех букмекеров (включая 888starz)
    const headers: Record<string, string> = {
      'sign': sign, // Заголовок sign (с маленькой буквы) для всех букмекеров
      'Authorization': authHeader, // Basic Auth нужен для всех букмекеров
    }

    const logDetails: any = {
      url,
      confirm,
      dt: formattedDt,
      sign_preview: sign.substring(0, 20) + '...',
      step1: step1,
      step2: step2,
      sha1_preview: sha1.substring(0, 20) + '...',
      md5Hash_preview: md5Hash.substring(0, 20) + '...',
      headers: {
        sign: sign.substring(0, 20) + '...',
        Authorization: 'Basic ...',
      },
    }
    
    console.log(`[${casino} Balance] Request details:`, logDetails)

    const response = await fetch(url, { headers, method: 'GET' })

    if (response.ok) {
      const data = await response.json()
      console.log(`📊 ${casino} API response:`, JSON.stringify(data))
      
      // Проверяем, что данные есть и правильно парсим
      if (data) {
        // Парсим Balance (может быть строкой или числом)
        const balanceValue = data.Balance ?? data.balance ?? 0
        const balance = typeof balanceValue === 'string' ? parseFloat(balanceValue) : (typeof balanceValue === 'number' ? balanceValue : 0)
        
        // Парсим Limit (может быть строкой, числом или null)
        // ВАЖНО: Используем только Limit, Balance не нужен для лимитов
        const limitValue = data.Limit ?? data.limit ?? null
        const limit = limitValue === null || limitValue === undefined 
          ? 0 
          : (typeof limitValue === 'string' ? parseFloat(limitValue) : (typeof limitValue === 'number' ? limitValue : 0))
        
        console.log(`✅ ${casino}: Limit=${limit} (raw: Limit=${data.Limit})`)
        return {
          balance: isNaN(balance) ? 0 : balance,
          limit: isNaN(limit) ? 0 : limit,
        }
      }
    } else {
      console.error(`❌ ${casino} API error: ${response.status} ${response.statusText}`)
      const text = await response.text()
      console.error(`Response:`, text)
    }
  } catch (error) {
    console.error(`❌ Error getting ${casino} balance:`, error)
  }

  return { balance: 0, limit: 0 }
}

/**
 * Получение баланса через Mostbet API (лимит недоступен)
 */
async function getMostbetBalance(cfg: MostbetConfig): Promise<BalanceResult> {
  try {
    const crypto = require('crypto')

    // Получаем timestamp в UTC в формате YYYY-MM-DD HH:MM:SS (UTC+0)
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const day = String(now.getUTCDate()).padStart(2, '0')
    const hours = String(now.getUTCHours()).padStart(2, '0')
    const minutes = String(now.getUTCMinutes()).padStart(2, '0')
    const seconds = String(now.getUTCSeconds()).padStart(2, '0')
    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`

    // В URL всегда должны быть цифры (131864), без буквы C
    // Извлекаем числовую часть из cashpoint_id (например "C131864" -> "131864")
    let cashpointIdForUrl = String(cfg.cashpoint_id)
    const numericMatch = cashpointIdForUrl.match(/\d+/)
    if (numericMatch) {
      cashpointIdForUrl = numericMatch[0]
      console.log(`[Mostbet Balance] Using numeric cashpoint_id in URL: ${cfg.cashpoint_id} -> ${cashpointIdForUrl}`)
    }
    
    // Path для подписи и URL используем с числовым cashpoint_id (131864)
    const path = `/mbc/gateway/v1/api/cashpoint/${cashpointIdForUrl}/balance`
    const url = `https://apimb.com/mbc/gateway/v1/api/cashpoint/${cashpointIdForUrl}/balance`

    // API key может быть с префиксом или без
    const apiKeyFormatted = cfg.api_key.startsWith('api-key:') 
      ? cfg.api_key
      : `api-key:${cfg.api_key}`

    // Подпись: HMAC SHA3-256 от <API_KEY><PATH><REQUEST_BODY><TIMESTAMP>
    // Для GET запросов REQUEST_BODY пустой
    const signString = `${apiKeyFormatted}${path}${timestamp}`
    
    // Используем SHA3-256 согласно документации Mostbet API
    // В Node.js 18+ поддерживается sha3-256, но может называться по-разному
    let signature: string
    try {
      // Пробуем разные варианты названия алгоритма
      const algorithms = ['sha3-256', 'SHA3-256', 'sha3_256']
      let hmac: any = null
      
      for (const algo of algorithms) {
        try {
          hmac = crypto.createHmac(algo, cfg.secret)
          break
        } catch (e) {
          // Пробуем следующий вариант
          continue
        }
      }
      
      if (!hmac) {
        throw new Error('SHA3-256 not supported')
      }
      
      signature = hmac.update(signString).digest('hex')
      const usedAlgorithm = algorithms.find(a => {
        try {
          crypto.createHmac(a, cfg.secret)
          return true
        } catch {
          return false
        }
      })
      console.log(`[Mostbet Balance] Using SHA3-256 for signature, algorithm: ${usedAlgorithm}`)
      console.log(`[Mostbet Balance] Signature calculation:`, {
        secret_length: cfg.secret.length,
        signString_length: signString.length,
        signature_length: signature.length,
        signature_first_20: signature.substring(0, 20),
        signString_preview: signString.substring(0, 100) + '...'
      })
    } catch (e: any) {
      // Если SHA3-256 не поддерживается, используем библиотеку crypto-js или выводим ошибку
      console.error(`❌ SHA3-256 not available: ${e.message}`)
      console.error(`❌ Mostbet API requires SHA3-256. Please use Node.js 18+ or install crypto-js library.`)
      // Не используем SHA256 fallback - это не будет работать с реальным API
      throw new Error('SHA3-256 is required for Mostbet API but not available')
    }

    const headers = {
      'X-Api-Key': apiKeyFormatted,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'Accept': '*/*',
    }

    console.log(`[Mostbet Balance] Request details:`, {
      cashpoint_id_original: cfg.cashpoint_id,
      cashpoint_id_type: typeof cfg.cashpoint_id,
      cashpoint_id_for_url: cashpointIdForUrl,
      cashpoint_id_is_numeric: /^\d+$/.test(cashpointIdForUrl),
      api_key: cfg.api_key.substring(0, 40) + '...',
      secret: cfg.secret.substring(0, 10) + '...',
      url,
      path,
      timestamp,
      signString_full: signString, // Полная строка для подписи для отладки
      signature: `${signature.substring(0, 20)}...`,
      headers: {
        'X-Api-Key': cfg.api_key.substring(0, 30) + '...',
        'X-Timestamp': timestamp,
        'X-Signature': signature.substring(0, 20) + '...',
      }
    })

    const response = await fetch(url, { headers, method: 'GET' })

    console.log(`[Mostbet Balance] Response status: ${response.status} ${response.statusText}`)

    if (response.ok) {
      const data = await response.json()
      console.log(`📊 Mostbet API response:`, JSON.stringify(data))
      
      if (data) {
        // Парсим balance (может быть строкой или числом)
        // Согласно Django коду, API возвращает {'balance': float, 'currency': str}
        const balanceValue = data.balance ?? data.Balance ?? 0
        const balance = typeof balanceValue === 'string' ? parseFloat(balanceValue) : (typeof balanceValue === 'number' ? balanceValue : 0)
        
        // Лимит недоступен в Mostbet Cash API (согласно Django коду)
        const limit = 0
        
        console.log(`✅ Mostbet: Balance=${balance}, Currency=${data.currency || 'N/A'} (raw: ${JSON.stringify(data)})`)
        return {
          balance: isNaN(balance) ? 0 : balance,
          limit: 0, // Лимит недоступен в Mostbet Cash API
        }
      }
    } else {
      const text = await response.text()
      console.error(`❌ Mostbet API error: ${response.status} ${response.statusText}`)
      console.error(`Response body:`, text)
      
      // Пытаемся распарсить ошибку
      try {
        const errorData = JSON.parse(text)
        console.error(`Error details:`, errorData)
      } catch (e) {
        // Не JSON ответ
      }
    }
  } catch (error) {
    console.error('❌ Error getting Mostbet balance:', error)
  }

  return { balance: 0, limit: 0 }
}

/**
 * Получение лимита кассы 1win через попытку депозита
 * Делает депозит на большую сумму и парсит ошибку для получения баланса и лимита
 */
async function get1winLimit(apiKey: string): Promise<BalanceResult> {
  try {
    // Очищаем API ключ от пробелов (как в других функциях)
    const cleanApiKey = apiKey.trim()
    
    if (!cleanApiKey || cleanApiKey.length < 10) {
      throw new Error('Invalid 1win API key format')
    }
    
    // Тестовый ID и большая сумма для получения ошибки с лимитом
    const testUserId = 306751296
    const testAmount = 500000

    console.log(`[1win Limit] Making test deposit to get cash limit:`)
    console.log(`[1win Limit]   - User ID: ${testUserId}`)
    console.log(`[1win Limit]   - Amount: ${testAmount}`)
    console.log(`[1win Limit]   - API Key: ${cleanApiKey.substring(0, 20)}...`)
    console.log(`[1win Limit]   - API Key length: ${cleanApiKey.length} characters`)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    // Согласно документации: заголовок x-api-key (строчными)
    headers['x-api-key'] = cleanApiKey
    
    const response = await fetch('https://api.1win.win/v1/client/deposit', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId: testUserId,
        amount: testAmount,
      }),
    })

    const responseText = await response.text()
    console.log(`[1win Limit] Response status: ${response.status}, Response ok: ${response.ok}`)
    console.log(`[1win Limit] Response body:`, responseText.substring(0, 500))
    
    let data: any
    try {
      data = JSON.parse(responseText)
    } catch (e) {
      console.error(`[1win Limit] Failed to parse response:`, responseText)
      return { balance: 0, limit: 0 }
    }

    // Ожидаем ошибку с информацией о лимите
    if (response.ok) {
      console.warn(`[1win Limit] ⚠️ Deposit succeeded unexpectedly. This should not happen with such a large amount.`)
      return { balance: 0, limit: 0 }
    }

    // Парсим ошибку для получения баланса и лимита
    if (data.errorCode === 'CASH07' || data.errorMessage) {
      const errorMessage = data.errorMessage || data.message || ''
      console.log(`[1win Limit] Error message:`, errorMessage)

      // Парсим формат: "Cash limit exceeded: 22236.57 >= 5000000"
      const patterns = [
        /Cash limit exceeded:\s*([\d.]+)\s*>=\s*([\d.]+)/i,
        /limit exceeded:\s*([\d.]+)\s*>=\s*([\d.]+)/i,
        /([\d.]+)\s*>=\s*([\d.]+)/,
      ]

      for (const pattern of patterns) {
        const match = errorMessage.match(pattern)
        if (match && match.length >= 3) {
          const balance = parseFloat(match[1])
          const limit = parseFloat(match[2])
          
          if (!isNaN(balance) && !isNaN(limit) && limit > 0) {
            console.log(`[1win Limit] ✅ Parsed: balance=${balance}, limit=${limit}`)
            return { balance, limit }
          }
        }
      }

      console.error(`[1win Limit] ❌ Could not parse balance and limit from error message:`, errorMessage)
    }

    return { balance: 0, limit: 0 }
  } catch (error: any) {
    console.error(`[1win Limit] ❌ Error:`, error.message)
    return { balance: 0, limit: 0 }
  }
}

// Кэш для лимитов платформ (30 секунд)
let platformLimitsCache: {
  data: Array<{ key: string; name: string; limit: number; balance?: number }>
  timestamp: number
} | null = null

const PLATFORM_LIMITS_CACHE_TTL = 30 * 1000 // 30 секунд

/**
 * Получение лимитов всех платформ (с кэшированием)
 */
export async function getPlatformLimits(): Promise<
  Array<{ key: string; name: string; limit: number; balance?: number }>
> {
  // Проверяем кэш
  if (platformLimitsCache && Date.now() - platformLimitsCache.timestamp < PLATFORM_LIMITS_CACHE_TTL) {
    console.log('📊 Using cached platform limits')
    return platformLimitsCache.data
  }

  const limits: Array<{ key: string; name: string; limit: number; balance?: number }> = []

  try {
    // Импортируем prisma для получения конфигурации из БД
    const { prisma } = await import('./prisma')

    // 1xbet - использует Cashdesk API (как Melbet, Winwin)
    let xbetCfg: CashdeskConfig | null = null
    
    const xbetSetting = await prisma.botConfiguration.findFirst({
      where: { key: '1xbet_api_config' },
    })

    if (xbetSetting) {
      const config = typeof xbetSetting.value === 'string' ? JSON.parse(xbetSetting.value) : xbetSetting.value
      if (config.hash && config.cashierpass && config.login && config.cashdeskid) {
        xbetCfg = {
          hash: config.hash,
          cashierpass: config.cashierpass,
          login: config.login,
          cashdeskid: parseInt(String(config.cashdeskid)),
        }
        console.log(`[1xbet Limits] Using config from database: cashdeskid=${xbetCfg.cashdeskid}, login=${xbetCfg.login}`)
      }
    }

    if (!xbetCfg) {
      xbetCfg = CASHDESK_CONFIG['1xbet']
      console.log(`[1xbet Limits] Using default config from env: cashdeskid=${xbetCfg.cashdeskid}`)
    }

    if (xbetCfg && xbetCfg.cashdeskid > 0) {
      const xbetBal = await getCashdeskBalance('1xbet', xbetCfg)
      console.log(`📊 1xbet result: balance=${xbetBal.balance}, limit=${xbetBal.limit}`)
      limits.push({ key: '1xbet', name: '1xbet', limit: xbetBal.limit, balance: xbetBal.balance })
    } else {
      limits.push({ key: '1xbet', name: '1xbet', limit: 0, balance: 0 })
    }

    // 888starz - использует Cashdesk API, получаем конфигурацию из БД
    let starzCfg: CashdeskConfig | null = null
    
    // Сначала пробуем получить из БД
    const starzSetting = await prisma.botConfiguration.findFirst({
      where: { key: '888starz_api_config' },
    })

    if (starzSetting) {
      const config = typeof starzSetting.value === 'string' ? JSON.parse(starzSetting.value) : starzSetting.value
      if (config.hash && config.cashierpass && config.login && config.cashdeskid) {
        starzCfg = {
          hash: config.hash,
          cashierpass: config.cashierpass,
          login: config.login,
          cashdeskid: parseInt(String(config.cashdeskid)),
        }
      }
    }

    // Если не нашли в БД, используем переменные окружения
    if (!starzCfg) {
      starzCfg = CASHDESK_CONFIG['888starz']
    }

    if (starzCfg && starzCfg.cashdeskid > 0) {
      console.log(`🔍 [888starz] Using config:`, {
        hash: starzCfg.hash?.substring(0, 20) + '...',
        login: starzCfg.login,
        cashdeskid: starzCfg.cashdeskid,
        cashierpass_length: starzCfg.cashierpass?.length || 0,
        source: starzSetting ? 'database' : 'env'
      })
      const starzBal = await getCashdeskBalance('888starz', starzCfg)
      console.log(`📊 888starz result: balance=${starzBal.balance}, limit=${starzBal.limit}`)
      limits.push({ key: '888starz', name: '888starz', limit: starzBal.limit, balance: starzBal.balance })
    } else {
      console.log(`⚠️ [888starz] Config not found or invalid:`, { starzCfg, hasSetting: !!starzSetting })
      limits.push({ key: '888starz', name: '888starz', limit: 0, balance: 0 })
    }

    // Melbet - получаем конфигурацию из БД
    let melbetCfg: CashdeskConfig | null = null
    
    const melbetSetting = await prisma.botConfiguration.findFirst({
      where: { key: 'melbet_api_config' },
    })

    if (melbetSetting) {
      const config = typeof melbetSetting.value === 'string' ? JSON.parse(melbetSetting.value) : melbetSetting.value
      if (config.hash && config.cashierpass && config.login && config.cashdeskid) {
        melbetCfg = {
          hash: config.hash,
          cashierpass: config.cashierpass,
          login: config.login,
          cashdeskid: parseInt(String(config.cashdeskid)),
        }
      }
    }

    if (!melbetCfg) {
      melbetCfg = CASHDESK_CONFIG.melbet
    }

    if (melbetCfg && melbetCfg.cashdeskid > 0) {
      const melbetBal = await getCashdeskBalance('melbet', melbetCfg)
      console.log(`📊 Melbet result: balance=${melbetBal.balance}, limit=${melbetBal.limit}`)
      limits.push({ key: 'melbet', name: 'Melbet', limit: melbetBal.limit, balance: melbetBal.balance })
    } else {
      limits.push({ key: 'melbet', name: 'Melbet', limit: 0, balance: 0 })
    }

    // 1WIN - получаем лимит через попытку депозита
    let onewinApiKey: string | undefined
    const onewinSetting = await prisma.botConfiguration.findFirst({
      where: { key: '1win_api_config' },
    })

    console.log(`[1win Limit] Checking API key configuration...`)
    console.log(`[1win Limit] Database setting found: ${!!onewinSetting}`)

    if (onewinSetting) {
      const config = typeof onewinSetting.value === 'string' ? JSON.parse(onewinSetting.value) : onewinSetting.value
      onewinApiKey = config.api_key ? config.api_key.trim() : undefined
      console.log(`[1win Limit] API key from DB: ${onewinApiKey ? onewinApiKey.substring(0, 20) + '...' : 'not found'}`)
    }

    if (!onewinApiKey) {
      const envKey = process.env.ONEWIN_API_KEY || process.env['1WIN_API_KEY'] || ''
      onewinApiKey = envKey ? envKey.trim() : undefined
      console.log(`[1win Limit] API key from env: ${onewinApiKey ? onewinApiKey.substring(0, 20) + '...' : 'not found'}`)
    }

    if (onewinApiKey && onewinApiKey.trim() !== '') {
      console.log(`[1win Limit] ✅ API key found, calling get1winLimit...`)
      try {
        const onewinLimit = await get1winLimit(onewinApiKey.trim())
        console.log(`📊 1win result: balance=${onewinLimit.balance}, limit=${onewinLimit.limit}`)
        limits.push({ 
          key: '1win', 
          name: '1WIN', 
          limit: onewinLimit.limit,
          balance: onewinLimit.balance 
        })
      } catch (error: any) {
        console.error(`[1win Limit] ❌ Error calling get1winLimit:`, error.message)
        limits.push({ key: '1win', name: '1WIN', limit: 0, balance: 0 })
      }
    } else {
      console.warn(`[1win Limit] ⚠️ 1win API key not configured`)
      limits.push({ key: '1win', name: '1WIN', limit: 0, balance: 0 })
    }

    // Winwin - получаем конфигурацию из БД
    let winwinCfg: CashdeskConfig | null = null
    
    const winwinSetting = await prisma.botConfiguration.findFirst({
      where: { key: 'winwin_api_config' },
    })

    if (winwinSetting) {
      const config = typeof winwinSetting.value === 'string' ? JSON.parse(winwinSetting.value) : winwinSetting.value
      if (config.hash && config.cashierpass && config.login && config.cashdeskid) {
        winwinCfg = {
          hash: config.hash,
          cashierpass: config.cashierpass,
          login: config.login,
          cashdeskid: parseInt(String(config.cashdeskid)),
        }
      }
    }

    if (!winwinCfg) {
      winwinCfg = CASHDESK_CONFIG.winwin
    }

    if (winwinCfg && winwinCfg.cashdeskid > 0) {
      const winwinBal = await getCashdeskBalance('winwin', winwinCfg)
      console.log(`📊 Winwin result: balance=${winwinBal.balance}, limit=${winwinBal.limit}`)
      limits.push({ key: 'winwin', name: 'Winwin', limit: winwinBal.limit, balance: winwinBal.balance })
    } else {
      limits.push({ key: 'winwin', name: 'Winwin', limit: 0, balance: 0 })
    }

    // Mostbet
    const mostbetCfg = MOSTBET_CONFIG
    if (mostbetCfg.cashpoint_id && mostbetCfg.cashpoint_id.length > 0) {
      const mostbetBal = await getMostbetBalance(mostbetCfg)
      // Для Mostbet лимит недоступен в API, показываем баланс вместо лимита
      console.log(`📊 Mostbet result: balance=${mostbetBal.balance}, limit=${mostbetBal.limit}`)
      limits.push({ key: 'mostbet', name: 'Mostbet', limit: mostbetBal.balance, balance: mostbetBal.balance })
    } else {
      limits.push({ key: 'mostbet', name: 'Mostbet', limit: 0, balance: 0 })
    }
  } catch (error) {
    console.error('Error getting platform limits:', error)
    // Возвращаем значения по умолчанию при ошибке
    // Для 1xbet используем -1 (недоступно), для остальных - 0
    const defaultLimits = [
      { key: '1xbet', name: '1xbet', limit: 0, balance: 0 },
      { key: '888starz', name: '888starz', limit: 0, balance: 0 },
      { key: 'melbet', name: 'Melbet', limit: 0, balance: 0 },
      { key: '1win', name: '1WIN', limit: 0, balance: 0 },
      { key: 'mostbet', name: 'Mostbet', limit: 0, balance: 0 },
    ]
    // Кэшируем даже ошибки на короткое время, чтобы не спамить API
    platformLimitsCache = {
      data: defaultLimits,
      timestamp: Date.now(),
    }
    return defaultLimits
  }

  // Сохраняем в кэш
  platformLimitsCache = {
    data: limits,
    timestamp: Date.now(),
  }

  return limits
}

interface PlayerCheckResult {
  exists: boolean
  firstName?: string | null
  lastName?: string | null
  name?: string | null  // Полное имя (firstName + lastName) для обратной совместимости
  currencyId?: number | null
  userId?: number
}

/**
 * Проверка существования игрока через Cashdesk API (метод "Поиск игрока")
 * Поддерживается только для букмекеров с Cashdesk API: 1xbet, melbet, winwin, 888starz
 * Для mostbet и 1win проверка недоступна
 */
export async function checkPlayerExists(
  casino: '1xbet' | 'melbet' | 'winwin' | '888starz',
  userId: string,
  cfg: CashdeskConfig
): Promise<PlayerCheckResult> {
  try {
    const crypto = require('crypto')
    
    console.log(`[${casino} Check Player] Checking user ID: ${userId}`)
    console.log(`[${casino} Check Player] Config:`, {
      hash: cfg.hash?.substring(0, 20) + '...',
      login: cfg.login,
      cashdeskid: cfg.cashdeskid,
      cashierpass: '***',
    })

    // Согласно документации CashdeskBotAPI пункт 2.1:
    // a. SHA256(hash={hash}&userid={userid}&cashdeskid={cashdeskid})
    // b. MD5(userid={userid}&cashierpass={cashierpass}&hash={hash})
    // c. SHA256(результаты 1 и 2 объединены)
    
    const step1 = `hash=${cfg.hash}&userid=${userId}&cashdeskid=${cfg.cashdeskid}`
    const sha1 = crypto.createHash('sha256').update(step1).digest('hex')

    const step2 = `userid=${userId}&cashierpass=${cfg.cashierpass}&hash=${cfg.hash}`
    const md5Hash = crypto.createHash('md5').update(step2).digest('hex')

    const combined = sha1 + md5Hash
    const sign = crypto.createHash('sha256').update(combined).digest('hex')

    // Согласно документации пункт 2.2: confirm = MD5(userId:hash)
    const confirmStr = `${userId}:${cfg.hash}`
    const confirm = crypto.createHash('md5').update(confirmStr).digest('hex')

    const url = `https://partners.servcul.com/CashdeskBotAPI/Users/${userId}?confirm=${confirm}&cashdeskId=${cfg.cashdeskid}`
    
    // Basic Auth
    const authString = `${cfg.login}:${cfg.cashierpass}`
    const authBase64 = Buffer.from(authString).toString('base64')
    const authHeader = `Basic ${authBase64}`
    
    const headers: Record<string, string> = {
      'sign': sign,
      'Authorization': authHeader,
    }

    console.log(`[${casino} Check Player] Request:`, {
      url,
      confirm,
      sign_preview: sign.substring(0, 20) + '...',
    })

    const response = await fetch(url, { headers, method: 'GET' })

    if (response.ok) {
      const data = await response.json()
      console.log(`[${casino} Check Player] API response:`, data)
      
      // Проверяем, что userId существует и не равен 0 (0 означает, что игрок не найден)
      const userId = data.userId ?? data.UserId ?? 0
      
      // Также проверяем наличие имени или фамилии - если они есть, игрок найден
      const firstName = data.firstName ?? data.FirstName ?? data.first_name ?? data.First_Name ?? null
      const lastName = data.lastName ?? data.LastName ?? data.last_name ?? data.Last_Name ?? null
      const fullName = data.name ?? data.Name ?? null
      
      if (userId && userId !== 0) {
        // Игрок найден - userId валидный
        const name = fullName || (firstName && lastName ? `${firstName} ${lastName}`.trim() : firstName || lastName || null)
        console.log(`[${casino} Check Player] ✅ Player exists:`, { userId, firstName, lastName, name, currencyId: data.currencyId ?? data.CurrencyId })
        return {
          exists: true,
          userId: userId,
          firstName: firstName || null,
          lastName: lastName || null,
          name: name,
          currencyId: data.currencyId ?? data.CurrencyId ?? null,
        }
      } else if (firstName || lastName || fullName) {
        // Игрок найден - есть имя/фамилия, но userId = 0 (возможно, API возвращает так)
        const name = fullName || (firstName && lastName ? `${firstName} ${lastName}`.trim() : firstName || lastName || null)
        console.log(`[${casino} Check Player] ✅ Player exists (by name):`, { firstName, lastName, name, currencyId: data.currencyId ?? data.CurrencyId })
        return {
          exists: true,
          userId: userId || undefined,
          firstName: firstName || null,
          lastName: lastName || null,
          name: name,
          currencyId: data.currencyId ?? data.CurrencyId ?? null,
        }
      } else {
        console.log(`[${casino} Check Player] ❌ Player not found (UserId is 0 and no name)`)
        return { exists: false }
      }
    } else if (response.status === 404) {
      console.log(`[${casino} Check Player] ❌ Player not found (404)`)
      return { exists: false }
    } else {
      const errorText = await response.text()
      console.error(`[${casino} Check Player] ❌ API error: ${response.status} ${response.statusText}`, errorText)
      // При ошибке считаем, что игрок не найден
      return { exists: false }
    }
  } catch (error: any) {
    console.error(`[${casino} Check Player] ❌ Error:`, error.message)
    return { exists: false }
  }
}

