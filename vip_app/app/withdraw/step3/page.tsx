"use client"
import { useState, useEffect, useRef, useCallback } from 'react'
import FixedHeaderControls from '../../../components/FixedHeaderControls'
import { useRouter } from 'next/navigation'
import { useLanguage } from '../../../components/LanguageContext'
import { checkUserBlocked, getTelegramUserId } from '../../../utils/telegram'
import { safeFetch, getApiBase } from '../../../utils/fetch'
import { useRequireAuth } from '../../../hooks/useRequireAuth'


declare global {
  interface Window {
    __wbBankUiRefCount?: number
  }
}

const __WB_BANK_UI_CSS = `:root{
  --wb-bg0:#05070c;
  --wb-bg1:#0a0f1a;
  --wb-line:rgba(255,255,255,.14);
  --wb-glass:rgba(255,255,255,.08);
  --wb-glass2:rgba(255,255,255,.12);
  --wb-shadow:0 16px 42px rgba(0,0,0,.38);
  --wb-shadow2:0 10px 24px rgba(0,0,0,.24);
  --wb-r:20px;
  --wb-a1:#2f7de0;
  --wb-a2:#4ea1ff;
}
body{
  background:
    radial-gradient(900px 700px at 20% -10%, rgba(78,161,255,.18), transparent 60%),
    radial-gradient(900px 700px at 90% 0%, rgba(46,95,184,.16), transparent 62%),
    radial-gradient(900px 700px at 50% 110%, rgba(12,19,34,.38), transparent 58%),
    linear-gradient(180deg,var(--wb-bg0),var(--wb-bg1));
}
main{
  max-width:520px;
  margin:0 auto;
  padding:10px 14px 120px;
}
h1,h2{
  letter-spacing:.2px;
}
.card{
  border-radius:var(--wb-r);
  border:1px solid var(--wb-line);
  background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.06));
  box-shadow:var(--wb-shadow2);
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
}
.card:not([class*="p-"]){
  padding:14px;
}
.label{
  color:rgba(255,255,255,.74);
  font-size:12px;
}
.input{
  border-radius:16px;
  background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.16);
  color:rgba(255,255,255,.92);
}
.input:focus{
  outline:none;
  box-shadow:0 0 0 4px rgba(78,161,255,.18);
  border-color:rgba(78,161,255,.45);
}
.btn{
  border-radius:16px;
  min-height:48px;
  transition:transform 140ms ease, filter 140ms ease, background 140ms ease;
  will-change:transform;
}
.btn:active{
  transform:scale(.986);
}
.btn.btn-primary{
  background:linear-gradient(135deg, rgba(47,125,224,.92), rgba(30,95,184,.92));
  border:1px solid rgba(255,255,255,.18);
  box-shadow:var(--wb-shadow);
}
.btn.btn-primary:disabled{
  filter:saturate(.6) brightness(.9);
}
.btn.btn-ghost{
  background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.12);
}
.wb-top{
  padding:0 6px;
}
.wb-title{
  color:rgba(255,255,255,.96);
}
.wb-sub{
  color:rgba(255,255,255,.66);
  font-size:13px;
}
.wb-progress{
  width:100%;
  height:8px;
  background:rgba(255,255,255,.12);
  border-radius:999px;
  overflow:hidden;
}
.wb-progress > div{
  height:100%;
  background:linear-gradient(90deg,var(--wb-a1),var(--wb-a2));
  border-radius:999px;
  box-shadow:0 10px 24px rgba(78,161,255,.22);
}
.wb-sticky{
  position:sticky;
  bottom:10px;
  z-index:5;
}
.wb-bar{
  display:flex;
  gap:10px;
  padding:10px;
  border-radius:18px;
  border:1px solid var(--wb-line);
  background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.06));
  backdrop-filter:blur(12px);
  -webkit-backdrop-filter:blur(12px);
  box-shadow:var(--wb-shadow2);
}
@media (prefers-reduced-motion: reduce){
  .btn{transition:none}
}`

function useBankUiTheme() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.__wbBankUiRefCount = (window.__wbBankUiRefCount || 0) + 1
    const id = 'wb-bank-ui-v1'
    let el = document.getElementById(id) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = id
      el.textContent = __WB_BANK_UI_CSS
      document.head.appendChild(el)
    }
    return () => {
      window.__wbBankUiRefCount = Math.max(0, (window.__wbBankUiRefCount || 1) - 1)
      if ((window.__wbBankUiRefCount || 0) === 0) {
        const cur = document.getElementById(id)
        if (cur) cur.remove()
      }
    }
  }, [])
}

