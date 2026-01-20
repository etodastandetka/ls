import { NextRequest, NextResponse } from 'next/server'
import { SECURITY_CONFIG } from '../config/app'

/**
 * 🛡️ Комплексная система защиты от DDoS и атак
 */

// Rate limiting storage (в продакшене используйте Redis)
interface RateLimitEntry {
  count: number
  resetTime: number
  blocked: boolean
  blockUntil?: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Очистка старых записей (из конфигурации)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now && (!entry.blockUntil || entry.blockUntil < now)) {
      rateLimitStore.delete(key)
    }
  }
}, SECURITY_CONFIG.RATE_LIMIT_CLEANUP_INTERVAL_MS)

/**
 * Получает IP адрес из запроса (с учетом Cloudflare и прокси)
 */
export function getClientIP(request: NextRequest): string {
  // Cloudflare передает реальный IP в заголовке
  const cfIP = request.headers.get('cf-connecting-ip')
  if (cfIP) return cfIP

  // X-Forwarded-For (может содержать несколько IP)
  const xForwardedFor = request.headers.get('x-forwarded-for')
  if (xForwardedFor) {
    const ips = xForwardedFor.split(',').map(ip => ip.trim())
    return ips[0] // Первый IP - это оригинальный клиент
  }

  // X-Real-IP
  const xRealIP = request.headers.get('x-real-ip')
  if (xRealIP) return xRealIP

  // Fallback
  return request.ip || 'unknown'
}

/**
 * Валидация входных данных для защиты от инъекций
 */
export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {
    // Удаляем потенциально опасные символы
    return input
      .replace(/[<>]/g, '') // Удаляем HTML теги
      .replace(/['";\\]/g, '') // Удаляем SQL инъекции
      .trim()
  }
  
  if (Array.isArray(input)) {
    return input.map(sanitizeInput)
  }
  
  if (input && typeof input === 'object') {
    const sanitized: any = {}
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value)
    }
    return sanitized
  }
  
  return input
}

/**
 * Проверяет наличие SQL инъекций в строке
 */
export function containsSQLInjection(input: string): boolean {
  // Более точная проверка на SQL инъекции - только реальные паттерны атак
  const sqlPatterns = [
    // SQL команды (только если это не часть обычного текста)
    /\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\s+.*(FROM|INTO|TABLE|DATABASE|WHERE)/i,
    // Комментарии SQL в контексте (-- или # в начале строки или после пробела, за которыми следует SQL-подобный текст)
    /(--|#)\s*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION)/i,
    // Многострочные комментарии SQL
    /\/\*.*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION).*\*\//i,
    // SQL инъекции через OR/AND с двойными равенствами
    /(\bOR\b.*=.*=)/i,
    /(\bAND\b.*=.*=)/i,
    // SQL инъекции через кавычки с OR/AND
    /('|"|`).*(\bOR\b|\bAND\b).*('|"|`)/i,
    // Попытки завершить SQL запрос точкой с запятой перед SQL командами
    /;.*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION)/i,
  ]
  
  return sqlPatterns.some(pattern => pattern.test(input))
}

/**
 * Rate Limiter с защитой от DDoS
 */
export interface RateLimitOptions {
  windowMs?: number // Окно времени в миллисекундах (по умолчанию 1 минута)
  maxRequests?: number // Максимальное количество запросов (по умолчанию 60)
  blockDurationMs?: number // Время блокировки при превышении (по умолчанию 15 минут)
  keyGenerator?: (request: NextRequest) => string // Функция для генерации ключа
}

export function rateLimit(options: RateLimitOptions = {}) {
  const {
    windowMs = SECURITY_CONFIG.RATE_LIMIT_WINDOW_MS,
    maxRequests = SECURITY_CONFIG.RATE_LIMIT_MAX_REQUESTS,
    blockDurationMs = SECURITY_CONFIG.RATE_LIMIT_BLOCK_DURATION_MS,
    keyGenerator = (req) => `rate_limit:${getClientIP(req)}:${req.nextUrl.pathname}`,
  } = options

  return (request: NextRequest): NextResponse | null => {
    const key = keyGenerator(request)
    const now = Date.now()
    let entry = rateLimitStore.get(key)

    // Проверяем, не заблокирован ли IP
    if (entry?.blocked && entry.blockUntil && entry.blockUntil > now) {
      const remainingBlockTime = Math.ceil((entry.blockUntil - now) / 1000)
      return NextResponse.json(
        {
          error: 'Too many requests',
          message: `IP temporarily blocked. Try again in ${remainingBlockTime} seconds.`,
        },
        {
          status: 429,
          headers: {
            'Retry-After': remainingBlockTime.toString(),
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': entry.blockUntil ? new Date(entry.blockUntil).toISOString() : new Date().toISOString(),
          },
        }
      )
    }

    // Создаем новую запись или сбрасываем счетчик
    if (!entry || entry.resetTime < now) {
      entry = {
        count: 0,
        resetTime: now + windowMs,
        blocked: false,
      }
    }

    // Увеличиваем счетчик
    entry.count++

    // Проверяем превышение лимита
    if (entry.count > maxRequests) {
      entry.blocked = true
      entry.blockUntil = now + blockDurationMs
      rateLimitStore.set(key, entry)

      return NextResponse.json(
        {
          error: 'Too many requests',
          message: 'Rate limit exceeded. Your IP has been temporarily blocked.',
        },
        {
          status: 429,
          headers: {
            'Retry-After': Math.ceil(blockDurationMs / 1000).toString(),
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': new Date(entry.blockUntil).toISOString(),
          },
        }
      )
    }

    // Сохраняем обновленную запись
    rateLimitStore.set(key, entry)

    // Возвращаем null, если все в порядке (продолжаем обработку)
    return null
  }
}

