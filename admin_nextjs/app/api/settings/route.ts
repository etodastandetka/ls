import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, createApiResponse } from '@/lib/api-helpers'

export async function GET(request: NextRequest) {
  try {
    requireAuth(request)

    // Получаем настройки из BotConfiguration
    const configs = await prisma.botConfiguration.findMany()
    const settingsMap: Record<string, any> = {}
    
    configs.forEach((config) => {
      let value: any = config.value
      // Пытаемся распарсить JSON, если это строка
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value)
        } catch {
          // Если не JSON, оставляем как строку
        }
      }
      settingsMap[config.key] = value
    })

    // Получаем настройки депозитов
    const depositSettings = settingsMap.deposit_settings || settingsMap.deposits || {
      enabled: true,
      banks: ['mbank', 'bakai', 'balance', 'demir', 'omoney', 'megapay']
    }

    // Получаем настройки выводов
    const withdrawalSettings = settingsMap.withdrawal_settings || settingsMap.withdrawals || {
      enabled: true,
      banks: ['kompanion', 'odengi', 'bakai', 'balance', 'megapay', 'mbank']
    }

    // Получаем настройки букмекера
    const casinoSettings = settingsMap.casinos || {
      '1xbet': true,
      '1win': true,
      melbet: true,
      mostbet: true,
      winwin: true
    }

    // Получаем настройки букмекеров (депозиты и выводы)
    const bookmakerSettings = settingsMap.bookmaker_settings || {
      '1xbet': { deposit_enabled: true, withdraw_enabled: true },
      '1win': { deposit_enabled: true, withdraw_enabled: true },
      melbet: { deposit_enabled: true, withdraw_enabled: true },
      mostbet: { deposit_enabled: true, withdraw_enabled: true },
      winwin: { deposit_enabled: true, withdraw_enabled: true }
    }

    // Получаем настройки канала
    const channelSettings = settingsMap.channel_subscription || {}
    
    const settings = {
      pause: settingsMap.pause === 'true' || settingsMap.pause === true,
      maintenance_message: settingsMap.maintenance_message || 'Технические работы. Попробуйте позже.',
      deposits_enabled: typeof depositSettings === 'object' ? depositSettings.enabled : depositSettings !== false,
      withdrawals_enabled: typeof withdrawalSettings === 'object' ? withdrawalSettings.enabled : withdrawalSettings !== false,
      enabled_deposit_banks: typeof depositSettings === 'object' ? depositSettings.banks : depositSettings || [],
      enabled_withdrawal_banks: typeof withdrawalSettings === 'object' ? withdrawalSettings.banks : withdrawalSettings || [],
      require_receipt_photo: settingsMap.require_receipt_photo === 'true' || settingsMap.require_receipt_photo === true,
      casinos: casinoSettings,
      channel_subscription_enabled: typeof channelSettings === 'object' ? channelSettings.enabled : channelSettings === 'true' || channelSettings === true || false,
      channel_username: typeof channelSettings === 'object' ? channelSettings.username || '' : '',
      channel_id: typeof channelSettings === 'object' ? channelSettings.channel_id || '' : '',
      deposit_video_url: settingsMap.deposit_video_url || '',
      withdraw_video_url: settingsMap.withdraw_video_url || '',
      admin_telegram_ids: settingsMap.admin_telegram_ids || '',
      bookmaker_settings: bookmakerSettings,
    }

    return NextResponse.json(createApiResponse(settings))
  } catch (error: any) {
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to fetch settings'),
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    requireAuth(request)

    const body = await request.json()

    // Сохраняем настройки в BotConfiguration
    const updateSetting = async (key: string, value: any, description: string) => {
      const stringValue = typeof value === 'string' ? value : JSON.stringify(value)
      
      await prisma.botConfiguration.upsert({
        where: { key },
        update: { value: stringValue, description },
        create: { key, value: stringValue, description },
      })
    }

    if (body.pause !== undefined) {
      await updateSetting('pause', body.pause.toString(), 'Пауза бота')
    }

    if (body.maintenance_message !== undefined) {
      await updateSetting('maintenance_message', body.maintenance_message, 'Сообщение о технических работах')
    }

    if (body.deposits_enabled !== undefined || body.enabled_deposit_banks !== undefined) {
      const depositSettings = {
        enabled: body.deposits_enabled !== undefined ? body.deposits_enabled : true,
        banks: body.enabled_deposit_banks || []
      }
      await updateSetting('deposits', depositSettings, 'Настройки депозитов')
    }

    if (body.withdrawals_enabled !== undefined || body.enabled_withdrawal_banks !== undefined) {
      const withdrawalSettings = {
        enabled: body.withdrawals_enabled !== undefined ? body.withdrawals_enabled : true,
        banks: body.enabled_withdrawal_banks || []
      }
      await updateSetting('withdrawals', withdrawalSettings, 'Настройки выводов')
    }

    if (body.require_receipt_photo !== undefined) {
      await updateSetting('require_receipt_photo', body.require_receipt_photo.toString(), 'Требовать фото чека при оплате')
    }

    if (body.casinos !== undefined) {
      await updateSetting('casinos', body.casinos, 'Настройки букмекера')
    }

    if (body.channel_subscription_enabled !== undefined || body.channel_username !== undefined || body.channel_id !== undefined) {
      const channelSettings = {
        enabled: body.channel_subscription_enabled !== undefined ? body.channel_subscription_enabled : false,
        username: body.channel_username || '',
        channel_id: body.channel_id || ''
      }
      await updateSetting('channel_subscription', channelSettings, 'Настройки подписки на канал')
    }

    if (body.deposit_video_url !== undefined) {
      await updateSetting('deposit_video_url', body.deposit_video_url, 'URL видео инструкции по пополнению')
    }

    if (body.withdraw_video_url !== undefined) {
      await updateSetting('withdraw_video_url', body.withdraw_video_url, 'URL видео инструкции по выводу')
    }

    if (body.admin_telegram_ids !== undefined) {
      // Преобразуем строку с ID через запятую в JSON массив
      let adminIds: string[] = []
      if (body.admin_telegram_ids && typeof body.admin_telegram_ids === 'string') {
        adminIds = body.admin_telegram_ids
          .split(',')
          .map((id: string) => id.trim())
          .filter((id: string) => id.length > 0)
      } else if (Array.isArray(body.admin_telegram_ids)) {
        adminIds = body.admin_telegram_ids
      }
      await updateSetting('admin_telegram_ids', adminIds, 'Telegram ID админов (пополнения и выводы всегда включены)')
    }

    if (body.bookmaker_settings !== undefined) {
      await updateSetting('bookmaker_settings', body.bookmaker_settings, 'Настройки депозитов и выводов по букмекерам')
    }

    return NextResponse.json(
      createApiResponse(null, undefined)
    )
  } catch (error: any) {
    return NextResponse.json(
      createApiResponse(null, error.message || 'Failed to save settings'),
      { status: error.message === 'Unauthorized' ? 401 : 500 }
    )
  }
}

