"use client"
import { useState, useEffect, useCallback, useRef } from 'react'
import Image from 'next/image'
import { useLanguage } from '../../components/LanguageContext'
import FixedHeaderControls from '../../components/FixedHeaderControls'
import { getTelegramUser, getTelegramUserId, getTelegramWebApp } from '../../utils/telegram'
import { getApiBase } from '../../utils/fetch'
import { HistoryIcon, BackIcon } from '../../components/Icons'
import { useRequireAuth } from '../../hooks/useRequireAuth'

interface Transaction {
  id: string
  type: 'deposit' | 'withdraw'
  bookmaker: string
  bank?: string
  amount: number
  status: string
  date: string
  withdrawalCode?: string
}

export default function HistoryPage(){
  const isAuthorized = useRequireAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'deposit' | 'withdraw'>('all')
  const { language } = useLanguage()
  const isMountedRef = useRef(true)

  const translations = {
    ru: {
      title: 'История операций',
      empty: 'История операций пуста',
      deposit: 'Пополнение',
      withdraw: 'Вывод',
      pending: 'Отменено',
      completed: 'Успешно',
      approved: 'Успешно',
      rejected: 'Отклонено',
      failed: 'Отклонено',
      deferred: 'Отменено',
      auto_completed: 'Успешно',
      autodeposit_success: 'Успешно',
      cancelled: 'Отменено',
      'profile-5': 'Отклонено',
      loading: 'Загружаем...',
      amount: 'Сумма',
      status: 'Статус',
      date: 'Дата',
      bookmaker: 'Счет',
      backToMain: 'На главную',
      all: 'Все',
      confirmationCode: 'Код подтверждения'
    },
    en: {
      title: 'Transaction History',
      empty: 'Transaction history is empty',
      deposit: 'Deposit',
      withdraw: 'Withdraw',
      pending: 'Cancelled',
      completed: 'Success',
      approved: 'Success',
      rejected: 'Rejected',
      failed: 'Rejected',
      deferred: 'Cancelled',
      auto_completed: 'Success',
      autodeposit_success: 'Success',
      cancelled: 'Cancelled',
      'profile-5': 'Rejected',
      loading: 'Loading...',
      amount: 'Amount',
      status: 'Status',
      date: 'Date',
      bookmaker: 'Bookmaker',
      backToMain: 'Back to main',
      all: 'All',
      confirmationCode: 'Confirmation code'
    },
    ky: {
      title: 'Операциялар тарыхы',
      empty: 'Операциялар тарыхы бош',
      deposit: 'Депозит',
      withdraw: 'Чыгаруу',
      pending: 'Жокко чыгарылды',
      completed: 'Ийгиликтүү',
      approved: 'Ийгиликтүү',
      rejected: 'Токтотулду',
      failed: 'Токтотулду',
      deferred: 'Жокко чыгарылды',
      auto_completed: 'Ийгиликтүү',
      autodeposit_success: 'Ийгиликтүү',
      cancelled: 'Жокко чыгарылды',
      'profile-5': 'Токтотулду',
      loading: 'Жүктөөдө...',
      amount: 'Сумма',
      status: 'Статус',
      date: 'Күн',
      bookmaker: 'Счет',
      backToMain: '🔙 Башкы менюга',
      all: 'Баары',
      confirmationCode: 'Ырастоо коду'
    },
    uz: {
      title: 'Operatsiyalar tarixi',
      empty: 'Operatsiyalar tarixi bo\'sh',
      deposit: 'Depozit',
      withdraw: 'Chiqarish',
      pending: 'Bekor qilindi',
      completed: 'Muvaffaqiyatli',
      approved: 'Muvaffaqiyatli',
      rejected: 'Rad etildi',
      failed: 'Rad etildi',
      deferred: 'Bekor qilindi',
      auto_completed: 'Muvaffaqiyatli',
      autodeposit_success: 'Muvaffaqiyatli',
      cancelled: 'Bekor qilindi',
      'profile-5': 'Rad etildi',
      loading: 'Yuklanmoqda...',
      amount: 'Miqdor',
      status: 'Holat',
      date: 'Sana',
      bookmaker: 'Bukmeker',
      backToMain: '🔙 Asosiy menyuga',
      all: 'Barchasi',
      confirmationCode: 'Tasdiqlash kodi'
    }
  }

  const t = translations[language as keyof typeof translations] || translations.ru

  const loadTransactions = useCallback(async () => {
    if (!isMountedRef.current) return
    
    setLoading(true)
    try {
      // Получаем данные пользователя из Telegram WebApp (используем тот же подход, что в профиле)
      const telegramUser = getTelegramUser()
      
      // Если пользователь не найден, не делаем запрос
      if (!telegramUser || !telegramUser.id) {
        console.log('❌ User not found in Telegram WebApp')
        if (!isMountedRef.current) return
        setTransactions([])
        setLoading(false)
        return
      }

      // Используем числовой ID из объекта пользователя (как в профиле)
      const userId = telegramUser.id

      console.log('👤 Loading transactions for user ID:', userId)

      // Запрашиваем историю транзакций пользователя с админ-панели API
      const apiUrl = getApiBase()
      
      // Формируем параметры запроса в зависимости от фильтра
      let url = `${apiUrl}/api/transaction-history?user_id=${userId}`
      if (filter === 'deposit') {
        url += '&type=deposit'
      } else if (filter === 'withdraw') {
        url += '&type=withdraw'
      }
      
      console.log('📡 Fetching transactions from:', url)
      
      const response = await fetch(url)
      
      // Проверяем статус ответа
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('❌ Error loading transactions:', errorData)
        if (!isMountedRef.current) return
        setTransactions([])
        setLoading(false)
        return
      }
      
      const data = await response.json()
      console.log('✅ API Response:', { 
        success: data.success, 
        hasData: !!data.data, 
        transactionsCount: data.data?.transactions?.length || data.transactions?.length || 0,
        transactions: data.data?.transactions || data.transactions || []
      })
      
      // Админ-панель возвращает данные в формате { success: true, data: { transactions: [...] } }
      const transactionsData = data.data?.transactions || data.transactions || []
      
      console.log('📦 Transactions data:', { 
        rawCount: transactionsData.length, 
        firstTransaction: transactionsData[0] 
      })
      
      // Проверяем успешность ответа - если success не false, то считаем успешным
      // (API может не всегда возвращать success: true, но если нет ошибки - всё ок)
      if (data.success !== false) {
        // Преобразуем данные в формат для отображения
        const formattedTransactions = transactionsData.map((tx: any) => {
          // Определяем статус: если pending/deferred и прошло больше 5 минут - это отменено
          let finalStatus = tx.status || 'pending'
          if ((finalStatus === 'pending' || finalStatus === 'deferred') && tx.date) {
            const txDate = new Date(tx.date || tx.created_at)
            const now = new Date()
            const diffMinutes = (now.getTime() - txDate.getTime()) / (1000 * 60)
            // Если прошло больше 5 минут и статус pending - это отменено
            if (diffMinutes > 5 && finalStatus === 'pending') {
              finalStatus = 'cancelled'
            }
          }
          
          return {
            id: tx.id?.toString() || '',
            type: tx.type || tx.request_type || tx.requestType || 'deposit',
            bookmaker: tx.bookmaker || '',
            bank: tx.bank || '',
            amount: tx.amount || 0,
            status: finalStatus,
            date: tx.date || tx.created_at || tx.createdAt || new Date().toISOString(),
            withdrawalCode: tx.withdrawalCode || tx.withdrawal_code || null
          }
        })
        
        console.log('📊 Formatted transactions:', formattedTransactions.length)
        if (isMountedRef.current) {
          setTransactions(formattedTransactions)
        }
      } else {
        console.error('❌ Error loading transactions - API returned error:', data.error || data)
        if (isMountedRef.current) {
          setTransactions([])
        }
      }
    } catch (error) {
      console.error('Error loading transactions:', error)
      if (isMountedRef.current) {
        setTransactions([])
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }, [filter])

  // Функция для совместимости с HTML шаблоном
  const displayRealTransactions = useCallback(() => {
    if (isMountedRef.current) {
      loadTransactions()
    }
  }, [loadTransactions])

  // Делаем функцию доступной глобально для HTML шаблона
  useEffect(() => {
    (window as any).displayRealTransactions = displayRealTransactions
    return () => {
      delete (window as any).displayRealTransactions
    }
  }, [displayRealTransactions])

  // Инициализация компонента
  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Загружаем транзакции при первой загрузке и при изменении фильтра
  useEffect(() => {
    // В Telegram Mini App пользователь всегда авторизован, поэтому можно загружать сразу
    const isMiniApp = typeof window !== 'undefined' && !!getTelegramWebApp()
    
    // Загружаем если:
    // 1. Авторизация подтверждена (true) - всегда загружаем
    // 2. Это Mini App и авторизация еще проверяется (null) - для первой загрузки
    // Не загружаем только если авторизация точно false
    const shouldLoad = isMountedRef.current && (
      isAuthorized === true || 
      (isMiniApp && isAuthorized !== false)
    )
    
    if (shouldLoad) {
      console.log('🔄 Loading transactions - isAuthorized:', isAuthorized, 'filter:', filter, 'isMiniApp:', isMiniApp)
      loadTransactions()
    } else {
      console.log('⏳ Skipping load - isAuthorized:', isAuthorized, 'isMiniApp:', isMiniApp, 'mounted:', isMountedRef.current)
    }
  }, [filter, isAuthorized, loadTransactions])

  // Не показываем контент, пока проверяется авторизация
  if (isAuthorized === null || isAuthorized === false) {
    // Показываем loading вместо null, чтобы хуки всегда выполнялись
    return (
      <main className="space-y-6">
        <FixedHeaderControls />
        <div className="text-center py-12">
          <div style={{
            animation: 'spin 1s linear infinite',
            borderRadius: '50%',
            height: '48px',
            width: '48px',
            border: '2px solid #22c55e',
            borderTopColor: 'transparent',
            margin: '0 auto 16px'
          }}></div>
          <div style={{ color: 'rgba(255, 255, 255, 0.7)' }}>Загрузка...</div>
        </div>
      </main>
    )
  }

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString)
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)

      // Проверяем, сегодня ли это
      if (date.toDateString() === today.toDateString()) {
        return `Сегодня ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
      }
      // Проверяем, вчера ли это
      else if (date.toDateString() === yesterday.toDateString()) {
        return `Вчера ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
      }
      // Иначе показываем полную дату
      else {
        return date.toLocaleDateString('ru-RU', { 
          day: '2-digit', 
          month: '2-digit', 
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      }
    } catch (error) {
      // Если не удалось распарсить дату, возвращаем как есть
      return dateString
    }
  }

  const getStatusColor = (status: string) => {
    const statusLower = status.toLowerCase()
    switch (statusLower) {
      case 'completed':
      case 'approved':
      case 'auto_completed':
      case 'autodeposit_success':
        return 'text-green-400'
      case 'pending':
      case 'deferred':
      case 'cancelled':
        return 'text-yellow-400'
      case 'failed':
      case 'rejected':
      case 'profile-5':
        return 'text-red-400'
      default:
        // Для неизвестных статусов проверяем, содержит ли он "profile"
        if (statusLower.includes('profile')) {
          return 'text-red-400' // Отклонено
        }
        return 'text-yellow-400' // По умолчанию отменено
    }
  }

  const getStatusText = (status: string) => {
    const statusLower = status.toLowerCase()
    switch (statusLower) {
      // Успешно
      case 'completed':
      case 'approved':
      case 'auto_completed':
      case 'autodeposit_success':
        return t.completed // "Успешно"
      // Отклонено
      case 'rejected':
      case 'failed':
      case 'profile-5':
        return t.rejected // "Отклонено"
      // Отменено (таймер истек, не нажал "Я оплатил")
      case 'pending':
      case 'deferred':
      case 'cancelled':
        return t.pending // "Отменено"
      default:
        // Для неизвестных статусов проверяем, содержит ли он "profile" или другие ошибки
        if (statusLower.includes('profile') || statusLower.includes('error') || statusLower.includes('fail')) {
          return t.rejected // "Отклонено"
        }
        // По умолчанию считаем отменено
        return t.pending // "Отменено"
    }
  }

  const getTypeText = (type: string) => {
    return type === 'deposit' ? t.deposit : t.withdraw
  }

  const getBookmakerName = (bookmaker: string) => {
    const names: Record<string, string> = {
      '1xbet': '1xBet',
      '1win': '1WIN',
      'melbet': 'Melbet',
      'mostbet': 'Mostbet',
      'winwin': 'Winwin',
      '888starz': '888starz',
    }
    return names[bookmaker?.toLowerCase()] || bookmaker || 'N/A'
  }

  const getBankIcon = (bankCode: string) => {
    if (!bankCode) return null
    
    const normalized = bankCode.toLowerCase()
    
    // Маппинг банков на изображения (используем includes для гибкости)
    if (normalized.includes('companion') || normalized.includes('kompanion')) {
      return { image: '/images/companion.png', name: 'Компаньон' }
    }
    if (normalized.includes('demirbank') || normalized.includes('demir')) {
      return { image: '/images/demirbank.jpg', name: 'DemirBank' }
    }
    if (normalized.includes('omoney') || normalized.includes('o!money') || normalized.includes('odengi')) {
      return { image: '/images/omoney.jpg', name: 'O!Money' }
    }
    if (normalized.includes('balance')) {
      return { image: '/images/balance.jpg', name: 'Balance.kg' }
    }
    if (normalized.includes('bakai')) {
      return { image: '/images/bakai.jpg', name: 'Bakai' }
    }
    if (normalized.includes('megapay')) {
      return { image: '/images/megapay.jpg', name: 'MegaPay' }
    }
    if (normalized.includes('mbank')) {
      return { image: '/images/mbank.png', name: 'MBank' }
    }
    if (normalized.includes('optima')) {
      return { image: '/images/optima.jpg', name: 'Optima' }
    }
    
    return null
  }

  return (
    <main className="space-y-6">
      <FixedHeaderControls />
      {/* Заголовок */}
      <div className="text-center space-y-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
          <div className="flex items-center justify-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-green-500/30">
              <HistoryIcon className="w-6 h-6 text-black" />
            </div>
            <h1 className="text-2xl font-semibold text-white/90">{t.title}</h1>
          </div>
        </div>
        <div className="px-4 overflow-x-auto -mx-4 scrollbar-hide">
          <div className="flex justify-center gap-3 min-w-max px-4 pb-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                filter === 'all'
                  ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-black'
                  : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span>{t.all}</span>
            </button>
            <button
              onClick={() => setFilter('deposit')}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                filter === 'deposit'
                  ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-black'
                  : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
              <span>{t.deposit}</span>
            </button>
            <button
              onClick={() => setFilter('withdraw')}
              className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                filter === 'withdraw'
                  ? 'bg-gradient-to-r from-green-400 to-emerald-500 text-black'
                  : 'bg-white/10 text-white/70 hover:bg-white/15'
              }`}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              <span>{t.withdraw}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Список транзакций */}
      <section className="space-y-3">
        {loading ? (
          <div style={{
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            backdropFilter: 'blur(8px)',
            borderRadius: '12px',
            padding: '32px',
            textAlign: 'center',
            border: '1px solid rgba(255, 255, 255, 0.2)'
          }}>
            <div style={{
              animation: 'spin 1s linear infinite',
              borderRadius: '50%',
              height: '48px',
              width: '48px',
              border: '2px solid #22c55e',
              borderTopColor: 'transparent',
              margin: '0 auto 16px'
            }}></div>
            <div style={{
              color: 'rgba(255, 255, 255, 0.7)'
            }}>{t.loading}</div>
          </div>
        ) : transactions.length === 0 ? (
          <div className="card text-center py-12">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-white/70 text-lg">{t.empty}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {transactions.map((transaction) => {
              const bankIcon = getBankIcon(transaction.bank || '')
              return (
              <div key={transaction.id} className="rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                        {bankIcon && bankIcon.image ? (
                          <div className="relative w-6 h-6">
                            <Image 
                              src={bankIcon.image} 
                              alt={bankIcon.name}
                              fill
                              sizes="24px"
                              loading="lazy"
                              quality={75}
                              className="object-contain rounded-full"
                            />
                          </div>
                        ) : (
                          <div className={`w-2.5 h-2.5 rounded-full ${
                            transaction.type === 'deposit' ? 'bg-green-400' : 'bg-red-400'
                          }`}></div>
                        )}
                      </div>
                      <div className="font-semibold text-white/90 text-base">
                        {getTypeText(transaction.type)}
                      </div>
                      <div className="text-white/60 text-sm">
                        • {getBookmakerName(transaction.bookmaker)}
                      </div>
                    </div>
                    <div className="text-xs text-white/60">
                      {formatDate(transaction.date)}
                    </div>
                    {transaction.type === 'withdraw' && transaction.withdrawalCode && (
                      <div className="text-xs text-white/70 mt-1">
                        <span className="text-white/50">{t.confirmationCode}: </span>
                        <span className="font-mono font-semibold">{transaction.withdrawalCode}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right space-y-1 ml-4">
                    <div className={`font-bold text-lg ${
                      transaction.type === 'deposit' ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {transaction.type === 'deposit' ? '+' : '-'}{transaction.amount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} сом
                    </div>
                    <div className={`text-xs font-medium px-2 py-1 rounded-full inline-block ${
                      (() => {
                        const color = getStatusColor(transaction.status)
                        const bgColor = color.replace('text-green-400', 'bg-green-500/20').replace('text-yellow-400', 'bg-yellow-500/20').replace('text-red-400', 'bg-red-500/20').replace('text-white/60', 'bg-gray-500/20')
                        return `${bgColor} ${color} border ${color.replace('text-', 'border-').replace('400', '500/30')}`
                      })()
                    }`}>
                      {getStatusText(transaction.status)}
                    </div>
                  </div>
                </div>
              </div>
            )
            })}
          </div>
        )}
      </section>

      {/* Навигация */}
      <div className="text-center px-4 pb-6">
        <a 
          href="/" 
          className="inline-flex items-center gap-2 bg-gray-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-700 transition-colors"
        >
          <BackIcon className="w-5 h-5" />
          {t.backToMain}
        </a>
      </div>
    </main>
  )
}

