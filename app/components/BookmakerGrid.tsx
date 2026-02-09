"use client"
import { useState, useEffect, useCallback, useMemo, memo } from 'react'
import Image from 'next/image'
// throttle убран для ускорения

type Item = { key: string; name: string; logo?: string; emoji?: string }

const ALL_BOOKMAKERS: Item[] = [
  { key: '1xbet', name: '1XBET', emoji: '🎯', logo: '/images/1xbet.jpg' },
  { key: '1win', name: '1WIN', emoji: '🏆', logo: '/images/1win.jpg' },
  { key: 'melbet', name: 'MELBET', emoji: '🎲', logo: '/images/melbet.jpg' },
  { key: 'mostbet', name: 'MOSTBET', emoji: '🎯', logo: '/images/mostbet.jpg' },
  { key: 'winwin', name: 'WINWIN', emoji: '🎰', logo: '/images/winwin.png' },
  { key: '888starz', name: '888STARZ', emoji: '⭐', logo: '/images/888starz.jpg' },
]

function BookmakerGrid({ 
  value, 
  onChange,
  disabledCasinos 
}: { 
  value?: string
  onChange: (k: string) => void
  disabledCasinos?: string[]
}) {
  const [showModal, setShowModal] = useState<string | null>(null)
  const [bookmakers, setBookmakers] = useState<Item[]>(ALL_BOOKMAKERS)

  // Проверяем, является ли это ботом только для 1xbet
  // Делаем это синхронно при первом рендере, без useEffect, чтобы не было задержки
  const [initialized, setInitialized] = useState(false)
  
  useEffect(() => {
    if (initialized) return
    
    // Проверяем параметр в URL (если бот передает ?bot=1xbet)
    const urlParams = new URLSearchParams(window.location.search)
    const botTypeFromUrl = urlParams.get('bot')
    
    // Также проверяем Telegram WebApp для определения типа бота
    const tg = (window as any).Telegram?.WebApp
    let botTypeFromTelegram: string | null = null
    
    // Пытаемся определить тип бота из Telegram WebApp
    if (tg?.initDataUnsafe?.start_param) {
      // start_param может содержать тип бота
      const startParam = tg.initDataUnsafe.start_param
      if (startParam.includes('1xbet') || startParam === '1xbet') {
        botTypeFromTelegram = '1xbet'
      }
    }
    
    // Приоритет: URL параметр > Telegram start_param > localStorage (только для очистки)
    const botType = botTypeFromUrl || botTypeFromTelegram
    
    // Если определен тип бота как 1xbet, показываем только 1xbet
    if (botType === '1xbet') {
      // Сохраняем в localStorage для последующих переходов
      localStorage.setItem('bot_type', '1xbet')
      
      setBookmakers([{ key: '1xbet', name: '1XBET', emoji: '🎯', logo: '/images/1xbet.jpg' }])
      // Автоматически выбираем 1xbet, если еще не выбран
      if (!value || value !== '1xbet') {
        onChange('1xbet')
      }
    } else {
      // Если не определен тип бота как 1xbet - показываем всех букмекеров
      // Это основной бот со всеми букмекерами
      setBookmakers(ALL_BOOKMAKERS)
      // Очищаем сохраненный тип бота, чтобы не показывать только 1xbet
      localStorage.removeItem('bot_type')
    }
    
    setInitialized(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Убираем value и onChange из зависимостей чтобы избежать бесконечных циклов

  const handleClick = useCallback((key: string) => {
    // Проверяем, отключен ли букмекер
    if (disabledCasinos && disabledCasinos.includes(key)) {
      setShowModal(key)
      return
    }
    onChange(key)
  }, [disabledCasinos, onChange])

  // Убрали throttle для мгновенной реакции

  const getCasinoName = (key: string) => {
    const casino = bookmakers.find(b => b.key === key) || ALL_BOOKMAKERS.find(b => b.key === key)
    return casino?.name || key.toUpperCase()
  }

  // Определяем количество колонок: если букмекер один - на всю ширину, иначе 2 колонки
  const gridCols = bookmakers.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
  // Высота карточки: если букмекер один - больше, иначе стандартная
  const cardHeight = bookmakers.length === 1 ? 'h-48' : 'h-32'

  return (
    <>
      <div className={`grid ${gridCols} gap-3`}>
        {bookmakers.map(b => {
          const isDisabled = disabledCasinos && disabledCasinos.includes(b.key)
          return (
            <button 
              key={b.key}
              onClick={() => handleClick(b.key)}
              disabled={isDisabled}
              className={`relative overflow-hidden rounded-xl transition-all duration-100 ${cardHeight} ${
                value === b.key 
                  ? 'ring-2 ring-green-400' 
                  : isDisabled
                  ? 'opacity-70 cursor-not-allowed grayscale'
                  : ''
              }`}
            >
              {b.logo ? (
                <Image 
                  src={b.logo} 
                  alt={b.name}
                  fill
                  priority={bookmakers.length === 1} // приоритет только если один элемент на экране
                  loading={bookmakers.length === 1 ? 'eager' : 'lazy'} // ленивое для сетки
                  sizes={bookmakers.length === 1 ? "100vw" : "(max-width: 768px) 50vw, 33vw"} // быстрее за счет меньшего таргета
                  quality={bookmakers.length === 1 ? 85 : 70} // ниже качество для сетки
                  className={b.key === '1xbet' ? "object-cover transform scale-150" : "object-cover"}
                  placeholder="empty"
                  unoptimized={false} // оставляем оптимизацию Next.js
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-black/30">
                  <div className="text-4xl">{b.emoji}</div>
                </div>
              )}
              {isDisabled && (
                <>
                  {/* Баннер сверху */}
                  <div className="absolute top-0 left-0 right-0 bg-red-600/90 text-white text-xs font-bold py-1.5 px-2 text-center z-10">
                    НЕДОСТУПНО
                  </div>
                  {/* Затемнение всей карточки */}
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-0">
                    <span className="text-white/80 text-sm font-semibold">Недоступно</span>
                  </div>
                </>
              )}
            </button>
          )
        })}
      </div>

      {/* Модальное окно для отключенных букмекеров */}
      {showModal && (
        <div 
          className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          onClick={() => setShowModal(null)}
        >
          <div 
            className="bg-gray-900 rounded-xl p-6 max-w-sm mx-4 border border-gray-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-center space-y-4">
              <div className="text-orange-300 text-2xl mb-2">🔧</div>
              <h3 className="text-xl font-bold text-white">Технические работы</h3>
              <p className="text-white/70">
                В данный момент ведутся технические работы с {getCasinoName(showModal)}. 
                Попробуйте позже или выберите другого букмекера.
              </p>
              <button
                onClick={() => setShowModal(null)}
                className="btn btn-primary w-full mt-4"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default memo(BookmakerGrid)
