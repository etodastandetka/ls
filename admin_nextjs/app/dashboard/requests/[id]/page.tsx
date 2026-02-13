'use client'

import { useEffect, useState, useMemo, useRef, useCallback, memo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'

interface RequestDetail {
  id: number
  userId: string
  username: string | null
  firstName: string | null
  lastName: string | null
  bookmaker: string | null
  accountId: string | null
  amount: string | null
  requestType: string
  status: string
  statusDetail: string | null
  status_detail: string | null
  processedBy: string | null
  bank: string | null
  phone: string | null
  withdrawalCode: string | null
  photoFileUrl: string | null
  userNote: string | null
  paymentMethod: string | null
  cryptoPayment: any | null
  isVip?: boolean
  is_vip?: boolean
  createdAt: string
  updatedAt: string
  processedAt: string | null
  incomingPayments: any[]
  matchingPayments?: any[]
  casinoTransactions?: any[]
}

interface MatchingPayment {
  id: number
  amount: string
  bank: string | null
  paymentDate: string
  requestId: number | null
  isProcessed: boolean
}

interface Payment {
  id: number
  amount: string
  createdAt: string
  description?: string
}

export default function RequestDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [request, setRequest] = useState<RequestDetail | null>(null)
  const [loading, setLoading] = useState(true) // Начинаем с true - показываем скелетон сразу
  const [searchAmount, setSearchAmount] = useState('')
  const [exactAmount, setExactAmount] = useState(true)
  const [processedOnly, setProcessedOnly] = useState(false)
  const [appliedSearchAmount, setAppliedSearchAmount] = useState('')
  const [appliedExactAmount, setAppliedExactAmount] = useState(false)
  const [appliedProcessedOnly, setAppliedProcessedOnly] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showSearchModal, setShowSearchModal] = useState(false)
  const [searchId, setSearchId] = useState('')
  const [deferring, setDeferring] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false) // Флаг для отслеживания процесса подтверждения
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null)
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null)
  const [showPhotoModal, setShowPhotoModal] = useState(false)
  const [photoZoom, setPhotoZoom] = useState(1)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [pendingStatus, setPendingStatus] = useState<'completed' | 'approved' | 'rejected' | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [photoError, setPhotoError] = useState(false) // Флаг ошибки загрузки фото
  const [showAllPayments, setShowAllPayments] = useState(false)
  const [allPayments, setAllPayments] = useState<MatchingPayment[]>([])
  const [allPaymentsLoading, setAllPaymentsLoading] = useState(false)
  const [allPaymentsError, setAllPaymentsError] = useState<string | null>(null)
  const isMountedRef = useRef(true)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const photoLoadedRef = useRef(false) // Флаг, что фото уже загружено для текущей заявки
  const currentRequestIdRef = useRef<string | null>(null) // ID текущей заявки

  // Функция для валидации URL фото
  const isValidPhotoUrl = (url: string | null | undefined): boolean => {
    if (!url || typeof url !== 'string') return false
    
    // Убираем пробелы в начале и конце
    const trimmedUrl = url.trim()
    if (trimmedUrl === '') return false
    
    // Проверяем, что это валидный URL или data URL
    try {
      // Проверяем data URL
      if (trimmedUrl.startsWith('data:')) {
        // Проверяем формат data URL: data:[<mediatype>][;base64],<data>
        const dataUrlPattern = /^data:([a-zA-Z][a-zA-Z0-9]*\/[a-zA-Z0-9][a-zA-Z0-9]*)(;base64)?,/
        if (!dataUrlPattern.test(trimmedUrl)) return false
        
        // Проверяем, что после запятой есть данные
        const commaIndex = trimmedUrl.indexOf(',')
        if (commaIndex === -1 || commaIndex === trimmedUrl.length - 1) return false
        
        // Проверяем, что данные не пустые (минимум 10 символов)
        const dataPart = trimmedUrl.substring(commaIndex + 1)
        if (dataPart.length < 10) return false
        
        return true
      }
      
      // Проверяем относительный URL (начинается с /)
      if (trimmedUrl.startsWith('/')) {
        // Проверяем, что это не просто "/" и не содержит опасных символов
        if (trimmedUrl.length > 1 && !trimmedUrl.includes('..')) {
          return true
        }
      }
      
      // Проверяем абсолютный URL (http/https)
      if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
        try {
          new URL(trimmedUrl)
          return true
        } catch {
          return false
        }
      }
      
      // Если это не data URL, не относительный URL и не http/https, считаем невалидным
      return false
    } catch (error) {
      console.warn('⚠️ [Request Detail] Ошибка валидации URL:', error, 'URL:', trimmedUrl)
      return false
    }
  }

  // Функция для загрузки фото заявки
  const fetchRequestPhoto = useCallback((requestId: string) => {
    // Проверяем, что фото еще не загружено
    if (photoLoadedRef.current || !isMountedRef.current) {
      return
    }
    
    fetch(`/api/requests/${requestId}/photo`, {
      cache: 'no-store', // Не кэшируем - фото может появиться позже
      next: { revalidate: 0 }, // Всегда проверяем актуальность
    })
      .then(res => {
        if (!res.ok) return { success: false }
        return res.json()
      })
      .then(photoData => {
        // Проверяем еще раз, что фото не загружено (защита от дублирования)
        if (photoLoadedRef.current || !isMountedRef.current) {
          return
        }
        
        if (photoData.success && photoData.data?.photoFileUrl && isMountedRef.current) {
          const photoUrl = String(photoData.data.photoFileUrl).trim()
          // Валидируем URL перед использованием
          if (isValidPhotoUrl(photoUrl)) {
            setRequest(prev => {
              if (!prev) return null
              // Если фото уже есть, не меняем его
              if (prev.photoFileUrl) return prev
              
              photoLoadedRef.current = true // Отмечаем, что фото загружено
              setPhotoError(false) // Сбрасываем ошибку
              console.log('✅ [Request Detail] Фото успешно загружено при обновлении:', photoUrl.substring(0, 50) + '...')
              return {
                ...prev,
                photoFileUrl: photoUrl
              }
            })
          } else {
            console.warn('⚠️ [Request Detail] Невалидный URL фото при обновлении:', photoUrl, 'Type:', typeof photoUrl, 'Length:', photoUrl?.length)
            setPhotoError(true)
          }
        }
      })
      .catch((error) => {
        // Тихая ошибка - просто не показываем фото
        console.error('❌ [Request Detail] Ошибка загрузки фото при обновлении:', error)
      })
  }, [])

  // Вспомогательная функция для обновления заявки с сохранением photoFileUrl
  const updateRequestPreservingPhoto = useCallback((newRequestData: RequestDetail | ((prev: RequestDetail | null) => RequestDetail | null)) => {
    setRequest(prev => {
      const newRequest = typeof newRequestData === 'function' ? newRequestData(prev) : newRequestData
      if (!prev || !newRequest) return newRequest
      
      // КРИТИЧНО: Если фото уже загружено, ВСЕГДА сохраняем его и НИКОГДА не меняем
      // API всегда возвращает null для фото, оно загружается отдельно только один раз
      if (prev.photoFileUrl && photoLoadedRef.current) {
        // Всегда сохраняем старое фото, даже если пришло новое
        return { ...newRequest, photoFileUrl: prev.photoFileUrl }
      }
      
      // Сохраняем существующий photoFileUrl, если новый null или undefined
      if (prev.photoFileUrl && (!newRequest.photoFileUrl || newRequest.photoFileUrl === null)) {
        return { ...newRequest, photoFileUrl: prev.photoFileUrl }
      }
      
      // Если фото появилось в новых данных, но его не было раньше - загружаем его
      if (newRequest.photoFileUrl && !prev.photoFileUrl && isValidPhotoUrl(newRequest.photoFileUrl)) {
        photoLoadedRef.current = true
        setPhotoError(false)
        console.log('✅ [Request Detail] Фото найдено в обновленных данных')
      }
      
      // Если фото нет в новых данных, но заявка еще pending - проверяем фото отдельно
      if (!newRequest.photoFileUrl && newRequest.status === 'pending' && !photoLoadedRef.current) {
        const requestId = Array.isArray(params.id) ? params.id[0] : params.id
        if (requestId) {
          // Загружаем фото асинхронно, не блокируя обновление
          setTimeout(() => {
            fetchRequestPhoto(requestId)
          }, 100)
        }
      }
      
      return newRequest
    })
  }, [fetchRequestPhoto, params.id])

  useEffect(() => {
    isMountedRef.current = true
    
    return () => {
      isMountedRef.current = false
    }
  }, [])

    useEffect(() => {
      const requestId = Array.isArray(params.id) ? params.id[0] : params.id
      if (!requestId) {
        setLoading(false)
        return
      }

      // Если заявка изменилась, сбрасываем флаги загрузки фото
      if (currentRequestIdRef.current !== requestId) {
        photoLoadedRef.current = false
        setPhotoError(false) // Сбрасываем ошибку при смене заявки
        currentRequestIdRef.current = requestId
      }

      const abortController = new AbortController()

      // Загружаем данные сразу, без показа индикатора загрузки
      const fetchRequest = async (showLoading = true) => {
        // Если это первая загрузка, не показываем loading - показываем скелетон сразу
        if (!showLoading) {
          // Для автообновления не меняем состояние loading
        }
        
        try {
          // Всегда получаем свежие данные для быстрого отображения автопополнения
          const response = await fetch(`/api/requests/${requestId}`, {
            signal: abortController.signal,
            cache: 'no-store',
          })
          
          if (abortController.signal.aborted || !isMountedRef.current) return
          
          // Проверяем, что ответ является JSON
          const contentType = response.headers.get('content-type')
          if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text()
            console.error('❌ API returned non-JSON response:', response.status, text.substring(0, 200))
            throw new Error(`API returned ${response.status} error. Expected JSON but got ${contentType}`)
          }
          
          const data = await response.json()

          // console.log('📋 Request detail data:', data)

          if (!isMountedRef.current) return

          if (data.success && isMountedRef.current) {
            const requestData = data.data
            
            // Устанавливаем данные СРАЗУ - это критично для мгновенного отображения
            updateRequestPreservingPhoto(requestData)
            
            // Убираем loading СРАЗУ после установки данных (не ждем фото)
              setLoading(false)
            
            // Загружаем фото если его еще нет - ВСЕГДА, не только при первой загрузке
            // Это важно для случаев, когда фото было добавлено после открытия страницы
            // Загружаем фото ПАРАЛЛЕЛЬНО с основными данными для ускорения, без показа лоадера
            if (!photoLoadedRef.current && !requestData.photoFileUrl) {
              // Загружаем фото сразу, без задержки - параллельно с основным контентом
              fetch(`/api/requests/${requestId}/photo`, {
                cache: 'no-store', // Не кэшируем - фото может появиться позже
                next: { revalidate: 0 }, // Всегда проверяем актуальность
              })
                .then(res => {
                  if (!res.ok) return { success: false }
                  return res.json()
                })
                .then(photoData => {
                  // Проверяем еще раз, что фото не загружено (защита от дублирования)
                  if (photoLoadedRef.current || !isMountedRef.current) {
                    return
                  }
                  
                  if (photoData.success && photoData.data?.photoFileUrl && isMountedRef.current) {
                    const photoUrl = String(photoData.data.photoFileUrl).trim()
                    // Валидируем URL перед использованием
                    if (isValidPhotoUrl(photoUrl)) {
                      setRequest(prev => {
                        if (!prev) return null
                        // Если фото уже есть, не меняем его
                        if (prev.photoFileUrl) return prev
                        
                        photoLoadedRef.current = true // Отмечаем, что фото загружено
                        setPhotoError(false) // Сбрасываем ошибку
                        console.log('✅ [Request Detail] Фото успешно загружено:', photoUrl.substring(0, 50) + '...')
                        return {
                          ...prev,
                          photoFileUrl: photoUrl
                        }
                      })
                    } else {
                      console.warn('⚠️ [Request Detail] Невалидный URL фото:', photoUrl, 'Type:', typeof photoUrl, 'Length:', photoUrl?.length)
                      setPhotoError(true)
                    }
                  } else {
                    // Если фото нет в ответе, это нормально - просто не показываем его
                    console.log('ℹ️ [Request Detail] Фото не найдено для заявки', requestId)
                  }
                })
                .catch((error) => {
                  // Логируем ошибку для отладки
                  console.error('❌ [Request Detail] Ошибка загрузки фото:', error)
                })
            } else if (requestData.photoFileUrl) {
              // Если фото уже есть в основных данных, просто отмечаем что оно загружено
              photoLoadedRef.current = true
              setPhotoError(false)
            }
            
            // Интервал автообновления управляется в основном useEffect
            
            // Загружаем фото профиля параллельно (не блокируем отображение страницы)
            if (requestData.userId) {
              // Загружаем сразу, без задержки - параллельно с основным контентом
              fetchProfilePhoto(requestData.userId).catch(err => {
                console.error('Failed to fetch profile photo:', err)
              })
            }
            
            // Проверяем автопополнение (привязанный платеж с совпадающей суммой)
            // Делаем это в фоне после отображения страницы, чтобы не замедлять загрузку
            if (requestData.requestType === 'deposit' && 
                requestData.status === 'pending' &&
                requestData.matchingPayments && 
                requestData.matchingPayments.length > 0) {
              // Выполняем проверку сразу, без задержки (не блокируем UI)
              // Используем requestAnimationFrame для выполнения после рендера
              requestAnimationFrame(() => {
                if (!isMountedRef.current) return
                
                const linkedPayment = requestData.matchingPayments.find((p: MatchingPayment) => 
                  p.requestId === requestData.id && p.isProcessed
                )
                
                if (linkedPayment && requestData.amount) {
                  const paymentAmount = parseFloat(linkedPayment.amount)
                  const requestAmount = parseFloat(requestData.amount)
                  
                  // Если сумма совпадает (с точностью до 1 копейки), обновляем статус
                  if (Math.abs(paymentAmount - requestAmount) < 0.01) {
                    // Обновляем статус в фоне, не блокируя UI
                    fetch(`/api/requests/${requestData.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ 
                        status: 'completed',
                        statusDetail: null
                      }),
                    })
                    .then(updateResponse => {
                      if (updateResponse.ok && isMountedRef.current) {
                        // Обновляем данные без полной перезагрузки
                        fetchRequest(false)
                      }
                    })
                    .catch(error => {
                      console.error('Failed to auto-update request status:', error)
                    })
                  }
                }
              })
            }
          } else {
            console.error('❌ Failed to fetch request:', data.error)
            // Если заявка не найдена, показываем лоадер, затем простой экран
            if (showLoading && response.status === 404) {
              setNotFound(true)
              // Убираем задержку - показываем ошибку сразу
              setLoading(false)
            } else if (showLoading) {
              setLoading(false)
            }
          }
        } catch (error: any) {
          if (error.name === 'AbortError') {
            return // Запрос был отменен, игнорируем ошибку
          }
          console.error('❌ Failed to fetch request:', error)
          // При ошибке сбрасываем loading
          if (isMountedRef.current && !abortController.signal.aborted && showLoading) {
            setLoading(false)
          }
        }
      }
      
      const fetchProfilePhoto = async (userId: string) => {
        try {
          const photoResponse = await fetch(`/api/users/${userId}/profile-photo`)
          
          // Проверяем Content-Type перед парсингом JSON
          const photoContentType = photoResponse.headers.get('content-type')
          if (!photoContentType || !photoContentType.includes('application/json')) {
            // Если не JSON, просто игнорируем (возможно, это ошибка 500)
            if (!photoResponse.ok) {
              const text = await photoResponse.text()
              console.error('❌ Profile photo API error:', photoResponse.status, text.substring(0, 200))
            }
            return
          }
          
          const photoData = await photoResponse.json()
          
          if (photoData.success && photoData.data?.photoUrl && isMountedRef.current) {
            setProfilePhotoUrl(photoData.data.photoUrl)
          }
        } catch (error) {
          console.error('Failed to fetch profile photo:', error)
        }
      }
      
      // Фото чека теперь загружается вместе с основными данными (оптимизация)
      // Отдельный запрос больше не нужен
      
            // Дополнительные данные уже загружаются в основном API endpoint, отдельный запрос не нужен
    
    // Загружаем данные сразу - скелетон уже показывается
    // Не устанавливаем loading в false сразу, чтобы скелетон показывался до загрузки данных
    fetchRequest(true)
    
    // Создаем начальный интервал (будет обновлен после загрузки данных)
    intervalRef.current = setInterval(() => {
      if (!document.hidden && isMountedRef.current) {
          fetchRequest(false)
        }
    }, 2000)
    
    // Обновление при фокусе страницы
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchRequest(false)
      }
    }
    
    const handleFocus = () => {
      fetchRequest(false)
    }
    
    // Синхронизация между вкладками через storage event
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'request_updated' && e.newValue) {
        const updatedRequestId = parseInt(e.newValue)
        if (updatedRequestId === parseInt(requestId as string)) {
          console.log('🔄 Request updated in another tab:', updatedRequestId)
          fetchRequest(false)
        }
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('storage', handleStorageChange)
    
      return () => {
      abortController.abort()
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('storage', handleStorageChange)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]) // request?.status обновляется внутри fetchRequest, не нужно в зависимостях

  // Обновляем интервал автообновления в зависимости от статуса заявки
  useEffect(() => {
    if (!request) return

    // Очищаем предыдущий интервал
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Определяем интервал на основе статуса
    const interval = request.status === 'pending' ? 2000 : 10000
    const requestId = Array.isArray(params.id) ? params.id[0] : params.id

    // Создаем новый интервал
    intervalRef.current = setInterval(() => {
      if (!document.hidden && isMountedRef.current && requestId) {
        fetch(`/api/requests/${requestId}`, {
          cache: 'no-store',
        })
          .then(res => res.json())
          .then(data => {
            if (data.success && isMountedRef.current) {
              updateRequestPreservingPhoto(data.data)
              
              // Проверяем фото при автообновлении, если его еще нет
              if (!photoLoadedRef.current && !data.data.photoFileUrl) {
                fetchRequestPhoto(requestId)
              }
            }
          })
          .catch(() => {
            // Тихая ошибка
          })
        
        // Также проверяем фото отдельно при автообновлении
        if (!photoLoadedRef.current) {
          fetchRequestPhoto(requestId)
        }
      }
    }, interval)
    
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [request, params.id, fetchRequestPhoto, updateRequestPreservingPhoto])

  // Закрываем меню при клике вне его
  useEffect(() => {
    if (!showMenu) return

    const handleClickOutside = (event: MouseEvent) => {
      if (!isMountedRef.current) return
      
      const target = event.target as HTMLElement
      if (!target.closest('.relative')) {
        if (isMountedRef.current) {
          setShowMenu(false)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showMenu])

  // Получаем все транзакции по accountId (ID букмекера) - используем useMemo для безопасного вычисления
  // ВАЖНО: должен вызываться до любых условных возвратов!
  const transactions = useMemo(() => {
    if (!request || !request.casinoTransactions) return []
    
    return request.casinoTransactions.map(t => {
      const amount = parseFloat(t.amount || '0')
      const isDeposit = t.requestType === 'deposit'
      const userName = t.username 
        ? `@${t.username}` 
        : t.firstName 
          ? `${t.firstName}${t.lastName ? ' ' + t.lastName : ''}` 
          : `ID: ${t.userId}`
      
      return {
        id: t.id,
        amount: Math.abs(amount).toFixed(2).replace('.', ','),
        isDeposit,
        createdAt: t.createdAt,
        status: t.status,
        userName,
        userId: t.userId,
        bookmaker: t.bookmaker,
        description: `${isDeposit ? 'Пополнение' : 'Вывод'} от ${userName}`,
      }
    })
  }, [request])

  // Вычисляем отображаемую сумму: если выбран платеж, используем его сумму, иначе сумму заявки
  // ВАЖНО: должен вызываться до любых условных возвратов!
  const displayAmount = useMemo(() => {
    if (selectedPaymentId && request?.matchingPayments) {
      const selectedPayment = request.matchingPayments.find((p: MatchingPayment) => p.id === selectedPaymentId)
      if (selectedPayment) {
        return parseFloat(selectedPayment.amount).toFixed(2).replace('.', ',')
      }
    }
    return request?.amount ? parseFloat(request.amount).toFixed(2).replace('.', ',') : '0,00'
  }, [selectedPaymentId, request?.amount, request?.matchingPayments])

  // Источник платежей для блока "Переводы по QR"
  const paymentsSource = useMemo(() => {
    if (showAllPayments) return allPayments
    return request?.matchingPayments ?? []
  }, [showAllPayments, allPayments, request?.matchingPayments])

  // Отфильтрованные платежи для блока "Переводы по QR"
  const filteredPayments = useMemo(() => {
    if (!paymentsSource.length) return []

    const normalizeAmount = (value: string) => {
      const parsed = parseFloat(value.replace(',', '.'))
      if (isNaN(parsed)) return null
      return parsed.toFixed(2)
    }

    return paymentsSource.filter((payment: MatchingPayment) => {
      if (appliedSearchAmount) {
        const normalizedSearch = normalizeAmount(appliedSearchAmount)
        const paymentNumeric = parseFloat(payment.amount.replace(',', '.'))
        const normalizedPayment = normalizeAmount(payment.amount)

        if (normalizedSearch) {
          if (appliedExactAmount) {
            if (!normalizedPayment || normalizedPayment !== normalizedSearch) return false
          } else {
            if (isNaN(paymentNumeric)) return false
            const searchValue = parseFloat(normalizedSearch)
            if (paymentNumeric < searchValue * 0.9 || paymentNumeric > searchValue * 1.1) return false
          }
        }
      }
      if (appliedProcessedOnly && !payment.isProcessed) return false
      return true
    })
  }, [paymentsSource, appliedSearchAmount, appliedExactAmount, appliedProcessedOnly])

  // Показываем все платежи (убрали ограничение)
  const limitedPayments = useMemo(() => filteredPayments, [filteredPayments])

  // Функции форматирования (должны быть определены до requestComputed)
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    // Скопировано в буфер обмена
  }, [])

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString)
    const day = date.getDate().toString().padStart(2, '0')
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const year = date.getFullYear()
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    return `${day}.${month}.${year} • ${hours}:${minutes}`
  }, [])

  // Функция для определения кто обработал заявку (логин админа или "автопополнение")
  const getProcessedBy = useCallback((processedBy: string | null | undefined) => {
    if (!processedBy) {
      return null
    }
    return processedBy === 'автопополнение' ? 'автопополнение' : processedBy
  }, [])

  // Функция для определения состояния (Успешно/Отклонено/Ожидает)
  const getStatusState = useCallback((status: string) => {
    if (status === 'completed' || status === 'approved' || status === 'auto_completed' || status === 'autodeposit_success') {
      return 'Успешно'
    }
    if (status === 'rejected' || status === 'declined') {
      return 'Отклонено'
    }
    if (status === 'pending') {
      return 'Ожидает'
    }
    if (status === 'deferred') {
      return 'Отложено'
    }
    if (status === 'manual' || status === 'awaiting_manual') {
      return 'Ручная'
    }
    if (status === 'api_error' || status === 'deposit_failed') {
      return 'Ошибка API'
    }
    return status
  }, [])

  const getStatusColor = useCallback((status: string) => {
    switch (status) {
      case 'pending':
      case 'Ожидает':
        return 'bg-yellow-500 text-black'
      case 'completed':
      case 'approved':
      case 'Успешно':
        return 'bg-green-500 text-black'
      case 'rejected':
        return 'bg-red-500 text-white'
      case 'api_error':
      case 'deposit_failed':
        return 'bg-orange-500 text-white'
      case 'deferred':
        return 'bg-orange-500 text-white'
      default:
        return 'bg-gray-700 text-gray-300'
    }
  }, [])

  const getStatusLabel = useCallback((status: string) => {
    switch (status) {
      case 'pending':
        return 'Ожидает'
      case 'completed':
      case 'approved':
      case 'auto_completed':
      case 'autodeposit_success':
        return 'Успешно'
      case 'rejected':
      case 'declined':
        return 'Отклонено'
      case 'deferred':
        return 'Отложено'
      case 'manual':
      case 'awaiting_manual':
        return 'Ручная'
      default:
        return status
    }
  }, [])

  // Мемоизируем вычисления для оптимизации рендеринга (до условных возвратов!)
  const requestComputed = useMemo(() => {
    if (!request) return null

    const isDeposit = request.requestType === 'deposit'
    const isDeferred = request.status === 'deferred'
    const processedBy = getProcessedBy(request.processedBy)
    const showMinus = isDeferred && processedBy === 'автопополнение'
    const isProcessed = request.status === 'completed' || 
                        request.status === 'approved' || 
                        request.status === 'rejected' || 
                        request.status === 'declined' ||
                        request.status === 'auto_completed' || 
                        request.status === 'autodeposit_success'
    const showActionButtons = !isProcessed || request.status === 'api_error' || request.status === 'deposit_failed'
    const userName = request.username 
      ? `@${request.username}` 
      : request.firstName 
        ? `${request.firstName}${request.lastName ? ' ' + request.lastName : ''}` 
        : `ID: ${request.userId}`
    const displayName = request.firstName || request.username || `ID: ${request.userId}`
    const statusColor = getStatusColor(request.status)
    const statusState = getStatusState(request.status)
    const formattedCreatedAt = formatDate(request.createdAt)

    return {
      isDeposit,
      isDeferred,
      processedBy,
      showMinus,
      isProcessed,
      showActionButtons,
      userName,
      displayName,
      statusColor,
      statusState,
      formattedCreatedAt,
    }
  }, [request, getProcessedBy, getStatusColor, getStatusState, formatDate])

  // Мемоизированный компонент для транзакции (до условных возвратов!)
  const TransactionListItem = memo(({ transaction, formatDate, getStatusState }: { 
    transaction: typeof transactions[0], 
    formatDate: (date: string) => string,
    getStatusState: (status: string) => string 
  }) => {
    const statusClass = transaction.status === 'completed' || transaction.status === 'approved'
      ? 'bg-green-500 text-black'
      : transaction.status === 'pending'
      ? 'bg-yellow-500 text-black'
      : transaction.status === 'rejected'
      ? 'bg-red-500 text-white'
      : 'bg-gray-700 text-gray-300'
    
    const statusLabel = getStatusState(transaction.status)
    const formattedDate = formatDate(transaction.createdAt)

    return (
      <Link
        href={`/dashboard/requests/${transaction.id}`}
        prefetch={false}
        className="block bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-green-500 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className={`w-1 h-12 rounded-full ${transaction.isDeposit ? 'bg-green-500' : 'bg-red-500'}`}></div>
          <div className="flex-1">
            <div className="flex items-center space-x-2 mb-1">
              <p className="text-sm font-medium text-white">
                {transaction.description}
              </p>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>
                {statusLabel}
              </span>
            </div>
            <p className="text-xs text-gray-400">{formattedDate}</p>
            {transaction.bookmaker && (
              <p className="text-xs text-gray-500 mt-1">{transaction.bookmaker}</p>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <p className={`text-lg font-bold ${transaction.isDeposit ? 'text-green-500' : 'text-red-500'}`}>
              {transaction.isDeposit ? '+' : '-'}{transaction.amount}
            </p>
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </Link>
    )
  })
  TransactionListItem.displayName = 'TransactionListItem'

  const deferRequest = async () => {
    if (!request) return
    
    setDeferring(true)
    try {
      const response = await fetch(`/api/requests/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'deferred' }),
      })

      // Проверяем Content-Type перед парсингом JSON
      const deferContentType = response.headers.get('content-type')
      if (!deferContentType || !deferContentType.includes('application/json')) {
        const text = await response.text()
        console.error('❌ Defer API returned non-JSON:', response.status, text.substring(0, 200))
        console.error(`Ошибка отложения заявки: Сервер вернул ошибку ${response.status}`)
        setDeferring(false)
        return
      }

      const data = await response.json()

      if (data.success) {
        // Проверяем, что компонент все еще смонтирован перед обновлением
        updateRequestPreservingPhoto(prevRequest => prevRequest ? { ...prevRequest, ...data.data } : data.data)
        setShowMenu(false)
        
        // Уведомляем другие вкладки об обновлении
        localStorage.setItem('request_updated', request.id.toString())
        localStorage.removeItem('request_updated') // Триггерим storage event
        
        // Заявка отложена успешно
      } else {
        console.error('Ошибка при откладывании заявки:', data.error)
      }
    } catch (error) {
      console.error('Failed to defer request:', error)
    } finally {
      setDeferring(false)
    }
  }

    // Функция для обновления статуса заявки (подтвердить/отклонить)
    const updateRequestStatus = async (newStatus: 'completed' | 'approved' | 'rejected') => {
      if (!request) return
      
      // Защита от повторных нажатий
      if (isProcessing) {
        console.warn('⚠️ Request is already being processed, ignoring duplicate click')
        return
      }
      
      // Проверяем, что заявка еще не обработана (но разрешаем обработку api_error для повторной попытки)
      // Проверяем все возможные статусы, которые означают что заявка уже обработана
      const processedStatuses = ['completed', 'approved', 'autodeposit_success', 'auto_completed']
      if (processedStatuses.includes(request.status)) {
        alert(`Заявка уже обработана (статус: ${request.status}). Пожалуйста, обновите страницу.`)
        return
      }
      
      setIsProcessing(true)
      
      try {
        // Если подтверждаем депозит и выбран платеж, сначала привязываем его
        if ((newStatus === 'completed' || newStatus === 'approved') && request.requestType === 'deposit' && selectedPaymentId) {
          try {
            const linkResponse = await fetch(`/api/incoming-payment/${selectedPaymentId}/link`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ requestId: request.id }),
            })
            
            if (linkResponse.ok) {
              const linkData = await linkResponse.json()
              if (linkData.success) {
                // Обновляем заявку после привязки
                const fetchResponse = await fetch(`/api/requests/${request.id}`)
                if (fetchResponse.ok) {
                  const fetchData = await fetchResponse.json()
                  if (fetchData.success) {
                    updateRequestPreservingPhoto(fetchData.data)
                    // Если заявка уже подтверждена автоматически (сумма совпала), перенаправляем на дашборд
                    if (fetchData.data.status === 'completed' || fetchData.data.status === 'approved') {
                      setSelectedPaymentId(null)
                      setTimeout(() => {
                        router.push('/dashboard')
                      }, 500)
                      return
                    }
                  }
                }
              }
            }
          } catch (linkError) {
            console.error('Failed to link payment:', linkError)
            // Продолжаем выполнение, даже если привязка не удалась
          }
        }
        
        // Если подтверждаем депозит, пополняем баланс через API букмекера
        if ((newStatus === 'completed' || newStatus === 'approved') && request.requestType === 'deposit' && request.bookmaker && request.accountId && request.amount) {
          try {
            // Если выбран платеж, используем его сумму, иначе сумму заявки
            let depositAmount = request.amount
            if (selectedPaymentId && request.matchingPayments) {
              const selectedPayment = request.matchingPayments.find((p: MatchingPayment) => p.id === selectedPaymentId)
              if (selectedPayment) {
                depositAmount = selectedPayment.amount
              }
            }
            
            const depositResponse = await fetch('/api/deposit-balance', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                requestId: request.id,
                bookmaker: request.bookmaker,
                accountId: request.accountId,
                amount: depositAmount,
              }),
            })

            // Проверяем, что ответ является JSON
            const contentType = depositResponse.headers.get('content-type')
            if (!contentType || !contentType.includes('application/json')) {
              const text = await depositResponse.text()
              console.error('❌ Deposit API returned non-JSON response:', depositResponse.status, text.substring(0, 200))
              alert(`Ошибка при пополнении баланса: Сервер вернул ошибку ${depositResponse.status}. Попробуйте позже.`)
              setIsProcessing(false)
              return
            }

            const depositData = await depositResponse.json()

            if (!depositData.success) {
              const errorMessage = depositData.message || depositData.error || 'Не удалось пополнить баланс'
              console.error('❌ Deposit failed:', errorMessage)
              
              // Показываем ошибку пользователю
              alert(`Ошибка при пополнении баланса: ${errorMessage}`)
              
              // Обновляем заявку чтобы получить актуальный статус (возможно API обновил статус на api_error)
              try {
                const refreshResponse = await fetch(`/api/requests/${request.id}`)
                if (refreshResponse.ok) {
                  const refreshContentType = refreshResponse.headers.get('content-type')
                  if (refreshContentType && refreshContentType.includes('application/json')) {
                    const refreshData = await refreshResponse.json()
                    if (refreshData.success && isMountedRef.current) {
                      updateRequestPreservingPhoto(refreshData.data)
                    }
                  }
                }
              } catch (refreshError) {
                console.error('Failed to refresh request after deposit error:', refreshError)
              }
              
              setIsProcessing(false)
              return
            }

            // Если пополнение успешно, API уже обновил статус заявки на completed
            // Обновляем заявку из ответа API
            if (depositData.data?.request) {
              console.log('✅ Deposit successful, updating request from API response:', depositData.data.request)
              
              // Обновляем заявку с данными из ответа API (уже содержит обновленный статус)
              updateRequestPreservingPhoto(depositData.data.request)
              
              // Перезагружаем данные для получения актуального состояния (включая связанные платежи)
              setTimeout(async () => {
                const refreshResponse = await fetch(`/api/requests/${request.id}`)
                
                // Проверяем Content-Type перед парсингом JSON
                const refreshContentType = refreshResponse.headers.get('content-type')
                if (!refreshContentType || !refreshContentType.includes('application/json')) {
                  console.error('❌ Refresh API returned non-JSON:', refreshResponse.status)
                  return
                }
                
                const refreshData = await refreshResponse.json()
                if (refreshData.success && isMountedRef.current) {
                  console.log('✅ Request refreshed after deposit:', refreshData.data)
                  updateRequestPreservingPhoto(refreshData.data)
                }
              }, 500)
              
              // Уведомляем другие вкладки об обновлении
              localStorage.setItem('request_updated', request.id.toString())
              localStorage.removeItem('request_updated')
              
              setSelectedPaymentId(null)
              
              // Перенаправляем на дашборд после успешного депозита
              setTimeout(() => {
                setIsProcessing(false)
                router.push('/dashboard')
              }, 500)
              return
            } else {
              // Если в ответе нет данных заявки, перезагружаем вручную
              console.log('⚠️ No request data in deposit response, refreshing manually')
              setTimeout(async () => {
                const refreshResponse = await fetch(`/api/requests/${request.id}`)
                
                const refreshContentType = refreshResponse.headers.get('content-type')
                if (!refreshContentType || !refreshContentType.includes('application/json')) {
                  console.error('❌ Refresh API returned non-JSON:', refreshResponse.status)
                  setIsProcessing(false)
                  return
                }
                
                const refreshData = await refreshResponse.json()
                if (refreshData.success && isMountedRef.current) {
                  updateRequestPreservingPhoto(refreshData.data)
                }
                setIsProcessing(false)
              }, 500)
              
              setSelectedPaymentId(null)
              
              // Перенаправляем на дашборд после успешного депозита
              setTimeout(() => {
                router.push('/dashboard')
              }, 500)
              return
            }
          } catch (depositError: any) {
            console.error('Failed to deposit balance:', depositError)
            const errorMessage = depositError.message || 'Произошла ошибка при пополнении баланса'
            alert(`Ошибка при пополнении баланса: ${errorMessage}`)
            setIsProcessing(false)
            return
          }
        }

        // Обновляем статус заявки
        // processedBy будет установлен автоматически на сервере из токена админа
        const response = await fetch(`/api/requests/${request.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            status: newStatus
          }),
        })

        // Проверяем Content-Type перед парсингом JSON
        const responseContentType = response.headers.get('content-type')
        if (!responseContentType || !responseContentType.includes('application/json')) {
          const text = await response.text()
          console.error('❌ Update status API returned non-JSON:', response.status, text.substring(0, 200))
          alert(`Ошибка при обновлении статуса: Сервер вернул ошибку ${response.status}`)
          setIsProcessing(false)
          return
        }

        const data = await response.json()

        if (data.success) {
          // Обновляем заявку с новым статусом
          const updatedRequest = { ...request, ...data.data, status: newStatus }
          updateRequestPreservingPhoto(updatedRequest)
          
          // Перезагружаем данные для получения актуального состояния
          setTimeout(async () => {
            const refreshResponse = await fetch(`/api/requests/${request.id}`)
            
            // Проверяем Content-Type перед парсингом JSON
            const refreshContentType2 = refreshResponse.headers.get('content-type')
            if (!refreshContentType2 || !refreshContentType2.includes('application/json')) {
              console.error('❌ Refresh API returned non-JSON:', refreshResponse.status)
              return
            }
            
            const refreshData = await refreshResponse.json()
            if (refreshData.success && isMountedRef.current) {
              updateRequestPreservingPhoto(refreshData.data)
            }
          }, 500)
          
          // Уведомляем другие вкладки об обновлении
          localStorage.setItem('request_updated', request.id.toString())
          localStorage.removeItem('request_updated') // Триггерим storage event
          
          setSelectedPaymentId(null)
          
          // Перенаправляем на дашборд после успешного обновления статуса
          // Используем router.refresh() для обновления данных перед редиректом
          setIsProcessing(false)
          setTimeout(() => {
            router.refresh() // Обновляем данные перед редиректом
            router.push('/dashboard?refresh=' + Date.now()) // Добавляем timestamp для обхода кэша
          }, 500)
        } else {
          const errorMessage = data.message || data.error || 'Не удалось обновить статус заявки'
          console.error('Failed to update request:', errorMessage)
          alert(`Ошибка при обновлении статуса: ${errorMessage}`)
          setIsProcessing(false)
        }
      } catch (error: any) {
        console.error('Failed to update request status:', error)
        const errorMessage = error.message || 'Произошла ошибка при обновлении статуса заявки'
        alert(`Ошибка: ${errorMessage}`)
        setIsProcessing(false)
      }
    }

  const handleSearchById = () => {
    if (!searchId.trim()) {
      console.error('Введите ID заявки')
      return
    }

    const id = parseInt(searchId.trim())
    if (isNaN(id)) {
      console.error('ID должен быть числом')
      return
    }

    router.push(`/dashboard/requests/${id}`)
    setShowSearchModal(false)
    setSearchId('')
  }

  // Показываем скелетон сразу для мгновенного отображения
  if (loading || !request) {
    return (
      <div className="py-4">
        {/* Скелетон хедера */}
        <div className="flex items-center mb-4 px-4">
          <div className="flex items-center space-x-2 flex-1 bg-gray-800 rounded-xl px-3 py-2 border border-gray-700 animate-pulse">
            <div className="w-6 h-6 bg-gray-700 rounded"></div>
            <div className="w-10 h-10 bg-gray-700 rounded-full"></div>
            <div className="flex-1">
              <div className="h-4 bg-gray-700 rounded w-24 mb-1"></div>
              <div className="h-3 bg-gray-700 rounded w-16"></div>
            </div>
            <div className="w-8 h-8 bg-gray-700 rounded"></div>
            <div className="w-8 h-8 bg-gray-700 rounded"></div>
          </div>
        </div>

        {/* Скелетон мини описания */}
        <div className="mx-4 mb-4 bg-gray-800 rounded-xl p-3 border border-gray-700 animate-pulse">
          <div className="flex items-center justify-between mb-2">
            <div className="h-6 bg-gray-700 rounded w-32"></div>
            <div className="h-5 bg-gray-700 rounded-full w-20"></div>
          </div>
          <div className="h-3 bg-gray-700 rounded w-40 mb-1.5"></div>
          <div className="flex items-center justify-between">
            <div className="h-3 bg-gray-700 rounded w-20"></div>
            <div className="h-6 bg-gray-700 rounded w-24"></div>
          </div>
        </div>

        {/* Скелетон фото */}
        <div className="mx-4 mb-4 bg-gray-800 rounded-2xl p-4 border border-gray-700 animate-pulse">
          <div className="h-4 bg-gray-700 rounded w-32 mb-3"></div>
          <div className="w-full h-48 bg-gray-700 rounded-lg"></div>
        </div>

        {/* Скелетон информации */}
        <div className="mx-4 mb-4 bg-gray-800 rounded-2xl p-4 border border-gray-700 animate-pulse">
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex justify-between items-center">
                <div className="h-4 bg-gray-700 rounded w-24"></div>
                <div className="h-4 bg-gray-700 rounded w-32"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Если заявка не найдена после загрузки, показываем простой экран
  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <p className="text-white text-lg font-medium mb-6">Заявка не найдена</p>
        <button
          onClick={() => router.back()}
          className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium"
        >
          Назад
        </button>
      </div>
    )
  }

    const isDeposit = requestComputed?.isDeposit ?? false
    const isDeferred = requestComputed?.isDeferred ?? false
    const processedBy = requestComputed?.processedBy ?? null
    const showMinus = requestComputed?.showMinus ?? false
    const isProcessed = requestComputed?.isProcessed ?? false
    const showActionButtons = requestComputed?.showActionButtons ?? false
    const userName = requestComputed?.userName ?? ''
    const displayName = requestComputed?.displayName ?? ''
    const isVip = Boolean((request as any)?.is_vip ?? (request as any)?.isVip)

  return (
    <div className="py-4">
      {request && (
        <>
      {/* Хедер с навигацией */}
      <div className="flex items-center mb-4 px-4">
        <div className="flex items-center space-x-2 flex-1 bg-gray-800 rounded-xl px-3 py-2 border border-gray-700">
          <button
            onClick={() => router.back()}
            className="p-1.5 hover:bg-gray-700 rounded-lg transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <Link
            href={`/dashboard/users/${request?.userId || ''}`}
            prefetch={false}
            className="flex items-center space-x-2 flex-1"
          >
            {profilePhotoUrl ? (
              <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border-2 border-gray-600 relative">
                <Image
                  src={profilePhotoUrl}
                  alt={displayName}
                  fill
                  className="object-cover"
                  loading="lazy"
                  sizes="40px"
                  onError={() => {
                    // Если фото не загрузилось, показываем букву
                    setProfilePhotoUrl(null)
                  }}
                />
              </div>
            ) : (
              <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-white text-sm font-bold">{displayName.charAt(0).toUpperCase()}</span>
              </div>
            )}
            <div className="text-left flex-1 min-w-0">
              <div className="flex items-center space-x-2">
                <p className="text-sm font-medium text-white truncate">{displayName}</p>
                {isVip && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    VIP
                  </span>
                )}
              </div>
              {request.username && (
                <p className="text-xs text-gray-400 truncate">@{request.username}</p>
              )}
            </div>
          </Link>
          <div className="flex items-center space-x-1">
            <Link
              href={`/dashboard/users/${request.userId}/chat`}
              prefetch={false}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors flex-shrink-0"
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </Link>
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-2 hover:bg-gray-700 rounded-lg transition-colors flex-shrink-0"
              >
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-gray-800 border border-gray-700 rounded-xl shadow-lg z-50">
                  <button
                    onClick={deferRequest}
                    disabled={deferring}
                    className="w-full text-left px-4 py-3 text-sm text-white hover:bg-gray-700 rounded-t-xl transition-colors disabled:opacity-50"
                  >
                    {deferring ? 'Откладывание...' : 'Отложить'}
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false)
                      setShowSearchModal(true)
                    }}
                    className="w-full text-left px-4 py-3 text-sm text-white hover:bg-gray-700 rounded-b-xl transition-colors"
                  >
                    Поиск по ID
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Модальное окно поиска по ID */}
      {showSearchModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-2xl p-6 mx-4 w-full max-w-md border border-gray-700">
            <h3 className="text-xl font-bold text-white mb-4">Поиск по ID</h3>
            <input
              type="text"
              placeholder="Введите ID заявки"
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearchById()}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500 mb-4"
              autoFocus
            />
            <div className="flex space-x-2">
              <button
                onClick={handleSearchById}
                className="flex-1 px-4 py-3 bg-green-500 hover:bg-green-600 text-black rounded-lg font-medium transition-colors"
              >
                Найти
              </button>
              <button
                onClick={() => {
                  setShowSearchModal(false)
                  setSearchId('')
                }}
                className="px-4 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Мини описание */}
      <div className="mx-4 mb-4 bg-gray-800 rounded-xl p-3 border border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-1.5">
            <span className="text-lg font-bold text-white">{request.accountId || 'N/A'}</span>
            {request.accountId && (
              <button
                onClick={() => copyToClipboard(request.accountId || '')}
                className="p-0.5 hover:bg-gray-700 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            )}
          </div>
          <div className={`flex items-center space-x-1.5 px-2 py-0.5 rounded-full ${requestComputed?.statusColor || 'bg-gray-700 text-gray-300'}`}>
            <div className="w-1.5 h-1.5 rounded-full bg-current"></div>
            <span className="text-xs font-medium">{requestComputed?.statusState || request.status}</span>
          </div>
        </div>

        <p className="text-xs text-gray-400 mb-1.5">{requestComputed?.formattedCreatedAt || ''}</p>

        {/* Отображение ошибки депозита */}
        {(request.status === 'api_error' || request.status === 'deposit_failed') && request.statusDetail && (
          <div className="mb-2 p-2 bg-orange-900/30 border border-orange-500 rounded-lg">
            <p className="text-xs text-orange-300 font-semibold">⚠️ Ошибка депозита:</p>
            <p className="text-xs text-orange-200 mt-1">{request.statusDetail}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {isDeposit ? 'Пополнение' : 'Вывод'}
          </p>
          <p className={`text-xl font-bold ${showMinus ? 'text-red-500' : (isDeposit ? 'text-green-500' : 'text-red-500')}`}>
            {showMinus ? '-' : (isDeposit ? '+' : '-')}{displayAmount}
          </p>
        </div>
      </div>

      {/* Фото чека или QR-кода - показываем только если фото загружено и валидно */}
      {request.photoFileUrl && isValidPhotoUrl(request.photoFileUrl) && !photoError && (
        <div className="mx-4 mb-4 bg-gray-800 rounded-2xl p-4 border border-gray-700">
          <h3 className="text-base font-semibold text-white mb-3">
            {request.requestType === 'withdraw' ? 'Фото QR-кода' : 'Фото чека'}
          </h3>
          <div 
            className="relative w-full flex justify-center items-center cursor-pointer hover:opacity-90 transition-opacity bg-gray-900 rounded-lg overflow-hidden" 
            style={{ minHeight: '200px' }}
            onClick={() => {
              setShowPhotoModal(true)
              setPhotoZoom(1)
            }}
          >
            {isValidPhotoUrl(request.photoFileUrl) ? (
              request.photoFileUrl.startsWith('data:') || request.photoFileUrl.startsWith('/api/') ? (
                // Для base64 и относительных URL API используем обычный img тег
                // (Next.js Image не поддерживает data URLs и может не работать с /api/ путями)
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={request.photoFileUrl}
                  alt={request.requestType === 'withdraw' ? 'Фото QR-кода' : 'Фото чека'}
                  className="w-full h-auto max-h-[600px] rounded-lg object-contain relative z-0"
                  style={{ display: 'block' }}
                  onError={(e) => {
                    console.error('❌ [Request Detail] Ошибка загрузки изображения:', e)
                    setPhotoError(true)
                  }}
                  onLoad={() => {
                    console.log('✅ [Request Detail] Изображение успешно загружено')
                    setPhotoError(false)
                  }}
                />
              ) : (
                // Для абсолютных URL (http/https) используем Next.js Image
                <Image
                  src={request.photoFileUrl}
                  alt={request.requestType === 'withdraw' ? 'Фото QR-кода' : 'Фото чека'}
                  width={800}
                  height={600}
                  className="w-full h-auto max-h-[600px] rounded-lg object-contain relative z-0"
                  style={{ display: 'block' }}
                  loading="eager"
                  priority
                  unoptimized={true}
                  onError={(e) => {
                    console.error('❌ [Request Detail] Ошибка загрузки изображения:', e)
                    setPhotoError(true)
                  }}
                  onLoad={() => {
                    console.log('✅ [Request Detail] Изображение успешно загружено')
                    setPhotoError(false)
                  }}
                />
              )
            ) : (
              <div className="text-center py-8 bg-gray-900 rounded-lg">
                <p className="text-red-400 text-sm">Невалидный URL фото</p>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Показываем сообщение об ошибке, если фото не удалось загрузить */}
      {photoError && (
        <div className="mx-4 mb-4 bg-gray-800 rounded-2xl p-4 border border-gray-700">
          <h3 className="text-base font-semibold text-white mb-3">
            {request.requestType === 'withdraw' ? 'Фото QR-кода' : 'Фото чека'}
          </h3>
          <div className="text-center py-8 bg-gray-900 rounded-lg">
            <p className="text-red-400 text-sm">Ошибка загрузки фото</p>
          </div>
        </div>
      )}

      {/* Модальное окно для увеличения фото */}
      {showPhotoModal && request.photoFileUrl && isValidPhotoUrl(request.photoFileUrl) && (
        <div 
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setShowPhotoModal(false)}
        >
            <button
              onClick={() => setShowPhotoModal(false)}
              className="absolute top-4 right-4 z-10 bg-gray-800 hover:bg-gray-700 text-white rounded-full p-2 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
                    {request.photoFileUrl.startsWith('data:') || request.photoFileUrl.startsWith('/api/') ? (
                      // Для base64 и относительных URL API используем обычный img тег
                      // (Next.js Image не поддерживает data URLs и может не работать с /api/ путями)
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={request.photoFileUrl}
                        alt={request.requestType === 'withdraw' ? 'Фото QR-кода' : 'Фото чека'}
                        className="max-w-full max-h-full object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                        onError={() => {
                          console.error('❌ [Request Detail] Ошибка загрузки изображения в модальном окне')
                          setShowPhotoModal(false)
                        }}
                      />
                    ) : (
                      // Для абсолютных URL (http/https) используем Next.js Image
                      <Image
                        src={request.photoFileUrl}
                        alt={request.requestType === 'withdraw' ? 'Фото QR-кода' : 'Фото чека'}
                        width={1200}
                        height={1200}
                        className="max-w-full max-h-full object-contain rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                        loading="eager"
                        priority
                        unoptimized={true}
                        onError={() => {
                          console.error('❌ [Request Detail] Ошибка загрузки изображения в модальном окне')
                          setShowPhotoModal(false)
                        }}
                      />
                    )}
        </div>
      )}

      {/* Входящие платежи с поиском - показываем для всех заявок на пополнение */}
      {request.requestType === 'deposit' && (
        <div className="mx-4 mb-4 bg-gray-800 rounded-2xl p-4 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-3">Переводы по QR</h3>
          
          {/* Проверяем есть ли платежи */}
          {(paymentsSource && paymentsSource.length > 0) ? (
            <>
              {/* Поиск и фильтры */}
              <div className="mb-3">
                <div className="flex space-x-2 mb-2">
                  <div className="flex-1 relative">
                    <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input
                      type="text"
                      placeholder="Поиск по сумме..."
                      value={searchAmount}
                      onChange={(e) => setSearchAmount(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-green-500"
                    />
                  </div>
                  <button
                    onClick={async () => {
                      if (allPaymentsLoading) return
                      setAppliedSearchAmount(searchAmount)
                      setAppliedExactAmount(exactAmount)
                      setAppliedProcessedOnly(processedOnly)
                      setAllPaymentsLoading(true)
                      setAllPaymentsError(null)
                      try {
                        const response = await fetch('/api/incoming-payments?limit=10000&offset=0', {
                          cache: 'no-store',
                        })
                        const data = await response.json()
                        if (data?.success) {
                          const mappedPayments = (data.data?.payments || []).map((p: any) => ({
                            id: p.id,
                            amount: String(p.amount),
                            bank: p.bank ?? null,
                            paymentDate: p.paymentDate,
                            requestId: p.requestId ?? null,
                            isProcessed: Boolean(p.isProcessed),
                          })) as MatchingPayment[]
                          setAllPayments(mappedPayments)
                          setShowAllPayments(true)
                        } else {
                          setAllPaymentsError(data?.error || data?.message || 'Не удалось загрузить платежи')
                        }
                      } catch (error: any) {
                        setAllPaymentsError(error?.message || 'Не удалось загрузить платежи')
                      } finally {
                        setAllPaymentsLoading(false)
                      }
                    }}
                    className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                      allPaymentsLoading
                        ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {allPaymentsLoading ? 'Поиск...' : 'Найти'}
                  </button>
                </div>
                <div className="flex space-x-3">
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={exactAmount}
                      onChange={(e) => setExactAmount(e.target.checked)}
                      className="w-3.5 h-3.5 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-300">Точная сумма</span>
                  </label>
                  <label className="flex items-center space-x-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={processedOnly}
                      onChange={(e) => setProcessedOnly(e.target.checked)}
                      className="w-3.5 h-3.5 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-300">Обработанные</span>
                  </label>
                </div>
                {allPaymentsError && (
                  <div className="mt-2 text-[11px] text-red-400">
                    {allPaymentsError}
                  </div>
                )}
              </div>
              
              {filteredPayments.length === 0 ? (
                <p className="text-sm text-gray-400">Совпадений не найдено</p>
              ) : (
                <>
                  <div className="space-y-1.5 pr-1 max-h-[280px] overflow-y-auto">
                    {limitedPayments.map((payment: MatchingPayment) => {
                      const isAttached = payment.requestId === request.id && payment.isProcessed
                      const isAutoCompleted = request.status === 'autodeposit_success' || request.status === 'auto_completed'
                      // Платеж обработан (серый) если: привязан к этой заявке И обработан, ИЛИ обработан и привязан к другой заявке
                      const isProcessed = payment.isProcessed
                      const isProcessedForThisRequest = payment.requestId === request.id && payment.isProcessed
                      const isProcessedForOtherRequest = payment.isProcessed && payment.requestId !== null && payment.requestId !== request.id
                      // Отключаем выбор если: автопополнение сработало, ИЛИ платеж уже обработан (для этой или другой заявки)
                      const isDisabled = isAutoCompleted || isProcessedForThisRequest || isProcessedForOtherRequest
                      const isSelected = selectedPaymentId === payment.id
                      
                      return (
                        <div
                          key={payment.id}
                          className={`bg-gray-900 rounded-lg p-2.5 border transition-colors ${
                            isDisabled 
                              ? 'border-gray-700 opacity-60 cursor-not-allowed' 
                              : isSelected
                                ? 'border-green-500 bg-green-900/20'
                                : 'border-gray-700 hover:border-gray-600 cursor-pointer'
                          }`}
                          onClick={() => !isDisabled && setSelectedPaymentId(isSelected ? null : payment.id)}
                        >
                          <div className="flex items-start space-x-3">
                            {/* Серый для обработанных, зеленый для необработанных */}
                            <div className={`w-1 h-10 rounded-full mt-1 ${isProcessed ? 'bg-gray-600' : 'bg-green-500'}`}></div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white truncate">Перевод по QR</p>
                              <div className="flex items-center space-x-2 mt-0.5">
                                <p className="text-xs text-gray-400">{formatDate(payment.paymentDate)}</p>
                              </div>
                            </div>
                            <div className="flex flex-col items-center space-y-1 flex-shrink-0 min-w-[70px]">
                              <div className="flex items-center space-x-2">
                                {/* Серый текст для обработанных, зеленый для необработанных */}
                                <p className={`text-base font-bold ${isProcessed ? 'text-gray-500' : 'text-green-500'}`}>
                                  +{parseFloat(payment.amount).toFixed(2).replace('.', ',')}
                                </p>
                                {isSelected && !isDisabled && (
                                  <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                              {payment.isProcessed && payment.requestId && (
                                <Link
                                  href={`/dashboard/requests/${payment.requestId}`}
                                  prefetch={false}
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1 rounded-md bg-gray-800 hover:bg-gray-700 transition-colors"
                                  title={`Открыть заявку #${payment.requestId}`}
                                >
                                  <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="text-center py-6">
              <p className="text-gray-400 text-sm">Платежи не найдены</p>
              <p className="text-gray-500 text-xs mt-1">Ожидание платежа на сумму {request.amount ? parseFloat(request.amount.toString()).toFixed(2).replace('.', ',') : '0,00'} сом</p>
            </div>
          )}
        </div>
      )}

      {/* Кнопки действий для отложенных и ожидающих заявок */}
      {/* Скрываем кнопки если заявка уже обработана */}
      {(() => {
        const isPendingOrDeferred = request.status === 'deferred' || request.status === 'pending'
        const isProcessed = request.status === 'completed' || 
                          request.status === 'approved' || 
                          request.status === 'rejected' || 
                          request.status === 'auto_completed' || 
                          request.status === 'autodeposit_success'
        
        // Показываем кнопки для:
        // 1. Необработанных заявок со статусом pending или deferred
        // 2. Заявок с ошибкой API (api_error, deposit_failed) - чтобы можно было пополнить баланс и подтвердить вручную
        const isApiError = request.status === 'api_error' || request.status === 'deposit_failed'
        return (isPendingOrDeferred && !isProcessed) || isApiError
      })() && (
        <div className="mx-4 mb-4 flex space-x-3">
          <button
            onClick={() => {
              if (isProcessing) return // Защита от повторных нажатий
              setPendingStatus('approved')
              setShowConfirmModal(true)
            }}
            disabled={isProcessing || request.status === 'completed' || request.status === 'approved'}
            className={`flex-1 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center space-x-2 ${
              isProcessing || request.status === 'completed' || request.status === 'approved'
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600 text-black'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>{isProcessing ? 'Обработка...' : 'Подтвердить'}</span>
          </button>
          <button
            onClick={() => {
              // Для выводов показываем дополнительное предупреждение
              if (request.requestType === 'withdraw') {
                if (!confirm(`⚠️ ВНИМАНИЕ!\n\nВы уверены, что хотите ОТКЛОНИТЬ вывод на ${request.amount ? parseFloat(request.amount.toString()).toFixed(2).replace('.', ',') : '0,00'} сом?\n\nЭто действие может быть выполнено только администратором и не может быть отменено автоматически.`)) {
                  return
                }
              }
              setPendingStatus('rejected')
              setShowConfirmModal(true)
            }}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center space-x-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span>Отклонить</span>
          </button>
        </div>
      )}

      {/* Модальное окно подтверждения */}
      {showConfirmModal && request && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowConfirmModal(false)}>
          <div className="bg-gray-800 rounded-2xl p-6 max-w-md w-full shadow-2xl border border-gray-700" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-white mb-4">
              {pendingStatus === 'rejected' ? '⚠️ Отклонить заявку' : 'Подтвердить операцию'}
            </h3>
            <p className="text-gray-300 mb-6">
              {pendingStatus === 'rejected' && request.requestType === 'withdraw' ? (
                <>
                  <span className="text-red-400 font-semibold block mb-2">⚠️ ВНИМАНИЕ: Отклонение вывода</span>
                  Вы уверены, что хотите <span className="text-red-400 font-semibold">отклонить</span> заявку на{' '}
                  <span className="font-semibold text-white">вывод</span>{' '}
                  <span className="font-semibold text-white">
                    {request.amount ? parseFloat(request.amount.toString()).toFixed(2).replace('.', ',') : '0,00'} сом
                  </span>{' '}
                  для {userName}?
                  <br /><br />
                  <span className="text-yellow-400 text-sm">
                    ⚠️ Это действие может быть выполнено только администратором и не может быть отменено автоматически.
                  </span>
                </>
              ) : pendingStatus === 'rejected' ? (
                <>
                  Вы уверены, что хотите <span className="text-red-400 font-semibold">отклонить</span> заявку на{' '}
                  {request.requestType === 'deposit' ? 'пополнение' : 'вывод'}{' '}
                  <span className="font-semibold text-white">
                    {request.amount ? parseFloat(request.amount.toString()).toFixed(2).replace('.', ',') : '0,00'} сом
                  </span>{' '}
                  для {userName}?
                </>
              ) : (
                <>
                  Вы уверены, что хотите{' '}
                  <span className="text-green-400 font-semibold">
                    {request.requestType === 'deposit' ? 'принять' : 'принять'}
                  </span>{' '}
                  заявку на {request.requestType === 'deposit' ? 'пополнение' : 'вывод'}{' '}
                  <span className="font-semibold text-white">
                    {request.amount ? parseFloat(request.amount.toString()).toFixed(2).replace('.', ',') : '0,00'} сом
                  </span>{' '}
                  для {userName}?
                </>
              )}
            </p>
            <div className="flex flex-col space-y-3">
              <button
                onClick={async () => {
                  if (isProcessing) return // Защита от повторных нажатий
                  setShowConfirmModal(false)
                  if (pendingStatus) {
                    await updateRequestStatus(pendingStatus)
                    setPendingStatus(null)
                  }
                }}
                disabled={isProcessing}
                className={`w-full font-semibold py-3 px-4 rounded-xl transition-colors ${
                  isProcessing
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : pendingStatus === 'rejected' 
                      ? 'bg-red-500 hover:bg-red-600 text-white' 
                      : 'bg-green-500 hover:bg-green-600 text-white'
                }`}
              >
                {isProcessing ? 'Обработка...' : (pendingStatus === 'rejected' ? 'Да, отклонить' : 'Да, принять')}
              </button>
              <button
                onClick={() => {
                  setShowConfirmModal(false)
                  setPendingStatus(null)
                }}
                className="w-full bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold py-3 px-4 rounded-xl transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Информация о сайте и пользователе */}
      <div className="mx-4 mb-4 bg-gray-800 rounded-2xl p-4 border border-gray-700">
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Сайт:</span>
            <span className="text-sm font-medium text-white">{request.bookmaker || 'N/A'}</span>
          </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">ID заявки:</span>
              <span className="text-sm font-medium text-white">{request.id}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">ID счета:</span>
              <span className="text-sm font-medium text-white">{request.accountId || 'N/A'}</span>
            </div>
            {request.requestType === 'withdraw' && request.withdrawalCode && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-400">Код подтверждения:</span>
                <span className="text-sm font-medium text-white font-mono">{request.withdrawalCode}</span>
              </div>
            )}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Дата создания:</span>
            <span className="text-sm font-medium text-white">{requestComputed?.formattedCreatedAt || ''}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-400">Пользователь:</span>
            <span className="text-sm font-medium text-white">{userName}</span>
          </div>
          {request.userNote && (
            <div className="pt-2 border-t border-gray-700">
              <span className="text-sm text-gray-400 block mb-1">Заметка:</span>
              <span className="text-sm font-medium text-red-400 whitespace-pre-wrap">{request.userNote}</span>
            </div>
          )}
          {request.bank && request.paymentMethod !== 'crypto' && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Банк:</span>
              <span className="text-sm font-medium text-white">{request.bank}</span>
            </div>
          )}
          {request.paymentMethod && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Способ оплаты:</span>
              <span className={`text-sm font-medium ${
                request.paymentMethod === 'crypto' ? 'text-purple-400' : 'text-white'
              }`}>
                {request.paymentMethod === 'crypto' ? '₿ Криптовалюта' : '💳 Банковский перевод'}
              </span>
            </div>
          )}
          {request.paymentMethod === 'crypto' && request.cryptoPayment && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Крипто-платеж:</span>
              <span className="text-sm font-medium text-purple-400">
                {request.cryptoPayment.amount} {request.cryptoPayment.asset}
              </span>
            </div>
          )}
          {request.status && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-400">Статус:</span>
              <span className={`text-sm font-medium ${requestComputed?.statusColor?.includes('text-') ? requestComputed.statusColor : 'text-white'}`}>
                {requestComputed?.statusState || request.status}
              </span>
            </div>
          )}
          
          {/* Отображение деталей ошибки */}
          {(request.status === 'api_error' || request.status === 'deposit_failed') && request.statusDetail && (
            <div className="mt-3 p-3 bg-orange-900/30 border border-orange-500 rounded-lg">
              <div className="flex items-start space-x-2">
                <svg className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm text-orange-300 font-semibold mb-1">Ошибка при пополнении баланса:</p>
                  <p className="text-sm text-orange-200">{request.statusDetail}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Список транзакций по ID счета */}
      <div className="mx-4">
        <h3 className="text-lg font-semibold text-white mb-3">
          Транзакции {request.accountId && `(ID: ${request.accountId})`}
        </h3>
        {transactions.length > 0 ? (
          <div className="space-y-2">
            {transactions.map((transaction) => (
              <TransactionListItem
                key={transaction.id}
                transaction={transaction}
                formatDate={formatDate}
                getStatusState={getStatusState}
              />
            ))}
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 text-center">
            <p className="text-gray-400">
              {request.accountId 
                ? `Нет транзакций по ID: ${request.accountId}`
                : 'ID счета не указан'}
            </p>
          </div>
        )}
      </div>
        </>
      )}
    </div>
  )
}
