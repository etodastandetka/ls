"use client"
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import FixedHeaderControls from '../../components/FixedHeaderControls'
import { SupportIcon, BackIcon } from '../../components/Icons'

const SUPPORT_BOT_URL = 'https://t.me/operator_luxon_bot'

export default function SupportPage() {
  const router = useRouter()

  useEffect(() => {
    window.location.href = SUPPORT_BOT_URL
  }, [])

  return (
    <main className="space-y-6 pb-6">
      <FixedHeaderControls />

      <section className="card space-y-4 text-center">
        <div className="flex items-center justify-center gap-2">
          <SupportIcon className="w-6 h-6 text-orange-400" />
          <h1 className="text-xl font-bold text-white">Техподдержка</h1>
        </div>
        <p className="text-sm text-white/80">
          Если переход не открылся, нажмите кнопку ниже.
        </p>
        <a
          href={SUPPORT_BOT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg hover:shadow-xl"
        >
          {SUPPORT_BOT_URL.replace('https://t.me/', '@')}
        </a>
      </section>

      <div className="text-center">
        <button
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-2 bg-gray-600/80 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-600 transition-colors"
        >
          <BackIcon className="w-5 h-5" />
          На главную
        </button>
      </div>
    </main>
  )
}

