import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { 
  protectAPI, 
  rateLimit, 
  getClientIP, 
  isIPBlocked,
  blockIP,
  unblockIP
} from './lib/security'
import { verifyTokenEdge } from './lib/auth-edge'

export async function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value
  const ip = getClientIP(request)
  const pathname = request.nextUrl.pathname
  
  // Детальное логирование для отладки 2FA
  if (pathname === '/dashboard' || pathname === '/login/2fa') {
    console.log(`🔍 Middleware: path=${pathname}, hasToken=${!!token}, tokenPreview=${token ? token.substring(0, 20) + '...' : 'none'}, IP=${ip}`)
  }

  // 🛡️ ЗАЩИТА ОТ DDoS И АТАК

  // 0. Пропускаем статические файлы и ресурсы
  const staticFiles = [
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png',
    '/icon.jpg',
    '/service-worker.js',
    '/ringtone-sms-notification.mp3',
    '/social-media-logout-sound.mp3',
  ]
  
  if (pathname.startsWith('/_next/') || 
      pathname.startsWith('/favicon') ||
      pathname.startsWith('/images/') ||
      staticFiles.includes(pathname)) {
    return NextResponse.next()
  }

  // 0.1. Пропускаем страницу геолокации и API геолокации
  if (pathname === '/geolocation' || pathname.startsWith('/api/geolocation')) {
    return NextResponse.next()
  }

  // Определяем публичные маршруты (которые должны быть доступны даже при блокировке IP)
  const publicRoutes = ['/login', '/api/auth/login', '/api/auth/2fa']
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))
  
  // Публичные страницы (не API)
  const isPublicPage = pathname === '/login' || pathname === '/login/2fa' || pathname === '/geolocation'

  // 1. Проверка блокировки IP (пропускаем внутренние IP, геолокацию и публичные маршруты)
  const isInternalRequest = ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' ||
                            ip === '::ffff:127.0.0.1' || ip.startsWith('192.168.') || 
                            ip.startsWith('10.') || ip.startsWith('172.16.')
  
  // Проверяем валидность токена ПЕРЕД проверкой блокировки IP
  // Если токен валиден, пользователь авторизован и не должен блокироваться
  let isValidToken = false
  let tokenPayload: { username: string } | null = null
  if (token) {
    try {
      // Детальное логирование для /dashboard
      if (pathname === '/dashboard') {
        console.log(`🔍 Verifying token for /dashboard, token length: ${token.length}, first 50 chars: ${token.substring(0, 50)}...`)
      }
      const payload = verifyTokenEdge(token)
      isValidToken = !!payload
      if (payload) {
        tokenPayload = payload
        console.log(`✅ Valid token detected for ${pathname}, user: ${payload.username}, IP: ${ip}, userId: ${payload.userId}`)
      } else {
        console.log(`⚠️  Invalid token (verifyToken returned null) for ${pathname}, IP: ${ip}, token: ${token.substring(0, 30)}...`)
        // Дополнительная диагностика для /dashboard
        if (pathname === '/dashboard') {
          console.log(`🔍 Token verification failed for /dashboard. Check JWT_SECRET in .env file.`)
        }
      }
    } catch (error) {
      console.log(`⚠️  Token verification error (exception) for ${pathname}, IP: ${ip}:`, error)
      isValidToken = false
    }
  } else {
    console.log(`⚠️  No token cookie found for ${pathname}, IP: ${ip}`)
  }
  
  // ОТКЛЮЧЕНО: Проверка блокировки IP (убрана по запросу пользователя)
  // IP блокировки отключены, чтобы не блокировать легитимных пользователей
  // const shouldCheckIPBlock = !isInternalRequest && !isPublicRoute && !isPublicPage && !pathname.startsWith('/api/geolocation') && !isValidToken
  // const isIPCurrentlyBlocked = isIPBlocked(ip)
  
  // if (pathname === '/dashboard') {
  //   console.log(`🔍 IP Block Check: shouldCheck=${shouldCheckIPBlock}, isBlocked=${isIPCurrentlyBlocked}, isValidToken=${isValidToken}, isInternal=${isInternalRequest}, isPublicRoute=${isPublicRoute}, isPublicPage=${isPublicPage}`)
  // }
  
  // if (shouldCheckIPBlock && isIPCurrentlyBlocked) {
  //   console.warn(`🚫 Blocked IP attempt: ${ip} accessing ${pathname} (no valid token, IP is blocked)`)
  //   return NextResponse.json(
  //     { error: 'Forbidden', message: 'Access denied' },
  //     { status: 403 }
  //   )
  // }
  
  // if (isValidToken && isIPCurrentlyBlocked) {
  //   unblockIP(ip)
  //   console.log(`✅ Valid token found, but IP ${ip} was blocked. User is authenticated, unblocking IP and allowing access.`)
  // }

  // 2. Защита API endpoints (пропускаем публичные API)
  // ВАЖНО: Сначала определяем публичные API маршруты, чтобы пропустить protectAPI для них
  const publicApiRoutes = [
    '/api/auth', 
    '/api/payment', 
    '/api/transaction-history', 
    '/api/public', 
    '/api/withdraw-check', 
    '/api/withdraw-check-exists', 
    '/api/withdraw-execute', 
    '/api/incoming-payment', 
    '/api/referral', // Все реферальные endpoints (register, withdraw/create, withdraw/list, public/referral-data)
    '/api/users', 
    '/api/crypto-pay', 
    '/api/requests', // Все endpoints для заявок (включая /api/requests/[id] и /api/requests/[id]/photo)
    '/api/channel',
    '/api/notifications/delayed-deposit' // Внутренний endpoint для отложенных уведомлений
  ]
  
  const isPublicApiRoute = publicApiRoutes.some(route => pathname.startsWith(route))
  
  // Защита API endpoints (пропускаем публичные API и маршруты с валидным токеном)
  if (pathname.startsWith('/api/') && !isPublicRoute) {
    // Пропускаем protectAPI для публичных API маршрутов (они должны быть доступны без токена)
    if (!isPublicApiRoute && !isValidToken) {
      const protectionResult = protectAPI(request)
      if (protectionResult) {
        console.log(`⚠️  protectAPI blocked request to ${pathname}, IP: ${ip}`)
        return protectionResult
      }
    } else if (isPublicApiRoute) {
      // Публичный API маршрут - логируем для отладки
      if (pathname === '/api/payment' || pathname === '/api/incoming-payment' || pathname.startsWith('/api/public/referral') || pathname.startsWith('/api/referral')) {
        console.log(`✅ Public API route accessed: ${pathname}, IP: ${ip}`)
      }
    } else if (isValidToken) {
      // Токен валиден - пропускаем защиту API, но логируем
      if (pathname.startsWith('/api/') && pathname !== '/api/auth/me') {
        console.log(`✅ Valid token, skipping API protection for ${pathname}, IP: ${ip}`)
      }
    }

    // 3. Rate limiting для API (более строгий для публичных endpoints)
    
    // Для внутренних запросов (localhost) - более мягкий rate limit
    // (isInternalRequest уже определен выше)
    
    // Более строгий rate limit для публичных API
    // Исключение: для /api/requests, /api/transaction-history и /api/limits убираем rate limiting (внутренние админские эндпоинты)
    const isRequestsApi = pathname.startsWith('/api/requests')
    const isTransactionHistory = pathname.startsWith('/api/transaction-history')
    const isLimitsApi = pathname.startsWith('/api/limits')
    
    // Пропускаем rate limiting для transaction-history, requests и limits (внутренние админские эндпоинты)
    if (isTransactionHistory || isRequestsApi || isLimitsApi) {
      // Пропускаем rate limiting для истории транзакций, заявок и лимитов
    } else {
      let rateLimitOptions
      if (isInternalRequest) {
        // Внутренние запросы - очень мягкий лимит
        rateLimitOptions = { maxRequests: 1000, windowMs: 60 * 1000 }
      } else if (isPublicApiRoute) {
        // Публичные API - строгий лимит
        rateLimitOptions = { maxRequests: 30, windowMs: 60 * 1000 }
      } else {
        // Защищенные API
        rateLimitOptions = { maxRequests: 100, windowMs: 60 * 1000 }
      }
      
      const rateLimitResult = rateLimit(rateLimitOptions)(request)
      if (rateLimitResult) {
        // ОТКЛЮЧЕНО: Блокировка IP при превышении rate limit (убрана по запросу пользователя)
        // if (rateLimitResult.status === 429 && !isInternalRequest) {
        //   blockIP(ip, 24 * 60 * 60 * 1000)
        // }
        return rateLimitResult
      }
    }

    // 4. CORS headers для публичных API
    if (isPublicApiRoute && request.method === 'OPTIONS') {
      const response = new NextResponse(null, { status: 200 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      response.headers.set('Access-Control-Max-Age', '86400')
      return response
    }

    if (isPublicApiRoute) {
      const response = NextResponse.next()
      // Add CORS headers
      response.headers.set('Access-Control-Allow-Origin', '*')
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      // Security headers
      response.headers.set('X-Content-Type-Options', 'nosniff')
      response.headers.set('X-Frame-Options', 'DENY')
      response.headers.set('X-XSS-Protection', '1; mode=block')
      response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
      return response
    }

    // 5. Защита приватных API endpoints
    if (!isPublicApiRoute && !token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

         // 6. 🗺️ ГЕОЛОКАЦИОННАЯ ЗАЩИТА (для всех страниц кроме геолокации и API)
         // Проверяем, прошла ли проверка геолокации
         // Исключаем: API endpoints, страницу геолокации, статические файлы, страницу 2FA
         // Можно отключить через .env: GEOLOCATION_ENABLED=false
         const geolocationEnvValue = process.env.GEOLOCATION_ENABLED
         // Проверяем явно: если переменная установлена в 'false' (строка), отключаем
         // Если переменная не установлена или установлена в 'true', включаем
         // Учитываем возможные варианты: 'false', 'False', 'FALSE', '0', или отсутствие значения
         const geolocationEnvLower = geolocationEnvValue?.toLowerCase()?.trim()
         const isGeolocationEnabled = geolocationEnvLower !== 'false' && geolocationEnvLower !== '0' && geolocationEnvLower !== ''
         
         const isGeolocationPage = pathname === '/geolocation'
         const is2FAPage = pathname === '/login/2fa'
         const isApiRoute = pathname.startsWith('/api/')
         const isStaticFile = pathname.startsWith('/_next/') || pathname.startsWith('/favicon')
         
         // Логируем для отладки (всегда, чтобы видеть состояние)
         if (pathname === '/dashboard' || pathname === '/') {
           console.log(`🗺️  Геолокация: enabled=${isGeolocationEnabled}, env="${geolocationEnvValue || 'не установлено'}", envLower="${geolocationEnvLower || 'не установлено'}", path=${pathname}, token=${token ? 'yes' : 'no'}`)
         }
         
         // Пропускаем проверку геолокации для страницы 2FA и если есть валидный токен (пользователь уже авторизован)
         // ВАЖНО: используем isValidToken, а не просто token, чтобы пропустить авторизованных пользователей
         if (isGeolocationEnabled && !isApiRoute && !isGeolocationPage && !is2FAPage && !isStaticFile && !isValidToken) {
           const geolocationVerified = request.cookies.get('geolocation_verified')?.value
           
           // Если геолокация не проверена, редиректим на страницу проверки
           if (!geolocationVerified || geolocationVerified !== 'true') {
             if (pathname === '/dashboard') {
               console.log(`🗺️  Geolocation check: redirecting to /geolocation (not verified), IP: ${ip}`)
             }
             const geolocationUrl = new URL('/geolocation', request.url)
             geolocationUrl.searchParams.set('return', pathname)
             return NextResponse.redirect(geolocationUrl)
           }
         } else if (!isGeolocationEnabled && !isApiRoute && !isGeolocationPage && !isStaticFile) {
           // Если геолокация отключена, пропускаем проверку
           console.log(`✅ Геолокация отключена, пропускаем проверку для ${pathname}`)
         } else if (isValidToken && pathname === '/dashboard') {
           // Если токен валиден, пропускаем проверку геолокации
           console.log(`✅ Valid token found, skipping geolocation check for ${pathname}, IP: ${ip}`)
         }

  // 7. Rate limiting для страниц (менее строгий)
  if (pathname.startsWith('/dashboard') || pathname === '/') {
    // Детальное логирование для /dashboard
    if (pathname === '/dashboard') {
      console.log(`🔍 Dashboard access check: isValidToken=${isValidToken}, hasToken=${!!token}, IP=${ip}, isIPBlocked=${isIPBlocked(ip)}`)
    }
    
    const rateLimitResult = rateLimit({ maxRequests: 120, windowMs: 60 * 1000 })(request)
    if (rateLimitResult) {
      if (pathname === '/dashboard') {
        console.log(`⚠️  Rate limit exceeded for /dashboard, IP: ${ip}`)
      }
      return rateLimitResult
    }

    // Используем уже проверенный токен (isValidToken определен выше)
    if (!isValidToken) {
      if (!token) {
        console.log(`⚠️  No token found for ${pathname}, redirecting to login. IP: ${ip}`)
      } else {
        console.log(`⚠️  Invalid token for ${pathname}, redirecting to login. IP: ${ip}, token: ${token.substring(0, 20)}...`)
      }
      return NextResponse.redirect(new URL('/login', request.url))
    }
    
    // Токен уже проверен выше, просто логируем успех
    console.log(`✅ Access granted to ${pathname}, IP: ${ip}, user: ${tokenPayload?.username || 'unknown'}`)
  }

  // 8. Public routes (login, etc.) - isPublicRoute уже определен выше
  if (isPublicRoute) {
    // Rate limiting для публичных страниц (защита от брутфорса)
    const rateLimitResult = rateLimit({ maxRequests: 20, windowMs: 60 * 1000 })(request)
    if (rateLimitResult) {
      return rateLimitResult
    }
  }

  // 9. Security headers для всех ответов
  const response = NextResponse.next()
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
  
  // HSTS (только для HTTPS)
  if (request.nextUrl.protocol === 'https:') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-|.*\\.mp3|.*\\.js|.*\\.json|images/).*)',
  ],
}

