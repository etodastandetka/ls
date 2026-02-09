'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
// Иконки через SVG компоненты

interface SearchResult {
  id: string
  type: 'user' | 'request'
  // User fields
  userId?: string
  username?: string
  firstName?: string
  lastName?: string
  fullName?: string
  language?: string
  isActive?: boolean
  createdAt?: string
  // Request fields
  requestId?: number
  accountId?: string
  amount?: number
  status?: string
  requestType?: string
  bookmaker?: string
  bank?: string
  withdrawalCode?: string
  processedAt?: string | null
  processedBy?: string | null
}

interface SearchResponse {
  users: SearchResult[]
  requests: SearchResult[]
  total: number
}

export default function SearchPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [searchType, setSearchType] = useState<'all' | 'users' | 'requests'>('all')
  const [results, setResults] = useState<SearchResponse>({ users: [], requests: [], total: 0 })
  const [loading, setLoading] = useState(false)
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null)

  // Поиск с задержкой (debounce)
  useEffect(() => {
    if (query.trim().length < 1) {
      setResults({ users: [], requests: [], total: 0 })
      setLoading(false)
      return
    }

    setLoading(true)
    const timer = setTimeout(() => {
      performSearch(query.trim(), searchType)
    }, 300) // Задержка 300ms

    setDebounceTimer(timer)

    return () => {
      clearTimeout(timer)
    }
  }, [query, searchType])

  const performSearch = async (searchQuery: string, type: string) => {
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&type=${type}`)
      const data = await response.json()

      if (data.success) {
        setResults(data.data || { users: [], requests: [], total: 0 })
      } else {
        setResults({ users: [], requests: [], total: 0 })
      }
    } catch (error) {
      console.error('Search error:', error)
      setResults({ users: [], requests: [], total: 0 })
    } finally {
      setLoading(false)
    }
  }

  const handleResultClick = (result: SearchResult) => {
    if (result.type === 'user' && result.userId) {
      router.push(`/dashboard/users/${result.userId}`)
    } else if (result.type === 'request' && result.requestId) {
      router.push(`/dashboard/requests/${result.requestId}`)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'completed':
      case 'approved':
        return 'bg-green-500/20 text-green-400'
      case 'rejected':
        return 'bg-red-500/20 text-red-400'
      case 'pending':
      case 'deferred':
        return 'bg-yellow-500/20 text-yellow-400'
      default:
        return 'bg-gray-500/20 text-gray-400'
    }
  }

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Заголовок */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">Поиск</h1>
          <p className="text-gray-400">Найдите игроков, заявки и другую информацию</p>
        </div>

        {/* Поисковая форма */}
        <div className="bg-gray-800 rounded-2xl p-6 mb-6 border border-gray-700">
          <div className="flex flex-col gap-4">
            {/* Поле поиска */}
            <div className="relative">
              <svg
                className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Введите ID игрока, номер заявки, имя, username..."
                className="w-full pl-12 pr-4 py-3 bg-gray-700 border border-gray-600 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                autoFocus
              />
              {loading && (
                <svg
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
            </div>

            {/* Фильтры типа поиска */}
            <div className="flex gap-2">
              <button
                onClick={() => setSearchType('all')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  searchType === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                Все
              </button>
              <button
                onClick={() => setSearchType('users')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                  searchType === 'users'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                Игроки
              </button>
              <button
                onClick={() => setSearchType('requests')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                  searchType === 'requests'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Заявки
              </button>
            </div>
          </div>
        </div>

        {/* Результаты поиска */}
        {query.trim().length >= 1 && (
          <div className="space-y-4">
            {/* Статистика */}
            {!loading && results.total > 0 && (
              <div className="text-gray-400 text-sm">
                Найдено результатов: {results.total}
              </div>
            )}

            {/* Результаты - Игроки */}
            {searchType === 'all' || searchType === 'users' ? (
              <div>
                {results.users.length > 0 && (
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Игроки ({results.users.length})
                    </h2>
                    <div className="space-y-2">
                      {results.users.map((user) => (
                        <div
                          key={user.id}
                          onClick={() => handleResultClick(user)}
                          className="bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-blue-500 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-white font-semibold">
                                  {user.fullName || user.username || 'Без имени'}
                                </h3>
                                {user.isActive === false && (
                                  <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                                    Неактивен
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-gray-400 space-y-1">
                                <div>ID: {user.userId}</div>
                                {user.username && <div>Username: @{user.username}</div>}
                                <div>Язык: {user.language || 'ru'}</div>
                                <div>Создан: {formatDate(user.createdAt)}</div>
                              </div>
                            </div>
                            <div className="ml-4">
                              <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Результаты - Заявки */}
            {searchType === 'all' || searchType === 'requests' ? (
              <div>
                {results.requests.length > 0 && (
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Заявки ({results.requests.length})
                    </h2>
                    <div className="space-y-2">
                      {results.requests.map((request) => (
                        <div
                          key={request.id}
                          onClick={() => handleResultClick(request)}
                          className="bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-blue-500 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h3 className="text-white font-semibold">
                                  Заявка #{request.requestId}
                                </h3>
                                <span
                                  className={`px-2 py-1 text-xs rounded ${getStatusColor(
                                    request.status || ''
                                  )}`}
                                >
                                  {request.status || '-'}
                                </span>
                                <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded">
                                  {request.requestType === 'deposit' ? 'Пополнение' : 'Вывод'}
                                </span>
                              </div>
                              <div className="text-sm text-gray-400 space-y-1">
                                <div>
                                  Сумма: <span className="text-white font-medium">{request.amount?.toFixed(2) || '-'} сом</span>
                                </div>
                                <div>Букмекер: {request.bookmaker || '-'}</div>
                                {request.bank && <div>Банк: {request.bank}</div>}
                                <div>ID счета: {request.accountId || '-'}</div>
                                {request.userId && <div>ID пользователя: {request.userId}</div>}
                                {request.withdrawalCode && (
                                  <div>Код вывода: {request.withdrawalCode}</div>
                                )}
                                <div>Создана: {formatDate(request.createdAt)}</div>
                                {request.processedAt && (
                                  <div>
                                    Обработана: {formatDate(request.processedAt)}
                                    {request.processedBy && ` (${request.processedBy})`}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="ml-4">
                              <div className="w-12 h-12 bg-purple-600 rounded-full flex items-center justify-center">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {/* Нет результатов */}
            {!loading && results.total === 0 && query.trim().length >= 1 && (
              <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
                <svg className="w-12 h-12 text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-gray-400 text-lg">Ничего не найдено</p>
                <p className="text-gray-500 text-sm mt-2">
                  Попробуйте изменить запрос или использовать другой фильтр
                </p>
              </div>
            )}

            {/* Подсказка */}
            {query.trim().length === 0 && (
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
                <p className="text-gray-400 text-center">
                  Введите запрос для поиска игроков и заявок
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

