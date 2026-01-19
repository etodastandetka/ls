'use client'

import '../globals.css'
import TelegramInit from '../components/TelegramInit'
import { LanguageProvider } from '../components/LanguageContext'
import { HomePageDataProvider } from '../contexts/HomePageDataContext'
import BottomNavigation from '../components/BottomNavigation'
import Snowflakes from '../components/Snowflakes'
import OldDeviceWarning from '../components/OldDeviceWarning'
import { useEffect, useState, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getApiBase } from '../utils/fetch'
import { getTelegramUserId } from '../utils/telegram'
import { initIOSColorFixes } from '../utils/ios-color-fix'

function BlockedChecker({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    
    // Пропускаем проверку на странице блокировки
    if (pathname === '/blocked') {
      return () => {
        isMountedRef.current = false
      }
    }

    // Получаем ID пользователя из Telegram WebApp (оптимизированная функция)
    const userId = getTelegramUserId()

    // Проверяем статус пользователя и регистрируем реферала (если есть реферальный код)
    if (userId) {
      const checkUserStatus = async () => {
        try {
          if (!isMountedRef.current) return
          
          const apiUrl = getApiBase()
          const response = await fetch(`${apiUrl}/api/public/check-user-status?user_id=${userId}`)
          
          if (!isMountedRef.current) return
          
          const data = await response.json()
          
          if (isMountedRef.current && data.success && data.data.isBlocked) {
            router.push('/blocked')
            return
          }
        } catch (error) {
          console.error('Error checking user status:', error)
          // В случае ошибки продолжаем работу
        }
      }

      // Первая проверка сразу
      checkUserStatus()

      // Периодическая проверка (чтобы блокировка с админки применялась без перезагрузки)
      const intervalId = setInterval(checkUserStatus, 30000)
      
      // Регистрируем реферала, если есть реферальный код в start_param
      const registerReferral = async () => {
        try {
          if (!isMountedRef.current) return
          
          const tg = (window as any).Telegram?.WebApp
          
          // Пробуем получить startParam из разных источников (безопасный доступ)
          let startParam: string | null = null
          try {
            if (tg && tg.startParam) {
              startParam = tg.startParam
            } else if (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
              startParam = tg.initDataUnsafe.start_param
            } else {
              // Пробуем получить из URL параметров
              try {
                const urlParams = new URLSearchParams(window.location.search)
                startParam = urlParams.get('start_param') || urlParams.get('ref')
              } catch (e) {
                // Fallback для старых браузеров без URLSearchParams
                const search = window.location.search
                if (search) {
                  const match = search.match(/[?&](?:start_param|ref)=([^&]+)/)
                  if (match) {
                    startParam = decodeURIComponent(match[1])
                  }
                }
              }
            }
          } catch (e) {
            // Игнорируем ошибки
          }
          
          // Безопасный доступ для логирования
          const tgStartParam = tg && tg.startParam ? tg.startParam : null
          const initDataUnsafeStartParam = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param 
            ? tg.initDataUnsafe.start_param 
            : null
          
          if (process.env.NODE_ENV === 'development') {
            console.log('🔍 Проверка реферального кода:', {
              startParam,
              tgStartParam,
              initDataUnsafeStartParam,
              userId,
              tgObject: tg ? 'exists' : 'missing'
            })
          }
          
          if (startParam && startParam.startsWith('ref')) {
            const referralCode = startParam.substring(3) // Убираем 'ref'
            const referrerId = referralCode.replace(/^_/, '') // Убираем '_' если есть
            
            console.log('🔍 Обработка реферального кода:', { referralCode, referrerId, userId })
            
            if (referrerId && referrerId !== userId && /^\d+$/.test(referrerId)) {
              const apiUrl = getApiBase()
              // Безопасный доступ к user
              let user: any = null
              try {
                if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
                  user = tg.initDataUnsafe.user
                }
              } catch (e) {
                // Игнорируем ошибки
              }
              
              console.log('🔄 Регистрация реферала:', { 
                referrerId, 
                referredId: userId,
                apiUrl: `${apiUrl}/api/referral/register`,
                user: user ? { id: user.id, username: user.username } : 'no user data'
              })
              
              const response = await fetch(`${apiUrl}/api/referral/register`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  referrer_id: referrerId,
                  referred_id: userId,
                  username: (user && user.username) ? user.username : null,
                  first_name: (user && user.first_name) ? user.first_name : null,
                  last_name: (user && user.last_name) ? user.last_name : null,
                }),
              })
              
              if (!isMountedRef.current) return
              
              const data = await response.json()
              console.log('📋 Ответ API регистрации реферала:', data)
              
              if (isMountedRef.current) {
                if (data.success) {
                  console.log('✅ Реферал успешно зарегистрирован')
                } else {
                  console.log('⚠️ Ошибка регистрации реферала:', data.error)
                }
              }
            } else {
              console.log('⚠️ Некорректный реферальный код:', { referrerId, userId, isValid: referrerId && referrerId !== userId && /^\d+$/.test(referrerId) })
            }
          } else {
            console.log('ℹ️ Реферальный код не найден или не начинается с "ref"')
          }
        } catch (error) {
          console.error('❌ Error registering referral:', error)
          // В случае ошибки продолжаем работу
        }
      }
      
      checkUserStatus()
      registerReferral()

      return () => {
        isMountedRef.current = false
        clearInterval(intervalId)
      }
    }
    
    return () => {
      isMountedRef.current = false
    }
  }, [pathname, router])

  return <>{children}</>
}

