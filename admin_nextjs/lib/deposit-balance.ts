import { prisma } from './prisma'
import { depositCashdeskAPI, depositMostbetAPI, depositMobCashAPI } from './casino-deposit'
import { getMobCashConfigFromTokens } from './mobcash-tokens'

// Функция для получения конфигурации API букмекера из настроек
export async function getCasinoConfig(bookmaker: string) {
  const normalizedBookmaker = bookmaker?.toLowerCase() || ''
  
  // 1xbet использует Cashdesk API (как Melbet, Winwin)
  if (normalizedBookmaker.includes('1xbet') || normalizedBookmaker === '1xbet' || normalizedBookmaker.includes('xbet')) {
    const setting = await prisma.botConfiguration.findFirst({
      where: { key: '1xbet_api_config' },
    })

    if (setting) {
      const config = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
      if (config.hash && config.cashierpass && config.login && config.cashdeskid) {
        return {
          hash: config.hash,
          cashierpass: config.cashierpass,
          login: config.login,
          cashdeskid: String(config.cashdeskid),
        }
      }
    }

    return {
      hash: process.env['1XBET_HASH'] || '97f471a9db92debbda38201af67e15f64d086e94ae4b919d8a6a4f64958912cf',
      cashierpass: process.env['1XBET_CASHIERPASS'] || 'wiaWAfE9',
      login: process.env['1XBET_LOGIN'] || 'zhenishbAd',
      cashdeskid: process.env['1XBET_CASHDESKID'] || '1388580',
    }
  }
  
  // Для Melbet нужны: hash, cashierpass, login, cashdeskid
  if (normalizedBookmaker.includes('melbet') || normalizedBookmaker === 'melbet') {
    const setting = await prisma.botConfiguration.findFirst({
      where: { key: 'melbet_api_config' },
    })

    if (setting) {
      const config = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
      if (config.hash && config.cashierpass && config.login && config.cashdeskid) {
        return {
          hash: config.hash,
          cashierpass: config.cashierpass,
          login: config.login,
          cashdeskid: String(config.cashdeskid),
        }
      }
    }

    return {
      hash: process.env.MELBET_HASH || 'f788cc308d9de930b292873b2cf79526da363cb24a85883575426cc7f3c4553d',
      cashierpass: process.env.MELBET_CASHIERPASS || '3nKS3!b7',
      login: process.env.MELBET_LOGIN || 'burgoevk',
      cashdeskid: process.env.MELBET_CASHDESKID || '1415842',
    }
  }
  
  if (normalizedBookmaker.includes('winwin')) {
    const setting = await prisma.botConfiguration.findFirst({
      where: { key: 'winwin_api_config' },
    })

    if (setting) {
      const config = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
      if (config.hash && config.cashierpass && config.login && config.cashdeskid) {
        return {
          hash: config.hash,
          cashierpass: config.cashierpass,
          login: config.login,
          cashdeskid: String(config.cashdeskid),
        }
      }
    }

    return {
      hash: process.env.WINWIN_HASH || 'ca4c49cea830e2fbebf7e3894659df1cd74abb2e0e79d58b17ecf82ea148cf2d',
      cashierpass: process.env.WINWIN_CASHIERPASS || 'yYRbyQeX',
      login: process.env.WINWIN_LOGIN || 'burgoevkan',
      cashdeskid: process.env.WINWIN_CASHDESKID || '1416579',
    }
  }

  // 888starz использует Cashdesk API
  if (normalizedBookmaker.includes('888starz') || normalizedBookmaker.includes('888') || normalizedBookmaker === '888starz') {
    const setting = await prisma.botConfiguration.findFirst({
      where: { key: '888starz_api_config' },
    })

    if (setting) {
      const config = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
      if (config.hash && config.cashierpass && config.login && config.cashdeskid) {
        return {
          hash: config.hash,
          cashierpass: config.cashierpass,
          login: config.login,
          cashdeskid: String(config.cashdeskid),
        }
      }
    }

    // API KEY используется как hash
    return {
      hash: process.env['888STARZ_HASH'] || '6e978b90d2e3d7010390c680cf036b49e521bf91e32839021db8c3637f1cbc56',
      cashierpass: process.env['888STARZ_CASHIERPASS'] || 'ydsuHiK^',
      login: process.env['888STARZ_LOGIN'] || 'burgoevka',
      cashdeskid: process.env['888STARZ_CASHDESKID'] || '1416358',
    }
  }
  
  // Mostbet нужны: api_key, secret, cashpoint_id
  if (normalizedBookmaker.includes('mostbet') || normalizedBookmaker === 'mostbet') {
    console.log(`[getCasinoConfig] Looking for Mostbet config in database...`)
    const setting = await prisma.botConfiguration.findFirst({
      where: { key: 'mostbet_api_config' },
    })

    if (setting) {
      console.log(`[getCasinoConfig] ✅ Mostbet config found in database`)
      let config: any
      try {
        config = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
        console.log(`[getCasinoConfig] Mostbet config parsed:`, {
          hasApiKey: !!config.api_key,
          hasSecret: !!config.secret,
          hasCashpointId: !!config.cashpoint_id,
          apiKeyLength: config.api_key?.length || 0,
          secretLength: config.secret?.length || 0,
          cashpointId: config.cashpoint_id,
          apiKeyPreview: config.api_key ? config.api_key.substring(0, 30) + '...' : 'missing',
        })
      } catch (parseError: any) {
        console.error(`[getCasinoConfig] ❌ Failed to parse Mostbet config from database:`, parseError.message)
        console.error(`[getCasinoConfig] Raw value type:`, typeof setting.value)
        console.error(`[getCasinoConfig] Raw value preview:`, typeof setting.value === 'string' 
          ? setting.value.substring(0, 100) 
          : JSON.stringify(setting.value).substring(0, 100))
      }

      if (config && config.api_key && config.secret && config.cashpoint_id) {
        // Проверяем, что значения не пустые
        if (config.api_key.trim() === '' || config.secret.trim() === '' || String(config.cashpoint_id).trim() === '') {
          console.warn(`[getCasinoConfig] ⚠️ Mostbet config in DB has empty values, using fallback`)
        } else {
          console.log(`[getCasinoConfig] ✅ Using Mostbet config from database`)
          return {
            api_key: config.api_key,
            secret: config.secret,
            cashpoint_id: String(config.cashpoint_id),
          }
        }
      } else {
        console.warn(`[getCasinoConfig] ⚠️ Mostbet config in DB is missing required fields:`, {
          hasApiKey: !!config?.api_key,
          hasSecret: !!config?.secret,
          hasCashpointId: !!config?.cashpoint_id,
        })
      }
    } else {
      console.warn(`[getCasinoConfig] ⚠️ Mostbet config not found in database, using environment variables/fallback`)
    }

    // Fallback на переменные окружения или дефолтные значения
    const envConfig = {
      api_key: process.env.MOSTBET_API_KEY || 'api-key:1b896249-f0dc-45ff-826e-4175c72d1e0e',
      secret: process.env.MOSTBET_SECRET || '73353b6b-868e-4561-9128-dce1c91bd24e',
      cashpoint_id: process.env.MOSTBET_CASHPOINT_ID || 'C92905',
    }
    
    console.log(`[getCasinoConfig] Using Mostbet fallback config:`, {
      hasApiKey: !!envConfig.api_key,
      hasSecret: !!envConfig.secret,
      hasCashpointId: !!envConfig.cashpoint_id,
      apiKeyLength: envConfig.api_key?.length || 0,
      secretLength: envConfig.secret?.length || 0,
      cashpointId: envConfig.cashpoint_id,
      source: process.env.MOSTBET_API_KEY ? 'environment' : 'default',
    })
    
    return envConfig
  }

  // 1win нужен только api_key
  if (normalizedBookmaker.includes('1win') || normalizedBookmaker === '1win') {
    const setting = await prisma.botConfiguration.findFirst({
      where: { key: '1win_api_config' },
    })

    if (setting) {
      const config = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
      if (config.api_key) {
        return {
          api_key: config.api_key,
        }
      }
    }

    return {
      api_key: process.env.ONEWIN_API_KEY || process.env['1WIN_API_KEY'] || '',
    }
  }

  return null
}

