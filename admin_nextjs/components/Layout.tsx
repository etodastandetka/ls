'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'

interface User {
  id: number
  username: string
  email: string | null
  isSuperAdmin: boolean
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(false) // Убираем начальный loading

  const fetchUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me')
      const data = await response.json()

      if (data.success && data.data) {
        setUser(data.data)
      } else {
        router.push('/login')
      }
    } catch (error) {
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    // Загружаем пользователя в фоне, не блокируя отображение
    fetchUser()
  }, [fetchUser])

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      router.push('/login')
      router.refresh()
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  // Не показываем лоадер - страница открывается сразу
  // Если пользователь не авторизован, редирект произойдет в fetchUser
  if (!user && !loading) {
    return null // Пока идет проверка авторизации, показываем пустую страницу
  }

  const bottomNavItems = [
    { 
      href: '/dashboard', 
      label: 'ГЛАВНАЯ', 
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      )
    },
    { 
      href: '/dashboard/history', 
      label: 'ИСТОРИЯ', 
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.31-8.86c-1.77-.45-2.34-.94-2.34-1.67 0-.84.79-1.43 2.1-1.43 1.38 0 1.9.66 1.9 1.57h1.52c0-1.5-1.08-2.86-3.42-2.86-2.07 0-3.62 1.17-3.62 3.06 0 1.92 1.47 2.71 3.29 3.16 1.95.47 2.33 1.11 2.33 1.8 0 .8-.63 1.5-1.95 1.5-1.64 0-2.17-.68-2.17-1.55H8.04c0 1.63 1.18 2.77 3.94 2.77 2.23 0 3.88-1.14 3.88-3.19 0-2.06-1.51-2.78-3.55-3.19z"/>
        </svg>
      )
    },
    { 
      href: '/dashboard/chat', 
      label: 'ЧАТ', 
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      )
    },
    { 
      href: '/dashboard/wallet', 
      label: 'КОШЕЛЕК', 
      icon: (
        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
          <path d="M21 4H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H3V8h18v10zm-8-1c0 .55-.45 1-1 1s-1-.45-1-1v-3h-2v3c0 .55-.45 1-1 1s-1-.45-1-1v-3H7v3c0 .55-.45 1-1 1s-1-.45-1-1v-2H3v2c0 .55-.45 1-1 1s-1-.45-1-1v-4c0-.55.45-1 1-1h20c.55 0 1 .45 1 1v4c0 .55-.45 1-1 1s-1-.45-1-1v-2h-2v2z"/>
        </svg>
      )
    },
    { 
      href: '/dashboard/menu', 
      label: 'МЕНЮ', 
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      )
    },
  ]

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname === '/'
    }
    return pathname.startsWith(href)
  }

  // Скрываем нижнее меню на странице чата с пользователем (но не на странице чата операторов)
  const isChatPage = pathname?.includes('/users/') && pathname?.includes('/chat')

  return (
    <div className="h-screen bg-gradient-to-b from-green-950 to-green-900 flex justify-center items-center overflow-hidden">
      <div className="mobile-container w-full max-w-[414px] h-full flex flex-col">
        {/* Основной контент */}
        <main className={`px-4 py-4 bg-transparent overflow-y-auto flex-1 ${isChatPage ? 'pb-4' : 'pb-20'} overscroll-contain`} style={{ WebkitOverflowScrolling: 'touch' }}>
          {children}
        </main>

        {/* Нижнее меню навигации */}
        {!isChatPage && (
        <nav className="fixed bottom-0 left-1/2 transform -translate-x-1/2 w-full max-w-[414px] bg-gray-800 border-t border-gray-700 rounded-t-3xl z-50 shadow-2xl">
          <div className="flex justify-around items-center py-2 px-2">
            {bottomNavItems.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className={`flex flex-col items-center justify-center px-2 py-2 rounded-xl transition-all duration-200 relative ${
                    active
                      ? 'text-green-500 bg-green-500 bg-opacity-20'
                      : 'text-gray-400'
                  }`}
                >
                  <div className={`mb-1 ${active ? 'transform scale-110' : ''}`}>
                    {item.icon}
                  </div>
                  <span className={`text-[9px] font-medium uppercase tracking-wider ${
                    active ? 'text-green-500' : 'text-gray-400'
                  }`}>
                    {item.label}
                  </span>
                  {active && (
                    <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-green-500 rounded-full"></div>
                  )}
                </Link>
              )
            })}
          </div>
        </nav>
        )}
      </div>
    </div>
  )
}

