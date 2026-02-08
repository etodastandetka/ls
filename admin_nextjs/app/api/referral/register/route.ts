import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { 
  protectAPI, 
  rateLimit, 
  sanitizeInput, 
  containsSQLInjection,
  containsXSS,
  getClientIP 
} from '@/lib/security'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

export async function POST(request: NextRequest) {
  let body: any = null
  
  try {
    // 🛡️ ПУБЛИЧНЫЙ API - защита отключена для корректной работы из браузера
    // Для публичного API referral/register отключаем protectAPI, т.к. запросы идут из браузера
    // (Telegram WebApp открывается в браузере и не всегда имеет правильный user-agent)
    // Защита обеспечивается через rate limiting и валидацию входных данных

    // Rate limiting (строгий для публичного endpoint)
    const rateLimitResult = rateLimit({ 
      maxRequests: 10, 
      windowMs: 60 * 1000,
      keyGenerator: (req) => `referral_register:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) {
      const response = NextResponse.json({
        success: false,
        error: 'Rate limit exceeded'
      }, { status: 429 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    body = await request.json()
    
    console.log('📋 [Referral Register] Входящий запрос на регистрацию реферала:', {
      referrer_id: body.referrer_id || body.referrerId,
      referred_id: body.referred_id || body.referredId,
      username: body.username,
      first_name: body.first_name || body.firstName,
      last_name: body.last_name || body.lastName,
      ip: getClientIP(request),
      user_agent: request.headers.get('user-agent')?.substring(0, 100)
    })
    
    // 🛡️ Валидация и очистка всех входных данных
    const sanitizedBody = sanitizeInput(body)
    
    let referrerId = sanitizedBody.referrer_id || sanitizedBody.referrerId
    let referredId = sanitizedBody.referred_id || sanitizedBody.referredId
    let username = sanitizedBody.username || null
    let firstName = sanitizedBody.first_name || sanitizedBody.firstName || null
    let lastName = sanitizedBody.last_name || sanitizedBody.lastName || null

    // 🛡️ Проверка на SQL инъекции и XSS во всех строковых полях
    const stringFields = [referrerId, referredId, username, firstName, lastName].filter(Boolean)
    for (const field of stringFields) {
      if (typeof field === 'string') {
        if (containsSQLInjection(field) || containsXSS(field)) {
          console.warn(`🚫 Security threat from ${getClientIP(request)}`)
          const errorResponse = NextResponse.json({
            success: false,
            error: 'Invalid input detected'
          }, { status: 400 })
          errorResponse.headers.set('Access-Control-Allow-Origin', '*')
          return errorResponse
        }
      }
    }

    // Валидация формата ID (должны быть числами)
    if (referrerId && !/^\d+$/.test(String(referrerId))) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'Invalid referrer ID format'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }

    if (referredId && !/^\d+$/.test(String(referredId))) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'Invalid referred ID format'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }

    // Ограничение длины строковых полей
    if (username && username.length > 100) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'Username too long'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }

    if (firstName && firstName.length > 100) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'First name too long'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }

    if (lastName && lastName.length > 100) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'Last name too long'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    if (!referrerId || !referredId) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'Referrer ID and Referred ID are required'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    const referrerIdBigInt = BigInt(referrerId)
    const referredIdBigInt = BigInt(referredId)
    
    // Нельзя быть рефералом самого себя
    if (referrerIdBigInt === referredIdBigInt) {
      const errorResponse = NextResponse.json({
        success: false,
        error: 'Cannot refer yourself'
      }, { status: 400 })
      errorResponse.headers.set('Access-Control-Allow-Origin', '*')
      return errorResponse
    }
    
    // Проверяем, существует ли уже реферальная связь
    const existingReferral = await prisma.botReferral.findUnique({
      where: {
        referredId: referredIdBigInt
      }
    })
    
    if (existingReferral) {
      // Если уже есть реферал, но от другого рефера, возвращаем ошибку
      // Сравниваем BigInt с BigInt для корректного сравнения
      if (existingReferral.referrerId !== referrerIdBigInt) {
        const errorResponse = NextResponse.json({
          success: false,
          error: 'User already referred by another user'
        }, { status: 400 })
        errorResponse.headers.set('Access-Control-Allow-Origin', '*')
        return errorResponse
      }
      // Если уже привязан к этому же рефералу, возвращаем успех
      const successResponse = NextResponse.json({
        success: true,
        message: 'Referral already exists',
        referral_id: existingReferral.id
      })
      successResponse.headers.set('Access-Control-Allow-Origin', '*')
      return successResponse
    }
    
    // Проверяем, существует ли рефер (тот, кто приглашает)
    let referrer = await prisma.botUser.findUnique({
      where: { userId: referrerIdBigInt }
    })
    
    // Если рефера нет в БД, создаем его
    if (!referrer) {
      referrer = await prisma.botUser.create({
        data: {
          userId: referrerIdBigInt,
          username: null,
          firstName: null,
          lastName: null,
          language: 'ru'
        }
      })
    }
    
    // Проверяем, существует ли реферал (тот, кого приглашают)
    let referred = await prisma.botUser.findUnique({
      where: { userId: referredIdBigInt }
    })
    
    // Если реферала нет в БД, создаем его
    if (!referred) {
      console.log(`📝 [Referral Register] Создание нового пользователя ${referredIdBigInt}`)
      referred = await prisma.botUser.create({
        data: {
          userId: referredIdBigInt,
          username: username,
          firstName: firstName,
          lastName: lastName,
          language: 'ru'
        }
      })
      console.log(`✅ [Referral Register] Пользователь ${referredIdBigInt} создан:`, {
        username: referred.username,
        firstName: referred.firstName,
        lastName: referred.lastName
      })
    } else {
      console.log(`ℹ️ [Referral Register] Пользователь ${referredIdBigInt} уже существует`)
      // Обновляем данные пользователя, если они есть
      if (username || firstName || lastName) {
        await prisma.botUser.update({
          where: { userId: referredIdBigInt },
          data: {
            username: username || referred.username,
            firstName: firstName || referred.firstName,
            lastName: lastName || referred.lastName
          }
        })
        console.log(`🔄 [Referral Register] Данные пользователя ${referredIdBigInt} обновлены`)
      }
    }
    
    // Создаем реферальную связь
    // На этом этапе мы уже проверили, что связи не существует, поэтому просто создаем
    console.log(`🔄 [Referral Register] Создание реферальной связи: ${referrerIdBigInt} -> ${referredIdBigInt}`)
    const referral = await prisma.botReferral.create({
      data: {
        referrerId: referrerIdBigInt,
        referredId: referredIdBigInt
      }
    })
    
    // Проверяем, что связь действительно создана
    const verifyReferral = await prisma.botReferral.findUnique({
      where: {
        referredId: referredIdBigInt
      },
      include: {
        referred: {
          select: {
            userId: true,
            username: true,
            firstName: true,
            lastName: true
          }
        },
        referrer: {
          select: {
            userId: true,
            username: true,
            firstName: true,
            lastName: true
          }
        }
      }
    })
    
    console.log('✅ [Referral Register] Реферальная связь успешно создана:', {
      referral_id: referral.id,
      referrer_id: referrerIdBigInt.toString(),
      referred_id: referredIdBigInt.toString(),
      created_at: referral.createdAt.toISOString(),
      verified: verifyReferral ? 'yes' : 'no',
      referred_user: verifyReferral?.referred ? {
        userId: verifyReferral.referred.userId.toString(),
        username: verifyReferral.referred.username
      } : 'null'
    })
    
    // Отправляем уведомления через Telegram
    const botToken = process.env.BOT_TOKEN
    if (botToken) {
      // Получаем имена пользователей для уведомлений
      const referredName = verifyReferral?.referred 
        ? (verifyReferral.referred.firstName || verifyReferral.referred.username || `ID: ${verifyReferral.referred.userId}`)
        : (firstName || username || `ID: ${referredIdBigInt}`)
      
      const referrerName = verifyReferral?.referrer
        ? (verifyReferral.referrer.firstName || verifyReferral.referrer.username || `ID: ${verifyReferral.referrer.userId}`)
        : 'пользователь'
      
      // Уведомление рефереру (тому, кто пригласил)
      try {
        const referrerMessage = `🎉 <b>Новый реферал!</b>\n\nПо вашей реферальной ссылке зашел <b>${referredName}</b>.\n\nТеперь вы будете получать процент с его депозитов!`
        
        const referrerResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: referrerIdBigInt.toString(),
            text: referrerMessage,
            parse_mode: 'HTML'
          })
        })
        
        if (referrerResponse.ok) {
          console.log(`✅ [Referral Register] Уведомление отправлено рефереру ${referrerIdBigInt}`)
        } else {
          const errorData = await referrerResponse.json()
          console.warn(`⚠️ [Referral Register] Не удалось отправить уведомление рефереру: ${errorData.description || 'Unknown error'}`)
        }
      } catch (error) {
        console.error(`❌ [Referral Register] Ошибка при отправке уведомления рефереру:`, error)
      }
      
      // Уведомление новому пользователю (рефералу)
      try {
        const referredMessage = `✅ <b>Реферальная программа</b>\n\nВы успешно стали рефералом <b>${referrerName}</b>.\n\nТеперь вы можете приглашать друзей и получать бонусы!`
        
        const referredResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: referredIdBigInt.toString(),
            text: referredMessage,
            parse_mode: 'HTML'
          })
        })
        
        if (referredResponse.ok) {
          console.log(`✅ [Referral Register] Уведомление отправлено рефералу ${referredIdBigInt}`)
        } else {
          const errorData = await referredResponse.json()
          console.warn(`⚠️ [Referral Register] Не удалось отправить уведомление рефералу: ${errorData.description || 'Unknown error'}`)
        }
      } catch (error) {
        console.error(`❌ [Referral Register] Ошибка при отправке уведомления рефералу:`, error)
      }
    } else {
      console.warn('⚠️ [Referral Register] BOT_TOKEN не настроен, уведомления не отправлены')
    }
    
    const response = NextResponse.json({
      success: true,
      message: 'Referral registered successfully',
      referral_id: referral.id
    })
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
    
  } catch (error: any) {
    console.error('❌ [Referral Register] Ошибка при регистрации реферала:', {
      error: error.message,
      code: error.code,
      meta: error.meta,
      referrer_id: body?.referrer_id || body?.referrerId || 'unknown',
      referred_id: body?.referred_id || body?.referredId || 'unknown'
    })
    
    // Обрабатываем специфичные ошибки Prisma
    let errorMessage = error.message || 'Failed to register referral'
    let statusCode = 500
    
    // Ошибка уникального ограничения (пользователь уже является рефералом другого рефера)
    if (error.code === 'P2002') {
      errorMessage = 'User already referred by another user'
      statusCode = 400
    }
    // Ошибка внешнего ключа
    else if (error.code === 'P2003') {
      errorMessage = 'Invalid referrer or referred user ID'
      statusCode = 400
    }
    
    const errorResponse = NextResponse.json({
      success: false,
      error: errorMessage,
      error_code: error.code || 'UNKNOWN_ERROR'
    }, { status: statusCode })
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    return errorResponse
  }
}

export const dynamic = 'force-dynamic'

