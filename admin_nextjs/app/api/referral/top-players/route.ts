import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/api-helpers'

// Призы для топ-рефералов (топ-20)
const TOP_PRIZES = [
  20000, // 1 место
  10000, // 2 место
  5000,  // 3 место
  ...Array(17).fill(1000) // 4-20 места по 1000 сом
]

export async function GET(request: NextRequest) {
  try {
    requireAuth(request)
    
    // Получаем дату начала текущего месяца из конфигурации
    const monthStartConfig = await prisma.botConfiguration.findUnique({
      where: { key: 'referral_current_month_start' }
    })
    
    let monthStartDate: Date | null = null
    if (monthStartConfig && monthStartConfig.value) {
      try {
        monthStartDate = new Date(monthStartConfig.value as string)
      } catch (e) {
        console.warn('Failed to parse referral_current_month_start date, using current month')
      }
    }
    
    // Если дата не установлена, используем начало текущего месяца
    if (!monthStartDate) {
      const now = new Date()
      monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1)
      monthStartDate.setHours(0, 0, 0, 0)
    }
    
    // Получаем топ-20 реферов через агрегацию (только за текущий месяц)
    const topReferrersRaw = await prisma.$queryRaw<Array<{
      referrer_id: bigint,
      total_deposits: number | bigint,
      referral_count: bigint
    }>>`
      SELECT 
        br.referrer_id,
        COALESCE(SUM(r.amount), 0)::numeric as total_deposits,
        COUNT(DISTINCT br.referred_id) as referral_count
      FROM "referrals" br
      LEFT JOIN "requests" r ON r.user_id = br.referred_id 
        AND r.request_type = 'deposit'
        AND r.status IN ('completed', 'approved', 'auto_completed', 'autodeposit_success')
        AND r.amount > 0
        AND r.created_at >= ${monthStartDate}::timestamp
      GROUP BY br.referrer_id
      ORDER BY total_deposits DESC
      LIMIT 20
    `
    
    // Получаем данные пользователей для топ-20
    const topReferrerIds = topReferrersRaw.length > 0 
      ? topReferrersRaw.map(r => r.referrer_id)
      : []
    
    const topReferrerUsers = topReferrerIds.length > 0
      ? await prisma.botUser.findMany({
          where: {
            userId: { in: topReferrerIds }
          },
          select: {
            userId: true,
            username: true,
            firstName: true,
            lastName: true
          }
        })
      : []
    
    const userMap = new Map(topReferrerUsers.map(u => [u.userId.toString(), u]))
    
    const topPlayers = topReferrersRaw.map((ref, index) => {
      const user = userMap.get(ref.referrer_id.toString())
      const rank = index + 1
      const prize = TOP_PRIZES[index] || 0
      
      return {
        id: ref.referrer_id.toString(),
        username: user?.username || null,
        firstName: user?.firstName || null,
        lastName: user?.lastName || null,
        total_deposits: parseFloat(ref.total_deposits.toString()),
        referral_count: parseInt(ref.referral_count.toString()),
        rank,
        prize
      }
    })
    
    return NextResponse.json({
      success: true,
      top_players: topPlayers
    })
    
  } catch (error: any) {
    console.error('Top players fetch error:', error)
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to fetch top players'
    }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'


