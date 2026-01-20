'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { TelegramUser, getTelegramUser, getTelegramUserId } from '../../utils/telegram'
import { getApiBase } from '../../utils/fetch'
import { useLanguage } from '../../components/LanguageContext'
import FixedHeaderControls from '../../components/FixedHeaderControls'
import { PremiumIcon, TransactionDepositIcon, TransactionWithdrawIcon, BackIcon } from '../../components/Icons'

interface UserStats {
  totalDeposits: number
  totalWithdraws: number
  totalDepositAmount: number
  totalWithdrawAmount: number
  recentTransactions: any[]
}

export default function ProfilePage() {
  const [user, setUser] = useState<TelegramUser | null>(null)
  const [stats, setStats] = useState<UserStats | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const { language } = useLanguage()

  useEffect(() => {
    const loadUserData = () => {
      const telegramUser = getTelegramUser()
      if (telegramUser) {
        setUser(telegramUser)
        loadStats(telegramUser.id)
      } else {
        setLoading(false)
      }
    }

    loadUserData()
  }, [])

  const loadStats = async (userId: number) => {
    try {
      const apiUrl = getApiBase()
      
      // Загружаем все транзакции (без фильтрации по статусу)
      // Используем большой лимит, чтобы получить все транзакции
      let allTransactions: any[] = []
      let offset = 0
      const limit = 1000
      let hasMore = true
      
      // Загружаем все транзакции пачками
      while (hasMore) {
        const response = await fetch(`${apiUrl}/api/transaction-history?user_id=${userId}&limit=${limit}&offset=${offset}`)
        const data = await response.json()
        
        const transactions = data.data?.transactions || data.transactions || []
        allTransactions = allTransactions.concat(transactions)
        
        // Проверяем, есть ли еще транзакции
        hasMore = data.data?.pagination?.hasMore || transactions.length === limit
        offset += limit
        
        // Защита от бесконечного цикла (максимум 10 запросов = 10000 транзакций)
        if (offset >= 10000) {
          break
        }
      }
      
      // Считаем транзакции по типу, исключая отклоненные заявки
      const deposits = allTransactions.filter((t: any) => {
        const rawType = t?.type || t?.requestType || t?.request_type
        const type = typeof rawType === 'string' ? rawType.toLowerCase() : ''
        const status = t?.status || t?.requestStatus || ''
        // Исключаем отклоненные заявки
        return type === 'deposit' && status !== 'rejected'
      })
      const withdraws = allTransactions.filter((t: any) => {
        const rawType = t?.type || t?.requestType || t?.request_type
        const type = typeof rawType === 'string' ? rawType.toLowerCase() : ''
        const status = t?.status || t?.requestStatus || ''
        // Исключаем отклоненные заявки
        return (type === 'withdraw' || type === 'withdrawal') && status !== 'rejected'
      })
      
      const userStats: UserStats = {
        totalDeposits: deposits.length, // Только успешные пополнения (без отклоненных)
        totalWithdraws: withdraws.length, // Только успешные выводы (без отклоненных)
        totalDepositAmount: deposits
          .reduce((sum: number, t: any) => sum + (t.amount || 0), 0),
        totalWithdrawAmount: withdraws
          .reduce((sum: number, t: any) => sum + (t.amount || 0), 0),
        recentTransactions: allTransactions.slice(0, 5)
      }
      
      setStats(userStats)
    } catch (error) {
      console.error('Error loading stats:', error)
      setStats({
        totalDeposits: 0,
        totalWithdraws: 0,
        totalDepositAmount: 0,
        totalWithdrawAmount: 0,
        recentTransactions: []
      })
    } finally {
      setLoading(false)
    }
  }

  const translations = {
    ru: {
      title: 'Профиль',
      deposits: 'Пополнений',
      withdraws: 'Выводов',
      totalDeposited: 'Всего пополнено',
      totalWithdrawn: 'Всего выведено',
      recentTransactions: 'Последние операции',
      viewAll: 'Посмотреть все',
      back: 'Назад',
      exitTelegram: 'Выйти в Telegram'
    },
    en: {
      title: 'Profile',
      deposits: 'Deposits',
      withdraws: 'Withdrawals',
      totalDeposited: 'Total Deposited',
      totalWithdrawn: 'Total Withdrawn',
      recentTransactions: 'Recent Transactions',
      viewAll: 'View All',
      back: 'Back',
      exitTelegram: 'Exit to Telegram'
    }
  }

  const t = translations[language as keyof typeof translations] || translations.ru

  const activity = stats
    ? (() => {
        const totalOps = (stats.totalDeposits || 0) + (stats.totalWithdraws || 0)
        const tiers = [
          { min: 0, max: 9, ru: 'Новичок', en: 'Beginner' },
          { min: 10, max: 49, ru: 'Активный', en: 'Active' },
          { min: 50, max: 99, ru: 'Профи', en: 'Pro' },
          { min: 100, max: 199, ru: 'Элита', en: 'Elite' },
          { min: 200, max: Infinity, ru: 'Легенда', en: 'Legend' },
        ]
        const current = tiers.find((tier) => totalOps >= tier.min && totalOps <= tier.max) || tiers[0]
        const nextTarget = current.max === Infinity ? current.min : current.max + 1
        const progress = current.max === Infinity ? 100 : Math.min(100, (totalOps / nextTarget) * 100)
        const label = language === 'en' ? current.en : current.ru
        const nextLabel = language === 'en' ? 'Next level at' : 'Следующий уровень с'
        return { totalOps, label, nextTarget, progress, nextLabel }
      })()
    : null

  if (loading) {
    return (
      <main style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <FixedHeaderControls />
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
            border: '2px solid #4fa9ff',
            borderTopColor: 'transparent',
            margin: '0 auto 16px'
          }}></div>
          <div style={{
            color: 'rgba(255, 255, 255, 0.7)'
          }}>Загрузка...</div>
        </div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="space-y-6">
        <FixedHeaderControls />
        <div className="card text-center py-8">
          <p className="text-white/70">Пользователь не найден</p>
          <button
            onClick={() => router.push('/')}
            className="mt-4 btn btn-primary"
          >
            {t.back}
          </button>
        </div>
      </main>
    )
  }

  const avatarUrl = user.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.first_name + (user.last_name || ''))}&background=4fa9ff&color=fff&size=256`

  return (
    <main className="space-y-6" style={{ paddingBottom: '100px' }}>
      <FixedHeaderControls />
      
      {/* Заголовок */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white pr-20">{t.title}</h1>
      </div>

      {/* Профиль пользователя */}
      <div className="card p-6 profile-header-3d">
        <div className="flex flex-col items-center space-y-4">
          {/* Аватарка */}
          <div className="relative">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center overflow-hidden profile-avatar-3d">
              {user.photo_url ? (
                <img 
                  src={avatarUrl} 
                  alt={user.first_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-4xl font-bold text-white">
                  {user.first_name?.[0]?.toUpperCase() || 'U'}
                </span>
              )}
            </div>
            {user.is_premium && (
              <div className="absolute -top-2 -right-2 w-8 h-8 bg-yellow-400 rounded-full flex items-center justify-center">
                <PremiumIcon className="w-5 h-5 text-yellow-900" />
              </div>
            )}
          </div>

          {/* Имя и username */}
          <div className="text-center">
            <h2 className="text-2xl font-bold text-white">
              {user.first_name} {user.last_name || ''}
            </h2>
            {user.username && (
              <p className="text-white/60 mt-1">@{user.username}</p>
            )}
          </div>
        </div>
      </div>

      {/* Статистика */}
      {stats && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="card p-4 text-center stat-card-3d">
              <div className="text-3xl font-bold text-sky-300 mb-1">{stats.totalDeposits}</div>
              <div className="text-sm text-white/70">{t.deposits}</div>
              <div className="text-xs text-white/50 mt-1">
                {stats.totalDepositAmount.toLocaleString('ru-RU')} сом
              </div>
            </div>
            <div className="card p-4 text-center stat-card-3d">
              <div className="text-3xl font-bold text-blue-400 mb-1">{stats.totalWithdraws}</div>
              <div className="text-sm text-white/70">{t.withdraws}</div>
              <div className="text-xs text-white/50 mt-1">
                {stats.totalWithdrawAmount.toLocaleString('ru-RU')} сом
              </div>
            </div>
          </div>
          {/* Последние операции */}
          {stats.recentTransactions.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">{t.recentTransactions}</h3>
                <a 
                  href="/history"
                  className="text-sm text-sky-300 hover:text-sky-300"
                >
                  {t.viewAll} →
                </a>
              </div>
              <div className="space-y-2">
                {stats.recentTransactions.map((transaction: any) => (
                  <div 
                    key={transaction.id}
                    className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        transaction.type === 'deposit' ? 'bg-sky-500/20' : 'bg-blue-500/20'
                      }`}>
                        {transaction.type === 'deposit' ? (
                          <TransactionDepositIcon className="w-5 h-5 text-sky-300" />
                        ) : (
                          <TransactionWithdrawIcon className="w-5 h-5 text-blue-400" />
                        )}
                      </div>
                      <div>
                        <div className="text-white font-medium">
                          {transaction.type === 'deposit' ? 'Пополнение' : 'Вывод'}
                        </div>
                        <div className="text-xs text-white/50">
                          {new Date(transaction.date).toLocaleDateString('ru-RU')}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${
                        transaction.type === 'deposit' ? 'text-sky-300' : 'text-blue-400'
                      }`}>
                        {transaction.type === 'deposit' ? '+' : '-'}{transaction.amount.toLocaleString('ru-RU')} сом
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Кнопки */}
      <div className="flex gap-3">
        <button
          onClick={() => router.push('/')}
          className="btn btn-ghost flex-1 flex items-center justify-center gap-2"
        >
          <BackIcon className="w-5 h-5" />
          {t.back}
        </button>
        <button
          onClick={() => {
            const botUrl = 'https://t.me/operator_luxon_bot'
            if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
              // Закрываем мини-приложение, либо открываем Telegram ссылку
              try {
                window.Telegram.WebApp.close()
              } catch {
                window.Telegram.WebApp.openTelegramLink(botUrl)
              }
            } else {
              window.location.href = botUrl
            }
          }}
          className="btn btn-primary flex-1 flex items-center justify-center gap-2"
        >
          {t.exitTelegram}
        </button>
      </div>
    </main>
  )
}


