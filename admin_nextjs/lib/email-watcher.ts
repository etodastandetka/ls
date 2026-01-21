/**
 * IMAP Watcher для автоматического пополнения
 * Читает email от банков и обрабатывает входящие платежи
 */
import Imap from 'imap'
import { simpleParser } from 'mailparser'
import { prisma } from './prisma'
import { parseEmailByBank } from './email-parsers'
import { matchAndProcessPayment } from './auto-deposit'
import dns from 'dns'

// Настраиваем надежные DNS серверы для избежания DNS ошибок
try {
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1'])
  console.log('✅ DNS servers configured: Google DNS (8.8.8.8, 8.8.4.4) and Cloudflare DNS (1.1.1.1, 1.0.0.1)')
} catch (error) {
  console.warn('⚠️ Failed to set DNS servers:', error)
}

interface WatcherSettings {
  enabled: boolean
  imapHost: string
  email: string
  password: string
  folder: string
  bank: string
  intervalSec: number
}

// Rate limiting для логов сетевых ошибок
let lastNetworkErrorLog = 0
const NETWORK_ERROR_LOG_INTERVAL = 60000 // Логируем не чаще раза в минуту
let consecutiveNetworkErrors = 0
const MAX_CONSECUTIVE_ERRORS_BEFORE_LOG = 3 // Логируем только после 3+ ошибок подряд

/**
 * Получение настроек watcher из БД
 * Упрощенная версия: только флаг включен/выключен в БД, остальное фиксировано
 */
async function getWatcherSettings(): Promise<WatcherSettings> {
  // Получаем email и password из активного реквизита
  const activeRequisite = await prisma.botRequisite.findFirst({
    where: { isActive: true },
  })

  const email = activeRequisite?.email || ''
  const password = activeRequisite?.password || ''

  // Получаем только флаг включен/выключен из БД
  const enabledSetting = await prisma.botSetting.findUnique({
    where: { key: 'autodeposit_enabled' },
  })

  // Фиксированные настройки для Timeweb
  // IMAP сервер: imap.timeweb.ru
  // Порт SSL: 993
  // Порт STARTTLS: 143 (не используется, используем SSL)
  return {
    enabled: enabledSetting?.value === '1',
    imapHost: 'imap.timeweb.ru', // Timeweb IMAP сервер
    email,
    password,
    folder: 'INBOX', // Всегда INBOX
    bank: 'DEMIRBANK', // Можно изменить если нужно, но по умолчанию DEMIRBANK
    intervalSec: 60, // Фиксированный интервал 60 секунд
  }
}

/**
 * Обработка одного письма
 */
