"use client"

import { useBotSettings } from './SettingsLoader'
import { useState, useEffect } from 'react'

interface ServiceStatusProps {
  service: 'deposits' | 'withdrawals' | 'casinos'
  children: React.ReactNode
}

export default function ServiceStatus({ service, children }: ServiceStatusProps) {
  const { settings, loading, error } = useBotSettings()
  const [isEnabled, setIsEnabled] = useState(true) // По умолчанию показываем кнопки

  const resolveServiceEnabled = () => {
    const s = settings as any
    if (!s) return true

    if (service === 'deposits') {
      return s.deposits?.enabled ?? s.deposits_enabled ?? true
    }
    if (service === 'withdrawals') {
      return s.withdrawals?.enabled ?? s.withdrawals_enabled ?? true
    }
    const enabledSites = s.enabled_deposit_banks || []
    return Array.isArray(enabledSites) ? enabledSites.length > 0 : true
  }

  // Обновляем статус в фоне, не блокируя рендер
  useEffect(() => {
    if (!loading && settings) {
      setIsEnabled(resolveServiceEnabled())
    }
  }, [loading, settings, service])

  // Если сервис отключен, показываем предупреждение вместо кнопки
  if (!loading && !isEnabled) {
    const messages = {
      deposits: 'Пополнение временно недоступно',
      withdrawals: 'Вывод временно недоступен',
      casinos: 'Счета временно недоступны'
    }

    return (
      <div className="card text-center bg-yellow-900/20 border-yellow-500">
        <div className="text-yellow-400 text-lg font-semibold mb-2">
          ⚠️ {messages[service]}
        </div>
        <p className="text-sm text-white/70">
          Обратитесь к администратору для получения дополнительной информации
        </p>
      </div>
    )
  }

  // Показываем кнопки сразу, даже если настройки еще загружаются
  return <>{children}</>
}

