/**
 * Функции для работы с API вывода средств из букмекера
 * Поддерживаются: 1xbet, Melbet, Mostbet, 1win
 */
import crypto from 'crypto'
import { MobCashClient } from './mob-cash-api'

// Конфигурация API букмекера
interface CasinoConfig {
  hash?: string
  cashierpass?: string
  login?: string
  cashdeskid?: string | number
  api_key?: string
  secret?: string
  cashpoint_id?: string | number
}

// Конфигурация mob-cash API
interface MobCashConfig {
  login: string
  password: string
  cashdesk_id: string | number
  default_lat?: number
  default_lon?: number
  bearer_token?: string
  user_id?: string
  session_id?: string
}

/**
 * Генерация confirm для вывода
 * Согласно документации CashdeskBotAPI пункт 4.2: confirm = MD5(userId:hash)
 * Для Melbet и Winwin userId должен быть в lowercase
 */
function generateConfirm(userId: string, hash: string, isMelbet: boolean = false, isWinwin: boolean = false): string {
  // Для Melbet и Winwin userId должен быть в lowercase для confirm
  const userIdForConfirm = (isMelbet || isWinwin) ? userId.toLowerCase() : userId
  const confirmString = `${userIdForConfirm}:${hash}`
  return crypto.createHash('md5').update(confirmString).digest('hex')
}

/**
 * Генерация подписи для вывода 1xbet/Melbet/888starz/Winwin
 * Согласно документации CashdeskBotAPI пункт 4.1:
 * a. SHA256(hash={hash}&lng={lng}&UserId={UserId}) - в описании UserId с большой, в примере используется userid с маленькой
 * b. MD5(code={code}&cashierpass={cashierpass}&cashdeskid={cashdeskid})
 * c. SHA256(step1 + step2)
 */
function generateSignForWithdraw(
  userId: string,
  code: string,
  hash: string,
  cashierpass: string,
  cashdeskid: string | number
): string {
  // a) SHA256(hash={hash}&lng=ru&userid={user_id})
  // Согласно документации используется userid с маленькой буквы
  const step1String = `hash=${hash}&lng=ru&userid=${userId}`
  const step1Hash = crypto.createHash('sha256').update(step1String).digest('hex')

  // b) MD5(code={code}&cashierpass={cashierpass}&cashdeskid={cashdeskid}) для Payout
  const step2String = `code=${code}&cashierpass=${cashierpass}&cashdeskid=${cashdeskid}`
  const step2Hash = crypto.createHash('md5').update(step2String).digest('hex')

  // c) SHA256(step1 + step2)
  const combined = step1Hash + step2Hash
  return crypto.createHash('sha256').update(combined).digest('hex')
}

/**
 * Проверка суммы вывода через API 1xbet/Melbet/888starz (Cashdesk API)
 * ВАЖНО: Метод Payout сразу выполняет вывод и возвращает summa в ответе
 * Согласно документации: POST Deposit/{userId}/Payout
 * Request Body: { "cashdeskId": int, "lng": "string", "code": "string", "confirm": "string" }
 * Response: { "summa": decimal, "success": bool, "messageId": int, "message": "string" }
 */
