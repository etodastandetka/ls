import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { 
  rateLimit, 
  sanitizeInput, 
  containsSQLInjection,
  getClientIP 
} from '@/lib/security'

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

export async function DELETE(request: NextRequest) {
  try {
    // Rate limiting
    const rateLimitResult = rateLimit({ 
      maxRequests: 20,
      windowMs: 60 * 1000,
      keyGenerator: (req) => `referral_delete:${getClientIP(req)}`
    })(request)
    if (rateLimitResult) {
      rateLimitResult.headers.set('Access-Control-Allow-Origin', '*')
      return rateLimitResult
    }

    const { searchParams } = new URL(request.url)
    let referrerId = searchParams.get('referrer_id')
    let referredId = searchParams.get('referred_id')
    
    if (!referrerId || !referredId) {
      const response = NextResponse.json({
        success: false,
        error: 'Referrer ID and Referred ID are required'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }
    
    // Валидация
    if (containsSQLInjection(referrerId) || containsSQLInjection(referredId)) {
      console.warn(`🚫 SQL injection attempt from ${getClientIP(request)}`)
      const response = NextResponse.json({
        success: false,
        error: 'Invalid input'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    referrerId = sanitizeInput(referrerId) as string
    referredId = sanitizeInput(referredId) as string

    if (!/^\d+$/.test(referrerId) || !/^\d+$/.test(referredId)) {
      const response = NextResponse.json({
        success: false,
        error: 'Invalid ID format'
      }, { status: 400 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }

    const referrerIdBigInt = BigInt(referrerId)
    const referredIdBigInt = BigInt(referredId)
    
    // Проверяем, что реферальная связь существует и принадлежит этому реферу
    const referral = await prisma.botReferral.findUnique({
      where: {
        referredId: referredIdBigInt
      }
    })
    
    if (!referral) {
      const response = NextResponse.json({
        success: false,
        error: 'Referral not found'
      }, { status: 404 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }
    
    // Проверяем, что рефер действительно является владельцем этой связи
    if (referral.referrerId !== referrerIdBigInt) {
      const response = NextResponse.json({
        success: false,
        error: 'You can only delete your own referrals'
      }, { status: 403 })
      response.headers.set('Access-Control-Allow-Origin', '*')
      return response
    }
    
    // Удаляем реферальную связь
    await prisma.botReferral.delete({
      where: {
        referredId: referredIdBigInt
      }
    })
    
    console.log(`✅ [Referral Delete] Реферальная связь удалена: ${referrerIdBigInt} -> ${referredIdBigInt}`)
    
    const response = NextResponse.json({
      success: true,
      message: 'Referral deleted successfully'
    })
    response.headers.set('Access-Control-Allow-Origin', '*')
    return response
    
  } catch (error: any) {
    console.error('❌ [Referral Delete] Ошибка:', {
      error: error.message,
      stack: error.stack,
      name: error.name
    })
    
    const errorResponse = NextResponse.json({
      success: false,
      error: error.message || 'Failed to delete referral'
    }, { status: 500 })
    errorResponse.headers.set('Access-Control-Allow-Origin', '*')
    return errorResponse
  }
}

export const dynamic = 'force-dynamic'

