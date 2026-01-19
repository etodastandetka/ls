"use client"
import { useState, useEffect } from 'react'
import FixedHeaderControls from '../../../components/FixedHeaderControls'
import { useRouter } from 'next/navigation'
import BookmakerGrid from '../../../components/BookmakerGrid'
import { useLanguage } from '../../../components/LanguageContext'
import { getApiBase } from '../../../utils/fetch'
import { useRequireAuth } from '../../../hooks/useRequireAuth'
import { getTelegramUserId, checkUserBlocked } from '../../../utils/telegram'


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

export default function WithdrawStep1() {
  useBankUiTheme()
  const router = useRouter()
  const { language } = useLanguage()
  const isAuthorized = useRequireAuth()
  const [bookmaker, setBookmaker] = useState<string>('')
  const [withdrawalsEnabled, setWithdrawalsEnabled] = useState(true)
  const [disabledCasinos, setDisabledCasinos] = useState<string[]>([])

  useEffect(() => {
    async function checkBlocked() {
      const userId = getTelegramUserId()
      if (userId) {
        const isBlocked = await checkUserBlocked(userId)
        if (isBlocked) {
          alert('Ваш аккаунт заблокирован!')
          router.push('/blocked')
          return
        }
      }
    }
    checkBlocked()
  }, [router])

  useEffect(() => {
    async function checkSettings() {
      try {
        const base = getApiBase()
        const telegramUserId = getTelegramUserId()
        const url = telegramUserId 
          ? `${base}/api/public/payment-settings?user_id=${telegramUserId}`
          : `${base}/api/public/payment-settings`
        const res = await fetch(url, { cache: 'no-store' })
        const data = await res.json()
        
        if (data && data.withdrawals) {
          setWithdrawalsEnabled(data.withdrawals.enabled === true)
        } else {
          setWithdrawalsEnabled(false)
        }
        
        if (data && data.casinos) {
          const disabled: string[] = []
          if (data.casinos['1xbet'] === false) disabled.push('1xbet')
          if (data.casinos['1win'] === false) disabled.push('1win')
          if (data.casinos['melbet'] === false) disabled.push('melbet')
          if (data.casinos['mostbet'] === false) disabled.push('mostbet')
          if (data.casinos['winwin'] === false) disabled.push('winwin')
          if (data.casinos['888starz'] === false) disabled.push('888starz')
          setDisabledCasinos(disabled)
        }
      } catch (error) {
        console.error('Error loading settings:', error)
      }
    }
    checkSettings()
  }, [])

  
  useEffect(() => {
    const savedBookmaker = localStorage.getItem('withdraw_bookmaker')
    if (savedBookmaker) {
      setBookmaker(savedBookmaker)
    }
  }, [])

  // Не показываем контент, пока проверяется авторизация
  if (isAuthorized === null || isAuthorized === false) {
    return null
  }

  const translations = {
    ru: {
      title: 'Вывод средств',
      selectBookmaker: 'Выберите казино',
      next: 'Далее',
      back: 'Назад'
    },
    en: {
      title: 'Withdraw',
      selectBookmaker: 'Select casino',
      next: 'Next',
      back: 'Back'
    },
    ky: {
      title: 'Акчаны чыгаруу',
      selectBookmaker: 'Казинодо тандаңыз',
      next: 'Кийинки',
      back: 'Артка'
    },
    uz: {
      title: 'Pulni yechib olish',
      selectBookmaker: 'Kazinoni tanlang',
      next: 'Keyingi',
      back: 'Orqaga'
    }
  }

  const t = translations[language as keyof typeof translations] || translations.ru

  const handleNext = () => {
    if (!bookmaker) {
      alert('Выберите казино')
      return
    }
    
    localStorage.setItem('withdraw_bookmaker', bookmaker)
    router.push('/withdraw/step2')
  }

  const handleBack = () => {
    router.push('/')
  }

  if (!withdrawalsEnabled) {
    return (
      <main className="space-y-4">
        <FixedHeaderControls />
        <h1 className="text-xl font-bold pr-20">{t.title}</h1>
        <div className="card text-center bg-orange-900/20 border-orange-500">
          <div className="text-orange-300 text-lg font-semibold mb-2">
            🔧 Технические работы
          </div>
          <div className="text-white/70 mb-4">
            Вывод средств временно недоступен. Попробуйте позже.
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

