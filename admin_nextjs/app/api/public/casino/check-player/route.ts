import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createApiResponse } from '@/lib/api-helpers'
import { protectAPI, rateLimit, getClientIP } from '@/lib/security'
import { checkPlayerExists } from '@/lib/casino-api'
import { getCasinoConfig } from '@/lib/deposit-balance'

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
    // Защита API
    const protectionResult = protectAPI(request)
    if (protectionResult) return protectionResult

    // Rate limiting
    const rateLimitResult = rateLimit({ 
      maxRequests: 20, 
      windowMs: 60 * 1000,
      keyGenerator: (req) => `check_player:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) {
      const response = NextResponse.json(
        createApiResponse(null, 'Rate limit exceeded'),
        { status: 429 }
      )
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    const body = await request.json()
    const { bookmaker, userId } = body

    if (!bookmaker || !userId) {
      const response = NextResponse.json(
        createApiResponse(null, 'Missing required fields: bookmaker, userId'),
        { status: 400 }
      )
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    const normalizedBookmaker = bookmaker.toLowerCase()

    // Проверка доступна только для букмекеров с Cashdesk API
    // mostbet и 1win не поддерживают проверку
    const supportedCasinos = ['1xbet', 'melbet', 'winwin', '888starz']
    
    if (!supportedCasinos.some(casino => normalizedBookmaker.includes(casino))) {
      const response = NextResponse.json(
        createApiResponse({ exists: true, skip: true }, 'Player check not available for this casino'),
        { status: 200 }
      )
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    // Получаем конфигурацию букмекера
    const config = await getCasinoConfig(bookmaker)
    
    if (!config || !config.hash || !config.cashierpass || !config.login || !config.cashdeskid) {
      const response = NextResponse.json(
        createApiResponse(null, 'Casino configuration not found'),
        { status: 500 }
      )
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    // Определяем тип букмекера для вызова функции
    let casinoType: '1xbet' | 'melbet' | 'winwin' | '888starz'
    if (normalizedBookmaker.includes('1xbet') || normalizedBookmaker === '1xbet') {
      casinoType = '1xbet'
    } else if (normalizedBookmaker.includes('melbet') || normalizedBookmaker === 'melbet') {
      casinoType = 'melbet'
    } else if (normalizedBookmaker.includes('winwin')) {
      casinoType = 'winwin'
    } else if (normalizedBookmaker.includes('888starz') || normalizedBookmaker.includes('888')) {
      casinoType = '888starz'
    } else {
      const response = NextResponse.json(
        createApiResponse(null, 'Unsupported casino for player check'),
        { status: 400 }
      )
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    // Выполняем проверку
    const result = await checkPlayerExists(
      casinoType,
      String(userId),
      {
        hash: config.hash,
        cashierpass: config.cashierpass,
        login: config.login,
        cashdeskid: parseInt(String(config.cashdeskid)),
      }
    )

    const response = NextResponse.json(
      createApiResponse(result),
      { status: 200 }
    )
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response

  } catch (error: any) {
    console.error('Error checking player:', error)
    const response = NextResponse.json(
      createApiResponse(null, error.message || 'Internal server error'),
      { status: 500 }
    )
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
  }
}

