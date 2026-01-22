"use client"
import { useState, useEffect, Suspense } from 'react'
import FixedHeaderControls from '../../../../components/FixedHeaderControls'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '../../../../components/LanguageContext'
import PageTransition from '../../../../components/PageTransition'
import { safeFetch, getApiBase } from '../../../../utils/fetch'
import { getTelegramUserId, getTelegramUser } from '../../../../utils/telegram'
import { useRequireAuth } from '../../../../hooks/useRequireAuth'

function ReferralWithdrawStep2Content() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { language } = useLanguage()
  const isAuthorized = useRequireAuth()
  const [accountId, setAccountId] = useState('')
  const [loading, setLoading] = useState(false)
  const [availableBalance, setAvailableBalance] = useState(0)
  const bookmaker = searchParams.get('bookmaker') || ''

  const loadAvailableBalance = async () => {
    try {
      // Используем оптимизированную функцию для получения ID
      const userId = getTelegramUserId()

      if (!userId) {
        console.error('No user ID found')
        return
      }

      const apiUrl = getApiBase()
      
      const response = await safeFetch(`${apiUrl}/api/public/referral-data?user_id=${userId}`, {
        timeout: 15000,
        retries: 1,
        retryDelay: 1000
      })
      
      if (!response.ok) {
        return
      }
      
      const data = await response.json()
      
      if (data.success) {
        setAvailableBalance(data.available_balance || 0)
      }
    } catch (error: any) {
      // Игнорируем ошибки загрузки баланса
    }
  }

  useEffect(() => {
    // Загружаем доступный баланс
    loadAvailableBalance()
  }, [])

  // Не показываем контент, пока проверяется авторизация
  if (isAuthorized === null || isAuthorized === false) {
    return null
  }

  const handleSubmit = async () => {
    if (!accountId.trim()) {
      alert('Введите ID аккаунта в казино')
      return
    }

    if (!bookmaker) {
      alert('Ошибка: не выбран казино')
      return
    }

    // Проверка минимальной суммы вывода - 100 сом
    const minWithdrawalAmount = 100
    if (availableBalance < minWithdrawalAmount) {
      alert(`Минимальная сумма вывода: ${minWithdrawalAmount} сом. Ваш баланс: ${availableBalance.toFixed(2)} сом`)
      return
    }

    try {
      setLoading(true)

      // Используем оптимизированную функцию для получения ID (как в основной странице рефералки)
      let userId = getTelegramUserId()
      
      // Если userId не получен, пробуем получить из localStorage (fallback)
      if (!userId && typeof window !== 'undefined') {
        try {
          const savedUser = localStorage.getItem('telegram_user')
          if (savedUser) {
            const userData = JSON.parse(savedUser)
            if (userData && userData.id) {
              userId = String(userData.id)
              console.log('✅ Восстановлен userId из localStorage:', userId)
            }
          }
        } catch (e) {
          console.warn('⚠️ Ошибка при чтении userId из localStorage:', e)
        }
      }

      if (!userId) {
        alert('Ошибка: не удалось получить ID пользователя. Пожалуйста, откройте приложение через Telegram.')
        setLoading(false)
        return
      }

      // Проверяем, не заблокирован ли пользователь
      const { checkUserBlocked } = await import('../../../../utils/telegram')
      const isBlocked = await checkUserBlocked(String(userId))
      if (isBlocked) {
        alert('Ваш аккаунт заблокирован. Вы не можете создавать заявки на вывод.')
        router.push('/blocked')
        return
      }

      const apiUrl = getApiBase()

      // Получаем данные пользователя из Telegram WebApp или localStorage
      const tg = (window as any).Telegram?.WebApp
      const telegramUser = getTelegramUser()
      
      const requestBody = {
        user_id: userId,
        bookmaker: bookmaker,
        account_id: accountId.trim(),
        amount: availableBalance, // Выводим весь баланс
        telegram_data: {
          username: telegramUser?.username || tg?.initDataUnsafe?.user?.username || null,
          first_name: telegramUser?.first_name || tg?.initDataUnsafe?.user?.first_name || null,
          last_name: telegramUser?.last_name || tg?.initDataUnsafe?.user?.last_name || null,
          phone_number: tg?.initDataUnsafe?.user?.phone_number || null,
        }
      }

      const response = await safeFetch(`${apiUrl}/api/referral/withdraw/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        timeout: 30000,
        retries: 2,
        retryDelay: 1000
      })

      console.log('📥 Ответ от сервера:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok
      })

      // Читаем ответ один раз
      let responseText = ''
      try {
        responseText = await response.text()
      } catch (e) {
        console.error('❌ Ошибка чтения ответа:', e)
        throw new Error(`Ошибка чтения ответа сервера: ${response.status}`)
      }

      if (!response.ok) {
        let errorMessage = `Ошибка сервера: ${response.status}`
        try {
          if (responseText) {
            const errorData = JSON.parse(responseText)
            // Проверяем разные форматы ответа API
            if (errorData?.error) {
              errorMessage = errorData.error
            } else if (errorData?.message) {
              errorMessage = errorData.message
            } else if (errorData?.data?.error) {
              errorMessage = errorData.data.error
            } else if (errorData?.data?.message) {
              errorMessage = errorData.data.message
            } else {
              errorMessage = `Ошибка сервера: ${response.status} ${response.statusText || ''}`
            }
          }
        } catch (parseError) {
          // Если не удалось распарсить JSON, используем текст или общее сообщение
          if (responseText && responseText.length < 500 && !responseText.includes('<html') && !responseText.includes('<!DOCTYPE')) {
            errorMessage = responseText
          } else {
            errorMessage = `Ошибка сервера: ${response.status} ${response.statusText || ''}`
          }
        }
        throw new Error(errorMessage)
      }

      // Парсим успешный ответ
      let data: any
      try {
        if (!responseText) {
          throw new Error('Пустой ответ от сервера')
        }
        data = JSON.parse(responseText)
      } catch (parseError: any) {
        throw new Error('Не удалось обработать ответ сервера')
      }

      if (data.success) {
        alert('Заявка на вывод создана успешно! Вывод выполнен автоматически.')
        // Обновляем данные перед переходом
        router.push('/referral')
        // Принудительно обновим страницу через небольшую задержку, чтобы данные успели обновиться
        setTimeout(() => {
          router.refresh()
        }, 500)
      } else {
        alert(`Ошибка: ${data.error || 'Не удалось создать заявку'}`)
      }
    } catch (error: any) {
      let errorMessage = 'Не удалось создать заявку'
      if (error?.message) {
        errorMessage = error.message
      } else if (error?.name === 'AbortError') {
        errorMessage = 'Превышено время ожидания. Проверьте интернет-соединение и попробуйте снова.'
      } else if (error?.message?.includes('Failed to fetch') || error?.message?.includes('NetworkError')) {
        errorMessage = 'Ошибка сети. Проверьте интернет-соединение и попробуйте снова.'
      }
      
      alert(`Ошибка: ${errorMessage}`)
    } finally {
      setLoading(false)
    }
  }

  const getBookmakerName = (bm: string) => {
    const names: Record<string, string> = {
      '1xbet': '1xBet',
      '1win': '1WIN',
      'melbet': 'Melbet',
      'mostbet': 'Mostbet',
      'winwin': 'Winwin',
      '888starz': '888starz',
    }
    return names[bm.toLowerCase()] || bm
  }

  const translations = {
    ru: {
      title: 'Вывод средств',
      subtitle: 'Введите ID аккаунта в казино',
      accountId: 'ID аккаунта в казино',
      accountIdPlaceholder: 'Введите ID аккаунта',
      amount: 'Сумма вывода',
      submit: 'Отправить заявку',
      back: 'Назад',
      note: 'Выводится весь доступный баланс'
    },
    en: {
      title: 'Withdraw funds',
      subtitle: 'Enter casino account ID',
      accountId: 'Casino account ID',
      accountIdPlaceholder: 'Enter account ID',
      amount: 'Withdrawal amount',
      submit: 'Submit request',
      back: 'Back',
      note: 'Full available balance will be withdrawn'
    }
  }

  const t = translations[language as keyof typeof translations] || translations.ru

  return (
    <PageTransition direction="forward">
      <main className="space-y-6 min-h-screen flex flex-col p-4">
        <FixedHeaderControls />
        {/* Заголовок */}
        <div className="text-center space-y-2">
          <div className="pr-20">
            <h1 className="text-xl font-bold text-white">{t.title}</h1>
            <div className="scale-75">
            </div>
          </div>
          <p className="text-sm text-white/70">{t.subtitle}</p>
        </div>

        {/* Информация о казино */}
        <div className="card space-y-2">
          <div className="text-white/70 text-sm">Казино</div>
          <div className="text-white font-semibold text-lg">{getBookmakerName(bookmaker)}</div>
        </div>

        {/* Сумма вывода */}
        <div className="card space-y-2">
          <div className="text-white/70 text-sm">{t.amount}</div>
          <div className="text-green-400 font-bold text-2xl">
            {availableBalance.toLocaleString()} сом
          </div>
          <div className="text-white/60 text-xs">{t.note}</div>
        </div>

        {/* ID аккаунта */}
        <div className="card space-y-2">
          <label className="text-white/70 text-sm">{t.accountId}</label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder={t.accountIdPlaceholder}
            className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Кнопки */}
        <div className="space-y-3 flex-1 flex flex-col justify-end">
          <button
            onClick={handleSubmit}
            disabled={loading || !accountId.trim()}
            className={`w-full py-3 rounded-lg font-semibold transition-colors ${
              loading || !accountId.trim()
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
          >
            {loading ? 'Отправка...' : t.submit}
          </button>
          <button
            onClick={() => router.back()}
            className="w-full py-3 bg-gray-600 text-white rounded-lg font-semibold hover:bg-gray-700 transition-colors"
          >
            {t.back}
          </button>
        </div>
      </main>
    </PageTransition>
  )
}

export default function ReferralWithdrawStep2() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <FixedHeaderControls />
        <div className="text-white">Загрузка...</div>
      </div>
    }>
      <ReferralWithdrawStep2Content />
    </Suspense>
  )
}


