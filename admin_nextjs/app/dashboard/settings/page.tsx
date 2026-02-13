'use client'

import { useEffect, useState } from 'react'

interface Settings {
  pause: boolean
  maintenance_message: string
  deposits_enabled: boolean
  withdrawals_enabled: boolean
  enabled_deposit_banks: string[]
  enabled_withdrawal_banks: string[]
  require_receipt_photo: boolean
  casinos: {
    '1xbet': boolean
    '1win': boolean
    melbet: boolean
    mostbet: boolean
    winwin: boolean
  }
  bookmaker_settings?: {
    [key: string]: {
      deposit_enabled: boolean
      withdraw_enabled: boolean
    }
  }
  channel_subscription_enabled: boolean
  channel_username: string
  channel_id: string
  deposit_video_url: string
  withdraw_video_url: string
  admin_telegram_ids: string
}

const DEPOSIT_BANKS = [
  { id: 'mbank', name: 'MBank' },
  { id: 'demir', name: 'DemirBank' },
  { id: 'balance', name: 'Balance.kg' },
  { id: 'omoney', name: 'O!Money' },
  { id: 'megapay', name: 'MegaPay' },
  { id: 'bakai', name: 'Bakai' },
]

const WITHDRAWAL_BANKS = [
  { id: 'kompanion', name: 'Компаньон' },
  { id: 'odengi', name: 'O!Money' },
  { id: 'bakai', name: 'Bakai' },
  { id: 'balance', name: 'Balance.kg' },
  { id: 'megapay', name: 'MegaPay' },
  { id: 'mbank', name: 'MBank' },
]

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      const data = await response.json()

      if (data.success) {
        const settingsData = data.data
        // Преобразуем admin_telegram_ids из массива в строку для отображения
        if (Array.isArray(settingsData.admin_telegram_ids)) {
          settingsData.admin_telegram_ids = settingsData.admin_telegram_ids.join(', ')
        }
        setSettings(settingsData)
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    if (!settings) return

    setSaving(true)
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      const data = await response.json()
      if (data.success) {
        alert('Настройки сохранены')
      } else {
        alert(data.error || 'Ошибка при сохранении')
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
      alert('Ошибка при сохранении настроек')
    } finally {
      setSaving(false)
    }
  }

  // Преобразует различные форматы ссылок Google Drive в стандартный формат
  const normalizeGoogleDriveUrl = (url: string): string => {
    if (!url) return url
    
    // Если уже правильный формат
    if (url.includes('/file/d/') && url.includes('/view')) {
      return url.split('?')[0] // Убираем параметры типа ?usp=drive_link
    }
    
    // Формат: https://drive.google.com/open?id=FILE_ID
    const openMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
    if (openMatch && openMatch[1]) {
      return `https://drive.google.com/file/d/${openMatch[1]}/view`
    }
    
    // Формат: https://drive.google.com/file/d/FILE_ID (без /view)
    const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
    if (fileMatch && fileMatch[1] && !url.includes('/view')) {
      return `https://drive.google.com/file/d/${fileMatch[1]}/view`
    }
    
    return url
  }

  const updateSetting = (key: keyof Settings, value: any) => {
    if (!settings) return
    
    // Автоматически преобразуем ссылки Google Drive
    if (key === 'deposit_video_url' || key === 'withdraw_video_url') {
      if (value && value.includes('drive.google.com')) {
        value = normalizeGoogleDriveUrl(value)
      }
    }
    
    setSettings({ ...settings, [key]: value })
  }

  const toggleBank = (bankId: string, type: 'deposit' | 'withdrawal') => {
    if (!settings) return

    const key = type === 'deposit' ? 'enabled_deposit_banks' : 'enabled_withdrawal_banks'
    const banks = [...settings[key]]
    const index = banks.indexOf(bankId)

    if (index > -1) {
      banks.splice(index, 1)
    } else {
      banks.push(bankId)
    }

    setSettings({ ...settings, [key]: banks })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
      </div>
    )
  }

  if (!settings) {
    return <div className="text-center text-gray-400 py-12">Не удалось загрузить настройки</div>
  }

  return (
    <div className="py-4">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10"></div>
        <div className="flex-1 text-center">
          <h1 className="text-xl font-bold text-white">Настройки</h1>
          <p className="text-xs text-gray-300 mt-1">Управление ботом</p>
        </div>
        <div className="w-10"></div>
      </div>

      {/* Основные настройки */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <h2 className="text-base font-bold text-white mb-4">Основные настройки</h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Пауза бота</p>
              <p className="text-xs text-gray-400">Временно отключить бота</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.pause}
                onChange={(e) => updateSetting('pause', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Сообщение обслуживания
            </label>
            <textarea
              value={settings.maintenance_message}
              onChange={(e) => updateSetting('maintenance_message', e.target.value)}
              className="w-full bg-gray-900 text-white border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              rows={3}
              placeholder="Введите сообщение..."
            />
          </div>
        </div>
      </div>

      {/* Настройка чека на заявке */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <h2 className="text-base font-bold text-white mb-4">Чек на заявке</h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Требовать фото чека</p>
              <p className="text-xs text-gray-400">Запрашивать фото чека при создании заявки на пополнение</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.require_receipt_photo}
                onChange={(e) => updateSetting('require_receipt_photo', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
            </label>
          </div>
        </div>
      </div>

      {/* Настройки пополнений */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <h2 className="text-base font-bold text-white mb-4">Настройки пополнений</h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Включить пополнения</p>
              <p className="text-xs text-gray-400">Разрешить пополнения</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.deposits_enabled}
                onChange={(e) => updateSetting('deposits_enabled', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
            </label>
          </div>

          <div>
            <p className="text-sm font-medium text-white mb-3">
              Доступные банки ({settings.enabled_deposit_banks.length} из {DEPOSIT_BANKS.length})
            </p>
            <div className="grid grid-cols-2 gap-2">
              {DEPOSIT_BANKS.map((bank) => (
                <label
                  key={bank.id}
                  className="flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-800"
                >
                  <span className="text-sm text-white">{bank.name}</span>
                  <input
                    type="checkbox"
                    checked={settings.enabled_deposit_banks.includes(bank.id)}
                    onChange={() => toggleBank(bank.id, 'deposit')}
                    className="w-4 h-4 text-green-500 bg-gray-700 border-gray-600 rounded focus:ring-green-500"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Настройки выводов */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <h2 className="text-base font-bold text-white mb-4">Настройки выводов</h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Включить выводы</p>
              <p className="text-xs text-gray-400">Разрешить выводы</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.withdrawals_enabled}
                onChange={(e) => updateSetting('withdrawals_enabled', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
            </label>
          </div>

          <div>
            <p className="text-sm font-medium text-white mb-3">
              Доступные банки ({settings.enabled_withdrawal_banks.length} из {WITHDRAWAL_BANKS.length})
            </p>
            <div className="grid grid-cols-2 gap-2">
              {WITHDRAWAL_BANKS.map((bank) => (
                <label
                  key={bank.id}
                  className="flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-800"
                >
                  <span className="text-sm text-white">{bank.name}</span>
                  <input
                    type="checkbox"
                    checked={settings.enabled_withdrawal_banks.includes(bank.id)}
                    onChange={() => toggleBank(bank.id, 'withdrawal')}
                    className="w-4 h-4 text-green-500 bg-gray-700 border-gray-600 rounded focus:ring-green-500"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Настройки счетов */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <h2 className="text-base font-bold text-white mb-4">Настройки счетов</h2>
        
        <div className="space-y-3">
          {(['1xbet', '1win', 'melbet', 'mostbet', 'winwin'] as const).map((casino) => (
            <div key={casino} className="flex items-center justify-between">
              <span className="text-sm font-medium text-white uppercase">{casino}</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.casinos[casino]}
                  onChange={(e) => updateSetting('casinos', { ...settings.casinos, [casino]: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Настройки депозитов и выводов по счетам */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <h2 className="text-base font-bold text-white mb-4">Управление депозитами и выводами по счетам</h2>
        <p className="text-xs text-gray-400 mb-4">Контроль пополнений и выводов для каждого счета отдельно</p>
        
        <div className="space-y-4">
          {(['1xbet', '1win', 'melbet', 'mostbet', 'winwin'] as const).map((bookmaker) => {
            const bookmakerSettings = settings.bookmaker_settings?.[bookmaker] || {
              deposit_enabled: true,
              withdraw_enabled: true
            }
            
            return (
              <div key={bookmaker} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                <h3 className="text-sm font-semibold text-white mb-3 uppercase">{bookmaker}</h3>
                
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">Пополнения</p>
                      <p className="text-xs text-gray-400">Разрешить депозиты для {bookmaker}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bookmakerSettings.deposit_enabled}
                        onChange={(e) => {
                          const newBookmakerSettings = {
                            ...settings.bookmaker_settings,
                            [bookmaker]: {
                              ...bookmakerSettings,
                              deposit_enabled: e.target.checked
                            }
                          }
                          updateSetting('bookmaker_settings', newBookmakerSettings)
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                    </label>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">Выводы</p>
                      <p className="text-xs text-gray-400">Разрешить выводы для {bookmaker}</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bookmakerSettings.withdraw_enabled}
                        onChange={(e) => {
                          const newBookmakerSettings = {
                            ...settings.bookmaker_settings,
                            [bookmaker]: {
                              ...bookmakerSettings,
                              withdraw_enabled: e.target.checked
                            }
                          }
                          updateSetting('bookmaker_settings', newBookmakerSettings)
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                    </label>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Настройки подписки на канал */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <h2 className="text-base font-bold text-white mb-4">Подписка на канал</h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">Включить проверку подписки</p>
              <p className="text-xs text-gray-400">Бот будет отправлять сообщение с кнопками для подписки на канал</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.channel_subscription_enabled || false}
                onChange={(e) => updateSetting('channel_subscription_enabled', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Username канала (@channel)
            </label>
            <input
              type="text"
              value={settings.channel_username || ''}
              onChange={(e) => updateSetting('channel_username', e.target.value)}
              className="w-full bg-gray-900 text-white border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="@channel"
            />
            <p className="text-xs text-gray-400 mt-1">Введите username канала без @ (например: channel)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              ID канала
            </label>
            <input
              type="text"
              value={settings.channel_id || ''}
              onChange={(e) => updateSetting('channel_id', e.target.value)}
              className="w-full bg-gray-900 text-white border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="-1001234567890"
            />
            <p className="text-xs text-gray-400 mt-1">Введите ID канала (например: -1001234567890). Можно получить через @userinfobot</p>
          </div>
        </div>
      </div>

      {/* Настройки админов */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <h2 className="text-base font-bold text-white mb-4">Админы</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Telegram ID админов
            </label>
            <input
              type="text"
              value={settings.admin_telegram_ids || ''}
              onChange={(e) => updateSetting('admin_telegram_ids', e.target.value)}
              className="w-full bg-gray-900 text-white border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="123456789, 987654321"
            />
            <p className="text-xs text-gray-400 mt-1">
              Введите Telegram ID админов через запятую. Админы всегда могут пополнять и выводить, даже если функции отключены для остальных.
            </p>
            <p className="text-xs text-yellow-400 mt-1">
              💡 Чтобы узнать свой Telegram ID, напишите боту @userinfobot
            </p>
          </div>
        </div>
      </div>

      {/* Видео инструкции */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <h2 className="text-base font-bold text-white mb-4">Видео инструкции</h2>
        
        {/* Инструкция по загрузке */}
        <div className="bg-blue-900/30 border border-blue-700 rounded-lg p-3 mb-4">
          <h3 className="text-sm font-semibold text-white mb-2">📹 Как загрузить видео и получить ссылку:</h3>
          <ol className="text-xs text-gray-300 space-y-1 list-decimal list-inside">
            <li>Загрузите видео на <strong className="text-white">Google Drive</strong> (drive.google.com)</li>
            <li>Нажмите правой кнопкой на файл → <strong className="text-white">&quot;Поделиться&quot;</strong></li>
            <li>Измените доступ на <strong className="text-white">&quot;Все, у кого есть ссылка&quot;</strong></li>
            <li>Скопируйте ссылку (формат: <code className="text-blue-400">https://drive.google.com/file/d/FILE_ID/view</code>)</li>
            <li>Вставьте ссылку в поле ниже</li>
          </ol>
          <p className="text-xs text-yellow-400 mt-2">
            ⚠️ Видео должно быть в формате MP4. Максимальный размер: до 100 МБ (рекомендуется до 50 МБ)
          </p>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              🔗 Ссылка на видео инструкции по пополнению
            </label>
            <input
              type="url"
              value={settings.deposit_video_url || ''}
              onChange={(e) => updateSetting('deposit_video_url', e.target.value)}
              className="w-full bg-gray-900 text-white border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="https://drive.google.com/file/d/1ABC.../view"
            />
            <p className="text-xs text-gray-400 mt-1">
              Поддерживаются форматы: <code className="text-blue-400">/file/d/ID/view</code> или <code className="text-blue-400">/open?id=ID</code>
            </p>
            {settings.deposit_video_url && (
              <a 
                href={settings.deposit_video_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block"
              >
                🔗 Проверить ссылку
              </a>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">
              🔗 Ссылка на видео инструкции по выводу
            </label>
            <input
              type="url"
              value={settings.withdraw_video_url || ''}
              onChange={(e) => updateSetting('withdraw_video_url', e.target.value)}
              className="w-full bg-gray-900 text-white border border-gray-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="https://drive.google.com/file/d/1XYZ.../view"
            />
            <p className="text-xs text-gray-400 mt-1">
              Поддерживаются форматы: <code className="text-blue-400">/file/d/ID/view</code> или <code className="text-blue-400">/open?id=ID</code>
            </p>
            {settings.withdraw_video_url && (
              <a 
                href={settings.withdraw_video_url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 mt-1 inline-block"
              >
                🔗 Проверить ссылку
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Кнопка сохранения */}
      <button
        onClick={saveSettings}
        disabled={saving}
        className="w-full bg-gradient-to-r from-green-500 to-green-600 text-black px-4 py-3 rounded-xl hover:from-green-600 hover:to-green-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Сохранение...' : 'Сохранить настройки'}
      </button>
    </div>
  )
}

