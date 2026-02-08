'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function MenuPage() {
  const router = useRouter()
  const [showMenu, setShowMenu] = useState(true)

  const menuItems = [
    { href: '/dashboard/search', label: 'Поиск', icon: '🔍' },
    { href: '/dashboard/requisites', label: 'Реквизиты', icon: '💳' },
    { href: '/dashboard/limits', label: 'Лимиты', icon: '⚙️' },
    { href: '/dashboard/referral-withdrawals', label: 'Реф. вывод', icon: '💸' },
    { href: '/dashboard/broadcast', label: 'Рассылка', icon: '📢' },
    { href: '/dashboard/settings', label: 'Настройки', icon: '🔧' },
  ]

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      router.push('/login')
      router.refresh()
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  return (
    <div className="py-4">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10"></div>
        <div className="flex-1 text-center">
          <h1 className="text-xl font-bold text-white">Меню</h1>
        </div>
        <button
          onClick={handleLogout}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
        >
          <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>

      <div className="bg-gray-800 bg-opacity-50 shadow-lg rounded-xl overflow-hidden border border-gray-700 backdrop-blur-sm">
        <ul className="divide-y divide-gray-700">
          {menuItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={false}
                className="flex items-center px-4 py-4 hover:bg-gray-700 hover:bg-opacity-50 transition-colors"
              >
                <span className="text-2xl mr-4">{item.icon}</span>
                <span className="text-base font-medium text-white flex-1">{item.label}</span>
                <svg
                  className="h-5 w-5 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