export async function checkWithdrawAmountCashdesk(
  bookmaker: string,
  userId: string,
  code: string,
  config: CasinoConfig
): Promise<{ success: boolean; amount?: number; message?: string; transactionId?: number }> {
  try {
    const normalizedBookmaker = bookmaker.toLowerCase()
    const baseUrl = 'https://partners.servcul.com/CashdeskBotAPI'
    const is1xbet = normalizedBookmaker.includes('1xbet') || normalizedBookmaker === '1xbet' || normalizedBookmaker.includes('xbet')
    const isMelbet = normalizedBookmaker.includes('melbet')
    const isWinwin = normalizedBookmaker.includes('winwin')
    const is888starz = normalizedBookmaker.includes('888starz') || normalizedBookmaker.includes('888')
    
    // Для Melbet и Winwin userid должен быть в нижнем регистре для URL и confirm
    // Для 1xbet и 888starz используем userId как есть (без lowercase)
    const userIdForApi = (isMelbet || isWinwin)
      ? userId.toLowerCase() 
      : userId

    // Генерируем confirm: MD5(userId:hash)
    // Передаем оригинальный userId и флаги, generateConfirm сам обработает lowercase
    const confirm = generateConfirm(userId, config.hash!, isMelbet, isWinwin)
    
    // Генерируем подпись согласно документации:
    // 1. SHA256(hash={hash}&lng=ru&userid={user_id})
    // 2. MD5(code={code}&cashierpass={cashierpass}&cashdeskid={cashdeskid})
    // 3. SHA256(step1 + step2)
    const sign = generateSignForWithdraw(
      userIdForApi,
      code,
      config.hash!,
      config.cashierpass!,
      config.cashdeskid!
    )

    const url = `${baseUrl}/Deposit/${userIdForApi}/Payout`
    
    // Согласно документации: для Payout используется cashdeskId (camelCase)
    const requestBody = {
      cashdeskId: parseInt(String(config.cashdeskid)),
      lng: 'ru',
      code: code,
      confirm: confirm,
    }

    // Генерируем Basic Auth для 1xbet и 888starz
    const generateBasicAuth = (login: string, cashierpass: string): string => {
      const authString = `${login}:${cashierpass}`
      const authBase64 = Buffer.from(authString).toString('base64')
      return `Basic ${authBase64}`
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'sign': sign,
    }

    // Для 1xbet и 888starz используем Basic Auth, для Winwin и Melbet - без него
    if (is1xbet || is888starz) {
      const authHeader = generateBasicAuth(config.login!, config.cashierpass!)
      headers['Authorization'] = authHeader
      console.log(`[Cashdesk Withdraw] Using Basic Auth for ${bookmaker}`)
    } else {
      console.log(`[Cashdesk Withdraw] NOT using Basic Auth for ${bookmaker} (Winwin/Melbet)`)
    }

    console.log(`[Cashdesk Withdraw] Bookmaker: ${bookmaker}, User ID: ${userIdForApi}, Code: ${code}`)
    console.log(`[Cashdesk Withdraw] URL: ${url}`)
    console.log(`[Cashdesk Withdraw] Request body:`, JSON.stringify(requestBody, null, 2))
    console.log(`[Cashdesk Withdraw] Sign: ${sign}`)
    console.log(`[Cashdesk Withdraw] Confirm: ${confirm}`)
    console.log(`[Cashdesk Withdraw] Bookmaker flags: is1xbet=${is1xbet}, isMelbet=${isMelbet}, isWinwin=${isWinwin}, is888starz=${is888starz}`)

    // ВАЖНО: Этот запрос ВЫПОЛНЯЕТ вывод и возвращает summa в ответе
    // Если код верный - вывод будет выполнен и вернется сумма
    // Если код неверный - вернется ошибка
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })

    const data = await response.json()
    console.log(`[Cashdesk Withdraw] Response status: ${response.status}`)
    console.log(`[Cashdesk Withdraw] Response data:`, JSON.stringify(data, null, 2))

    // API может возвращать success (маленькая) или Success (большая)
    // Также проверяем наличие summa/Summa - если есть сумма, значит операция успешна
    const hasSuccessFlag = data.success === true || data.Success === true
    const hasAmount = (data.summa !== undefined && data.summa !== null) || (data.Summa !== undefined && data.Summa !== null)
    
    // Если есть сумма и HTTP статус OK, считаем операцию успешной
    // Это важно, так как некоторые API могут не возвращать флаг success, но возвращать сумму
    const isSuccess = hasSuccessFlag || (hasAmount && response.ok)

    console.log(`[Cashdesk Withdraw] Success check:`, {
      responseOk: response.ok,
      responseStatus: response.status,
      hasSuccessFlag,
      hasAmount,
      isSuccess,
      summa: data.summa,
      Summa: data.Summa,
      success: data.success,
      Success: data.Success
    })

    // Если HTTP статус не OK, это ошибка
    if (!response.ok) {
      console.error(`[Cashdesk Withdraw] HTTP error: status=${response.status}`)
      return {
        success: false,
        message: data.Message || data.message || `HTTP error: ${response.status}`,
      }
    }

    // Если нет суммы и нет флага успеха, это ошибка
    if (!hasAmount && !hasSuccessFlag) {
      console.error(`[Cashdesk Withdraw] No amount and no success flag`)
      return {
        success: false,
        message: data.Message || data.message || 'Не удалось получить сумму вывода',
      }
    }

    // Если успешно - возвращаем сумму из ответа (summa или Summa)
    // ВАЖНО: Вывод уже выполнен! Нужно это учесть при создании заявки
    // Для вывода сумма может быть отрицательной (например, -150)
    // Проверяем оба варианта: summa (lowercase) и Summa (capitalized)
    let amount: number = 0
    
    if (data.summa !== undefined && data.summa !== null) {
      amount = parseFloat(String(data.summa))
      console.log(`[Cashdesk Withdraw] Found summa (lowercase):`, data.summa, '->', amount)
    } else if (data.Summa !== undefined && data.Summa !== null) {
      amount = parseFloat(String(data.Summa))
      console.log(`[Cashdesk Withdraw] Found Summa (capitalized):`, data.Summa, '->', amount)
    } else {
      console.error(`[Cashdesk Withdraw] No summa/Summa field found in response:`, Object.keys(data))
      return {
        success: false,
        message: 'Сумма вывода не получена из ответа API',
      }
    }
    
    console.log(`[Cashdesk Withdraw] Extracted amount:`, {
      raw_summa: data.summa,
      raw_Summa: data.Summa,
      parsed_amount: amount,
      is_zero: amount === 0,
      absolute_amount: Math.abs(amount)
    })
    
    // Для вывода сумма может быть отрицательной, поэтому проверяем на !== 0
    if (amount === 0 || isNaN(amount)) {
      console.error(`[Cashdesk Withdraw] Amount is 0 or NaN:`, amount)
      return {
        success: false,
        message: 'Сумма вывода не получена из ответа API (сумма равна 0 или не является числом)',
      }
    }

    // Берем абсолютное значение суммы для вывода (API может вернуть отрицательное)
    const absoluteAmount = Math.abs(amount)

    console.log(`[Cashdesk Withdraw] Returning success with amount:`, absoluteAmount)

    return {
      success: true,
      amount: absoluteAmount,
      message: data.Message || data.message || 'Withdrawal processed successfully',
    }
  } catch (error: any) {
    console.error(`[Cashdesk Withdraw] Error:`, error)
    return {
      success: false,
      message: `Error processing withdrawal: ${error.message}`,
    }
  }
}

