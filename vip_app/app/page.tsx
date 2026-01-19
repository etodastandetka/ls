"use client"
import { useEffect, useState, useMemo, useRef, useCallback } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import ServiceStatus from "../components/ServiceStatus"
import FixedHeaderControls from "../components/FixedHeaderControls"
import { useLanguage } from "../components/LanguageContext"
import { useBotSettings } from "../components/SettingsLoader"
import { initTelegramWebApp, syncWithBot, TelegramUser, getTelegramUser, clearTelegramUserCache, getTelegramUserId, checkUserBlocked } from "../utils/telegram"
import { useHomePageData } from "../hooks/useHomePageData"
import { HistoryIcon, InstructionIcon, SupportIcon } from "../components/Icons"
import UserProfile from "../components/UserProfile"
import TelegramLoginWidget from "../components/TelegramLoginWidget"

function HolidayEffects() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const particlesRef = useRef<
    Array<{ x: number; y: number; r: number; vy: number; vx: number; a: number; tw: number }>
  >([])

  const setup = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d", { alpha: true })
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight)
    canvas.width = Math.floor(w * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const count = reduceMotion ? 0 : Math.min(110, Math.max(60, Math.floor((w * h) / 22000)))
    const p: typeof particlesRef.current = []
    for (let i = 0; i < count; i++) {
      const r = 0.8 + Math.random() * 2.4
      p.push({
        x: Math.random() * w,
        y: Math.random() * h,
        r,
        vy: 0.35 + Math.random() * 1.25,
        vx: -0.25 + Math.random() * 0.5,
        a: 0.12 + Math.random() * 0.28,
        tw: 0.8 + Math.random() * 1.6,
      })
    }
    particlesRef.current = p
  }, [])

  useEffect(() => {
    setup()
    const onResize = () => setup()
    window.addEventListener("resize", onResize, { passive: true })
    return () => window.removeEventListener("resize", onResize)
  }, [setup])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d", { alpha: true })
    if (!ctx) return

    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(34, now - last)
      last = now

      const w = window.innerWidth
      const h = window.innerHeight
      ctx.clearRect(0, 0, w, h)

      const p = particlesRef.current
      if (p.length) {
        const t = now / 1000
        for (let i = 0; i < p.length; i++) {
          const s = p[i]
          s.x += s.vx * (dt / 16)
          s.y += s.vy * (dt / 16)
          s.x += Math.sin((t * s.tw + s.x * 0.002) * 2.0) * 0.25 * (dt / 16)

          if (s.y - s.r > h) {
            s.y = -10 - Math.random() * 40
            s.x = Math.random() * w
          }
          if (s.x < -20) s.x = w + 20
          if (s.x > w + 20) s.x = -20

          ctx.beginPath()
          ctx.globalAlpha = s.a
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
          ctx.fillStyle = "#ffffff"
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="wb-snow" aria-hidden="true" />
    </>
  )
}