async function processEmail(
  imap: Imap,
  uid: number,
  settings: WatcherSettings
): Promise<void> {
  return new Promise((resolve, reject) => {
    let seqno: number | null = null
    const markSeen = (context: string) => {
      const seq = (imap as any).seq
      if (seq && typeof seq.setFlags === 'function' && seqno) {
        seq.setFlags(seqno, ['\\Seen'], (err: Error | null) => {
          if (err) {
            console.error(`❌ Error marking email as seen (${context}):`, err)
          } else {
            console.log(`✅ Email marked as read (${context})`)
          }
          resolve()
        })
        return
      }
      imap.setFlags(uid, ['\\Seen'], (err: Error | null) => {
        if (err) {
          console.error(`❌ Error marking email as seen (${context}):`, err)
        } else {
          console.log(`✅ Email marked as read (${context})`)
        }
        resolve()
      })
    }

    const fetch = imap.fetch(uid, { bodies: '', markSeen: true })

    fetch.on('message', (msg, messageSeqno) => {
      seqno = messageSeqno
      msg.on('body', (stream) => {
        const chunks: Buffer[] = []

        stream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        stream.once('end', async () => {
          try {
            // Собираем полный буфер
            // @ts-ignore - Buffer.concat возвращает Buffer, который совместим с mailparser
            const buffer = Buffer.concat(chunks)
            // Парсим email
            const parsed = await simpleParser(buffer)
            const text = parsed.text || parsed.html || parsed.textAsHtml || ''

            // Логируем информацию о письме для отладки
            console.log(`📨 Email subject: ${parsed.subject || 'N/A'}`)
            console.log(`📨 Email from: ${parsed.from?.text || 'N/A'}`)
            console.log(`📨 Email text length: ${text.length} chars`)
            if (text.length > 0) {
              const preview = text.substring(0, 500).replace(/\n/g, ' ').replace(/\s+/g, ' ')
              console.log(`📨 Email preview: ${preview}...`)
            }

            // РАННЯЯ ПРОВЕРКА: Если это уведомление об исходящем переводе или служебное письмо банка
            // - пометим как прочитанное сразу, не пытаясь парсить
            const isOutgoingNotificationPatterns = [
              /(?:Вы\s+)?осуществили\s+перевод/i,
              /Важно!\s*Банк\s+никогда\s+не\s+отправляет\s+электронные\s+письма/i,
              /Уважаемый(?:\(ая\))?\s+\S+.*(?:осуществили|перевод|QR-платежа).*(?:Важно|Банк\s+никогда)/i,
            ]
            
            const isOutgoingNotification = isOutgoingNotificationPatterns.some(pattern => pattern.test(text))
            
            if (isOutgoingNotification) {
              console.log(`⏭️ Email UID ${uid} is outgoing transfer notification, marking as read immediately`)
              markSeen('outgoing_notification')
              return
            }

            // ВАЖНО: Проверяем дату письма - если письмо старше 7 дней, сразу помечаем как прочитанное
            // (увеличено до 7 дней, чтобы обрабатывать письма, которые пришли недавно)
            const emailDate = parsed.date || new Date()
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            
            if (emailDate < sevenDaysAgo) {
              console.log(`⚠️ Email UID ${uid} is too old (${emailDate.toISOString()}), marking as read without processing`)
              markSeen('too_old')
              return
            }

            // Парсим сумму и дату из письма
            const paymentData = parseEmailByBank(text, settings.bank)

          if (!paymentData) {
            console.log(`⚠️ Could not parse email (UID: ${uid})`)
            console.log(`   Bank setting: ${settings.bank}`)
            console.log(`   Trying to find amount pattern in text...`)
            // Попробуем показать, что именно ищем
            // Поддерживаем числа с пробелами: "1 000", "10 000", "100 000"
            // Поддерживаем запятые как разделители тысяч: "1,240.06"
            const amountPattern = /([0-9]{1,3}(?:[,\s]+[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:[,\s]+[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:,[0-9]{1,2})?)\s*(KGS|сом|сомов)/i
            const amountMatches = text.match(amountPattern)
            if (amountMatches) {
              console.log(`   Found potential amount: ${amountMatches[0]}`)
            } else {
              console.log(`   No amount pattern found`)
            }
            // Помечаем как прочитанное, даже если не смогли распарсить
            // Используем setFlags вместо addFlags для более надежной установки флага
            markSeen('unparseable')
            return
          }

          // Проверяем, не является ли это исходящим переводом (который нужно пропустить)
          if ((paymentData as any)._skip) {
            console.log(`⏭️ Skipping outgoing transfer email (UID: ${uid}), marking as read`)
            markSeen('skip_outgoing')
            return
          }

          const { amount, isoDatetime, bank } = paymentData

            console.log(
              `📧 Parsed email: ${bank}, amount: ${amount}, date: ${isoDatetime || 'N/A'}`
            )

            // Сохраняем входящий платеж в БД
            // ВАЖНО: isoDatetime уже в формате UTC ISO строки (из email-parsers)
            const paymentDate = isoDatetime
              ? new Date(isoDatetime) // isoDatetime уже в UTC формате
              : emailDate // Используем дату письма, если не удалось распарсить дату из текста
            
            console.log(`🕐 [Email Watcher] Payment date: ${paymentDate.toISOString()} (UTC)`)

            const notificationSnippet = text.substring(0, 500)

            // ВАЖНО: дубликаты отключены — сохраняем все письма как новые платежи

            // Создаем новый платеж только если его еще нет
            const incomingPayment = await prisma.incomingPayment.create({
              data: {
                amount,
                bank,
                paymentDate,
                notificationText: notificationSnippet, // Первые 500 символов
                isProcessed: false,
              },
            })

            console.log(`✅ IncomingPayment saved: ID ${incomingPayment.id}`)
            console.log(`🔍 [Email Watcher] Starting auto-match for payment ${incomingPayment.id}, amount: ${amount}`)

            // Пытаемся найти совпадение и автоматически пополнить баланс
            // Используем правильную функцию из lib/auto-deposit.ts
            try {
              const result = await matchAndProcessPayment(incomingPayment.id, amount)
              if (result && result.success) {
                console.log(`✅ [Email Watcher] Auto-deposit completed instantly for payment ${incomingPayment.id}, request ${result.requestId}`)
              } else {
                console.log(`ℹ️ [Email Watcher] No matching request found for payment ${incomingPayment.id} (amount: ${amount})`)
              }
            } catch (error: any) {
              console.error(`❌ [Email Watcher] Auto-match failed for payment ${incomingPayment.id}:`, error.message)
              // Не прерываем обработку, т.к. платеж уже сохранен и может быть обработан вручную
            }

            // СРАЗУ помечаем письмо как прочитанное ПОСЛЕ успешной обработки
            // Это критично важно, чтобы не обрабатывать письмо повторно
            // Используем setFlags вместо addFlags для более надежной установки флага
            markSeen(`processed:${incomingPayment.id}`)
          } catch (error: any) {
            console.error(`❌ Error processing email (UID: ${uid}):`, error)
            reject(error)
          }
        })
      })
    })

    fetch.once('error', reject)
    fetch.once('end', () => {
      // Если сообщений не было, все равно resolve
      resolve()
    })
  })
}

// Функция matchAndProcessPayment теперь импортируется из ./auto-deposit
// Это гарантирует единую логику автопополнения во всем приложении

/**
 * Проверка всех непрочитанных писем (для первого запуска после перезапуска)
 */
async function checkAllUnreadEmails(settings: WatcherSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: settings.email,
      password: settings.password,
      host: settings.imapHost,
      port: 993,
      tls: true,
      tlsOptions: { 
        rejectUnauthorized: false,
        servername: 'imap.timeweb.ru',
      },
      connTimeout: 30000,
      authTimeout: 10000,
    })

    imap.once('ready', () => {
      consecutiveNetworkErrors = 0
      imap.openBox(settings.folder, false, (err: Error | null) => {
        if (err) {
          reject(err)
          return
        }

        // Ищем ВСЕ непрочитанные письма (без фильтра по дате)
        console.log('🔍 Checking all unread emails (first run after restart)...')
        imap.search(['UNSEEN'], (err: Error | null, results?: number[]) => {
          if (err) {
            reject(err)
            return
          }

          if (!results || results.length === 0) {
            console.log('📭 No unread emails found')
            consecutiveNetworkErrors = 0
            imap.end()
            resolve()
            return
          }

          console.log(`📬 Found ${results.length} unread email(s) - processing all...`)

          const processSequentially = async () => {
            for (const uid of results!) {
              try {
                await processEmail(imap, uid, settings)
              } catch (error: any) {
                console.error(`❌ Error processing email UID ${uid}:`, error.message)
              }
            }
          }

          processSequentially()
            .then(() => {
              consecutiveNetworkErrors = 0
              console.log(`✅ Finished processing ${results.length} unread email(s)`)
              imap.end()
              resolve()
            })
            .catch((error) => {
              imap.end()
              reject(error)
            })
        })
      })
    })

    imap.once('error', (err: Error) => {
      if ((err as any).code === 'ENOTFOUND' || (err as any).code === 'ETIMEDOUT' || (err as any).code === 'ECONNREFUSED') {
        consecutiveNetworkErrors++
        const now = Date.now()
        if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_ERRORS_BEFORE_LOG && 
            (now - lastNetworkErrorLog) > NETWORK_ERROR_LOG_INTERVAL) {
          console.warn(`⚠️ IMAP network error in checkAllUnreadEmails (${(err as any).code}): ${err.message || err}`)
          lastNetworkErrorLog = now
        }
        resolve()
        return
      }
      reject(err)
    })

    imap.once('end', () => {
      resolve()
    })

    imap.connect()
  })
}