// Компонент для управления UI на основе pathname
function LayoutUI({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [shouldHideUI, setShouldHideUI] = useState(false)

  // Подстраховка: если где-то остался loading-active — убираем и возвращаем меню
  useEffect(() => {
    if (typeof document === 'undefined') return
    
    const isBlocked = pathname === '/blocked'
    setShouldHideUI(isBlocked)
    
    document.body.classList.remove('loading-active')
    const nav = document.querySelector('.bottom-navigation') as HTMLElement | null
    const garlands = document.querySelector('.new-year-garlands') as HTMLElement | null
    if (nav) {
      nav.style.removeProperty('display')
      nav.style.removeProperty('visibility')
      nav.style.removeProperty('opacity')
      nav.style.removeProperty('z-index')
    }
    if (garlands) {
      garlands.style.removeProperty('display')
      garlands.style.removeProperty('visibility')
      garlands.style.removeProperty('opacity')
      garlands.style.removeProperty('z-index')
    }
  }, [pathname])

  return (
    <>
      {!shouldHideUI && <Snowflakes />}
      {children}
    </>
  )
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Инициализируем исправления цветов для iOS
  useEffect(() => {
    initIOSColorFixes()
  }, [])
  
  // Гарантируем, что title всегда установлен правильно
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = 'LUX ON'
      // Используем MutationObserver для отслеживания изменений title
      const titleElement = document.querySelector('title')
      if (titleElement) {
        const observer = new MutationObserver(() => {
          if (document.title !== 'LUX ON') {
            document.title = 'LUX ON'
          }
        })
        observer.observe(titleElement, { childList: true, subtree: true, characterData: true })
        
        return () => observer.disconnect()
      }
    }
  }, [])

  return (
    <html lang="ru">
      <head>
        <title>LUX ON</title>
        <meta name="description" content="LUX ON" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
        <meta name="robots" content="noindex, nofollow" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
        <meta name="app-version" content={process.env.NEXT_PUBLIC_APP_VERSION || Date.now().toString()} />
        
        {/* PWA мета-теги */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#07150d" />
        <meta name="color-scheme" content="dark" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="LUX ON" />
        
        {/* Иконки для iOS */}
        <link rel="apple-touch-icon" sizes="180x180" href="/luxon.jpg" />
        <link rel="apple-touch-icon" sizes="152x152" href="/luxon.jpg" />
        <link rel="apple-touch-icon" sizes="144x144" href="/luxon.jpg" />
        <link rel="apple-touch-icon" sizes="120x120" href="/luxon.jpg" />
        <link rel="apple-touch-icon" sizes="114x114" href="/luxon.jpg" />
        <link rel="apple-touch-icon" sizes="76x76" href="/luxon.jpg" />
        <link rel="apple-touch-icon" sizes="72x72" href="/luxon.jpg" />
        <link rel="apple-touch-icon" sizes="60x60" href="/luxon.jpg" />
        <link rel="apple-touch-icon" sizes="57x57" href="/luxon.jpg" />
        <link rel="apple-touch-icon" href="/luxon.jpg" />
        
        {/* Иконки для Android */}
        <link rel="icon" type="image/jpeg" sizes="192x192" href="/luxon.jpg" />
        <link rel="icon" type="image/jpeg" sizes="512x512" href="/luxon.jpg" />
        
        {/* Полифиллы для старых браузеров - загружаем первыми */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Минимальные полифиллы для критических функций
              (function() {
                // Полифилл для Object.assign
                if (typeof Object.assign !== 'function') {
                  Object.assign = function(target) {
                    if (target == null) throw new TypeError('Cannot convert undefined or null to object');
                    var to = Object(target);
                    for (var index = 1; index < arguments.length; index++) {
                      var nextSource = arguments[index];
                      if (nextSource != null) {
                        for (var nextKey in nextSource) {
                          if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
                            to[nextKey] = nextSource[nextKey];
                          }
                        }
                      }
                    }
                    return to;
                  };
                }
                
                // Полифилл для Array.from
                if (typeof Array.from !== 'function') {
                  Array.from = function(arrayLike) {
                    var C = this;
                    var items = Object(arrayLike);
                    if (arrayLike == null) throw new TypeError('Array.from requires an array-like object');
                    var len = parseInt(items.length) || 0;
                    var A = typeof C === 'function' ? Object(new C(len)) : new Array(len);
                    var k = 0;
                    while (k < len) {
                      A[k] = items[k];
                      k += 1;
                    }
                    A.length = len;
                    return A;
                  };
                }
                
                // Полифилл для String.prototype.includes
                if (typeof String.prototype.includes !== 'function') {
                  String.prototype.includes = function(search, start) {
                    if (typeof start !== 'number') start = 0;
                    return this.indexOf(search, start) !== -1;
                  };
                }
                
                // Полифилл для Array.prototype.includes
                if (typeof Array.prototype.includes !== 'function') {
                  Array.prototype.includes = function(searchElement, fromIndex) {
                    var O = Object(this);
                    var len = parseInt(O.length) || 0;
                    if (len === 0) return false;
                    var n = parseInt(fromIndex) || 0;
                    var k = n >= 0 ? n : Math.max(len + n, 0);
                    for (; k < len; k++) {
                      if (O[k] === searchElement) return true;
                    }
                    return false;
                  };
                }
              })();
            `,
          }}
        />
        {/* Telegram WebApp скрипт загружается через TelegramInit компонент на клиенте */}
        {/* Preload критических изображений казино для быстрой загрузки */}
        <link rel="preload" as="image" href="/images/1xbet.jpg" />
        <link rel="preload" as="image" href="/images/1win.jpg" />
        <link rel="preload" as="image" href="/images/melbet.jpg" />
      </head>
      <body style={{ position: 'relative', margin: 0, padding: 0, minHeight: '100vh' }}>
        <LanguageProvider>
          <HomePageDataProvider>
            <OldDeviceWarning />
            <TelegramInit />
            <LayoutUI>
            <BlockedChecker>
              <div className="container" style={{ paddingTop: '0', paddingBottom: '100px', minHeight: '100vh' }}>
                {children}
              </div>
            </BlockedChecker>
            </LayoutUI>
          </HomePageDataProvider>
        </LanguageProvider>
      </body>
    </html>
  )
}