// Функция для получения конфигурации mob-cash для 1xbet
export async function getMobCashConfig(bookmaker: string): Promise<{
  login: string
  password: string
  cashdesk_id: string | number
  default_lat?: number
  default_lon?: number
  bearer_token?: string
  user_id?: string
  session_id?: string
} | null> {
  const normalizedBookmaker = bookmaker?.toLowerCase() || ''
  
  // Для 1xbet
  if (normalizedBookmaker.includes('1xbet') || normalizedBookmaker === '1xbet') {
    // Сначала пробуем получить из БД
    const setting = await prisma.botConfiguration.findFirst({
      where: { key: '1xbet_mobcash_config' },
    })

    if (setting) {
      const config = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value
      if (config.login && config.password && config.cashdesk_id) {
        return {
          login: config.login,
          password: config.password,
          cashdesk_id: String(config.cashdesk_id),
          default_lat: config.default_lat || parseFloat(process.env.MOBCASH_DEFAULT_LAT || '42.845778'),
          default_lon: config.default_lon || parseFloat(process.env.MOBCASH_DEFAULT_LON || '74.568778'),
          bearer_token: config.bearer_token,
          user_id: config.user_id,
          session_id: config.session_id,
        }
      }
    }

    // Сначала пробуем получить токены из файла (созданного Python скриптом)
    const tokensFromFile = getMobCashConfigFromTokens()
    
    // Fallback на переменные окружения или дефолтные значения
    // Вариант 2: Используем только логин/пароль для автоматического OAuth2
    // Токены передаются только если они явно указаны (для гибридного режима)
    return {
      login: process.env.MOBCASH_LOGIN || 'burgoevk',
      password: process.env.MOBCASH_PASSWORD || 'Kanat312###',
      cashdesk_id: process.env.MOBCASH_CASHDESK_ID || '1001098',
      default_lat: parseFloat(process.env.MOBCASH_DEFAULT_LAT || '42.845778'),
      default_lon: parseFloat(process.env.MOBCASH_DEFAULT_LON || '74.568778'),
      // Приоритет: токены из файла > переменные окружения
      bearer_token: tokensFromFile.bearer_token || process.env.MOBCASH_BEARER_TOKEN || undefined,
      user_id: tokensFromFile.user_id || process.env.MOBCASH_USER_ID || undefined,
      session_id: tokensFromFile.session_id || process.env.MOBCASH_SESSION_ID || undefined,
    }
  }

  return null
}