/**
 * Проверка новых писем (только за последние 15 минут)
 */
async function checkEmails(settings: WatcherSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: settings.email,
      password: settings.password,
      host: settings.imapHost, // imap.timeweb.ru
      port: 993, // SSL порт для IMAP (Timeweb)
      tls: true, // Используем SSL/TLS
      tlsOptions: { 
        rejectUnauthorized: false, // Разрешаем самоподписанные сертификаты
        servername: 'imap.timeweb.ru', // Явно указываем имя сервера для SNI
      },
      connTimeout: 30000, // Таймаут подключения 30 секунд
      authTimeout: 10000, // Таймаут авторизации 10 секунд
    })

    imap.once('ready', () => {
      // Сбрасываем счетчик ошибок при успешном подключении
      consecutiveNetworkErrors = 0
      imap.openBox(settings.folder, false, (err: Error | null) => {
        if (err) {
          reject(err)
          return
        }

        // Ищем ВСЕ непрочитанные письма (без фильтра по дате)
        // Это исключает задержки, когда письмо имеет "старую" дату и не попадает в окно
        imap.search(['UNSEEN'], (err: Error | null, results?: number[]) => {
          if (err) {
            reject(err)
            return
          }

          if (!results || results.length === 0) {
            console.log('📭 No new emails (last 15 minutes)')
            // Сбрасываем счетчик при успешной проверке
            consecutiveNetworkErrors = 0
            imap.end()
            resolve()
            return
          }

          console.log(`📬 Found ${results.length} new unread email(s)`)

          // Обрабатываем каждое письмо последовательно (не параллельно), чтобы избежать конфликтов
          const processSequentially = async () => {
            for (const uid of results!) {
              try {
                await processEmail(imap, uid, settings)
              } catch (error: any) {
                console.error(`❌ Error processing email UID ${uid}:`, error.message)
                // Продолжаем обработку остальных писем даже при ошибке
              }
            }
          }

          processSequentially()
            .then(() => {
              // Сбрасываем счетчик при успешной обработке
              consecutiveNetworkErrors = 0
              imap.end()
              resolve()
            })
            .catch((error) => {
              imap.end()
              reject(error)
            })
        })
      })
    })

    imap.once('error', (err: Error) => {
      // Обрабатываем сетевые ошибки с rate limiting
      if ((err as any).code === 'ENOTFOUND' || (err as any).code === 'ETIMEDOUT' || (err as any).code === 'ECONNREFUSED') {
        consecutiveNetworkErrors++
        const now = Date.now()
        
        // Логируем только если прошло достаточно времени и есть несколько ошибок подряд
        if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_ERRORS_BEFORE_LOG && 
            (now - lastNetworkErrorLog) > NETWORK_ERROR_LOG_INTERVAL) {
          console.warn(`⚠️ IMAP network error in checkEmails (${(err as any).code}): ${err.message || err} (${consecutiveNetworkErrors} consecutive errors)`)
          lastNetworkErrorLog = now
        }
        // Закрываем соединение перед resolve
        try {
          imap.end()
        } catch (e) {
          // Игнорируем ошибки при закрытии
        }
        // Не reject при сетевых ошибках, просто resolve чтобы продолжить работу
        resolve()
        return
      }
      // Для других ошибок тоже закрываем соединение
      try {
        imap.end()
      } catch (e) {
        // Игнорируем ошибки при закрытии
      }
      reject(err)
    })

    imap.once('end', () => {
      resolve()
    })

    imap.connect()
  })
}