export default function HomePage() {
  const router = useRouter()
  const { language } = useLanguage()
  const { settings } = useBotSettings()
  
  // ИНИЦИАЛИЗАЦИЯ: Проверяем все сразу при создании компонента (синхронно)
  const initialState = (() => {
    if (typeof window === 'undefined') {
      return { isTelegramWebApp: false, user: null }
    }
    
    const tg = (window as any).Telegram?.WebApp
    const isWebApp = !!tg
    
    // Если это Telegram WebApp - получаем пользователя из WebApp
    if (isWebApp) {
      const telegramUser = initTelegramWebApp()
      return { isTelegramWebApp: true, user: telegramUser }
    }
    
    // Если это обычный сайт - проверяем localStorage
    try {
      const savedUserStr = localStorage.getItem('telegram_user')
      if (savedUserStr) {
        const savedUser = JSON.parse(savedUserStr)
        return { isTelegramWebApp: false, user: savedUser }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга
    }
    
    return { isTelegramWebApp: false, user: null }
  })()
  
  const [isTelegramWebApp, setIsTelegramWebApp] = useState(initialState.isTelegramWebApp)
  const [user, setUser] = useState<TelegramUser | null>(initialState.user)
  const [authReady, setAuthReady] = useState(false)
  
  const userInitialized = useRef(false)
  
  // Обновляем isTelegramWebApp при монтировании (на случай редиректа)
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const tg = (window as any).Telegram?.WebApp
    const isWebApp = !!tg && !!tg.initDataUnsafe?.user // Проверяем не только наличие объекта, но и реальные данные пользователя
    
    setIsTelegramWebApp(isWebApp)
    setAuthReady(true)
  }, [])
  
  // Функция для обновления пользователя (для синхронизации с другими вкладками и периодических проверок)
  const updateUser = useCallback(() => {
    if (typeof window === 'undefined') return
    
    // Проверяем, действительно ли это Telegram WebApp (не только наличие объекта, но и реальные данные пользователя)
    const tg = (window as any).Telegram?.WebApp
    const isWebApp = !!tg && !!tg.initDataUnsafe?.user
    
    // Обновляем состояние isTelegramWebApp
    setIsTelegramWebApp(isWebApp)
    
    // Если это Telegram WebApp - получаем пользователя из WebApp
    if (isWebApp) {
      const telegramUser = initTelegramWebApp()
      if (telegramUser) {
        setUser((currentUser) => {
          if (!currentUser || currentUser.id !== telegramUser.id) {
            if (!userInitialized.current) {
              userInitialized.current = true
              syncWithBot(telegramUser, "app_opened", {
                page: "home",
                language,
              }).catch(() => {})
            }
            return telegramUser
          }
          return currentUser
        })
      } else {
        // Если WebApp есть, но пользователя нет - сбрасываем
        setUser(null)
      }
    } else {
      // Если это обычный сайт - проверяем localStorage
      try {
        const savedUserStr = localStorage.getItem('telegram_user')
        if (savedUserStr) {
          const savedUser = JSON.parse(savedUserStr)
          setUser((currentUser) => {
            if (!currentUser || currentUser.id !== savedUser.id) {
              return savedUser
            }
            return currentUser
          })
        } else {
          // Если пользователя нет в localStorage - сбрасываем
          setUser(null)
        }
      } catch (e) {
        // Игнорируем ошибки парсинга
        setUser(null)
      }
    }
  }, [language])
  
  // Периодическая проверка пользователя (для синхронизации с другими вкладками)
  useEffect(() => {
    // Немедленная проверка при монтировании (на случай если пользователь вернулся после авторизации)
    updateUser()
    
    // Если пользователь уже есть и это WebApp - инициализируем синхронизацию
    if (user && isTelegramWebApp && !userInitialized.current) {
      userInitialized.current = true
      syncWithBot(user, "app_opened", {
        page: "home",
        language,
      }).catch(() => {})
    }
    
    // Проверяем URL параметры на наличие успешной авторизации
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      const authError = urlParams.get('auth_error')
      
      // Если нет ошибки авторизации, проверяем пользователя несколько раз с интервалами
      // (на случай если он только что авторизовался и вернулся на страницу)
      if (!authError) {
        // Первая проверка через 100ms
        const check1 = setTimeout(() => {
          updateUser()
        }, 100)
        
        // Вторая проверка через 500ms
        const check2 = setTimeout(() => {
          updateUser()
        }, 500)
        
        // Третья проверка через 1000ms
        const check3 = setTimeout(() => {
          updateUser()
        }, 1000)
        
        // Очищаем URL от параметров авторизации после проверки
        if (urlParams.has('auth_error') || window.location.search.includes('auth')) {
          setTimeout(() => {
            window.history.replaceState({}, '', window.location.pathname)
          }, 2000)
        }
        
        return () => {
          clearTimeout(check1)
          clearTimeout(check2)
          clearTimeout(check3)
        }
      }
    }
  }, [updateUser, user, isTelegramWebApp, language])
  
  // Периодическая проверка и обработка событий фокуса/видимости
  useEffect(() => {
    // Периодически проверяем наличие пользователя (на случай если авторизация произошла в другом окне)
    const interval = setInterval(() => {
      updateUser()
    }, 1000) // Проверяем каждую секунду для более быстрой реакции
    
    // Проверяем при фокусе окна (когда пользователь возвращается на вкладку)
    const handleFocus = () => {
      // Немедленная проверка при возврате на вкладку
      updateUser()
      // Дополнительная проверка через 200ms на случай задержки
      setTimeout(() => {
        updateUser()
      }, 200)
    }
    window.addEventListener('focus', handleFocus)
    
    // Проверяем при видимости страницы (Page Visibility API)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Немедленная проверка при возврате видимости
        updateUser()
        // Дополнительная проверка через 200ms
        setTimeout(() => {
          updateUser()
        }, 200)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [updateUser])

  // Слушаем сообщения от окна авторизации (для виджета)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'telegram_auth_success' && event.data?.user) {
        const userData = event.data.user
        setUser(userData)
        // Обновляем localStorage через функцию getTelegramUser (она использует localStorage)
        if (typeof window !== 'undefined') {
          localStorage.setItem('telegram_user', JSON.stringify(userData))
          // Очищаем кэш, чтобы следующая проверка получила свежие данные
          clearTelegramUserCache()
        }
        // Вызываем callback если он есть
        if (userInitialized.current === false) {
          userInitialized.current = true
        }
      }
    }

    // Также слушаем изменения localStorage (если авторизация произошла в другом окне)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'telegram_user' && e.newValue) {
        try {
          const userData = JSON.parse(e.newValue)
          setUser((currentUser) => {
            if (!currentUser || currentUser.id !== userData.id) {
              clearTelegramUserCache()
              return userData
            }
            return currentUser
          })
        } catch (error) {
          console.error('Error parsing user data from storage:', error)
        }
      }
    }

    window.addEventListener('message', handleMessage)
    window.addEventListener('storage', handleStorageChange)
    
    return () => {
      window.removeEventListener('message', handleMessage)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [user])

  const greeting = useMemo(() => {
    const hour = new Date().getHours()
    if (hour >= 5 && hour < 12) return language === "en" ? "Good morning" : "Доброе утро"
    if (hour >= 12 && hour < 18) return language === "en" ? "Good afternoon" : "Добрый день"
    if (hour >= 18 && hour < 22) return language === "en" ? "Good evening" : "Добрый вечер"
    return language === "en" ? "Good night" : "Доброй ночи"
  }, [language])

  const { transactions, loading: transactionsLoading } = useHomePageData()

  // Вычисляем статистику напрямую из транзакций - всегда актуально
  const computedStats = useMemo(() => {
    let deposits = 0
    let withdraws = 0
    for (let i = 0; i < transactions.length; i++) {
      const t: any = transactions[i]
      const rawType = t?.type || t?.requestType || t?.request_type
      const type = typeof rawType === "string" ? rawType.toLowerCase() : ""
      if (type === "deposit") deposits++
      else if (type === "withdraw" || type === "withdrawal") withdraws++
    }
    return { deposits, withdraws }
  }, [transactions])

  const vipStats = useMemo(() => {
    const totalOps = computedStats.deposits + computedStats.withdraws
    const tiers = [
      { level: 1, min: 0, max: 4, labelRu: 'VIP I', labelEn: 'VIP I' },
      { level: 2, min: 5, max: 14, labelRu: 'VIP II', labelEn: 'VIP II' },
      { level: 3, min: 15, max: 29, labelRu: 'VIP III', labelEn: 'VIP III' },
      { level: 4, min: 30, max: 59, labelRu: 'VIP IV', labelEn: 'VIP IV' },
      { level: 5, min: 60, max: Infinity, labelRu: 'VIP V', labelEn: 'VIP V' },
    ]
    const current = tiers.find((tier) => totalOps >= tier.min && totalOps <= tier.max) || tiers[0]
    const nextTarget = current.max === Infinity ? current.min : current.max + 1
    const progress = current.max === Infinity ? 100 : Math.min(100, (totalOps / nextTarget) * 100)
    const label = language === 'en' ? current.labelEn : current.labelRu
    return { totalOps, label, nextTarget, progress }
  }, [computedStats.deposits, computedStats.withdraws, language])

  const translations = {
    ru: {
      subtitle: "VIP платформа для пополнения и вывода средств",
      deposit: "Пополнить",
      withdraw: "Вывести",
      support: "Поддержка",
      history: "История",
      instruction: "Инструкция",
      quickActions: "Быстрые действия",
      services: "Сервисы",
      activity: "Активность",
      depCount: "Пополнений",
      wdrCount: "Выводов",
      secure: "Защита",
      open: "Открыть",
      vipStatus: "VIP-статус",
      vipLevel: "Текущий уровень",
      vipNext: "До следующего уровня",
      vipManager: "Персональный менеджер",
      vipManagerNote: "Связь 24/7 и приоритетная поддержка",
      vipCashback: "Кэшбэк и лимиты",
      vipCashbackValue: "Кэшбэк 5% на операции",
      vipCashbackNote: "Увеличенные лимиты и ускоренные выплаты",
    },
    en: {
      subtitle: "VIP platform for deposits and withdrawals",
      deposit: "Deposit",
      withdraw: "Withdraw",
      support: "Support",
      history: "History",
      instruction: "Instruction",
      quickActions: "Quick Actions",
      services: "Services",
      activity: "Activity",
      depCount: "Deposits",
      wdrCount: "Withdrawals",
      secure: "Security",
      open: "Open",
      vipStatus: "VIP status",
      vipLevel: "Current level",
      vipNext: "Next level at",
      vipManager: "Personal manager",
      vipManagerNote: "24/7 priority support",
      vipCashback: "Cashback and limits",
      vipCashbackValue: "5% cashback on operations",
      vipCashbackNote: "Higher limits and faster payouts",
    },
  }

  const t = translations[language as keyof typeof translations] || translations.ru
  
  // Проверяем паузу (используем settings даже если они еще загружаются из кеша)
  const isPaused = settings && (settings as any)?.pause === true
  const maintenanceMessage = (settings as any)?.maintenance_message || 'Технические работы. Попробуйте позже.'

  // Если пауза включена, показываем сообщение
  if (isPaused) {
    return (
      <main className="wb-page wb-ready" style={{ paddingTop: "0.5rem", paddingBottom: "110px" }}>
        <HolidayEffects />
        <FixedHeaderControls />
        <div className="wb-wrap space-y-6" style={{ padding: "2rem 1rem" }}>
          <div className="card text-center bg-orange-900/20 border-orange-500" style={{ padding: "2rem" }}>
            <div className="text-orange-300 text-2xl font-semibold mb-4">
              ⏸️ {language === "en" ? "Service Paused" : "Бот на паузе"}
            </div>
            <p className="text-white/80 text-lg">
              {maintenanceMessage}
            </p>
          </div>
        </div>
      </main>
    )
  }

  // Всегда показываем контент, не ждем загрузки настроек
  return (
    <main className="wb-page wb-ready" style={{ paddingTop: "0.5rem", paddingBottom: "110px" }}>
      <HolidayEffects />
      <FixedHeaderControls />

      <div className="wb-wrap space-y-6">
        {/* Резервируем место под виджет входа, чтобы не было сдвига */}
        {!authReady && !isTelegramWebApp && (
          <section className="wb-section" style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{
              background: 'linear-gradient(135deg, rgba(79, 169, 255, 0.08), rgba(47, 129, 230, 0.06))',
              border: '1px solid rgba(79, 169, 255, 0.18)',
              borderRadius: '16px',
              padding: '1.5rem 1.25rem',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(79, 169, 255, 0.08) inset',
              position: 'relative',
              overflow: 'hidden',
              maxWidth: '400px',
              margin: '0 auto',
              minHeight: '180px',
            }} />
          </section>
        )}
        {/* Показываем виджет входа только если НЕ в Telegram Mini App (для обычного сайта) и пользователь не авторизован */}
        {authReady && !user && !isTelegramWebApp && (
          <section className="wb-section" style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{
              background: 'linear-gradient(135deg, rgba(79, 169, 255, 0.14), rgba(47, 129, 230, 0.12))',
              border: '1px solid rgba(79, 169, 255, 0.25)',
              borderRadius: '16px',
              padding: '1.5rem 1.25rem',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 6px 20px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(79, 169, 255, 0.1) inset',
              position: 'relative',
              overflow: 'hidden',
              maxWidth: '400px',
              margin: '0 auto'
            }}>
              {/* Декоративный градиент */}
              <div style={{
                position: 'absolute',
                top: '-20%',
                right: '-20%',
                width: '120%',
                height: '120%',
                background: 'radial-gradient(circle, rgba(79, 169, 255, 0.08) 0%, transparent 70%)',
                pointerEvents: 'none'
              }} />
              
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{
                  fontSize: '1.5rem',
                  marginBottom: '0.5rem',
                  filter: 'drop-shadow(0 2px 4px rgba(79, 169, 255, 0.35))'
                }}>
                  ✨
                </div>
                <h2 className="wb-h2" style={{ 
                  marginBottom: '0.375rem',
                  background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98), rgba(79, 169, 255, 0.9))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                  fontSize: '1.25rem',
                  fontWeight: '700',
                  letterSpacing: '-0.02em'
                }}>
                  {language === 'en' ? 'Sign in with Telegram' : 'Вход через Telegram'}
                </h2>
                <p className="wb-p" style={{ 
                  marginBottom: '1.25rem', 
                  opacity: 0.75,
                  fontSize: '0.85rem',
                  color: 'rgba(255, 255, 255, 0.8)'
                }}>
                  {language === 'en' 
                    ? 'Please sign in to continue' 
                    : 'Пожалуйста, войдите, чтобы продолжить'}
                </p>
                
                {/* Компактная обертка для виджета */}
                <div style={{
                  display: 'inline-block',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  boxShadow: '0 4px 16px rgba(79, 169, 255, 0.25), 0 0 0 1px rgba(79, 169, 255, 0.15)',
                  transition: 'all 0.2s ease',
                  transform: 'scale(1)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'scale(1.01)'
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(79, 169, 255, 0.35), 0 0 0 1px rgba(124, 195, 255, 0.2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'scale(1)'
                  e.currentTarget.style.boxShadow = '0 4px 16px rgba(79, 169, 255, 0.2), 0 0 0 1px rgba(124, 195, 255, 0.15)'
                }}
                >
                  <TelegramLoginWidget botName="vip_luxon_bot" />
                </div>
              </div>
            </div>
          </section>
        )}
        <UserProfile />

        <section className="wb-hero">
          <div className="wb-hero-top">
            <div className="wb-hero-title">
              <h1 className="wb-h1">
                {greeting}
                {user ? `, ${user.first_name}` : ""}!
              </h1>
              <p className="wb-p">{t.subtitle}</p>
            </div>

          </div>

          <div className="wb-hero-cards">
            <div className="wb-mini">
              <div className="wb-mini-label">{t.depCount}</div>
              <div className="wb-mini-value">{computedStats.deposits}</div>
            </div>
            <div className="wb-mini">
              <div className="wb-mini-label">{t.wdrCount}</div>
              <div className="wb-mini-value">{computedStats.withdraws}</div>
            </div>
          </div>

          <div className="wb-hero-sheen" aria-hidden="true" />
        </section>

        <section className="wb-section">
          <div className="wb-section-head">
            <h2 className="wb-h2">{t.quickActions}</h2>
            <span className="wb-pill">{t.activity}</span>
          </div>

          <div className="wb-actions">
            <ServiceStatus service="deposits">
              <a 
                href="/deposit" 
                className="wb-primary wb-primary-dep"
                onClick={(e) => {
                  e.preventDefault()
                  const handleClick = async () => {
                    const userId = getTelegramUserId()
                    if (userId) {
                      const isBlocked = await checkUserBlocked(userId)
                      if (isBlocked) {
                        alert('Ваш аккаунт заблокирован!')
                        router.push('/blocked')
                        return
                      }
                    }
                    router.push('/deposit')
                  }
                  handleClick()
                }}
              >
                <div className="wb-primary-left">
                  <div className="wb-primary-icon">
                    <svg className="wb-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div className="wb-primary-text">
                    <div className="wb-primary-title">{t.deposit}</div>
                    <div className="wb-primary-sub">{language === "en" ? "Instant top up" : "Мгновенное пополнение"}</div>
                  </div>
                </div>
                <div className="wb-primary-cta">
                  <span className="wb-cta">{t.open}</span>
                  <span className="wb-chevron" aria-hidden="true">
                    ›
                  </span>
                </div>
                <span className="wb-primary-shine" aria-hidden="true" />
              </a>
            </ServiceStatus>

            <ServiceStatus service="withdrawals">
              <a 
                href="/withdraw" 
                className="wb-primary wb-primary-wdr"
                onClick={(e) => {
                  e.preventDefault()
                  const handleClick = async () => {
                    const userId = getTelegramUserId()
                    if (userId) {
                      const isBlocked = await checkUserBlocked(userId)
                      if (isBlocked) {
                        alert('Ваш аккаунт заблокирован!')
                        router.push('/blocked')
                        return
                      }
                    }
                    router.push('/withdraw')
                  }
                  handleClick()
                }}
              >
                <div className="wb-primary-left">
                  <div className="wb-primary-icon">
                    <svg className="wb-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                    </svg>
                  </div>
                  <div className="wb-primary-text">
                    <div className="wb-primary-title">{t.withdraw}</div>
                    <div className="wb-primary-sub">{language === "en" ? "Fast payout" : "Быстрый вывод"}</div>
                  </div>
                </div>
                <div className="wb-primary-cta">
                  <span className="wb-cta">{t.open}</span>
                  <span className="wb-chevron" aria-hidden="true">
                    ›
                  </span>
                </div>
                <span className="wb-primary-shine" aria-hidden="true" />
              </a>
            </ServiceStatus>
          </div>
        </section>

        <section className="vip-panel">
          <div className="vip-card vip-card-wide">
            <div className="vip-card-head">
              <span className="vip-label">{t.vipCashback}</span>
            </div>
            <div className="vip-cashback">{t.vipCashbackValue}</div>
            <div className="vip-note">{t.vipCashbackNote}</div>
          </div>
        </section>

        <section className="wb-section">
          <div className="wb-section-head">
            <h2 className="wb-h2">{t.services}</h2>
            <span className="wb-pill wb-pill-soft">{language === "en" ? "Tools" : "Инструменты"}</span>
          </div>

          <div className="wb-list">
            <a href="/history" className="wb-row">
              <div className="wb-row-left">
                <div className="wb-row-icon wb-i-blue">
                  <HistoryIcon className="wb-row-svg" />
                </div>
                <div className="wb-row-text">
                  <div className="wb-row-title">{t.history}</div>
                </div>
              </div>
              <div className="wb-row-right">
                <span className="wb-row-arrow">›</span>
              </div>
            </a>

            <a href="/instruction" className="wb-row">
              <div className="wb-row-left">
                <div className="wb-row-icon wb-i-purple">
                  <InstructionIcon className="wb-row-svg" />
                </div>
                <div className="wb-row-text">
                  <div className="wb-row-title">{t.instruction}</div>
                </div>
              </div>
              <div className="wb-row-right">
                <span className="wb-row-arrow">›</span>
              </div>
            </a>

            <a
              href="https://t.me/operator_luxon_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="wb-row"
            >
              <div className="wb-row-left">
                <div className="wb-row-icon wb-i-orange">
                  <SupportIcon className="wb-row-svg" />
                </div>
                <div className="wb-row-text">
                  <div className="wb-row-title">{t.support}</div>
                </div>
              </div>
              <div className="wb-row-right">
                <span className="wb-row-arrow">›</span>
              </div>
            </a>
          </div>
        </section>

      </div>

    </main>
  )
}