export default function WithdrawStep3() {
  useBankUiTheme()
  const router = useRouter()
  const { language } = useLanguage()
  const isAuthorized = useRequireAuth()
  const [userId, setUserId] = useState('')
  const [siteCode, setSiteCode] = useState('')
  const [isCheckingCode, setIsCheckingCode] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [withdrawAmount, setWithdrawAmount] = useState<number | null>(null)
  const [bookmaker, setBookmaker] = useState('')
  const [bank, setBank] = useState('')
  const [phone, setPhone] = useState('')
  const [qrPhoto, setQrPhoto] = useState('')
  const [isAlreadySubmitted, setIsAlreadySubmitted] = useState(false)
  const idSectionRef = useRef<HTMLDivElement>(null)
  const codeSectionRef = useRef<HTMLDivElement>(null)

  // Проверка кода (без автоматической отправки)
  const handleCheckCode = useCallback(async () => {
    if (!userId.trim() || !siteCode.trim()) {
      return
    }

    if (isCheckingCode || isSubmitting) {
      return
    }

    setIsCheckingCode(true)
    setError(null)
    setWithdrawAmount(null)
    
    try {
      const base = getApiBase()
      
      const response = await safeFetch(`${base}/api/withdraw-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bookmaker: bookmaker,
          playerId: userId,
          code: siteCode.trim(),
        }),
        timeout: 30000,
        retries: 2,
        retryDelay: 1000
      })

      if (!response.ok) {
        let errorText = ''
        let errorData: any = null
        try {
          errorText = await response.text()
          try {
            errorData = JSON.parse(errorText)
          } catch (e) {}
        } catch (e) {}
        
        let errorMessage = `Ошибка сервера: ${response.status}`
        if (errorData?.error) {
          errorMessage = errorData.error
        } else if (errorData?.message) {
          errorMessage = errorData.message
        } else if (errorText && errorText.length < 200) {
          errorMessage = errorText
        }
        
        setError(errorMessage)
        setWithdrawAmount(null) // Сбрасываем сумму при ошибке, чтобы скрыть кнопку
        setIsCheckingCode(false)
        return
      }

      const data = await response.json()
      
      if (data.success) {
        let amount: number | null = null
        
        if (data.data && data.data.amount !== undefined && data.data.amount !== null) {
          amount = parseFloat(String(data.data.amount))
        } else if (data.amount !== undefined && data.amount !== null) {
          amount = parseFloat(String(data.amount))
        }
        
        if (amount !== null && !isNaN(amount) && amount > 0) {
          setWithdrawAmount(amount)
          setError(null) // Очищаем ошибку при успешной проверке
          setIsCheckingCode(false)
          // НЕ отправляем автоматически - ждем нажатия кнопки
        } else {
          setError('Не удалось получить сумму вывода. Попробуйте еще раз.')
          setWithdrawAmount(null) // Сбрасываем сумму при ошибке
          setIsCheckingCode(false)
        }
      } else {
        let errorMessage = data.error || data.message || 'Код неверный или вывод не найден'
        setError(errorMessage)
        setWithdrawAmount(null) // Сбрасываем сумму при ошибке, чтобы скрыть кнопку
        setIsCheckingCode(false)
      }
    } catch (error: any) {
      console.error('Ошибка проверки кода:', error)
      setError('Ошибка проверки кода. Попробуйте еще раз.')
      setWithdrawAmount(null) // Сбрасываем сумму при ошибке, чтобы скрыть кнопку
      setIsCheckingCode(false)
    }
  }, [userId, siteCode, bookmaker, isCheckingCode, isSubmitting])

  useEffect(() => {
    
    const savedBookmaker = localStorage.getItem('withdraw_bookmaker')
    const savedBank = localStorage.getItem('withdraw_bank')
    const savedQrPhoto = localStorage.getItem('withdraw_qr_photo')
    const savedPhone = localStorage.getItem('withdraw_phone')
    
    if (!savedBookmaker || !savedBank || !savedQrPhoto || !savedPhone) {
      router.push('/withdraw/step1')
      return
    }

    setBookmaker(savedBookmaker)
    setBank(savedBank)
    setQrPhoto(savedQrPhoto)
    setPhone(savedPhone)

    
    const getCookie = (name: string) => {
      const value = `; ${document.cookie}`
      const parts = value.split(`; ${name}=`)
      if (parts.length === 2) return parts.pop()?.split(';').shift()
      return null
    }
    
    const cookieName = `user_id_${savedBookmaker}`
    const savedUserId = getCookie(cookieName)
    
    if (savedUserId) {
      setUserId(savedUserId)
      
      // Проверяем, не был ли уже отправлен этот вывод
      const telegramUserId = getTelegramUserId()
      if (telegramUserId) {
        const withdrawKey = `withdraw_${savedBookmaker}_${savedUserId}`
        const wasSubmitted = localStorage.getItem(withdrawKey)
        if (wasSubmitted) {
          setIsAlreadySubmitted(true)
        }
      }
    }
  }, [router])

  
  useEffect(() => {
    // Проверяем, не был ли уже отправлен этот вывод при изменении userId или siteCode
    if (bookmaker && userId.trim()) {
      const withdrawKey = `withdraw_${bookmaker}_${userId}`
      const wasSubmitted = localStorage.getItem(withdrawKey)
      if (wasSubmitted) {
        setIsAlreadySubmitted(true)
      } else {
        setIsAlreadySubmitted(false)
      }
    }
    
    // Автоматически проверяем код (но НЕ отправляем заявку)
    if (userId.trim() && siteCode.trim() && !isCheckingCode && !isSubmitting && !withdrawAmount && !error && !isAlreadySubmitted) {
      const timer = setTimeout(() => {
        handleCheckCode()
      }, 500)
      
      return () => clearTimeout(timer)
    }
  }, [userId, siteCode, bookmaker, isAlreadySubmitted, isCheckingCode, isSubmitting, withdrawAmount, error, handleCheckCode])

  // Не показываем контент, пока проверяется авторизация
  if (isAuthorized === null || isAuthorized === false) {
    return null
  }

  const translations = {
    ru: {
      title: 'Вывод средств',
      accountId: 'ID аккаунта',
      accountIdPlaceholder: 'Введите ID',
      siteCode: 'Код с сайта',
      siteCodePlaceholder: 'Введите код',
      checking: 'Проверка кода...',
      submitting: 'Отправка заявки...',
      back: 'Назад',
      checkCode: 'Проверить код',
      submit: 'Отправить'
    },
    en: {
      title: 'Withdraw',
      accountId: 'Account ID',
      accountIdPlaceholder: 'Enter ID',
      siteCode: 'Site code',
      siteCodePlaceholder: 'Enter code',
      checking: 'Checking code...',
      submitting: 'Submitting request...',
      back: 'Back',
      checkCode: 'Check Code',
      submit: 'Submit'
    },
    ky: {
      title: 'Акчаны чыгаруу',
      accountId: 'Аккаунт ID',
      accountIdPlaceholder: 'ID киргизиңиз',
      siteCode: 'Сайт коду',
      siteCodePlaceholder: 'Код киргизиңиз',
      checking: 'Код текшерилуүдө...',
      submitting: 'Өтүнүч жөнөтүлүүдө...',
      back: 'Артка',
      checkCode: 'Код текшерүү',
      submit: 'Жөнөтүү'
    },
    uz: {
      title: 'Pulni yechib olish',
      accountId: 'Hisob ID',
      accountIdPlaceholder: 'ID kiriting',
      siteCode: 'Sayt kodi',
      siteCodePlaceholder: 'Kod kiriting',
      checking: 'Kod tekshirilmoqda...',
      submitting: 'So\'rov yuborilmoqda...',
      back: 'Orqaga',
      checkCode: 'Kodni tekshirish',
      submit: 'Yuborish'
    }
  }

  const t = translations[language as keyof typeof translations] || translations.ru
  
  // Обработчик нажатия кнопки "Отправить"
  const handleSubmit = async () => {
    if (isAlreadySubmitted) {
      setError('Этот вывод уже был отправлен. Нельзя отправить повторно.')
      return
    }
    
    if (!withdrawAmount || withdrawAmount <= 0) {
      setError('Сначала проверьте код подтверждения')
      return
    }
    
    if (!userId.trim() || !siteCode.trim()) {
      setError('Заполните все поля')
      return
    }
    
    await submitRequest(withdrawAmount)
  }

  const submitRequest = async (amount: number) => {
    if (isSubmitting) {
      return
    }
    
    // Проверяем, не был ли уже отправлен этот конкретный вывод
    if (isAlreadySubmitted) {
      setError('Этот вывод уже был отправлен. Нельзя отправить повторно.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const base = getApiBase()
      const telegramUserId = getTelegramUserId()
      
      if (!telegramUserId) {
        throw new Error('Не удалось определить ID пользователя. Перезагрузите страницу.')
      }

      // Проверяем, не был ли уже отправлен этот конкретный вывод (bookmaker + playerId)
      const withdrawKey = `withdraw_${bookmaker}_${userId}`
      const wasSubmitted = localStorage.getItem(withdrawKey)
      if (wasSubmitted) {
        setIsAlreadySubmitted(true)
        setIsSubmitting(false)
        setError('Этот вывод уже был отправлен. Нельзя отправить повторно.')
        return
      }
      
      const isBlocked = await checkUserBlocked(telegramUserId)
      if (isBlocked) {
        alert('Ваш аккаунт заблокирован!')
        window.location.href = '/blocked'
        return
      }

      
      const normalizedBookmaker = bookmaker.toLowerCase()
      if (normalizedBookmaker.includes('1xbet') || normalizedBookmaker === '1xbet') {
        const withdrawResponse = await safeFetch(`${base}/api/withdraw-execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            bookmaker: bookmaker,
            playerId: userId,
            code: siteCode.trim(),
            amount: amount,
          }),
          timeout: 30000,
          retries: 2,
          retryDelay: 1000
        })

        if (!withdrawResponse.ok) {
          const errorText = await withdrawResponse.text()
          let errorData: any = null
          try {
            if (errorText) {
              errorData = JSON.parse(errorText)
            }
          } catch (e) {}
          
          const errorMsg = errorData?.error || errorData?.message || `Ошибка выполнения вывода: ${withdrawResponse.status}`
          throw new Error(errorMsg)
        }

        const withdrawData = await withdrawResponse.json()
        if (!withdrawData.success) {
          throw new Error(withdrawData.message || withdrawData.error || 'Ошибка выполнения вывода')
        }
      }
      
      
      const tg = (window as any).Telegram?.WebApp
      let telegramUser = null
      
      if (tg?.initDataUnsafe?.user) {
        telegramUser = tg.initDataUnsafe.user
      } else if (tg?.initData) {
        try {
          const params = new URLSearchParams(tg.initData)
          const userParam = params.get('user')
          if (userParam) {
            telegramUser = JSON.parse(decodeURIComponent(userParam))
          }
        } catch (e) {
        }
      }

      
      const requestBody = {
        type: 'withdraw',
        bookmaker: bookmaker,
        userId: telegramUserId,
        phone: phone,
        amount: amount,
        bank: bank,
        account_id: userId,
        playerId: userId,
        qr_photo: qrPhoto,
        site_code: siteCode.trim(),
        telegram_user_id: telegramUserId,
        telegram_username: telegramUser?.username,
        telegram_first_name: telegramUser?.first_name,
        telegram_last_name: telegramUser?.last_name,
        telegram_language_code: telegramUser?.language_code
      }
      
      const response = await safeFetch(`${base}/api/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        timeout: 30000,
        retries: 2,
        retryDelay: 1000
      })
      
      let responseText = ''
      try {
        responseText = await response.text()
      } catch (e) {
        throw new Error(`Ошибка чтения ответа сервера: ${response.status}`)
      }
      
      if (!response.ok) {
        let errorData: any = null
        try {
          if (responseText) {
            errorData = JSON.parse(responseText)
          }
        } catch (e) {}
        
        let errorMessage = `Ошибка создания заявки (${response.status})`
        if (errorData?.error) {
          errorMessage = errorData.error
        } else if (errorData?.message) {
          errorMessage = errorData.message
        } else if (responseText && responseText.length < 200 && !responseText.includes('<html')) {
          errorMessage = responseText
        }
        
        throw new Error(errorMessage)
      }
      
      let result: any
      try {
        if (!responseText) {
          throw new Error('Пустой ответ от сервера')
        }
        result = JSON.parse(responseText)
      } catch (parseError: any) {
        throw new Error('Не удалось обработать ответ сервера.')
      }
      
      if (result.success !== false) {
        // Сохраняем специфичный ключ для этого конкретного вывода (bookmaker + playerId)
        // Это предотвращает повторную отправку той же заявки
        const withdrawKey = `withdraw_${bookmaker}_${userId}`
        localStorage.setItem(withdrawKey, 'true')
        setIsAlreadySubmitted(true)
        
        // Сохраняем cookie с ID игрока
        const cookieName = `user_id_${bookmaker}`
        const expires = new Date()
        expires.setTime(expires.getTime() + (30 * 24 * 60 * 60 * 1000))
        document.cookie = `${cookieName}=${userId}; expires=${expires.toUTCString()}; path=/`
        
        // Очищаем данные формы
        localStorage.removeItem('withdraw_bookmaker')
        localStorage.removeItem('withdraw_bank')
        localStorage.removeItem('withdraw_qr_photo')
        localStorage.removeItem('withdraw_phone')
        
        // Переходим на главную
        router.push('/')
      } else {
        throw new Error(result.error || 'Неизвестная ошибка')
      }
    } catch (error: any) {
      console.error('Ошибка создания заявки:', error)
      setError(error?.message || 'Ошибка при создании заявки. Попробуйте еще раз.')
      setIsSubmitting(false)
    }
  }

  const handleBack = () => {
    router.push('/withdraw/step2')
  }

  return (
    <main className="space-y-4" style={{ scrollBehavior: 'smooth' }}>
      <FixedHeaderControls />
      <div className="pr-20">
        <h1 className="text-xl font-bold">{t.title}</h1>
      </div>
      
      <div className="card space-y-4">
        <div className="text-center">
          <h2 className="text-lg font-semibold">Шаг 3 из 3</h2>
          <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
            <div className="bg-accent h-2 rounded-full" style={{width: '100%'}}></div>
          </div>
        </div>

        
        <div ref={idSectionRef}>
          <label className="label">{t.accountId}</label>
          <input 
            className="input w-full"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={t.accountIdPlaceholder}
            disabled={isCheckingCode || isSubmitting}
          />
        </div>
        
        
        <div ref={codeSectionRef}>
          <label className="label">{t.siteCode}</label>
          <input 
            className="input w-full"
            type="text"
            value={siteCode}
            onChange={(e) => {
              setSiteCode(e.target.value)
              setWithdrawAmount(null)
              setError(null)
            }}
            placeholder={t.siteCodePlaceholder}
            disabled={isCheckingCode || isSubmitting}
          />
        </div>
        
        
        {isCheckingCode && (
          <div className="p-3 bg-blue-900/30 border border-blue-500 rounded-lg">
            <p className="text-sm text-blue-300">⏳ {t.checking}</p>
          </div>
        )}
        
        {isSubmitting && (
          <div className="p-3 bg-slate-900/30 border border-sky-500 rounded-lg">
            <p className="text-sm text-sky-300">⏳ {t.submitting}</p>
          </div>
        )}
        
        {/* Кнопка проверки кода, если код еще не проверен */}
        {!withdrawAmount && !isCheckingCode && userId.trim() && siteCode.trim() && (
          <button 
            className="btn btn-primary w-full"
            onClick={handleCheckCode}
            disabled={isSubmitting || isAlreadySubmitted}
          >
            {t.checkCode}
          </button>
        )}
        
        {/* Блок с результатом проверки и кнопкой отправки */}
        {withdrawAmount !== null && withdrawAmount > 0 && (
          <div className="p-4 bg-slate-900/30 border border-sky-500 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">✅</span>
              <p className="text-sm text-sky-300 font-semibold">
                Код проверен! Сумма: {withdrawAmount.toLocaleString()} сом
              </p>
            </div>
            {isAlreadySubmitted ? (
              <div className="p-3 bg-yellow-900/30 border border-yellow-500 rounded-lg">
                <p className="text-sm text-yellow-300 font-semibold">
                  ⚠️ Этот вывод уже был отправлен. Нельзя отправить повторно.
                </p>
              </div>
            ) : (
              <button 
                className="btn btn-primary w-full"
                onClick={handleSubmit}
                disabled={isSubmitting || isAlreadySubmitted}
              >
                {isSubmitting ? t.submitting : t.submit}
              </button>
            )}
          </div>
        )}
        
        
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-500 rounded-lg">
            <p className="text-sm text-red-300 font-semibold">❌ {error}</p>
          </div>
        )}

        <div className="flex gap-2">
          <button 
            className="btn btn-ghost flex-1"
            onClick={handleBack}
            disabled={isCheckingCode || isSubmitting}
          >
            {t.back}
          </button>
        </div>
      </div>
    </main>
  )
}