/**
 * Проверка наличия выводов для игрока (Mostbet) - без кода
 */
export async function checkWithdrawsExistMostbet(
  playerId: string,
  config: CasinoConfig
): Promise<{ success: boolean; hasWithdrawals: boolean; message?: string }> {
  try {
    const baseUrl = 'https://apimb.com'
    const cashpointId = String(config.cashpoint_id)
    
    // Получаем timestamp в UTC в формате YYYY-MM-DD HH:MM:SS (UTC+0)
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const day = String(now.getUTCDate()).padStart(2, '0')
    const hours = String(now.getUTCHours()).padStart(2, '0')
    const minutes = String(now.getUTCMinutes()).padStart(2, '0')
    const seconds = String(now.getUTCSeconds()).padStart(2, '0')
    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`

    const apiKey = config.api_key!
    const apiKeyFormatted = apiKey.startsWith('api-key:') 
      ? apiKey
      : `api-key:${apiKey}`

    // Извлекаем числовую часть из cashpoint_id (например "C131864" -> "131864")
    let cashpointIdForUrl = cashpointId
    const numericMatch = cashpointIdForUrl.match(/\d+/)
    if (numericMatch) {
      cashpointIdForUrl = numericMatch[0]
    }

    const listPath = `/mbc/gateway/v1/api/cashpoint/${cashpointIdForUrl}/player/cashout/list/page?page=1&size=10&searchString=${playerId}`
    // Для GET запросов REQUEST_BODY пустой (пустая строка)
    const listString = `${apiKeyFormatted}${listPath}${timestamp}`
    
    console.log(`[Mostbet Check Withdrawals] List signature string components:`, {
      apiKeyFormatted: apiKeyFormatted.substring(0, 50) + '...',
      listPath,
      requestBody: '(empty for GET)',
      timestamp,
      listStringLength: listString.length,
      listStringPreview: listString.substring(0, 100) + '...'
    })
    
    // Генерируем подпись: HMAC SHA3-256
    // Пробуем разные варианты названия алгоритма
    const algorithms = ['sha3-256', 'SHA3-256', 'sha3_256']
    let listHmac: any = null
    
    if (!config.secret) {
      throw new Error('Mostbet secret is required but not provided')
    }
    
    for (const algo of algorithms) {
      try {
        listHmac = crypto.createHmac(algo, config.secret)
        break
      } catch (e) {
        // Пробуем следующий вариант
        continue
      }
    }
    
    if (!listHmac) {
      throw new Error('SHA3-256 not supported. Please use Node.js 18+ or install crypto-js library.')
    }
    
    const listSignature = listHmac.update(listString).digest('hex')

    const listResponse = await fetch(`${baseUrl}${listPath}`, {
      method: 'GET',
      headers: {
        'X-Timestamp': timestamp,
        'X-Signature': listSignature,
        'X-Api-Key': apiKeyFormatted,
      },
    })

    const listData = await listResponse.json()
    console.log(`[Mostbet Check Withdrawals] List response:`, listData)
    
    if (!listResponse.ok) {
      const errorMessage = listData.message || listData.error || `API error: ${listResponse.status}`
      console.error(`[Mostbet Check Withdrawals] API error:`, {
        status: listResponse.status,
        message: errorMessage,
        data: listData
      })
      return {
        success: false,
        hasWithdrawals: false,
        message: errorMessage || 'Failed to check withdrawals',
      }
    }

    const hasWithdrawals = listData.items && listData.items.length > 0 && 
      listData.items.some((item: any) => item.playerId === String(playerId))
    
    console.log(`[Mostbet Check Withdrawals] Has withdrawals: ${hasWithdrawals} for player ${playerId}`)

    return {
      success: true,
      hasWithdrawals,
      message: hasWithdrawals ? 'Withdrawals found' : 'No withdrawals found for this player',
    }
  } catch (error: any) {
    console.error(`[Mostbet Check Withdrawals] Error:`, error)
    return {
      success: false,
      hasWithdrawals: false,
      message: `Error: ${error.message}`,
    }
  }
}

/**
 * Проверка суммы вывода через API Mostbet
 */
export async function checkWithdrawAmountMostbet(
  playerId: string,
  code: string,
  config: CasinoConfig
): Promise<{ success: boolean; amount?: number; transactionId?: number; message?: string }> {
  try {
    const baseUrl = 'https://apimb.com'
    const cashpointId = String(config.cashpoint_id)
    
    // Получаем timestamp в UTC в формате YYYY-MM-DD HH:MM:SS (UTC+0)
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const day = String(now.getUTCDate()).padStart(2, '0')
    const hours = String(now.getUTCHours()).padStart(2, '0')
    const minutes = String(now.getUTCMinutes()).padStart(2, '0')
    const seconds = String(now.getUTCSeconds()).padStart(2, '0')
    const timestamp = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`

    // API key может быть с префиксом или без
    const apiKey = config.api_key!
    const apiKeyFormatted = apiKey.startsWith('api-key:') 
      ? apiKey
      : `api-key:${apiKey}`

    // Извлекаем числовую часть из cashpoint_id (например "C131864" -> "131864")
    let cashpointIdForUrl = cashpointId
    const numericMatch = cashpointIdForUrl.match(/\d+/)
    if (numericMatch) {
      cashpointIdForUrl = numericMatch[0]
    }

    // Сначала получаем список запросов на вывод
    const listPath = `/mbc/gateway/v1/api/cashpoint/${cashpointIdForUrl}/player/cashout/list/page?page=1&size=10&searchString=${playerId}`
    // Для GET запросов REQUEST_BODY пустой (пустая строка)
    const listString = `${apiKeyFormatted}${listPath}${timestamp}`
    
    console.log(`[Mostbet Withdraw Check] List signature string components:`, {
      apiKeyFormatted: apiKeyFormatted.substring(0, 50) + '...',
      listPath,
      requestBody: '(empty for GET)',
      timestamp,
      listStringLength: listString.length,
      listStringPreview: listString.substring(0, 100) + '...'
    })
    
    // Генерируем подпись: HMAC SHA3-256
    // Пробуем разные варианты названия алгоритма
    const algorithms = ['sha3-256', 'SHA3-256', 'sha3_256']
    let listHmac: any = null
    
    if (!config.secret) {
      throw new Error('Mostbet secret is required but not provided')
    }
    
    for (const algo of algorithms) {
      try {
        listHmac = crypto.createHmac(algo, config.secret)
        break
      } catch (e) {
        // Пробуем следующий вариант
        continue
      }
    }
    
    if (!listHmac) {
      throw new Error('SHA3-256 not supported. Please use Node.js 18+ or install crypto-js library.')
    }
    
    const listSignature = listHmac.update(listString).digest('hex')

    const listResponse = await fetch(`${baseUrl}${listPath}`, {
      method: 'GET',
      headers: {
        'X-Timestamp': timestamp,
        'X-Signature': listSignature,
        'X-Api-Key': apiKeyFormatted,
        'Accept': '*/*',
      },
    })

    const listData = await listResponse.json()
    console.log(`[Mostbet Withdraw Check] List response:`, listData)

    // Проверяем ошибки от API
    if (!listResponse.ok) {
      const errorMessage = listData.message || listData.error || `API error: ${listResponse.status}`
      console.error(`[Mostbet Withdraw Check] API error:`, {
        status: listResponse.status,
        message: errorMessage,
        data: listData
      })
      return {
        success: false,
        message: errorMessage || 'Failed to check withdrawals from Mostbet API',
      }
    }

    // Проверяем наличие выводов
    if (!listData.items || listData.items.length === 0) {
      console.log(`[Mostbet Withdraw Check] No withdrawals found for player ${playerId}`)
      return {
        success: false,
        message: 'У этого игрока нет активных запросов на вывод. Убедитесь, что вы создали заявку на вывод в букмекере Mostbet.',
      }
    }

    // Ищем запрос для этого игрока
    let withdrawal = listData.items.find((item: any) => 
      item.playerId === String(playerId)
    )

    if (!withdrawal) {
      // Если не нашли точно по ID, берем первый (может быть новый запрос)
      console.log(`[Mostbet Withdraw Check] Player ${playerId} not found in list, using first withdrawal:`, listData.items[0])
      withdrawal = listData.items[0]
    }

    // Подтверждаем вывод кодом, чтобы получить сумму
    const confirmPath = `/mbc/gateway/v1/api/cashpoint/${cashpointIdForUrl}/player/cashout/confirmation`
    const confirmBody = {
      code: code,
      transactionId: withdrawal.transactionId,
    }
    // Тело запроса в JSON без пробелов и переводов строк (согласно документации)
    const confirmBodyString = JSON.stringify(confirmBody).replace(/\s+/g, '')
    const confirmString = `${apiKeyFormatted}${confirmPath}${confirmBodyString}${timestamp}`
    
    console.log(`[Mostbet Withdraw Check] Confirm signature string components:`, {
      apiKeyFormatted: apiKeyFormatted.substring(0, 50) + '...',
      confirmPath,
      confirmBodyString,
      timestamp,
      confirmStringLength: confirmString.length,
      confirmStringPreview: confirmString.substring(0, 100) + '...'
    })
    
    // Генерируем подпись: HMAC SHA3-256
    // Пробуем разные варианты названия алгоритма
    const confirmAlgorithms = ['sha3-256', 'SHA3-256', 'sha3_256']
    let confirmHmac: any = null
    
    if (!config.secret) {
      throw new Error('Mostbet secret is required but not provided')
    }
    
    for (const algo of confirmAlgorithms) {
      try {
        confirmHmac = crypto.createHmac(algo, config.secret)
        break
      } catch (e) {
        // Пробуем следующий вариант
        continue
      }
    }
    
    if (!confirmHmac) {
      throw new Error('SHA3-256 not supported. Please use Node.js 18+ or install crypto-js library.')
    }
    
    const confirmSignature = confirmHmac.update(confirmString).digest('hex')

    const confirmResponse = await fetch(`${baseUrl}${confirmPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Timestamp': timestamp,
        'X-Signature': confirmSignature,
        'X-Api-Key': apiKeyFormatted,
        'X-Project': 'MBC',
        'Accept': '*/*',
      },
      body: confirmBodyString,
    })

    const confirmData = await confirmResponse.json()
    console.log(`[Mostbet Withdraw Check] Confirm response:`, confirmData)

    if (!confirmResponse.ok) {
      const errorMessage = confirmData.message || confirmData.error || `API error: ${confirmResponse.status}`
      console.error(`[Mostbet Withdraw Check] Confirm API error:`, {
        status: confirmResponse.status,
        message: errorMessage,
        data: confirmData
      })
      return {
        success: false,
        message: errorMessage || 'Ошибка при подтверждении вывода. Проверьте код и попробуйте еще раз.',
      }
    }

    if (confirmData.status === 'NEW_ERROR' || confirmData.status === 'PROCESSING_ERROR' || confirmData.status === 'CANCELED' || confirmData.status === 'EXPIRED') {
      const statusMessages: Record<string, string> = {
        'NEW_ERROR': 'Ошибка при создании транзакции вывода',
        'PROCESSING_ERROR': 'Ошибка при обработке транзакции',
        'CANCELED': 'Транзакция была отменена',
          'EXPIRED': 'Код подтверждения просрочен. Создайте новую заявку на вывод в букмекере.',
      }
      const message = confirmData.message || statusMessages[confirmData.status] || 'Неверный код или транзакция недоступна'
      return {
        success: false,
        message: message,
      }
    }

    // Возвращаем сумму подтвержденного вывода
    return {
      success: true,
      amount: withdrawal.amount || confirmData.amount,
      transactionId: withdrawal.transactionId || confirmData.transactionId,
      message: 'Withdrawal confirmed',
    }
  } catch (error: any) {
    console.error(`[Mostbet Withdraw Check] Error:`, error)
    return {
      success: false,
      message: `Error checking withdrawal: ${error.message}`,
    }
  }
}

/**
 * Проверка суммы вывода через API 1win
 * Согласно документации: POST /v1/client/withdrawal
 * Параметры: userId (number), code (number)
 * Ответ: id, cashId, amount, userId
 */
export async function checkWithdrawAmount1win(
  userId: string,
  code: string,
  config: CasinoConfig
): Promise<{ success: boolean; amount?: number; message?: string; data?: any }> {
  try {
    const baseUrl = 'https://api.1win.win/v1/client'
    
    // Проверяем наличие API ключа
    if (!config.api_key || config.api_key.trim() === '') {
      console.error(`[1win Withdraw Check] ❌ API key is missing or empty`)
      return {
        success: false,
        message: 'Missing required 1win API key',
      }
    }

    // Парсим userId и code в числа
    const userIdNum = parseInt(userId)
    const codeNum = parseInt(code)

    if (isNaN(userIdNum) || isNaN(codeNum)) {
      console.error(`[1win Withdraw Check] ❌ Invalid userId or code format: userId=${userId}, code=${code}`)
      return {
        success: false,
        message: 'Invalid userId or code format',
      }
    }

    const requestBody = {
      userId: userIdNum,
      code: codeNum,
    }

    // Очищаем API ключ от пробелов и проверяем его длину
    const apiKey = config.api_key.trim()
    if (apiKey.length < 10) {
      console.error(`[1win Withdraw Check] ❌ API key is too short: ${apiKey.length} characters`)
      return {
        success: false,
        message: 'Invalid 1win API key format',
      }
    }

    console.log(`[1win Withdraw Check] User ID: ${userIdNum}, Code: ${codeNum}`)
    console.log(`[1win Withdraw Check] URL: ${baseUrl}/withdrawal`)
    console.log(`[1win Withdraw Check] Request body:`, requestBody)
    console.log(`[1win Withdraw Check] API Key length: ${apiKey.length} characters`)
    console.log(`[1win Withdraw Check] API Key preview: ${apiKey.substring(0, 20)}...${apiKey.substring(apiKey.length - 10)}`)
    console.log(`[1win Withdraw Check] API Key full (for debugging): ${apiKey}`)
    console.log(`[1win Withdraw Check] Header X-API-KEY will be set to: ${apiKey.substring(0, 20)}...`)

    // Пробуем оба варианта заголовка (некоторые API чувствительны к регистру)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    
    // Согласно документации: заголовок x-api-key (строчными)
    // Но также пробуем X-API-KEY для совместимости
    headers['x-api-key'] = apiKey
    
    console.log(`[1win Withdraw Check] Request headers:`, { 
      'Content-Type': headers['Content-Type'],
      'x-api-key': `${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 5)}`,
      'API Key length': apiKey.length,
      'API Key first 10': apiKey.substring(0, 10),
      'API Key last 5': apiKey.substring(apiKey.length - 5)
    })

    const response = await fetch(`${baseUrl}/withdrawal`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })

    const responseText = await response.text()
    let data: any
    try {
      data = JSON.parse(responseText)
    } catch (e) {
      console.error(`[1win Withdraw Check] Failed to parse response: ${responseText}`)
      return {
        success: false,
        message: `Invalid response from 1win API: ${responseText.substring(0, 100)}`,
        data: { rawResponse: responseText, status: response.status },
      }
    }

    console.log(`[1win Withdraw Check] Response status: ${response.status}, Response ok: ${response.ok}, Data:`, data)

    if (!response.ok) {
      // Обрабатываем ошибки согласно документации
      let errorMessage = 'Failed to process withdrawal'
      if (response.status === 400) {
        if (data.message) {
          errorMessage = data.message
        } else if (responseText.includes('процесс обработки')) {
          errorMessage = 'Вывод находится в процессе обработки'
        } else if (responseText.includes('лимиты')) {
          errorMessage = 'Сумма превышает лимиты'
        } else if (responseText.includes('неверный идентификатор кассы')) {
          errorMessage = 'Передан неверный идентификатор кассы'
        } else if (responseText.includes('Не корректный код')) {
          errorMessage = 'Не корректный код'
        } else if (responseText.includes('превышает доступный баланс')) {
          errorMessage = 'Сумма вывода превышает доступный баланс в кассе'
        } else if (responseText.includes('Не корректный идентификатор кассы')) {
          errorMessage = 'Не корректный идентификатор кассы'
        }
      } else if (response.status === 403) {
        // Ошибка 403 "Не допускается" обычно означает проблему с API ключом
        console.error(`[1win Withdraw Check] ❌ 403 Forbidden - API key may be invalid or missing`)
        console.error(`[1win Withdraw Check] ❌ API Key used: ${apiKey.substring(0, 20)}...${apiKey.substring(apiKey.length - 10)}`)
        console.error(`[1win Withdraw Check] ❌ Response body: ${responseText.substring(0, 200)}`)
        errorMessage = 'Не допускается. Проверьте правильность API ключа или обратитесь к менеджеру для получения нового ключа.'
      } else if (response.status === 404) {
        if (responseText.includes('Вывод не найден')) {
          errorMessage = 'Вывод не найден'
        } else if (responseText.includes('Пользователь не найден')) {
          errorMessage = 'Пользователь не найден'
        } else {
          errorMessage = 'Вывод или пользователь не найден'
        }
      }

      return {
        success: false,
        message: errorMessage,
        data,
      }
    }

    // Успешный ответ содержит: id, cashId, amount, userId
    const amount = data.amount || 0
    if (amount === 0 || isNaN(amount)) {
      return {
        success: false,
        message: 'Сумма вывода не получена из ответа API',
        data,
      }
    }

    return {
      success: true,
      amount: parseFloat(String(amount)),
      message: 'Withdrawal confirmed',
    }
  } catch (error: any) {
    console.error(`[1win Withdraw Check] Error:`, error)
    return {
      success: false,
      message: `Error checking withdrawal: ${error.message}`,
    }
  }
}

/**
 * Проверка суммы вывода через mob-cash API
 */
export async function checkWithdrawAmountMobCash(
  payerID: string,
  withdrawalCode: string,
  config: MobCashConfig
): Promise<{ success: boolean; amount?: number; message?: string }> {
  try {
    // Проверяем, что все обязательные поля заполнены
    if (!config.login || !config.password || !config.cashdesk_id ||
        config.login.trim() === '' || config.password.trim() === '' ||
        String(config.cashdesk_id).trim() === '' || String(config.cashdesk_id).trim() === '0') {
      return {
        success: false,
        message: 'Missing required mob-cash API credentials',
      }
    }

    console.log(`[MobCash Withdraw Check] Payer ID: ${payerID}, Code: ${withdrawalCode}`)

    // Создаем клиент mob-cash
    const client = new MobCashClient(config)

    // Запрашиваем сумму ордера
    const result = await client.getWithdrawalAmount(payerID, withdrawalCode)

    if (!result.success) {
      return {
        success: false,
        message: result.message || 'Failed to get withdrawal amount',
      }
    }

    return {
      success: true,
      amount: parseFloat(result.amount) || 0,
      message: result.message || 'Withdrawal amount retrieved',
    }
  } catch (error: any) {
    console.error(`[MobCash Withdraw Check] Error:`, error)
    return {
      success: false,
      message: error.message || 'Error checking withdrawal amount',
    }
  }
}

/**
 * Исполнение ордера на вывод через mob-cash API
 */
export async function processWithdrawMobCash(
  payerID: string,
  amount: number,
  withdrawalCode: string,
  config: MobCashConfig
): Promise<{ success: boolean; amount?: number; message?: string; data?: any }> {
  try {
    // Проверяем, что все обязательные поля заполнены
    if (!config.login || !config.password || !config.cashdesk_id ||
        config.login.trim() === '' || config.password.trim() === '' ||
        String(config.cashdesk_id).trim() === '' || String(config.cashdesk_id).trim() === '0') {
      return {
        success: false,
        message: 'Missing required mob-cash API credentials',
      }
    }

    console.log(`[MobCash Withdraw] Payer ID: ${payerID}, Amount: ${amount}, Code: ${withdrawalCode}`)

    // Создаем клиент mob-cash
    const client = new MobCashClient(config)

    // Выполняем вывод
    const result = await client.withdrawal(payerID, amount, withdrawalCode)

    if (!result.success) {
      return {
        success: false,
        message: result.message || 'Withdrawal failed',
      }
    }

    return {
      success: true,
      amount: amount,
      message: result.message || 'Withdrawal successful',
      data: result.data,
    }
  } catch (error: any) {
    console.error(`[MobCash Withdraw] Error:`, error)
    return {
      success: false,
      message: error.message || 'Error processing withdrawal',
    }
  }
}

/**
 * Выполнение вывода средств через API букмекера
 */
export async function processWithdraw(
  bookmaker: string,
  userId: string,
  code: string,
  config: CasinoConfig
): Promise<{ success: boolean; amount?: number; message?: string; transactionId?: number }> {
  const normalizedBookmaker = bookmaker.toLowerCase()

  // Melbet, Winwin и 888starz используют Cashdesk API
  if (normalizedBookmaker.includes('melbet') || normalizedBookmaker.includes('winwin') ||
      normalizedBookmaker.includes('888starz') || normalizedBookmaker.includes('888') || normalizedBookmaker === '888starz') {
    return await checkWithdrawAmountCashdesk(bookmaker, userId, code, config)
  }

  // Mostbet использует свой API
  if (normalizedBookmaker.includes('mostbet')) {
    return await checkWithdrawAmountMostbet(userId, code, config)
  }

  // 1win использует свой API
  if (normalizedBookmaker.includes('1win')) {
    return await checkWithdrawAmount1win(userId, code, config)
  }

  return {
    success: false,
    message: `Unsupported bookmaker: ${bookmaker}`,
  }
}

