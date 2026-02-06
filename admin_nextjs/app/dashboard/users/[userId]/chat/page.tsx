'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { CHAT_CONFIG } from '@/config/app'
import { getSocketClient, disconnectSocket } from '@/lib/socket-client'

interface ReplyTo {
  id: number
  messageText: string | null
  messageType: string
  mediaUrl: string | null
  direction: string
  isDeleted?: boolean
}

interface ChatMessage {
  id: number
  userId: string
  messageText: string | null
  messageType: string
  direction: string
  createdAt: string
  mediaUrl?: string | null
  replyToId?: number | null
  replyTo?: ReplyTo | null
  editedAt?: string | null
  isDeleted?: boolean
}

interface UserInfo {
  userId: string
  username: string | null
  firstName: string | null
  lastName: string | null
  photoUrl: string | null
}

export default function ChatPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const channel = searchParams?.get('channel') || 'bot'
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [user, setUser] = useState<UserInfo | null>(null)
  const [newMessage, setNewMessage] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [replyingToId, setReplyingToId] = useState<number | null>(null)
  const [zoomImage, setZoomImage] = useState<string | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [templates, setTemplates] = useState<any[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const fetchChatData = useCallback(async () => {
    try {
      const [chatRes, userRes, photoRes] = await Promise.all([
        fetch(`/api/users/${params.userId}/chat?channel=${channel}`),
        fetch(`/api/users/${params.userId}`),
        fetch(`/api/users/${params.userId}/profile-photo`)
      ])

      const chatData = await chatRes.json()
      const userData = await userRes.json()
      const photoData = await photoRes.json()

      if (chatData.success && chatData.data.messages) {
        // Разворачиваем, чтобы старые были сверху
        const reversedMessages = [...chatData.data.messages].reverse()
        console.log(`📨 Chat: Загружено ${reversedMessages.length} сообщений`)
        setMessages(reversedMessages)
      } else {
        console.warn('⚠️ Chat: Не удалось загрузить сообщения:', chatData)
      }

      if (userData.success && userData.data) {
        const userInfo = userData.data
        setUser({
          userId: userInfo.userId || params.userId?.toString() || '',
          username: userInfo.username,
          firstName: userInfo.firstName,
          lastName: userInfo.lastName,
          photoUrl: photoData.success && photoData.data?.photoUrl ? photoData.data.photoUrl : null,
        })
      }
    } catch (error) {
      console.error('Failed to fetch chat data:', error)
    } finally {
      setLoading(false)
    }
  }, [params.userId, channel])

  const fetchTemplates = useCallback(async () => {
    try {
      const response = await fetch('/api/message-templates')
      const data = await response.json()
      if (data.success) {
        setTemplates(data.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch templates:', error)
    }
  }, [])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  useEffect(() => {
    if (!params.userId) return
    
    fetchChatData()
    
    // Подключаемся к Socket.IO
    const socket = getSocketClient()
    if (socket) {
      // Подписываемся на события для этого пользователя
      socket.emit('subscribe:user', params.userId)
      
      // Обработчики событий
      const handleNewMessage = (data: any) => {
        const newMessage = data.data || data
        if (newMessage.userId === params.userId) {
          setMessages(prev => {
            // Проверяем, нет ли уже такого сообщения
            if (prev.find(m => m.id === newMessage.id)) {
              return prev
            }
            return [...prev, newMessage]
          })
        }
      }
      
      const handleEditMessage = (data: any) => {
        const editedMessage = data.data || data
        if (editedMessage.userId === params.userId) {
          setMessages(prev => prev.map(msg => 
            msg.id === editedMessage.id ? { ...msg, ...editedMessage } : msg
          ))
        }
      }
      
      const handleDeleteMessage = (data: any) => {
        const deletedMessage = data.data || data
        if (deletedMessage.userId === params.userId) {
          setMessages(prev => prev.map(msg => 
            msg.id === deletedMessage.id ? { ...msg, isDeleted: true } : msg
          ))
        }
      }
      
      socket.on('message:new', handleNewMessage)
      socket.on('message:edit', handleEditMessage)
      socket.on('message:delete', handleDeleteMessage)
      
      return () => {
        socket.emit('unsubscribe:user', params.userId)
        socket.off('message:new', handleNewMessage)
        socket.off('message:edit', handleEditMessage)
        socket.off('message:delete', handleDeleteMessage)
      }
    } else {
      // Fallback на polling, если Socket.IO недоступен
      const interval = setInterval(() => {
        fetchChatData()
      }, CHAT_CONFIG.REFRESH_INTERVAL_MS)
      
      return () => clearInterval(interval)
    }
  }, [params.userId, fetchChatData])

  useEffect(() => {
    // Используем setTimeout для корректного скролла после рендера
    setTimeout(() => {
      scrollToBottom()
    }, 100)
  }, [messages, scrollToBottom])

  // Исправление проблемы с клавиатурой на мобильных
  useEffect(() => {
    const handleResize = () => {
      // Прокручиваем вниз при изменении размера (когда появляется/скрывается клавиатура)
      setTimeout(() => {
        scrollToBottom()
      }, 300)
    }

    const handleVisualViewportChange = () => {
      // Обработка изменения визуального viewport (клавиатура на мобильных)
      setTimeout(() => {
        scrollToBottom()
      }, 100)
    }

    window.addEventListener('resize', handleResize)
    if (typeof window !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewportChange)
    }
    
    return () => {
      window.removeEventListener('resize', handleResize)
      if (typeof window !== 'undefined' && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewportChange)
      }
    }
  }, [scrollToBottom])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Разрешаем фото, видео, аудио и документы
    if (
      file.type.startsWith('image/') ||
      file.type.startsWith('video/') ||
      file.type.startsWith('audio/') ||
      file.type.startsWith('application/')
    ) {
      setSelectedFile(file)
      const url = URL.createObjectURL(file)
      setPreviewUrl(url)
    } else {
      alert('Пожалуйста, выберите фото, видео, аудио или документ')
    }
  }

  const removeFile = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setSelectedFile(null)
    setPreviewUrl(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const sendMessage = async () => {
    if ((!newMessage.trim() && !selectedFile) || sending) return

    setSending(true)
    try {
      const formData = new FormData()
      if (newMessage.trim()) {
        formData.append('message', newMessage)
      }
      if (selectedFile) {
        formData.append('file', selectedFile)
        formData.append('fileType', selectedFile.type)
      }
      if (replyingToId) {
        formData.append('replyToId', replyingToId.toString())
      }

      const response = await fetch(
        `/api/users/${params.userId}/send-message?channel=${channel}`,
        {
          method: 'POST',
          body: formData,
        }
      )

      const data = await response.json()

      if (data.success) {
        setNewMessage('')
        setReplyingToId(null)
        removeFile()
        // Обновляем чат
        await fetchChatData()
        // Фокус на поле ввода
        inputRef.current?.focus()
      } else {
        alert(data.error || 'Ошибка при отправке сообщения')
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      alert('Ошибка при отправке сообщения')
    } finally {
      setSending(false)
    }
  }

  const editMessage = async (messageId: number, newText: string) => {
    try {
      const response = await fetch(
        `/api/users/${params.userId}/messages/${messageId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageText: newText }),
        }
      )

      const data = await response.json()

      if (data.success) {
        setEditingMessageId(null)
        await fetchChatData()
      } else {
        alert(data.error || 'Ошибка при редактировании сообщения')
      }
    } catch (error) {
      console.error('Failed to edit message:', error)
      alert('Ошибка при редактировании сообщения')
    }
  }

  const deleteMessage = async (messageId: number) => {
    if (!confirm('Удалить это сообщение?')) return

    try {
      const response = await fetch(
        `/api/users/${params.userId}/messages/${messageId}`,
        {
          method: 'DELETE',
        }
      )

      const data = await response.json()

      if (data.success) {
        await fetchChatData()
      } else {
        alert(data.error || 'Ошибка при удалении сообщения')
      }
    } catch (error) {
      console.error('Failed to delete message:', error)
      alert('Ошибка при удалении сообщения')
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    } else if (date.toDateString() === yesterday.toDateString()) {
      return `Вчера ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    } else {
      return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    }
  }

  const getReplyPreview = (replyTo: ReplyTo) => {
    if (replyTo.isDeleted) {
      return 'Сообщение удалено'
    }
    if (replyTo.mediaUrl) {
      return `📎 ${replyTo.messageType === 'photo' ? 'Фото' : replyTo.messageType === 'video' ? 'Видео' : replyTo.messageType === 'voice' ? 'Голосовое' : 'Файл'}`
    }
    return replyTo.messageText || 'Медиа'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center text-gray-400 py-12">Пользователь не найден</div>
    )
  }

  const displayName = user.firstName 
    ? (user.lastName ? `${user.firstName} ${user.lastName}` : user.firstName)
    : (user.username ? `@${user.username}` : `ID: ${user.userId}`)

  return (
    <>
      {/* Модальное окно для увеличенного фото */}
      {zoomImage && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={() => setZoomImage(null)}
        >
          <button
            onClick={() => setZoomImage(null)}
            className="absolute top-4 right-4 text-white text-2xl font-bold hover:text-gray-300"
          >
            ✕
          </button>
          <div className="relative max-w-full max-h-full">
            <Image
              src={zoomImage}
              alt="Zoomed"
              width={1200}
              height={1200}
              className="max-w-full max-h-[90vh] object-contain"
              unoptimized
            />
          </div>
        </div>
      )}

      <div className="flex flex-col h-screen max-h-screen overflow-hidden">
        {/* Хедер */}
        <div className="flex items-center justify-between p-3 sm:p-4 bg-gray-800 border-b border-gray-700 flex-shrink-0">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-700 active:bg-gray-600 rounded-lg transition-colors touch-manipulation"
            type="button"
          >
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <Link
            href={`/dashboard/users/${user.userId}`}
            prefetch={false}
            className="flex items-center space-x-3 flex-1 ml-4"
          >
            {user.photoUrl ? (
              <div className="w-10 h-10 rounded-full overflow-hidden relative flex-shrink-0">
                <Image
                  src={user.photoUrl}
                  alt={displayName}
                  fill
                  className="object-cover"
                />
              </div>
            ) : (
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center">
                <span className="text-white text-sm font-bold">{displayName.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{displayName}</p>
              {user.username && (
                <p className="text-xs text-gray-400 truncate">@{user.username}</p>
              )}
              <p className="text-xs text-green-500">онлайн</p>
            </div>
          </Link>
        </div>

        {/* Сообщения */}
        <div 
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-green-950 to-green-900 min-h-0 overscroll-contain"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {messages.length === 0 ? (
            <div className="text-center text-gray-400 py-12">
              <p>Нет сообщений</p>
              <p className="text-sm mt-2">Начните общение</p>
            </div>
          ) : (
            messages.map((message) => {
              if (message.isDeleted) {
                return (
                  <div
                    key={message.id}
                    className={`flex ${message.direction === 'out' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className="px-4 py-2 rounded-2xl bg-gray-800 text-gray-500 text-sm italic">
                      Сообщение удалено
                    </div>
                  </div>
                )
              }

              const isEditing = editingMessageId === message.id
              const isOutgoing = message.direction === 'out'

              return (
                <div
                  key={message.id}
                  className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'} group animate-fadeIn`}
                >
                  <div className="relative">
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-2xl transition-all duration-200 ${
                        isOutgoing
                          ? 'bg-green-500 text-black hover:bg-green-600'
                          : 'bg-gray-700 text-white hover:bg-gray-600'
                      }`}
                    >
                      {/* Ответ на сообщение */}
                      {message.replyTo && (
                        <div className={`mb-2 pb-2 border-l-2 ${
                          isOutgoing ? 'border-gray-800' : 'border-gray-500'
                        } pl-2 text-xs opacity-75`}>
                          <div className="font-semibold">
                            {message.replyTo.direction === 'out' ? 'Вы' : displayName}
                          </div>
                          <div className="truncate">{getReplyPreview(message.replyTo)}</div>
                        </div>
                      )}

                      {/* Медиа */}
                      {message.mediaUrl && (
                        <div className="mb-2 rounded-lg overflow-hidden">
                          {message.messageType === 'photo' ? (
                            <div 
                              className="relative w-full h-64 cursor-pointer"
                              onClick={() => setZoomImage(message.mediaUrl!)}
                            >
                              <Image 
                                src={message.mediaUrl} 
                                alt="Photo" 
                                fill
                                className="object-cover rounded-lg"
                                unoptimized
                              />
                            </div>
                          ) : message.messageType === 'video' ? (
                            <div className="relative w-full">
                              <video 
                                src={message.mediaUrl} 
                                controls 
                                className="w-full max-h-96 rounded-lg"
                                preload="metadata"
                              />
                            </div>
                          ) : message.messageType === 'audio' || message.messageType === 'voice' ? (
                            <div className="flex items-center space-x-2">
                              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                              </svg>
                              <audio
                                src={message.mediaUrl}
                                controls
                                className="flex-1"
                              />
                            </div>
                          ) : (
                            <a
                              href={message.mediaUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center space-x-2 text-sm underline p-2 bg-gray-800 rounded"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
                              </svg>
                              <span>Файл</span>
                            </a>
                          )}
                        </div>
                      )}

                      {/* Текст сообщения */}
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            type="text"
                            defaultValue={message.messageText || ''}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                editMessage(message.id, e.currentTarget.value)
                              } else if (e.key === 'Escape') {
                                setEditingMessageId(null)
                              }
                            }}
                            className="w-full bg-gray-800 text-white rounded px-2 py-1 text-sm"
                            autoFocus
                          />
                          <div className="flex gap-2 text-xs">
                            <button
                              onClick={() => editMessage(message.id, (document.querySelector('input[type="text"]') as HTMLInputElement)?.value || '')}
                              className="text-green-400 hover:text-green-300 active:opacity-70 touch-manipulation"
                              type="button"
                            >
                              Сохранить
                            </button>
                            <button
                              onClick={() => setEditingMessageId(null)}
                              className="text-gray-400 hover:text-gray-300 active:opacity-70 touch-manipulation"
                              type="button"
                            >
                              Отмена
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          {message.messageText && (
                            <p className="text-sm whitespace-pre-wrap break-words">{message.messageText}</p>
                          )}
                          <div className="flex items-center justify-between mt-1">
                            <p className={`text-xs ${isOutgoing ? 'text-gray-800' : 'text-gray-400'}`}>
                              {formatDate(message.createdAt)}
                              {message.editedAt && ' (изменено)'}
                            </p>
                            {isOutgoing && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 ml-2">
                                <button
                                  onClick={() => setEditingMessageId(message.id)}
                                  className="text-xs hover:underline active:opacity-70 touch-manipulation"
                                  title="Редактировать"
                                  type="button"
                                >
                                  ✏️
                                </button>
                                <button
                                  onClick={() => deleteMessage(message.id)}
                                  className="text-xs hover:underline active:opacity-70 touch-manipulation"
                                  title="Удалить"
                                  type="button"
                                >
                                  🗑️
                                </button>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Кнопка ответа для входящих сообщений */}
                    {!isOutgoing && (
                      <button
                        onClick={() => setReplyingToId(message.id)}
                        className="absolute -left-8 top-1/2 transform -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-gray-700 rounded hover:bg-gray-600"
                        title="Ответить"
                      >
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Поле ввода */}
        <div className="p-3 sm:p-4 bg-gray-800 border-t border-gray-700 flex-shrink-0 relative z-10 safe-area-inset-bottom">
          {/* Preview ответа */}
          {replyingToId && (() => {
            const replyToMessage = messages.find(m => m.id === replyingToId)
            return replyToMessage ? (
              <div className="mb-2 p-2 bg-gray-700 rounded-lg flex items-center justify-between border border-gray-600 relative z-20">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-400 mb-0.5">Ответ на:</div>
                  <div className="text-sm text-white truncate">{getReplyPreview(replyToMessage as any)}</div>
                </div>
                <button
                  onClick={() => setReplyingToId(null)}
                  className="ml-2 p-1 text-gray-400 hover:text-white hover:bg-gray-600 active:bg-gray-500 rounded transition-colors touch-manipulation"
                  type="button"
                >
                  ✕
                </button>
              </div>
            ) : null
          })()}

          {/* Preview выбранного файла */}
          {previewUrl && selectedFile && (
            <div className="mb-2 relative">
              {selectedFile.type.startsWith('image/') ? (
                <div className="relative w-full h-32">
                  <Image 
                    src={previewUrl} 
                    alt="Preview" 
                    fill
                    className="object-cover rounded-lg"
                  />
                  <button
                    onClick={removeFile}
                    className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white rounded-full p-1 touch-manipulation"
                    type="button"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : selectedFile.type.startsWith('video/') ? (
                <div className="relative">
                  <video 
                    src={previewUrl} 
                    controls 
                    className="w-full max-h-32 rounded-lg"
                  />
                  <button
                    onClick={removeFile}
                    className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white rounded-full p-1 touch-manipulation"
                    type="button"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : null}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="p-2 hover:bg-gray-700 active:bg-gray-600 rounded-lg transition-colors flex-shrink-0 touch-manipulation"
              title="Прикрепить файл"
              type="button"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="p-2 hover:bg-gray-700 active:bg-gray-600 rounded-lg transition-colors flex-shrink-0 relative touch-manipulation"
              title="Шаблоны ответов"
              type="button"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {showTemplates && templates.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-64 bg-gray-800 rounded-lg border border-gray-700 max-h-64 overflow-y-auto z-50 shadow-xl">
                  <div className="p-2 text-xs text-gray-400 border-b border-gray-700 bg-gray-900">Шаблоны ответов</div>
                  {templates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => {
                        setNewMessage(template.text || template.content || '')
                        setShowTemplates(false)
                        inputRef.current?.focus()
                      }}
                      className="w-full p-3 text-left hover:bg-gray-700 active:bg-gray-600 transition-colors border-b border-gray-700/50 last:border-0 touch-manipulation"
                      type="button"
                    >
                      <div className="text-sm text-white font-medium">{template.title}</div>
                      {template.category && (
                        <div className="text-xs text-gray-400 mt-0.5">{template.category}</div>
                      )}
                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">{template.text}</div>
                    </button>
                  ))}
                </div>
              )}
            </button>
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              placeholder="Введите сообщение..."
              className="flex-1 bg-gray-700 text-white rounded-lg px-3 sm:px-4 py-2 text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-green-500 min-w-0"
              disabled={sending}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
            <button
              onClick={sendMessage}
              disabled={sending || (!newMessage.trim() && !selectedFile)}
              className="p-2 bg-green-500 hover:bg-green-600 active:bg-green-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 touch-manipulation"
              type="button"
            >
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
