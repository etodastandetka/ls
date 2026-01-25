"use client"
import { useState, useEffect } from 'react'
import FixedHeaderControls from '../../../components/FixedHeaderControls'
import { useRouter } from 'next/navigation'
import BookmakerGrid from '../../../components/BookmakerGrid'
import { useLanguage } from '../../../components/LanguageContext'
import { getApiBase } from '../../../utils/fetch'
import { useRequireAuth } from '../../../hooks/useRequireAuth'


declare global {
  interface Window {
    __wbBankUiRefCount?: number
  }
}

const __WB_BANK_UI_CSS = `:root{
  --wb-bg0:#07150d;
  --wb-bg1:#0b2014;
  --wb-line:rgba(255,255,255,.14);
  --wb-glass:rgba(255,255,255,.08);
  --wb-glass2:rgba(255,255,255,.12);
  --wb-shadow:0 16px 42px rgba(0,0,0,.38);
  --wb-shadow2:0 10px 24px rgba(0,0,0,.24);
  --wb-r:20px;
  --wb-a1:#52d16a;
  --wb-a2:#9ed1a8;
}
body{
  background:
    radial-gradient(900px 700px at 20% -10%, rgba(82,209,106,.20), transparent 60%),
    radial-gradient(900px 700px at 90% 0%, rgba(78,171,63,.16), transparent 62%),
    radial-gradient(900px 700px at 50% 110%, rgba(18,89,50,.34), transparent 58%),
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
  box-shadow:0 0 0 4px rgba(82,209,106,.14);
  border-color:rgba(82,209,106,.42);
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
  background:linear-gradient(135deg, rgba(78,171,63,.92), rgba(18,89,50,.92));
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
  box-shadow:0 10px 24px rgba(82,209,106,.18);
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

const translations = {
  ru: {
    title: 'Пополнение счета',
    selectBookmaker: 'Выберите казино',
    next: 'Далее',
    back: 'Назад'
  },
  en: {
    title: 'Deposit',
    selectBookmaker: 'Select casino',
    next: 'Next',
    back: 'Back'
  },
  ky: {
    title: 'Эсепти толтуруу',
    selectBookmaker: 'Казинодо тандаңыз',
    next: 'Кийинки',
    back: 'Артка'
  },
  uz: {
    title: 'Hisobni to\'ldirish',
    selectBookmaker: 'Kazinoni tanlang',
    next: 'Keyingi',
    back: 'Orqaga'
  }
}

export default function DepositStep1() {
  useBankUiTheme()
  const router = useRouter()
  const { language } = useLanguage()
  const isAuthorized = useRequireAuth()
  const [bookmaker, setBookmaker] = useState<string>('')
  const [depositsEnabled, setDepositsEnabled] = useState(true)
  const [disabledCasinos, setDisabledCasinos] = useState<string[]>([])

  const t = translations[language as keyof typeof translations] || translations.ru

  useEffect(() => {
    async function checkSettings() {
      try {
        const base = getApiBase()
        const { getTelegramUserId } = await import('../../../utils/telegram')
        const telegramUserId = getTelegramUserId()
        const url = telegramUserId 
          ? `${base}/api/public/payment-settings?user_id=${telegramUserId}`
          : `${base}/api/public/payment-settings`
        const res = await fetch(url, { cache: 'no-store' })
        const data = await res.json()
        
        if (data && data.deposits) {
          setDepositsEnabled(data.deposits.enabled === true)
        } else {
          setDepositsEnabled(false)
        }
        
        const disabled: string[] = []
        
        // Проверяем общие настройки казино
        if (data && data.casinos) {
          if (data.casinos['1xbet'] === false) disabled.push('1xbet')
          if (data.casinos['1win'] === false) disabled.push('1win')
          if (data.casinos['melbet'] === false) disabled.push('melbet')
          if (data.casinos['mostbet'] === false) disabled.push('mostbet')
          if (data.casinos['winwin'] === false) disabled.push('winwin')
          if (data.casinos['888starz'] === false) disabled.push('888starz')
        }
        
        // Проверяем настройки букмекеров для депозитов
        if (data && data.bookmaker_settings) {
          const bookmakerSettings = data.bookmaker_settings
          // Проверяем строго: если deposit_enabled === false, отключаем
          if (bookmakerSettings['1xbet']?.deposit_enabled === false) disabled.push('1xbet')
          if (bookmakerSettings['1win']?.deposit_enabled === false) disabled.push('1win')
          if (bookmakerSettings['melbet']?.deposit_enabled === false) disabled.push('melbet')
          if (bookmakerSettings['mostbet']?.deposit_enabled === false) disabled.push('mostbet')
          if (bookmakerSettings['winwin']?.deposit_enabled === false) disabled.push('winwin')
          if (bookmakerSettings['888starz']?.deposit_enabled === false) disabled.push('888starz')
        }
        
        // Убираем дубликаты
        const uniqueDisabled = [...new Set(disabled)]
        setDisabledCasinos(uniqueDisabled)
      } catch (error) {
        console.error('Error loading settings:', error)
      }
    }
    checkSettings()
  }, [])

  useEffect(() => {
    const savedBookmaker = localStorage.getItem('deposit_bookmaker')
    if (savedBookmaker) {
      setBookmaker(savedBookmaker)
    }
  }, [])

  // Не показываем контент, пока проверяется авторизация
  if (isAuthorized === null || isAuthorized === false) {
    return null
  }

  const handleNext = () => {
    if (!bookmaker) {
      alert('Выберите казино')
      return
    }
    
    localStorage.setItem('deposit_bookmaker', bookmaker)
    router.push(`/deposit/step2?bookmaker=${encodeURIComponent(bookmaker)}`)
  }

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/')
  }

  if (!depositsEnabled) {
    return (
      <main className="space-y-4">
        <FixedHeaderControls />
        <h1 className="text-xl font-bold pr-20">{t.title}</h1>
        <div className="card text-center bg-orange-900/20 border-orange-500">
          <div className="text-orange-300 text-lg font-semibold mb-2">
            🔧 Технические работы
          </div>
          <div className="text-white/70 mb-4">
            Пополнение счета временно недоступно. Попробуйте позже.
          </div>
          <button
            onClick={handleBack}
            className="btn btn-ghost"
          >
            ← {t.back}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="space-y-4">
      <FixedHeaderControls />
      <h1 className="text-xl font-bold">{t.title}</h1>
      
      <section className="card space-y-3">
        <div className="label">{t.selectBookmaker}</div>
        <BookmakerGrid 
          value={bookmaker} 
          onChange={setBookmaker}
          disabledCasinos={disabledCasinos}
        />
      </section>

      <div className="flex gap-3">
        <button 
          className="btn btn-ghost flex-1" 
          onClick={handleBack}
        >
          {t.back}
        </button>
        <button 
          className="btn btn-primary flex-1" 
          onClick={handleNext}
          disabled={!bookmaker}
        >
          {t.next}
        </button>
      </div>
    </main>
  )
}