/**
 * IDLE режим для реального времени (реакция на новые письма мгновенно)
 */
async function startIdleMode(settings: WatcherSettings): Promise<void> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: settings.email,
      password: settings.password,
      host: settings.imapHost, // imap.timeweb.ru
      port: 993, // SSL порт для IMAP (Timeweb)
      tls: true, // Используем SSL/TLS
      tlsOptions: { 
        rejectUnauthorized: false, // Разрешаем самоподписанные сертификаты
        servername: 'imap.timeweb.ru', // Явно указываем имя сервера для SNI
      },
      connTimeout: 30000, // Таймаут подключения 30 секунд
      authTimeout: 10000, // Таймаут авторизации 10 секунд
    })

    let idleInterval: NodeJS.Timeout | null = null
    let keepAliveInterval: NodeJS.Timeout | null = null

    imap.once('ready', () => {
      console.log(`✅ Connected to IMAP (${settings.email})`)
      // Сбрасываем счетчик ошибок при успешном подключении
      consecutiveNetworkErrors = 0
      imap.openBox(settings.folder, false, (err: Error | null) => {
        if (err) {
          reject(err)
          return
        }

        console.log(`📂 Opened folder: ${settings.folder}`)
        console.log('🔄 Starting IDLE mode (real-time monitoring)...')
        console.log('⏰ Watcher is now actively listening for new emails...')

        // Слушаем события о новых письмах
        imap.on('mail', async () => {
          console.log('📬 New email detected! Processing immediately...')
          try {
            // ОПТИМИЗАЦИЯ: При событии mail сразу обрабатываем новые письма без задержки
            // Используем быстрый поиск только самых свежих писем (за последние 2 минуты)
            const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000)
            const searchCriteria = ['UNSEEN', ['SINCE', twoMinutesAgo]]
            
            imap.search(searchCriteria, async (err: Error | null, results?: number[]) => {
              if (err) {
                console.error(`❌ Error searching for new emails:`, err)
                // Fallback: используем обычный метод
                try {
                  await checkEmails(settings)
                } catch (fallbackError: any) {
                  console.error('❌ Fallback checkEmails also failed:', fallbackError.message)
                }
                return
              }

              if (!results || results.length === 0) {
                console.log('📭 No new unread emails found (in last 2 minutes)')
                consecutiveNetworkErrors = 0
                return
              }

              console.log(`📬 Found ${results.length} new unread email(s) - processing immediately...`)

              // Обрабатываем каждое письмо последовательно
              for (const uid of results) {
                try {
                  await processEmail(imap, uid, settings)
                } catch (error: any) {
                  console.error(`❌ Error processing email UID ${uid}:`, error.message)
                  // Продолжаем обработку остальных писем даже при ошибке
                }
              }

              console.log(`✅ Finished processing ${results.length} new email(s)`)
              consecutiveNetworkErrors = 0
            })
          } catch (error: any) {
            // Обрабатываем сетевые ошибки с rate limiting
            if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
              consecutiveNetworkErrors++
              const now = Date.now()
              if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_ERRORS_BEFORE_LOG && 
                  (now - lastNetworkErrorLog) > NETWORK_ERROR_LOG_INTERVAL) {
                console.warn(`⚠️ Network error processing new emails (${error.code}): ${error.message || error} (${consecutiveNetworkErrors} consecutive errors)`)
                lastNetworkErrorLog = now
              }
            } else {
              console.error('Error processing new emails:', error)
            }
          }
        })

        // Режим реального времени: используем событие 'mail' которое срабатывает автоматически
        // Библиотека imap автоматически отслеживает новые письма через IMAP IDLE если поддерживается
        // Если IDLE не поддерживается, используем быстрый polling (каждые 5 секунд)
        
        console.log('✅ Real-time mode active - listening for new emails...')
        
        // Быстрый polling если IDLE не работает (каждую секунду для быстрого автопополнения)
        idleInterval = setInterval(async () => {
          try {
            await checkEmails(settings)
            // Сбрасываем счетчик при успехе
            consecutiveNetworkErrors = 0
          } catch (error: any) {
            if (error.textCode === 'AUTHENTICATIONFAILED') {
              console.error('❌ Authentication failed in polling!')
              console.error('   Check email/password in active requisite')
              // Останавливаем интервал при ошибке аутентификации
              if (idleInterval) clearInterval(idleInterval)
              if (keepAliveInterval) clearInterval(keepAliveInterval)
              imap.end()
              reject(error)
              return
            }
            // Обрабатываем сетевые ошибки (DNS, таймауты) - просто игнорируем, не пытаемся переподключаться
            if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
              consecutiveNetworkErrors++
              const now = Date.now()
              
              // При критических ошибках останавливаем интервал
              if (consecutiveNetworkErrors >= 10) {
                console.warn(`⚠️ Too many network errors (${consecutiveNetworkErrors}), stopping polling...`)
                if (idleInterval) {
                  clearInterval(idleInterval)
                  idleInterval = null
                }
                // Закрываем соединение
                try {
                  imap.end()
                } catch (e) {
                  // Игнорируем ошибки
                }
                resolve() // Разрешаем промис - основной цикл попробует заново
                return
              }
              
              // Логируем только если прошло достаточно времени и есть несколько ошибок подряд
              if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_ERRORS_BEFORE_LOG && 
                  (now - lastNetworkErrorLog) > NETWORK_ERROR_LOG_INTERVAL) {
                console.warn(`⚠️ Network error in polling (${error.code}): ${error.message || error.hostname || 'Connection issue'} (${consecutiveNetworkErrors} consecutive errors)`)
                lastNetworkErrorLog = now
              }
              // Просто игнорируем ошибку, не пытаемся переподключаться
              return
            }
            
            // Обрабатываем ошибку "Account is temporarily unavailable" - это значит сервер временно заблокировал аккаунт
            // Обычно происходит при слишком частых подключениях
            if (error.message && error.message.includes('Account is temporarily unavailable')) {
              // Логируем только раз в 5 минут, чтобы не спамить
              const now = Date.now()
              if ((now - lastNetworkErrorLog) > NETWORK_ERROR_LOG_INTERVAL) {
                console.warn(`⚠️ Account temporarily unavailable - IMAP server blocked due to frequent connections. Waiting...`)
                lastNetworkErrorLog = now
              }
              // Не сбрасываем счетчик, но и не увеличиваем - просто игнорируем и ждем
              return
            }
            
            // Сбрасываем счетчик при других ошибках
            consecutiveNetworkErrors = 0
            console.error('Error in quick polling:', error.message || error)
          }
        }, 1000) // Проверка каждую секунду для быстрого автопополнения
        
        // Keepalive: каждые 29 минут проверяем соединение
        keepAliveInterval = setInterval(() => {
          if (imap && imap.state !== 'authenticated') {
            console.warn('⚠️ Connection lost')
            imap.end()
          }
        }, 29 * 60 * 1000)
      })
    })

    imap.once('error', (err: Error) => {
      if ((err as any).textCode === 'AUTHENTICATIONFAILED') {
        console.error('❌ IMAP Authentication Failed!')
        console.error('   Please check email and password in the active requisite')
        console.error(`   Email: ${settings.email ? '✓ set' : '✗ missing'}`)
        console.error(`   Password: ${settings.password ? '✓ set' : '✗ missing'}`)
        if (idleInterval) clearInterval(idleInterval)
        if (keepAliveInterval) clearInterval(keepAliveInterval)
        try {
          imap.end()
        } catch (e) {
          // Игнорируем ошибки при закрытии
        }
        reject(err)
      } else if ((err as any).code === 'ENOTFOUND' || (err as any).code === 'ETIMEDOUT' || (err as any).code === 'ECONNREFUSED') {
        // Сетевые ошибки - при множественных ошибках останавливаемся (PM2 перезапустит)
        consecutiveNetworkErrors++
        const now = Date.now()
        
        // При критических ошибках (5+) сразу останавливаемся - PM2 перезапустит процесс
        if (consecutiveNetworkErrors >= 5) {
          console.error(`❌ Too many network errors (${consecutiveNetworkErrors}), stopping watcher. PM2 will restart the process.`)
          // Закрываем все интервалы
          try {
            if (idleInterval) {
              clearInterval(idleInterval)
              idleInterval = null
            }
            if (keepAliveInterval) {
              clearInterval(keepAliveInterval)
              keepAliveInterval = null
            }
            imap.end()
          } catch (e) {
            // Игнорируем ошибки
          }
          // Просто выходим - PM2 перезапустит
          process.exit(1)
        }
        
        // Логируем только если прошло достаточно времени и есть несколько ошибок подряд
        if (consecutiveNetworkErrors >= MAX_CONSECUTIVE_ERRORS_BEFORE_LOG && 
            (now - lastNetworkErrorLog) > NETWORK_ERROR_LOG_INTERVAL) {
          console.warn(`⚠️ IMAP network error (${(err as any).code}): ${err.message || err} (${consecutiveNetworkErrors} consecutive errors)`)
          lastNetworkErrorLog = now
        }
        
        // Закрываем соединение и интервалы
        try {
          if (idleInterval) {
            clearInterval(idleInterval)
            idleInterval = null
          }
          if (keepAliveInterval) {
            clearInterval(keepAliveInterval)
            keepAliveInterval = null
          }
          imap.end()
        } catch (e) {
          // Игнорируем ошибки при закрытии
        }
        
        // Reject промис чтобы основной цикл не пытался сразу переподключаться
        // Основной цикл поймает ошибку и остановится при критических ошибках
        reject(err)
      } else {
        console.error('❌ IMAP connection error:', err)
        consecutiveNetworkErrors = 0 // Сбрасываем при других ошибках
        if (idleInterval) clearInterval(idleInterval)
        if (keepAliveInterval) clearInterval(keepAliveInterval)
        reject(err)
      }
    })

    imap.once('end', () => {
      if (idleInterval) {
        clearInterval(idleInterval)
        idleInterval = null
      }
      if (keepAliveInterval) {
        clearInterval(keepAliveInterval)
        keepAliveInterval = null
      }
      // Только логируем если это не было вызвано сетевой ошибкой (она уже залогировала)
      if (consecutiveNetworkErrors === 0) {
        console.log('⚠️ IMAP connection ended')
      }
      resolve()
    })

    imap.connect()
  })
}

