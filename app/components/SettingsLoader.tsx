"use client"

import { useState, useEffect } from 'react'
import { getApiBase } from '../utils/fetch'

interface BotSettings {
  bot_name: string
  welcome_message: string
  platform_description: string
  supported_bookmakers: string[]
  supported_banks: string[]
  min_deposit: number
  max_deposit: number
  min_withdraw: number
  max_withdraw: number
  referral_percentage: number
  support_contact: string
}

const FALLBACK_SETTINGS: BotSettings = {
  bot_name: 'LUXON',
  welcome_message: 'Добро пожаловать!',
  platform_description: 'Платформа для пополнения и вывода средств в казино',
  supported_bookmakers: ['1xBet', 'Melbet', 'Mostbet', '1Win', 'Winwin', '888starz'],
  supported_banks: ['DemirBank', 'O! bank', 'Balance.kg', 'Bakai', 'MegaPay', 'MBank'],
  min_deposit: 35,
  max_deposit: 500000,
  min_withdraw: 100,
  max_withdraw: 50000, // Ограничение вывода убрано, но оставляем значение для совместимости
  referral_percentage: 5,
  support_contact: '@operator_luxon_bot'
}

// Простое шареное кеширование (память + sessionStorage) чтобы не дергать API на каждой странице
const CACHE_TTL = 30_000 // 30 секунд
let inMemorySettings: BotSettings | null = null
let inMemoryTimestamp = 0
let inFlightPromise: Promise<BotSettings> | null = null

type CachedPayload = { settings: BotSettings; timestamp: number }

const readSessionCache = (): CachedPayload | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem('bot_settings_cache_v1')
    if (!raw) return null
    return JSON.parse(raw) as CachedPayload
  } catch {
    return null
  }
}

const writeSessionCache = (settings: BotSettings) => {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(
      'bot_settings_cache_v1',
      JSON.stringify({ settings, timestamp: Date.now() })
    )
  } catch {
    // молча игнорируем quota errors
  }
}

const resolveSettingsFromApi = (data: any): BotSettings | null => {
  // API возвращает { success: true, data: {...} }
  if (data?.success && data.data) return data.data as BotSettings
  // Если есть settings напрямую
  if (data?.success && data.settings) return data.settings
  // Если нет success, но есть данные напрямую
  if (data && !data.success && !data.error && typeof data === 'object') {
    return data as BotSettings
  }
  return null
}

const loadSettingsOnce = async (): Promise<BotSettings> => {
  try {
  const apiUrl = getApiBase()
  const response = await fetch(`${apiUrl}/api/public/payment-settings`, { cache: 'no-store' })

  if (!response.ok) {
      // Не бросаем ошибку, возвращаем fallback
      console.warn(`⚠️ Settings API returned ${response.status}, using fallback settings`)
      return FALLBACK_SETTINGS
  }

  const data = await response.json()
  const resolved = resolveSettingsFromApi(data)
  if (!resolved) {
      // Не бросаем ошибку, возвращаем fallback
      console.warn('⚠️ Could not resolve settings from API response, using fallback settings', data)
      return FALLBACK_SETTINGS
  }

  return resolved
  } catch (error) {
    // Не бросаем ошибку дальше, возвращаем fallback
    console.warn('⚠️ Error loading settings, using fallback:', error)
    return FALLBACK_SETTINGS
  }
}

const getCachedSettings = (): BotSettings | null => {
  const now = Date.now()

  if (inMemorySettings && now - inMemoryTimestamp < CACHE_TTL) {
    return inMemorySettings
  }

  const sessionCached = readSessionCache()
  if (sessionCached && now - sessionCached.timestamp < CACHE_TTL) {
    inMemorySettings = sessionCached.settings
    inMemoryTimestamp = sessionCached.timestamp
    return sessionCached.settings
  }

  return null
}

const fetchSettingsWithCache = async (): Promise<BotSettings> => {
  const cached = getCachedSettings()
  if (cached) return cached

  if (inFlightPromise) return inFlightPromise

  inFlightPromise = loadSettingsOnce()
    .then((result) => {
      inMemorySettings = result
      inMemoryTimestamp = Date.now()
      writeSessionCache(result)
      return result
    })
    .catch((error) => {
      // Это не должно происходить, так как loadSettingsOnce теперь всегда возвращает результат
      console.warn('⚠️ Unexpected error in settings loader, using fallback:', error)
      return FALLBACK_SETTINGS
    })
    .finally(() => {
      inFlightPromise = null
    })

  return inFlightPromise
}

export const useBotSettings = () => {
  const [settings, setSettings] = useState<BotSettings | null>(getCachedSettings())
  const [loading, setLoading] = useState(!getCachedSettings())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        setError(null)
        const loaded = await fetchSettingsWithCache()
        if (!cancelled) {
          setSettings(loaded)
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error loading bot settings:', err)
          setError(err instanceof Error ? err.message : 'Unknown error')
          setSettings((prev) => prev || FALLBACK_SETTINGS)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  return { settings, loading, error }
}

export default useBotSettings
