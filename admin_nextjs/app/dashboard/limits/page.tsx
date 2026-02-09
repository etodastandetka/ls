'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'

interface PlatformLimit {
  key: string
  name: string
  limit: number
  balance?: number
}

interface PlatformStats {
  key: string
  name: string
  depositsSum: number
  depositsCount: number
  withdrawalsSum: number
  withdrawalsCount: number
}

interface DailyShift {
  id: number
  date: string
  depositsSum: string
  withdrawalsSum: string
  netProfit: string
  depositsCount: number
  withdrawalsCount: number
  isClosed: boolean
  closedAt?: string
}

interface LimitsStats {
  platformLimits: PlatformLimit[]
  platformStats?: PlatformStats[]
  totalDepositsCount: number
  totalDepositsSum: number
  totalWithdrawalsCount: number
  totalWithdrawalsSum: number
  approximateIncome: number
  chart: {
    labels: string[]
    deposits: number[]
    withdrawals: number[]
  }
}

export default function LimitsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [stats, setStats] = useState<LimitsStats | null>(null)
  const [loading, setLoading] = useState(true) // Начинаем с true - показываем скелетон сразу
  const [shifts, setShifts] = useState<DailyShift[]>([])
  const [showCalendar, setShowCalendar] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [selectedDates, setSelectedDates] = useState<Date[]>([])
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth())
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear())
  const calendarRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const start = searchParams.get('start') || ''
      const end = searchParams.get('end') || ''

      const params = new URLSearchParams()
      if (start) params.append('start', start)
      if (end) params.append('end', end)

      // Загружаем статистику и смены параллельно
      // Умное кеширование: для прошлых периодов используем кеш, для сегодня - нет
      const today = new Date().toISOString().split('T')[0]
      const useCache = start && end && end < today // Кешируем только для прошлых периодов
      
      const [statsResponse, shiftsResponse] = await Promise.all([
        fetch(`/api/limits/stats?${params.toString()}`, {
          cache: useCache ? 'default' : 'no-store', // Кеш только для прошлых периодов
          next: useCache ? { revalidate: 120 } : undefined, // 2 минуты для прошлых периодов
        }),
        (start && end) ? fetch(`/api/shifts?start=${start}&end=${end}`, {
          cache: useCache ? 'default' : 'no-store', // Кеш только для прошлых периодов
          next: useCache ? { revalidate: 120 } : undefined,
        }) : Promise.resolve(null),
      ])
      
      if (!statsResponse.ok) {
        throw new Error(`HTTP ${statsResponse.status}`)
      }
      
      const statsData = await statsResponse.json()

      if (statsData.success && statsData.data) {
        setStats(statsData.data)
        
        // Устанавливаем значение дат
        setStartDate(start || '')
        setEndDate(end || '')
        
        // Устанавливаем выбранные даты для календаря
        if (start && end) {
          setSelectedDates([new Date(start), new Date(end)])
        } else {
          setSelectedDates([])
        }
      } else {
        console.error('Failed to fetch limits stats: API returned error', statsData)
      }

      // Загружаем смены, если период выбран
      if (shiftsResponse && shiftsResponse.ok) {
        const shiftsData = await shiftsResponse.json()
        if (shiftsData.success && shiftsData.data) {
          setShifts(shiftsData.data.shifts || [])
        }
      } else {
        setShifts([])
      }
    } catch (error) {
      console.error('Failed to fetch limits stats:', error)
    } finally {
      setLoading(false)
    }
  }, [searchParams])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])


  // Инициализация дат из URL
  useEffect(() => {
    const start = searchParams.get('start') || ''
    const end = searchParams.get('end') || ''
    setStartDate(start)
    setEndDate(end)
    if (start && end) {
      setSelectedDates([new Date(start), new Date(end)])
    }
  }, [searchParams])

  const handleDateClick = (date: Date) => {
    if (selectedDates.length === 0) {
      // Первая дата - начало периода
      setSelectedDates([date])
    } else if (selectedDates.length === 1) {
      // Вторая дата - конец периода
      const firstDate = selectedDates[0]
      if (date < firstDate) {
        // Если вторая дата раньше первой, меняем местами
        setSelectedDates([date, firstDate])
      } else {
        setSelectedDates([firstDate, date])
      }
    } else {
      // Начинаем новый выбор
      setSelectedDates([date])
    }
  }

  // Функция для форматирования даты в YYYY-MM-DD с учетом локального часового пояса
  const formatDateLocal = (date: Date): string => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const handleApplyPeriod = () => {
    if (selectedDates.length >= 1) {
      // Используем локальное форматирование вместо toISOString() чтобы избежать проблем с часовыми поясами
      const start = formatDateLocal(selectedDates[0])
      const end = selectedDates.length === 2 
        ? formatDateLocal(selectedDates[1])
        : start // Если выбрана одна дата, используем её как начало и конец
      
      const params = new URLSearchParams()
      params.append('start', start)
      params.append('end', end)
      
      router.push(`/dashboard/limits?${params.toString()}`)
      setShowCalendar(false)
    }
  }

  const handleClearPeriod = () => {
    setSelectedDates([])
    setStartDate('')
    setEndDate('')
    router.push('/dashboard/limits')
    setShowCalendar(false)
  }

  // Навигация по месяцам
  const goToPreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentMonth(currentMonth - 1)
    }
  }

  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear(currentYear + 1)
    } else {
      setCurrentMonth(currentMonth + 1)
    }
  }

  // Генерация календаря
  const generateCalendar = () => {
    const firstDay = new Date(currentYear, currentMonth, 1)
    const lastDay = new Date(currentYear, currentMonth + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDayOfWeek = firstDay.getDay()
    
    const days: (Date | null)[] = []
    
    // Пустые ячейки до первого дня месяца
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null)
    }
    
    // Дни месяца
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(currentYear, currentMonth, day))
    }
    
    return days
  }

  const getMonthName = () => {
    return new Date(currentYear, currentMonth).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  }

  const isDateInRange = (date: Date) => {
    if (selectedDates.length === 0) return false
    if (selectedDates.length === 1) {
      return date.toDateString() === selectedDates[0].toDateString()
    }
    return date >= selectedDates[0] && date <= selectedDates[1]
  }

  const isDateSelected = (date: Date) => {
    return selectedDates.some(d => d.toDateString() === date.toDateString())
  }

  const formatDateRange = () => {
    if (startDate && endDate) {
      return `${startDate} — ${endDate}`
    }
    return 'Выберите период'
  }

  useEffect(() => {
    // Инициализация графика
    if (!stats || loading) return

    // Динамически загружаем Chart.js
    const loadChart = async () => {
      if (typeof window === 'undefined') return

      // Проверяем, не загружен ли уже Chart.js
      if ((window as any).Chart) {
        renderChart()
        return
      }

      // Загружаем Chart.js
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js'
      script.onload = renderChart
      document.body.appendChild(script)
    }

    const renderChart = () => {
      const canvas = document.getElementById('operations-chart') as HTMLCanvasElement
      if (!canvas || !(window as any).Chart) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Удаляем старый график если есть
      const existingChart = (canvas as any).chart
      if (existingChart) {
        existingChart.destroy()
      }

      // Создаем градиенты для столбцов
      const gradientDeposits = ctx.createLinearGradient(0, 0, 0, 400)
      gradientDeposits.addColorStop(0, 'rgba(34, 197, 94, 1)')
      gradientDeposits.addColorStop(0.7, 'rgba(34, 197, 94, 0.8)')
      gradientDeposits.addColorStop(1, 'rgba(34, 197, 94, 0.4)')

      const gradientWithdrawals = ctx.createLinearGradient(0, 0, 0, 400)
      gradientWithdrawals.addColorStop(0, 'rgba(251, 191, 36, 1)')
      gradientWithdrawals.addColorStop(0.7, 'rgba(251, 191, 36, 0.8)')
      gradientWithdrawals.addColorStop(1, 'rgba(251, 191, 36, 0.4)')

      const chart = new (window as any).Chart(ctx, {
        type: 'bar',
        data: {
          labels: stats.chart.labels,
          datasets: [
            {
              label: 'Пополнения',
              data: stats.chart.deposits,
              backgroundColor: gradientDeposits,
              borderColor: '#22c55e',
              borderWidth: 2,
              borderRadius: 8,
              borderSkipped: false,
              maxBarThickness: 40,
            },
            {
              label: 'Выводы',
              data: stats.chart.withdrawals,
              backgroundColor: gradientWithdrawals,
              borderColor: '#fbbf24',
              borderWidth: 2,
              borderRadius: 8,
              borderSkipped: false,
              maxBarThickness: 40,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false,
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: '#ffffff',
                font: {
                  size: 12,
                  weight: '600',
                },
                usePointStyle: true,
                pointStyle: 'circle',
                padding: 15,
                boxWidth: 10,
                boxHeight: 10,
              },
            },
            tooltip: {
              backgroundColor: 'rgba(0, 0, 0, 0.9)',
              titleColor: '#ffffff',
              bodyColor: '#ffffff',
              borderColor: 'rgba(255, 255, 255, 0.2)',
              borderWidth: 1,
              padding: 14,
              cornerRadius: 10,
              displayColors: true,
              titleFont: {
                size: 14,
                weight: 'bold',
              },
              bodyFont: {
                size: 13,
              },
              boxPadding: 8,
              callbacks: {
                label: function(context: any) {
                  return `${context.dataset.label}: ${context.parsed.y} операций`
                }
              }
            },
          },
          scales: {
            x: {
              stacked: false,
              ticks: {
                color: '#9ca3af',
                font: {
                  size: 11,
                  weight: '500',
                },
                padding: 10,
              },
              grid: {
                display: false,
              },
              border: {
                color: 'rgba(156, 163, 175, 0.3)',
                width: 1,
              },
            },
            y: {
              stacked: false,
              beginAtZero: true,
              ticks: {
                color: '#9ca3af',
                font: {
                  size: 11,
                },
                padding: 10,
                stepSize: 1,
                callback: function(value: any) {
                  return Number(value).toFixed(0)
                },
              },
              grid: {
                color: 'rgba(156, 163, 175, 0.15)',
                drawBorder: false,
                lineWidth: 1,
              },
              border: {
                color: 'rgba(156, 163, 175, 0.3)',
                width: 1,
              },
            },
          },
        },
      })

      ;(canvas as any).chart = chart
    }

    loadChart()
  }, [stats, loading])

  // Показываем скелетон пока загружаются данные
  if (loading || !stats) {
    return (
      <div className="py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="w-10"></div>
          <div className="flex-1 text-center">
            <div className="h-6 bg-gray-700 rounded w-24 mx-auto mb-2 animate-pulse"></div>
            <div className="h-3 bg-gray-700 rounded w-32 mx-auto animate-pulse"></div>
          </div>
          <div className="w-10"></div>
        </div>

        {/* Скелетон периода */}
        <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 animate-pulse">
          <div className="h-5 bg-gray-700 rounded w-32 mb-3"></div>
          <div className="h-10 bg-gray-700 rounded w-full"></div>
        </div>

        {/* Скелетон лимитов */}
        <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 animate-pulse">
          <div className="h-5 bg-gray-700 rounded w-40 mb-3"></div>
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="h-4 bg-gray-700 rounded w-24"></div>
                <div className="h-4 bg-gray-700 rounded w-20"></div>
              </div>
            ))}
          </div>
        </div>

        {/* Скелетон статистики */}
        <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 animate-pulse">
          <div className="h-5 bg-gray-700 rounded w-40 mb-3"></div>
          <div className="grid grid-cols-2 gap-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="bg-gray-900 bg-opacity-50 rounded-xl p-3 border border-gray-700">
                <div className="h-3 bg-gray-700 rounded w-24 mb-2"></div>
                <div className="h-6 bg-gray-700 rounded w-20 mb-1"></div>
                <div className="h-3 bg-gray-700 rounded w-16"></div>
              </div>
            ))}
          </div>
        </div>

        {/* Скелетон графика */}
        <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 border border-gray-700 animate-pulse">
          <div className="h-5 bg-gray-700 rounded w-32 mb-3"></div>
          <div className="h-[250px] bg-gray-700 rounded"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="py-4">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10"></div>
        <div className="flex-1 text-center">
          <h1 className="text-xl font-bold text-white">Лимиты</h1>
          <p className="text-xs text-gray-300 mt-1">Лимиты и балансы платформ</p>
        </div>
        <div className="w-10"></div>
      </div>

      {/* Период с календарем */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <div className="text-base font-bold text-white mb-3">Период (от — до)</div>
        <div className="relative" ref={calendarRef}>
          <button
            type="button"
            onClick={() => setShowCalendar(!showCalendar)}
            className="w-full bg-gray-900 text-white border border-gray-700 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 flex items-center justify-between"
          >
            <span className={startDate && endDate ? 'text-white' : 'text-gray-400'}>
              {formatDateRange()}
            </span>
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>

          {/* Календарь через Portal */}
          {mounted && showCalendar && createPortal(
            <>
              {/* Затемненный фон */}
              <div 
                className="fixed inset-0 bg-black/50 backdrop-blur-sm" 
                onClick={() => setShowCalendar(false)}
                style={{ 
                  position: 'fixed', 
                  top: 0, 
                  left: 0, 
                  right: 0, 
                  bottom: 0,
                  zIndex: 99999
                }}
              />
              {/* Календарь */}
              <div 
                className="fixed flex items-start justify-center pt-16 px-4 pointer-events-none"
                style={{ 
                  position: 'fixed', 
                  top: 0, 
                  left: 0, 
                  right: 0, 
                  bottom: 0,
                  zIndex: 100000,
                  pointerEvents: 'none'
                }}
              >
                <div 
                  className="bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-2xl max-w-xs w-full relative" 
                  onClick={(e) => e.stopPropagation()}
                  style={{ pointerEvents: 'auto' }}
                >
              <div className="mb-2">
                <div className="flex items-center justify-between mb-1.5">
                  <button
                    type="button"
                    onClick={goToPreviousMonth}
                    className="p-0.5 hover:bg-gray-700 rounded transition-colors"
                  >
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <h3 className="text-white font-semibold text-sm">
                    {getMonthName()}
                  </h3>
                  <button
                    type="button"
                    onClick={goToNextMonth}
                    className="p-0.5 hover:bg-gray-700 rounded transition-colors"
                  >
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-0.5 mb-1">
                  {['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'].map((day) => (
                    <div key={day} className="text-center text-[10px] text-gray-400 py-0.5">
                      {day}
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {generateCalendar().map((date, index) => {
                    if (!date) {
                      return <div key={index} className="aspect-square" />
                    }
                    const isInRange = isDateInRange(date)
                    const isSelected = isDateSelected(date)
                    const isToday = date.toDateString() === new Date().toDateString()
                    
                    return (
                      <button
                        key={index}
                        type="button"
                        onClick={() => handleDateClick(date)}
                        className={`aspect-square rounded text-xs transition-colors ${
                          isSelected
                            ? 'bg-green-500 text-black font-bold'
                            : isInRange
                            ? 'bg-green-500/30 text-white'
                            : isToday
                            ? 'bg-gray-700 text-white font-semibold'
                            : 'text-white hover:bg-gray-700'
                        }`}
                      >
                        {date.getDate()}
                      </button>
                    )
                  })}
                </div>
              </div>
              
              {selectedDates.length >= 1 && (
                <div className="text-center text-xs text-gray-300 mb-2">
                  {selectedDates.length === 1 
                    ? 'Выбрана одна дата' 
                    : 'Период выбран'}
                </div>
              )}
              
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={handleApplyPeriod}
                  disabled={selectedDates.length === 0}
                  className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-gray-700 disabled:text-gray-500 text-black font-medium py-1.5 px-3 rounded-lg transition-colors text-xs"
                >
                  Применить
                </button>
                <button
                  type="button"
                  onClick={handleClearPeriod}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-xs"
                >
                  Очистить
                </button>
              </div>
                </div>
              </div>
            </>,
            document.body
          )}
        </div>
        <p className="text-xs text-gray-400 mt-2">Оставьте пустым, чтобы показать все время</p>
      </div>

      {/* Лимиты платформ */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <div className="text-base font-bold text-white mb-3">Лимиты платформ</div>
        {stats.platformLimits.length > 0 ? (
          <div className="space-y-2">
            {stats.platformLimits.map((platform) => {
              // Для 1win показываем баланс вместо лимита
              // Для остальных показываем limit, если он > 0, иначе balance если есть
              let displayValue = platform.limit
              
              if (platform.key === '1win' && platform.balance !== undefined && platform.balance > 0) {
                displayValue = platform.balance
              } else if (platform.limit <= 0 && platform.balance !== undefined && platform.balance > 0) {
                // Если limit не доступен, показываем balance
                displayValue = platform.balance
              }
              
              // N/A только если значение действительно недоступно (меньше или равно 0)
              const isNA = displayValue <= 0 || isNaN(displayValue)
              
              return (
                <div key={platform.key} className="flex items-center justify-between py-2">
                  <span className="text-white">{platform.name}</span>
                  <span className={isNA ? "text-gray-400 font-bold" : "text-green-500 font-bold"}>
                    {isNA ? 'N/A' : `${displayValue.toFixed(2)} с`}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-gray-400 text-sm">Нет данных по лимитам</div>
        )}
      </div>

      {/* Детальная статистика по платформам */}
      {stats.platformStats && stats.platformStats.length > 0 && (
        <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
          <div className="text-base font-bold text-white mb-3">Статистика по платформам</div>
          <div className="space-y-3">
            {stats.platformStats.map((platform) => (
              <div key={platform.key} className="bg-gray-900 bg-opacity-50 rounded-xl p-4 border border-gray-700">
                <div className="text-white font-semibold mb-3">{platform.name}</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Пополнения</div>
                    <div className="text-green-500 font-bold text-lg">
                      {platform.depositsSum.toFixed(2)} с
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {platform.depositsCount} {platform.depositsCount === 1 ? 'операция' : platform.depositsCount < 5 ? 'операции' : 'операций'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Выводы</div>
                    <div className="text-yellow-500 font-bold text-lg">
                      {platform.withdrawalsSum.toFixed(2)} с
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {platform.withdrawalsCount} {platform.withdrawalsCount === 1 ? 'операция' : platform.withdrawalsCount < 5 ? 'операции' : 'операций'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Общая статистика */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
        <div className="text-base font-bold text-white mb-3">Общая статистика</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-900 bg-opacity-50 rounded-xl p-3 border border-gray-700">
            <div className="text-xs text-gray-400 mb-1">Всего пополнений</div>
            <div className="text-green-500 font-bold text-lg">
              {stats.totalDepositsSum.toFixed(2)} с
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {stats.totalDepositsCount} {stats.totalDepositsCount === 1 ? 'операция' : stats.totalDepositsCount < 5 ? 'операции' : 'операций'}
            </div>
          </div>
          <div className="bg-gray-900 bg-opacity-50 rounded-xl p-3 border border-gray-700">
            <div className="text-xs text-gray-400 mb-1">Всего выводов</div>
            <div className="text-yellow-500 font-bold text-lg">
              {stats.totalWithdrawalsSum.toFixed(2)} с
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {stats.totalWithdrawalsCount} {stats.totalWithdrawalsCount === 1 ? 'операция' : stats.totalWithdrawalsCount < 5 ? 'операции' : 'операций'}
            </div>
          </div>
        </div>
      </div>

      {/* Чистая прибыль (из смен) */}
      <div className="bg-gradient-to-r from-green-500/20 to-green-600/20 rounded-xl p-4 mb-4 border border-green-500/30 backdrop-blur-sm">
        <div className="text-base font-bold text-white mb-2">
          {startDate && endDate ? 'Чистая прибыль за период' : 'Чистая прибыль за сегодня'}
        </div>
        <div className="text-green-500 font-bold text-2xl mb-1">
          {stats.approximateIncome.toFixed(2)} с
        </div>
        <div className="text-xs text-gray-400">
          {startDate && endDate 
            ? `Сумма всех закрытых смен за период ${startDate} — ${endDate} (8% от пополнений + 2% от выводов)`
            : '8% от пополнений + 2% от выводов (за сегодня с 00:00)'}
        </div>
      </div>

      {/* Смены за период */}
      {startDate && endDate && shifts.length > 0 && (
        <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 mb-4 border border-gray-700 backdrop-blur-sm">
          <div className="text-base font-bold text-white mb-3">
            Смены за период ({shifts.length} {shifts.length === 1 ? 'смена' : shifts.length < 5 ? 'смены' : 'смен'})
          </div>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {shifts.map((shift) => (
              <div key={shift.id} className="bg-gray-900 bg-opacity-50 rounded-xl p-3 border border-gray-700">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-white font-semibold text-sm">
                    {new Date(shift.date).toLocaleDateString('ru-RU', { 
                      day: '2-digit', 
                      month: '2-digit', 
                      year: 'numeric' 
                    })}
                  </div>
                  <div className={`text-xs px-2 py-1 rounded ${
                    shift.isClosed 
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                      : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                  }`}>
                    {shift.isClosed ? 'Закрыта' : 'Открыта'}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-gray-400">Пополнения</div>
                    <div className="text-green-500 font-bold">
                      {parseFloat(shift.depositsSum).toFixed(2)} с
                    </div>
                    <div className="text-gray-500">{shift.depositsCount} оп.</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Выводы</div>
                    <div className="text-yellow-500 font-bold">
                      {parseFloat(shift.withdrawalsSum).toFixed(2)} с
                    </div>
                    <div className="text-gray-500">{shift.withdrawalsCount} оп.</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Чистая прибыль</div>
                    <div className="text-green-400 font-bold text-base">
                      {parseFloat(shift.netProfit).toFixed(2)} с
                    </div>
                    <div className="text-gray-500 text-[10px]">8% + 2%</div>
                  </div>
                </div>
                {shift.closedAt && (
                  <div className="text-[10px] text-gray-500 mt-2">
                    Закрыта: {new Date(shift.closedAt).toLocaleString('ru-RU')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}


      {/* График */}
      <div className="bg-gray-800 bg-opacity-50 rounded-xl p-4 border border-gray-700 backdrop-blur-sm">
        <div className="text-base font-bold text-white mb-3">График операций</div>
        <div className="h-[250px]">
          <canvas id="operations-chart"></canvas>
        </div>
      </div>
    </div>
  )
}