/**
 * Проверка таймаутов автопополнения
 * Вызывается периодически для проверки заявок, которые не были обработаны в течение 1 минуты
 */
async function checkTimeouts(): Promise<void> {
  try {
    // Вызываем API для проверки таймаутов
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const response = await fetch(`${baseUrl}/api/auto-deposit/check-timeout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (response.ok) {
      const data = await response.json()
      if (data.success && data.data.updated > 0) {
        console.log(`⏰ Timeout check: ${data.data.updated} requests changed to profile-1`)
      }
    }
  } catch (error: any) {
    // Игнорируем ошибки проверки таймаутов, чтобы не прерывать работу watcher
    console.warn('⚠️ Timeout check error:', error.message)
  }
}


// Флаг для отслеживания первого запуска после перезапуска
let isFirstRun = true

/**
 * Запуск watcher в режиме реального времени (IDLE)
 */
export async function startWatcher(): Promise<void> {
  console.log('🚀 Starting Email Watcher (IDLE mode - real-time)...')

  // Небольшая задержка при старте для инициализации DNS и системы
  console.log('⏳ Initializing... (waiting 2 seconds)')
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Запускаем периодическую проверку таймаутов каждую минуту
  const timeoutInterval = setInterval(() => {
    checkTimeouts().catch((error) => {
      console.warn('⚠️ Timeout check failed:', error.message)
    })
  }, 60000) // Каждую минуту

  // Периодически повторяем автопополнение для необработанных платежей

  // Проверяем таймауты сразу при запуске
  checkTimeouts().catch((error) => {
    console.warn('⚠️ Initial timeout check failed:', error.message)
  })

  while (true) {
    try {
      const settings = await getWatcherSettings()

      if (!settings.enabled) {
        console.log('⏸️ Autodeposit is disabled, waiting 30 seconds...')
        await new Promise((resolve) => setTimeout(resolve, 30000))
        continue
      }

      if (!settings.email || !settings.password) {
        console.warn('⚠️ IMAP credentials not configured!')
        console.warn('   Please set email and password in the active requisite (BotRequisite with isActive=true)')
        console.warn('   Waiting 30 seconds...')
        await new Promise((resolve) => setTimeout(resolve, 30000))
        continue
      }

      console.log(`📧 Connecting to ${settings.imapHost} (${settings.email})...`)

      // При первом запуске обрабатываем ВСЕ непрочитанные письма
      if (isFirstRun) {
        console.log('🔄 First run detected - processing all unread emails...')
        try {
          await checkAllUnreadEmails(settings)
          console.log('✅ Finished processing all unread emails, switching to real-time mode...')
        } catch (error: any) {
          console.error('❌ Error processing unread emails on first run:', error.message)
          // Продолжаем работу даже если обработка непрочитанных писем не удалась
        }
        isFirstRun = false
      }

      // Запускаем IDLE режим (реальное время)
      try {
        await startIdleMode(settings)
        // Сбрасываем счетчик при успешном подключении
        consecutiveNetworkErrors = 0
      } catch (error: any) {
        if (error.textCode === 'AUTHENTICATIONFAILED') {
          console.error('❌ IMAP Authentication Failed!')
          console.error('   Please check email and password in the active requisite')
          console.error(`   Email: ${settings.email ? '✓ set' : '✗ missing'}`)
          console.error(`   Password: ${settings.password ? '✓ set' : '✗ missing'}`)
          console.error('   Waiting 60 seconds before retry...')
          await new Promise((resolve) => setTimeout(resolve, 60000))
        } else if ((error as any).code === 'ENOTFOUND' || (error as any).code === 'ETIMEDOUT' || (error as any).code === 'ECONNREFUSED') {
          // Сетевые ошибки - при критических останавливаемся
          consecutiveNetworkErrors++
          if (consecutiveNetworkErrors >= 5) {
            console.error(`❌ Too many network errors (${consecutiveNetworkErrors}), stopping watcher. PM2 will restart.`)
            process.exit(1)
          }
          // При не критических ошибках логируем и добавляем небольшую задержку перед следующей попыткой
          console.error('❌ Network error in IDLE mode:', error.message)
          // Небольшая задержка 5 секунд перед следующей попыткой подключения
          await new Promise((resolve) => setTimeout(resolve, 5000))
        } else {
          // При других ошибках просто логируем и продолжаем цикл
          console.error('❌ IDLE mode error:', error.message)
        }
      }
    } catch (error: any) {
      // При критических DNS ошибках останавливаемся - PM2 перезапустит
      if ((error as any).code === 'ENOTFOUND' && consecutiveNetworkErrors >= 5) {
        console.error(`❌ Too many DNS errors (${consecutiveNetworkErrors}), stopping watcher. PM2 will restart.`)
        process.exit(1)
      }
      console.error('❌ Error in watcher:', error)
    }
  }
}

/**
 * Одноразовая проверка (для ручного запуска)
 */
export async function checkEmailsOnce(): Promise<void> {
  const settings = await getWatcherSettings()

  if (!settings.enabled) {
    console.log('⏸️ Autodeposit is disabled')
    return
  }

  if (!settings.email || !settings.password) {
    throw new Error('IMAP credentials not configured')
  }

  await checkEmails(settings)
}

