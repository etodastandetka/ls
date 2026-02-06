'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

interface LastMessage {
  id: number
  text: string | null
  type: string
  direction: string
  createdAt: string
}

interface Dialog {
  userId: string
  username: string | null
  firstName: string | null
  lastName: string | null
  lastMessage: LastMessage
}

export default function ChatDialogsPage() {
  const router = useRouter()
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const fetchDialogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.append('search', search)

      const response = await fetch(`/api/chat/dialogs?${params.toString()}`)
      const data = await response.json()

      if (data.success) {
        setDialogs(data.data.dialogs || [])
      }
    } catch (error) {
      console.error('Failed to fetch dialogs:', error)
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    fetchDialogs()
    
    // Обновляем список диалогов каждые 5 секунд
    const interval = setInterval(() => {
      fetchDialogs()
    }, 5000)
    
    return () => clearInterval(interval)
  }, [fetchDialogs])

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'только что'
    if (diffMins < 60) return `${diffMins} мин назад`
    if (diffHours < 24) return `${diffHours} ч назад`
    if (diffDays < 7) return `${diffDays} дн назад`
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  }

  const getDisplayName = (dialog: Dialog) => {
    if (dialog.firstName) {
      return dialog.lastName ? `${dialog.firstName} ${dialog.lastName}` : dialog.firstName
    }
    return dialog.username ? `@${dialog.username}` : `ID: ${dialog.userId}`
  }

  const getMessagePreview = (message: LastMessage) => {
    if (message.text) {
      return message.text.length > 50 ? message.text.substring(0, 50) + '...' : message.text
    }
    if (message.type === 'photo') return '📷 Фото'
    if (message.type === 'video') return '🎥 Видео'
    if (message.type === 'voice' || message.type === 'audio') return '🎤 Аудио'
    if (message.type === 'document') return '📄 Документ'
    return 'Медиа'
  }

  if (loading && dialogs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen max-h-screen overflow-hidden bg-gray-900">
      {/* Хедер */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 sm:p-4 bg-gray-800 border-b border-gray-700 flex-shrink-0">
        <h1 className="text-lg sm:text-xl font-bold text-white">Чаты</h1>
        <input
          type="text"
          placeholder="Поиск..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-700 text-white rounded-lg px-3 sm:px-4 py-2 w-full sm:w-64 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-green-500"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>

      {/* Список диалогов */}
      <div className="flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
        {dialogs.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p>Нет диалогов</p>
            <p className="text-sm mt-2">Сообщения от пользователей появятся здесь</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-700">
            {dialogs.map((dialog) => {
              const displayName = getDisplayName(dialog)
              const messagePreview = getMessagePreview(dialog.lastMessage)
              const isIncoming = dialog.lastMessage.direction === 'in'

              return (
                <Link
                  key={dialog.userId}
                  href={`/dashboard/users/${dialog.userId}/chat`}
                  className="flex items-center p-3 sm:p-4 hover:bg-gray-800 active:bg-gray-750 transition-colors cursor-pointer touch-manipulation"
                >
                  {/* Аватарка */}
                  <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mr-3">
                    <span className="text-white text-sm font-bold">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                  </div>

                  {/* Информация о диалоге */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-white font-medium truncate">{displayName}</p>
                      <span className="text-xs text-gray-400 ml-2 flex-shrink-0">
                        {formatDate(dialog.lastMessage.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center">
                      <p
                        className={`text-sm truncate ${
                          isIncoming ? 'text-gray-300' : 'text-gray-400'
                        }`}
                      >
                        {isIncoming ? '' : 'Вы: '}
                        {messagePreview}
                      </p>
                    </div>
                  </div>

                  {/* Стрелка */}
                  <div className="ml-2 flex-shrink-0">
                    <svg
                      className="w-5 h-5 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}