// Функция для пополнения баланса через API букмекера
export async function depositToCasino(
  bookmaker: string,
  accountId: string,
  amount: number,
  requestId?: number // ID текущей заявки, которую нужно исключить из проверки на дублирование
): Promise<{ success: boolean; message: string; data?: any }> {
  const normalizedBookmaker = bookmaker?.toLowerCase() || ''

  try {
    // Проверка на дублирование пополнений - проверяем, не было ли уже пополнения для этого accountId и суммы в последние 2 минуты
    // ВАЖНО: Уменьшено до 2 минут, чтобы не блокировать легитимные повторные пополнения
    // Это защищает от дубликатов только в случае очень быстрого повторения
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)
    
    // Ищем все недавние пополнения для этого accountId и bookmaker
    // Исключаем текущую заявку из проверки, если requestId передан
    const whereClause: any = {
      accountId: String(accountId), // Приводим к строке для сравнения
      bookmaker: bookmaker,
      requestType: 'deposit',
      status: {
        in: ['completed', 'approved', 'auto_completed', 'autodeposit_success']
      },
      processedAt: {
        gte: twoMinutesAgo
      }
    }
    
    // Исключаем текущую заявку из проверки на дублирование
    if (requestId !== undefined) {
      whereClause.id = { not: requestId }
      console.log(`[Deposit Balance] Checking for duplicates, excluding requestId: ${requestId}`)
    } else {
      console.log(`[Deposit Balance] Checking for duplicates, no requestId provided`)
    }
    
    const recentDeposits = await prisma.request.findMany({
      where: whereClause,
      orderBy: {
        processedAt: 'desc'
      }
    })
    
    console.log(`[Deposit Balance] Found ${recentDeposits.length} recent deposits (excluding requestId: ${requestId || 'none'})`)

    // Проверяем, есть ли пополнение с такой же суммой (с точностью до 1 копейки)
    const duplicateDeposit = recentDeposits.find(deposit => {
      const depositAmount = typeof deposit.amount === 'string' 
        ? parseFloat(deposit.amount) 
        : (deposit.amount as any).toNumber ? (deposit.amount as any).toNumber() : Number(deposit.amount)
      return Math.abs(depositAmount - amount) < 0.01 // Разница не более 1 копейки
    })

    if (duplicateDeposit) {
      const timeDiff = Math.floor((Date.now() - duplicateDeposit.processedAt!.getTime()) / 1000 / 60)
      const remainingMinutes = Math.max(0, 2 - timeDiff)
      console.warn(`[Deposit Balance] ⚠️ Duplicate deposit detected! Found recent deposit for accountId ${accountId}, amount ${amount}, ${timeDiff} minutes ago (Request ID: ${duplicateDeposit.id})`)
      return {
        success: false,
        message: `Депозит на сумму ${amount.toFixed(2)} игроку № ${accountId} уже был проведен, повторить платеж можно будет через ${remainingMinutes} минут.`,
        data: {
          MessageId: 100337,
          Message: `Депозит на сумму ${amount.toFixed(2)} игроку № ${accountId} уже был проведен, повторить платеж можно будет через ${remainingMinutes} минут.`
        }
      }
    }
    // 1xbet, Melbet, Winwin и 888starz используют Cashdesk API
    if (normalizedBookmaker.includes('1xbet') || normalizedBookmaker === '1xbet' ||
        normalizedBookmaker.includes('melbet') || normalizedBookmaker.includes('winwin') ||
        normalizedBookmaker.includes('888starz') || normalizedBookmaker.includes('888') || normalizedBookmaker === '888starz') {
      const config = await getCasinoConfig(bookmaker)
      
      if (!config) {
        return {
          success: false,
          message: `${bookmaker} API configuration not found in database`,
        }
      }

      return await depositCashdeskAPI(bookmaker, accountId, amount, config)
    }
    
    // Mostbet использует свой API
    if (normalizedBookmaker.includes('mostbet')) {
      const config = await getCasinoConfig(bookmaker)
      
      if (!config) {
        return {
          success: false,
          message: 'Mostbet API configuration not found in database',
        }
      }

      return await depositMostbetAPI(accountId, amount, config)
    }
    
  // 1win использует публичное API
  if (normalizedBookmaker.includes('1win') || normalizedBookmaker === '1win') {
    const config = await getCasinoConfig(bookmaker)
    
    if (!config) {
      return {
        success: false,
        message: '1win API configuration not found in database',
      }
    }

    const { deposit1winAPI } = await import('./casino-deposit')
    return await deposit1winAPI(accountId, amount, config)
  }

    return {
      success: false,
      message: `Unsupported bookmaker: ${bookmaker}`,
    }
  } catch (error: any) {
    console.error('Deposit balance error:', error)
    return {
      success: false,
      message: error.message || 'Failed to deposit balance',
    }
  }
}

