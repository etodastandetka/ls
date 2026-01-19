"use client"
import { useState, useEffect, Suspense } from 'react'
import FixedHeaderControls from '../../../components/FixedHeaderControls'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '../../../components/LanguageContext'
import BankButtons from '../../../components/BankButtons'
import { getApiBase, safeFetch } from '../../../utils/fetch'
import { getTelegramUserId, getTelegramUser } from '../../../utils/telegram'
import { DEPOSIT_CONFIG } from '../../../config/app'
import { compressImage, fileToBase64 } from '../../../utils/imageCompression'
import { useRequireAuth } from '../../../hooks/useRequireAuth'

// Компонент QR-кода с текстом (как в боте)
function QRCodeWithText({ url }: { url: string }) {
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null)

  useEffect(() => {
    const generateQRCode = async () => {
      if (!url) {
        console.warn('QR code URL is empty')
        return
      }

      try {
        // Загружаем QR-код через API (900x900 как в боте)
        const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=900x900&data=${encodeURIComponent(url)}`
        console.log('Loading QR code from:', qrCodeUrl.substring(0, 100) + '...')
        
        // Создаем изображение QR-кода
        const qrImage = new Image()
        qrImage.crossOrigin = 'anonymous'
        
        qrImage.onload = () => {
          try {
            console.log('QR image loaded, creating canvas...')
            
            // Создаем canvas в памяти (не привязан к DOM)
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            
            if (!ctx) {
              console.error('Failed to get 2d context')
              setQrImageUrl(qrCodeUrl)
              return
            }
            
            // Размеры canvas (как в боте: 900x1200, обрезается после красной линии)
            const imgWidth = 900
            const imgHeight = 1200
            canvas.width = imgWidth
            canvas.height = imgHeight
            
            // Белый фон
            ctx.fillStyle = 'white'
            ctx.fillRect(0, 0, imgWidth, imgHeight)
            
            // Рисуем QR-код (780x780 как в боте)
            const qrSize = 780
            const qrX = (imgWidth - qrSize) / 2
            const qrY = 50
            
            // Масштабируем QR-код с 900x900 до 780x780
            ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize)
            console.log('QR code drawn on canvas')
            
            // Текст "ПОПОЛНЕНИЕ ДЛЯ КАЗИНО" поверх QR-кода по диагонали (как в боте)
            const textLine1 = "ПОПОЛНЕНИЕ ДЛЯ"
            const textLine2 = "КАЗИНО"
            
            // Сохраняем контекст для поворота
            ctx.save()
            
            // Переходим в центр QR-кода
            const qrCenterX = qrX + qrSize / 2
            const qrCenterY = qrY + qrSize / 2
            ctx.translate(qrCenterX, qrCenterY)
            
            // Поворачиваем на -40 градусов (как в боте)
            ctx.rotate(-40 * Math.PI / 180)
            
            // Настройки текста
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            
            // Красный полупрозрачный текст (rgba(220, 0, 0, 0.7) как в боте)
            ctx.fillStyle = 'rgba(220, 0, 0, 0.7)'
            ctx.font = 'bold 85px Arial' // Размер шрифта 85 как в боте
            
            // Рисуем первую строку
            ctx.fillText(textLine1, 0, -30)
            
            // Рисуем вторую строку под первой
            ctx.fillText(textLine2, 0, 50)
            
            // Восстанавливаем контекст
            ctx.restore()
            
            // Текст "ОТСКАНИРУЙТЕ QR" под QR-кодом (черный, размер 55 как в боте)
            ctx.textAlign = 'center'
            ctx.textBaseline = 'top'
            ctx.fillStyle = 'black'
            ctx.font = 'bold 55px Arial'
            const textBelow1 = "ОТСКАНИРУЙТЕ QR"
            const textY2 = qrY + qrSize + 30
            ctx.fillText(textBelow1, imgWidth / 2, textY2)
            
            // Текст "В любом банке" (синий, размер 42 как в боте)
            ctx.font = 'bold 42px Arial'
            ctx.fillStyle = 'blue'
            const textBelow2 = "В любом банке"
            const textY3 = textY2 + 60
            ctx.fillText(textBelow2, imgWidth / 2, textY3)
            
            // Красная линия внизу (высота 5px как в боте)
            const redLineY = textY3 + 50
            const redLineHeight = 5
            ctx.fillStyle = 'red'
            ctx.fillRect(0, redLineY, imgWidth, redLineHeight)
            
            // Обрезаем изображение после красной линии (как в боте)
            const bottomCrop = redLineY + redLineHeight + 20
            
            // Создаем новый canvas с обрезанной высотой
            const croppedCanvas = document.createElement('canvas')
            croppedCanvas.width = imgWidth
            croppedCanvas.height = bottomCrop
            const croppedCtx = croppedCanvas.getContext('2d')!
            
            // Копируем нужную часть изображения
            croppedCtx.drawImage(canvas, 0, 0, imgWidth, bottomCrop, 0, 0, imgWidth, bottomCrop)
            
            // Преобразуем canvas в data URL
            const dataUrl = croppedCanvas.toDataURL('image/png')
            console.log('QR code generated successfully, data URL length:', dataUrl.length)
            setQrImageUrl(dataUrl)
          } catch (error) {
            console.error('Error drawing on canvas:', error)
            // Fallback на простой QR-код
            setQrImageUrl(qrCodeUrl)
          }
        }
        
        qrImage.onerror = (error) => {
          console.error('Error loading QR image:', error)
          // Fallback на простой QR-код без текста
          setQrImageUrl(qrCodeUrl)
        }
        
        qrImage.src = qrCodeUrl
      } catch (error) {
        console.error('Error generating QR code:', error)
        // Fallback на простой QR-код
        setQrImageUrl(`https://api.qrserver.com/v1/create-qr-code/?size=900x900&data=${encodeURIComponent(url)}`)
      }
    }

    generateQRCode()
  }, [url])

  if (!qrImageUrl) {
    return (
      <section className="card space-y-2">
        <div className="label text-center text-xs">QR-код для оплаты</div>
        <div className="flex justify-center">
          <div className="w-56 h-56 rounded-lg border border-white/20 bg-white/10 animate-pulse"></div>
        </div>
      </section>
    )
  }

  return (
    <section className="card space-y-2">
      <div className="label text-center text-xs">QR-код для оплаты</div>
      <div className="flex justify-center">
        <div className="relative">
          {qrImageUrl ? (
            <img 
              src={qrImageUrl} 
              alt="QR код для оплаты" 
              className="w-full max-w-[520px] h-auto rounded-lg border border-white/20"
              onError={(e) => {
                console.error('Error loading QR image')
                e.currentTarget.style.display = 'none'
              }}
            />
          ) : (
            <div className="w-full max-w-[520px] h-[360px] rounded-lg border border-white/20 bg-white/10 flex items-center justify-center">
              <div className="text-white/50">Загрузка QR-кода...</div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

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

function DepositStep3Content() {
  useBankUiTheme()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { language } = useLanguage()
  const isAuthorized = useRequireAuth()
  const [selectedBank, setSelectedBank] = useState('')
  const [loading, setLoading] = useState(false)
  const [paymentUrls, setPaymentUrls] = useState<Record<string, string>>({})
  const [enabledBanks, setEnabledBanks] = useState<string[]>([])
  const [timeLeft, setTimeLeft] = useState(DEPOSIT_CONFIG.TIMEOUT_SECONDS)
  const [timerStarted, setTimerStarted] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)
  const [receiptUploaded, setReceiptUploaded] = useState(false)
  const [requestId, setRequestId] = useState<number | null>(null)
  const bookmaker = searchParams.get('bookmaker') || (typeof window !== 'undefined' ? localStorage.getItem('deposit_bookmaker') : '') || ''
  const accountId = searchParams.get('accountId') || ''
  const amount = searchParams.get('amount') || ''

  // Инициализация и восстановление таймера из localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    const TIMER_DURATION = DEPOSIT_CONFIG.TIMEOUT_SECONDS
    const TIMER_KEY = `deposit_timer_${bookmaker}_${accountId}_${amount}`
    
    // Проверяем, есть ли сохраненный таймер
    const savedTimerStart = localStorage.getItem(TIMER_KEY)
    const now = Date.now()
    
    if (savedTimerStart) {
      const elapsed = Math.floor((now - parseInt(savedTimerStart)) / 1000)
      const remaining = Math.max(0, TIMER_DURATION - elapsed)
      
      if (remaining > 0) {
        setTimeLeft(remaining)
        setTimerStarted(true)
      } else {
        // Таймер истек, удаляем из localStorage
        localStorage.removeItem(TIMER_KEY)
        setTimeLeft(0)
      }
    } else {
      // Создаем новый таймер
      localStorage.setItem(TIMER_KEY, now.toString())
      setTimeLeft(TIMER_DURATION)
      setTimerStarted(true)
    }
    
    // Очистка при размонтировании (если пользователь уходит со страницы)
    return () => {
      // Не удаляем таймер при размонтировании, чтобы он сохранялся при обновлении
    }
  }, [bookmaker, accountId, amount])

  // Таймер обратного отсчета
  useEffect(() => {
    if (!timerStarted || timeLeft <= 0) return

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          const TIMER_KEY = `deposit_timer_${bookmaker}_${accountId}_${amount}`
          if (typeof window !== 'undefined') {
            localStorage.removeItem(TIMER_KEY)
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [timeLeft, timerStarted, bookmaker, accountId, amount])

  useEffect(() => {
    if (!bookmaker || !accountId || !amount) {
      router.push('/deposit/step1')
      return
    }

    // Загружаем фото чека, если заявка уже создана
    const requestIdFromUrl = searchParams.get('requestId')
    if (requestIdFromUrl && !requestId) {
      // Загружаем фото только если requestId есть в URL, но еще не загружен в state
      const telegramUserId = getTelegramUserId()
      const photoUrl = telegramUserId 
        ? `${getApiBase()}/api/requests/${requestIdFromUrl}/photo?user_id=${telegramUserId}`
        : `${getApiBase()}/api/requests/${requestIdFromUrl}/photo`
      
      fetch(photoUrl)
        .then(response => {
          if (response.ok) {
            return response.json()
          }
          console.warn('⚠️ Не удалось загрузить фото чека:', response.status, response.statusText)
          return null
        })
        .then(data => {
          if (data && data.success && data.data && data.data.photoFileUrl) {
            let photoUrl = data.data.photoFileUrl
            
            // Если URL относительный, добавляем базовый URL
            if (photoUrl && photoUrl.startsWith('/api/')) {
              photoUrl = `${getApiBase()}${photoUrl}`
            }
            
            setReceiptPreview(photoUrl)
            setReceiptUploaded(true)
            setRequestId(parseInt(requestIdFromUrl))
            console.log('✅ Фото чека загружено из API:', photoUrl.substring(0, 50) + '...')
          } else {
            console.warn('⚠️ Фото чека не найдено в ответе API')
          }
        })
        .catch(error => {
          console.error('Ошибка загрузки фото чека:', error)
        })
    }

    // Загружаем настройки банков и QR ссылки
    async function loadBankSettingsAndQR() {
      try {
        const base = getApiBase()
        const telegramUserId = getTelegramUserId()
        const amountNum = parseFloat(amount)
        
        // 1. Пробуем загрузить предзагруженные QR ссылки из sessionStorage
        // Используем точную сумму из URL (с копейками)
        const storageKey = `deposit_qr_${bookmaker}_${accountId}_${amount}`
        const cachedQr = typeof window !== 'undefined' ? sessionStorage.getItem(storageKey) : null
        
        if (cachedQr) {
          try {
            const cachedUrls = JSON.parse(cachedQr)
            setPaymentUrls(cachedUrls)
            console.log('✅ QR ссылки загружены из кэша:', Object.keys(cachedUrls))
            // Удаляем из кэша после использования
            if (typeof window !== 'undefined') {
              sessionStorage.removeItem(storageKey)
            }
          } catch (e) {
            console.error('Error parsing cached QR:', e)
          }
        }

        // 2. Загружаем настройки банков (параллельно)
        const settingsUrl = telegramUserId 
          ? `${base}/api/public/payment-settings?user_id=${telegramUserId}`
          : `${base}/api/public/payment-settings`
        
        const [settingsRes, qrResponse] = await Promise.all([
          fetch(settingsUrl, { cache: 'no-store' }),
          // Если QR ссылки не были в кэше, загружаем их
          // ВАЖНО: Используем точную сумму из URL (с копейками)
          cachedQr ? Promise.resolve(null) : safeFetch(`${base}/api/public/generate-qr`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              amount: parseFloat(amount), // Используем сумму из URL (уже с копейками)
              playerId: accountId,
              bank: 'demirbank'
            }),
            timeout: 30000,
            retries: 2,
            retryDelay: 1000
          })
        ])
        
        // Обрабатываем настройки банков
        const settingsData = await settingsRes.json()
        if (settingsData && settingsData.deposits && settingsData.deposits.banks && Array.isArray(settingsData.deposits.banks)) {
          const bankCodeMapping: Record<string, string> = {
            'DemirBank': 'demirbank',
            'demirbank': 'demirbank',
            'O! bank': 'omoney',
            'O!bank': 'omoney',
            'omoney': 'omoney',
            'odengi': 'omoney',
            'Balance.kg': 'balance',
            'balance': 'balance',
            'Bakai': 'bakai',
            'bakai': 'bakai',
            'MegaPay': 'megapay',
            'megapay': 'megapay',
            'MBank': 'mbank',
            'mbank': 'mbank'
          }
          const mappedBanks: string[] = []
          for (const b of settingsData.deposits.banks) {
            const code = b.code || b
            const mapped = bankCodeMapping[code] || code.toLowerCase()
            if (mapped) mappedBanks.push(mapped)
          }
          setEnabledBanks(mappedBanks)
        }

        // Обрабатываем QR ссылки (если не были в кэше)
        if (qrResponse && qrResponse.ok) {
          const qrData = await qrResponse.json()
          if (qrData.success && qrData.all_bank_urls) {
            setPaymentUrls(qrData.all_bank_urls)
            console.log('✅ QR ссылки получены из API:', Object.keys(qrData.all_bank_urls))
          }
        }
      } catch (error) {
        console.error('Error loading bank settings or QR:', error)
      }
    }
    loadBankSettingsAndQR()
  }, [bookmaker, accountId, amount, router, searchParams])

  // Не показываем контент, пока проверяется авторизация
  if (isAuthorized === null || isAuthorized === false) {
    return null
  }

  const handleBankSelect = async (bankCode: string) => {
    setSelectedBank(bankCode)
    setLoading(true)

    try {
      // Ищем ссылку для выбранного банка
      const bankUrlMap: Record<string, string[]> = {
        'demirbank': ['DemirBank', 'demirbank', 'Demir'],
        'omoney': ['O!Money', 'omoney', 'O!Money', 'Odengi'],
        'balance': ['Balance.kg', 'balance', 'Balance'],
        'bakai': ['Bakai', 'bakai'],
        'megapay': ['MegaPay', 'megapay'],
        'mbank': ['MBank', 'mbank', 'MBank']
      }

      let bankUrl: string | undefined = undefined
      const variants = bankUrlMap[bankCode] || [bankCode]
      
      // Пробуем найти ссылку по вариантам названий
      for (const variant of variants) {
        if (paymentUrls[variant]) {
          bankUrl = paymentUrls[variant]
          break
        }
      }

      // Если не нашли, пробуем напрямую по коду
      if (!bankUrl && paymentUrls[bankCode]) {
        bankUrl = paymentUrls[bankCode]
      }

      if (!bankUrl) {
        alert('Ссылка для оплаты не найдена. Попробуйте обновить страницу.')
        setLoading(false)
        return
      }

      // Открываем ссылку на оплату
      // ВАЖНО: Заявка НЕ создается здесь - только при нажатии "Оплатил" после загрузки фото
      if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
        (window as any).Telegram.WebApp.openLink(bankUrl)
      } else {
        window.open(bankUrl, '_blank')
      }
    } catch (error: any) {
      console.error('Error opening bank link:', error)
      alert('Ошибка при открытии ссылки на оплату')
    } finally {
      setLoading(false)
    }
  }

  const handleReceiptChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (typeof window === 'undefined' || typeof (window as any).FileReader === 'undefined') {
      alert('Ошибка: FileReader недоступен. Пожалуйста, используйте другой браузер.')
      return
    }

    // Проверка типа файла
    if (!file.type.startsWith('image/')) {
      alert('Пожалуйста, выберите изображение (PNG, JPG)')
      return
    }

    // Проверка размера файла (20MB - увеличили лимит, так как будем сжимать)
    if (file.size > 20 * 1024 * 1024) {
      alert('Размер файла не должен превышать 20MB')
      return
    }

    try {
      // Сжимаем изображение, если оно большое
      let processedFile = file
      if (file.size > 2 * 1024 * 1024) {
        try {
          processedFile = await compressImage(file, {
            maxWidth: 1920,
            maxHeight: 1920,
            quality: 0.85,
            maxSizeMB: 5,
          })
        } catch (error) {
          console.warn('Не удалось сжать изображение, используем оригинал:', error)
          processedFile = file
        }
      }

      setReceiptFile(processedFile)

      // Конвертируем в base64 через Promise для гарантированного обновления
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (e) => {
            const result = e.target?.result
            if (result && typeof result === 'string') {
              resolve(result)
            } else {
              reject(new Error('Неверный формат данных'))
            }
          }
          reader.onerror = () => {
            reject(new Error('Ошибка чтения файла'))
          }
          reader.readAsDataURL(processedFile)
        })
        
        setReceiptPreview(base64)
      } catch (error) {
        alert('Ошибка при загрузке фото. Попробуйте еще раз.')
        return
      }

      // Если есть requestId, сразу загружаем
      if (requestId) {
        await uploadReceipt(processedFile)
      }
    } catch (error) {
      console.error('Ошибка обработки изображения:', error)
      alert('Ошибка при обработке фото. Попробуйте еще раз.')
    }
  }

  const uploadReceipt = async (file: File) => {
    if (!requestId) return

    setUploadingReceipt(true)
    try {
      const base = getApiBase()
      const formData = new FormData()
      formData.append('receipt', file)
      formData.append('requestId', requestId.toString())

      const response = await fetch(`${base}/api/requests/${requestId}/receipt`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      
      if (data.success) {
        console.log('✅ Чек загружен успешно на сервер')
        console.log('📋 Ответ сервера:', data)
        
        // НЕ перезаписываем локальный preview - оставляем base64 preview для отображения
        // URL с сервера можно использовать для загрузки, но локальный preview более надежен
        if (data.data && data.data.url) {
          let photoUrl = data.data.url
          // Если URL относительный, добавляем базовый URL
          if (photoUrl && photoUrl.startsWith('/api/')) {
            photoUrl = `${base}${photoUrl}`
          }
          console.log('📸 URL фото на сервере:', photoUrl.substring(0, 100) + '...')
          // НЕ обновляем preview на URL с сервера - оставляем локальный base64 preview
          // Это гарантирует, что фото всегда будет видно, даже если URL с сервера недоступен
        } else {
          console.log('⚠️ URL не получен от сервера, используем локальный preview')
        }
        
        // Обновляем состояние, чтобы показать, что чек загружен на сервер
        // НО НЕ меняем receiptPreview - оставляем локальный base64 preview
        setReceiptUploaded(true)
        
        // Показываем успешное сообщение (используем message из ответа или дефолтное)
        const successMessage = data.message || 'Чек успешно загружен'
        console.log('✅ Состояние обновлено: receiptUploaded = true, preview сохранен')
        
        // НЕ показываем alert, чтобы не мешать пользователю - просто обновляем состояние
        // alert(successMessage)
      } else {
        // Ошибка: используем только error, не message (message может быть успешным сообщением)
        const errorMessage = data.error || `Ошибка сервера: ${response.status}`
        console.error('❌ Ошибка загрузки чека на сервер:', errorMessage)
        // НЕ удаляем preview при ошибке загрузки - оставляем локальный preview
        // Пользователь все равно видит фото, даже если загрузка на сервер не удалась
        alert(`Ошибка загрузки чека: ${errorMessage}`)
      }
    } catch (error: any) {
      console.error('Error uploading receipt:', error)
      alert('Ошибка при загрузке чека. Попробуйте еще раз.')
    } finally {
      setUploadingReceipt(false)
    }
  }

  const handlePaymentConfirmed = async () => {
    if (!selectedBank) {
      alert('Пожалуйста, сначала выберите банк для оплаты')
      return
    }

    // Проверяем, что фото чека загружено
    if (!receiptFile && !receiptUploaded) {
      alert('Пожалуйста, загрузите фото чека перед подтверждением оплаты')
      return
    }

    setLoading(true)
    try {
      const userId = getTelegramUserId()
      if (!userId) {
        alert('Ошибка: не удалось получить ID пользователя')
        setLoading(false)
        return
      }

      const base = getApiBase()
      // ВАЖНО: Используем точную сумму из URL (с копейками), не округляем
      const amountWithCents = parseFloat(amount)

      // Получаем данные пользователя из Telegram
      const telegramUser = getTelegramUser()

      // Создаем заявку только при нажатии "Оплатил" (с фото сразу, как в боте)
      if (!requestId) {
        // Используем уже готовый base64 из receiptPreview, если он есть
        // Если нет, конвертируем из файла (как в боте)
        let receipt_photo_base64: string | null = null
        
        if (receiptPreview && receiptPreview.startsWith('data:')) {
          // Используем уже готовый base64 из preview
          receipt_photo_base64 = receiptPreview
        } else if (receiptFile) {
          // Конвертируем фото в base64 (как в боте)
          try {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = (e) => {
                const result = e.target?.result
                if (result && typeof result === 'string') {
                  // В боте отправляется полный data URL: data:image/jpeg;base64,{base64_data}
                  resolve(result)
                } else {
                  reject(new Error('Неверный формат данных'))
                }
              }
              reader.onerror = () => {
                reject(new Error('Ошибка чтения файла'))
              }
              reader.readAsDataURL(receiptFile)
            })
            receipt_photo_base64 = base64
          } catch (error) {
            console.error('Ошибка конвертации фото в base64:', error)
            alert('Ошибка при обработке фото. Попробуйте еще раз.')
            setLoading(false)
            return
          }
        }
        
        const response = await safeFetch(`${base}/api/payment`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'deposit',
            bookmaker: bookmaker,
            userId: userId,
            account_id: accountId,
            amount: amountWithCents, // Передаем сумму С КОПЕЙКАМИ
            payment_method: selectedBank,
            telegram_username: telegramUser?.username || null,
            telegram_first_name: telegramUser?.first_name || null,
            telegram_last_name: telegramUser?.last_name || null,
            receipt_photo: receipt_photo_base64, // Фото чека отправляем сразу, как в боте
          }),
          timeout: 30000,
          retries: 2,
          retryDelay: 1000
        })

        if (!response.ok) {
          const errorText = await response.text()
          let errorData: any = null
          try {
            errorData = JSON.parse(errorText)
          } catch (e) {}

          const errorMessage = errorData?.error || errorData?.message || `Ошибка сервера: ${response.status}`
          alert(`${t.paymentConfirmError}: ${errorMessage}`)
          setLoading(false)
          return
        }

        const data = await response.json()
        if (!data.success) {
          alert(`${t.paymentConfirmError}: ${data.error}`)
          setLoading(false)
          return
        }

        if (data.data && data.data.id) {
          setRequestId(data.data.id)
          
          // Если сумма была скорректирована, перегенерируем QR-код с новой суммой
          if (data.data.amount && data.data.originalAmount) {
            const adjustedAmount = parseFloat(data.data.amount)
            const originalAmount = parseFloat(data.data.originalAmount)
            
            if (Math.abs(adjustedAmount - originalAmount) > 0.001) {
              console.log(`💰 Сумма была скорректирована: ${originalAmount} → ${adjustedAmount}, перегенерируем QR-код`)
              
              // Обновляем amount в URL (state обновится автоматически через searchParams)
              const newAmount = adjustedAmount.toFixed(2)
              router.replace(`/deposit/step3?bookmaker=${bookmaker}&accountId=${encodeURIComponent(accountId.trim())}&amount=${newAmount}&requestId=${data.data.id}`)
              
              try {
                const qrResponse = await safeFetch(`${base}/api/public/generate-qr`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    amount: adjustedAmount,
                    playerId: accountId,
                    bank: selectedBank || 'demirbank'
                  }),
                  timeout: 30000,
                  retries: 2,
                  retryDelay: 1000
                })
                
                if (qrResponse.ok) {
                  const qrData = await qrResponse.json()
                  if (qrData.success && qrData.all_bank_urls) {
                    setPaymentUrls(qrData.all_bank_urls)
                    console.log('✅ QR-код обновлен с скорректированной суммой')
                  }
                }
              } catch (qrError) {
                console.error('Ошибка при перегенерации QR-кода:', qrError)
                // Не критично, продолжаем с исходным QR
              }
            }
          }
          
          // Фото уже отправлено при создании заявки, поэтому отдельно загружать не нужно
          if (receipt_photo_base64) {
            setReceiptUploaded(true)
          }
        }
      } else {
        // Если заявка уже создана, проверяем наличие фото
        if (!receiptUploaded && receiptFile) {
          // Загружаем фото, если оно есть, но еще не загружено
          await uploadReceipt(receiptFile)
        } else if (!receiptUploaded) {
          alert('⚠️ Внимание: фото чека не загружено. Пожалуйста, загрузите фото чека.')
          setLoading(false)
          return
        }
      }

      alert(t.paymentConfirmed)
      
      // Переходим на главную страницу
      router.push('/')
    } catch (error: any) {
      console.error('Error confirming payment:', error)
      alert(`${t.paymentConfirmError}: ${error.message || 'Неизвестная ошибка'}`)
    } finally {
      setLoading(false)
    }
  }

  const getBookmakerName = (bm: string) => {
    const names: Record<string, string> = {
      '1xbet': '1xBet',
      '1win': '1WIN',
      'melbet': 'Melbet',
      'mostbet': 'Mostbet',
      'winwin': 'Winwin',
      '888starz': '888starz',
    }
    return names[bm.toLowerCase()] || bm
  }

  const translations = {
    ru: {
      title: 'Оплата',
      subtitle: 'Оплатите заявку',
      timeToPay: 'Время на оплату',
      requestDetails: 'Детали заявки',
      bookmaker: 'Букмекер:',
      playerId: 'ID игрока:',
      amountToPay: 'Сумма к оплате:',
      selectBank: 'Выберите банк для оплаты',
      back: 'Назад',
      loading: 'Создание заявки...',
      uploadReceipt: 'Загрузить чек об оплате',
      receiptUploaded: 'Чек загружен',
      uploadReceiptDesc: 'Загрузите скриншот или фото чека об оплате',
      receiptFileTypes: 'PNG, JPG до 20MB',
      uploading: 'Загрузка...',
      paidButton: 'Я оплатил',
      paymentConfirmed: 'Заявка отправлена в обработку',
      paymentConfirmError: 'Ошибка при отправке заявки',
      timeExpired: 'Ваше время истекло',
      timeExpiredDesc: 'Время на оплату заявки истекло. Пожалуйста, создайте новую заявку.',
      goToMainMenu: 'В главное меню'
    },
    en: {
      title: 'Payment',
      subtitle: 'Pay the application',
      timeToPay: 'Time to pay',
      requestDetails: 'Application details',
      bookmaker: 'Bookmaker:',
      playerId: 'Player ID:',
      amountToPay: 'Amount to pay:',
      selectBank: 'Select bank for payment',
      back: 'Back',
      loading: 'Creating request...',
      uploadReceipt: 'Upload payment receipt',
      receiptUploaded: 'Receipt uploaded',
      uploadReceiptDesc: 'Upload a screenshot or photo of the payment receipt',
      receiptFileTypes: 'PNG, JPG up to 20MB',
      uploading: 'Uploading...',
      paidButton: 'I paid',
      paymentConfirmed: 'Request submitted for processing',
      paymentConfirmError: 'Error submitting request',
      timeExpired: 'Your time has expired',
      timeExpiredDesc: 'The time to pay the request has expired. Please create a new request.',
      goToMainMenu: 'Go to main menu'
    },
    ky: {
      title: 'Төлөм',
      subtitle: 'Өтүнүчтү төлөңүз',
      timeToPay: 'Төлөм убактысы',
      requestDetails: 'Өтүнүч деталдары',
      bookmaker: 'Букмекер:',
      playerId: 'Оюнчу ID:',
      amountToPay: 'Төлөм суммасы:',
      selectBank: 'Төлөм үчүн банкты тандаңыз',
      back: 'Артка',
      loading: 'Өтүнүч түзүлүүдө...',
      uploadReceipt: 'Төлөм чегин жүктөө',
      receiptUploaded: 'Чек жүктөлдү',
      uploadReceiptDesc: 'Төлөм чегинин скриншотун же сүрөтүн жүктөңүз',
      receiptFileTypes: 'PNG, JPG 20MB чейин',
      uploading: 'Жүктөлүүдө...',
      paidButton: 'Мен төлөдүм',
      paymentConfirmed: 'Өтүнүч иштетүүгө жөнөтүлдү',
      paymentConfirmError: 'Өтүнүчтү жөнөтүүдө ката',
      timeExpired: 'Сиздин убактыңыз бүттү',
      timeExpiredDesc: 'Төлөм убактысы бүттү. Сураныч, жаңы өтүнүч түзүңүз.',
      goToMainMenu: 'Башкы менюга'
    },
    uz: {
      title: 'To\'lov',
      subtitle: 'Ariza to\'lovini to\'lang',
      timeToPay: 'To\'lov vaqti',
      requestDetails: 'Ariza tafsilotlari',
      bookmaker: 'Bukmeker:',
      playerId: 'O\'yinchi ID:',
      amountToPay: 'To\'lov summasi:',
      selectBank: 'To\'lov uchun bankni tanlang',
      back: 'Orqaga',
      loading: 'So\'rov yaratilmoqda...',
      uploadReceipt: 'To\'lov kvitansiyasini yuklash',
      receiptUploaded: 'Kvitansiya yuklandi',
      uploadReceiptDesc: 'To\'lov kvitansiyasining skrinshotini yoki rasmini yuklang',
      receiptFileTypes: 'PNG, JPG 20MB gacha',
      uploading: 'Yuklanmoqda...',
      paidButton: 'To\'lov qildim',
      paymentConfirmed: 'So\'rov qayta ishlash uchun yuborildi',
      paymentConfirmError: 'So\'rovni yuborishda xatolik',
      timeExpired: 'Vaqtingiz tugadi',
      timeExpiredDesc: 'To\'lov vaqti tugadi. Iltimos, yangi so\'rov yarating.',
      goToMainMenu: 'Bosh menyuga'
    }
  }

  const t = translations[language as keyof typeof translations] || translations.ru

  // Форматирование времени MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // Вычисление прогресса таймера (0-100%)
  const timerProgress = (DEPOSIT_CONFIG.TIMEOUT_SECONDS - timeLeft) / DEPOSIT_CONFIG.TIMEOUT_SECONDS * 100

  // Если время истекло, показываем страницу истечения времени
  if (timeLeft <= 0) {
    return (
      <main className="space-y-4">
        <FixedHeaderControls />
        
        {/* Страница истечения времени */}
        <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
          <div className="card space-y-4 p-8 text-center max-w-md">
            {/* Иконка истечения времени */}
            <div className="w-24 h-24 mx-auto rounded-full bg-red-500/20 flex items-center justify-center">
              <svg className="w-12 h-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            
            {/* Заголовок */}
            <h2 className="text-2xl font-bold text-white">{t.timeExpired}</h2>
            
            {/* Описание */}
            <p className="text-white/70 text-sm leading-relaxed">
              {t.timeExpiredDesc}
            </p>
            
            {/* Кнопка в главное меню */}
            <button 
              className="btn btn-primary w-full mt-6" 
              onClick={() => router.push('/')}
            >
              {t.goToMainMenu}
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="space-y-3">
      <FixedHeaderControls />
      
      {/* Заголовок и подзаголовок */}
      <div className="space-y-1">
        <h1 className="text-lg font-bold text-white">{t.title}</h1>
        <p className="text-white/70 text-xs">{t.subtitle}</p>
      </div>

      {/* Таймер */}
      <section className="card space-y-2 p-4">
        <div className="text-center">
          <div className="relative inline-block">
            {/* Круглый прогресс-бар */}
            <div className="relative w-24 h-24 mx-auto mb-2">
              <svg className="transform -rotate-90 w-24 h-24" viewBox="0 0 120 120">
                {/* Фоновый круг */}
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  stroke="rgba(255, 255, 255, 0.1)"
                  strokeWidth="8"
                  fill="none"
                />
                {/* Прогресс круг */}
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  stroke="url(#timerGradient)"
                  strokeWidth="8"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 54}`}
                  strokeDashoffset={`${2 * Math.PI * 54 * (1 - timerProgress / 100)}`}
                  className="transition-all duration-1000 ease-linear"
                />
                <defs>
                  <linearGradient id="timerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4fa9ff" />
                    <stop offset="100%" stopColor="#2f81e6" />
                  </linearGradient>
                </defs>
              </svg>
              {/* Текст таймера в центре */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <div className={`text-2xl font-bold text-white transition-all duration-300 ${
                    timeLeft <= 60 ? 'text-red-400 animate-pulse' : ''
                  }`}>
                    {formatTime(timeLeft)}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="text-white/60 text-xs font-medium">{t.timeToPay}</div>
        </div>
      </section>

      {/* Детали заявки */}
      <section className="card space-y-2">
        <div className="label text-xs font-semibold">{t.requestDetails}</div>
        {bookmaker && (
          <div className="flex justify-between items-center">
            <span className="text-white/70 text-sm">{t.bookmaker}</span>
            <span className="text-white font-semibold text-sm">{getBookmakerName(bookmaker)}</span>
          </div>
        )}
        {accountId && (
          <div className="flex justify-between items-center">
            <span className="text-white/70 text-sm">{t.playerId}</span>
            <span className="text-white font-semibold text-sm">{accountId}</span>
          </div>
        )}
        {amount && (
          <div className="flex justify-between items-center">
            <span className="text-white/70 text-sm">{t.amountToPay}</span>
            <span className="text-white font-semibold text-base">
              {parseFloat(amount || '0').toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} сом
            </span>
          </div>
        )}
      </section>

      {/* QR-код для оплаты */}
      {Object.keys(paymentUrls).length > 0 && (() => {
        // Используем ссылку O!Money для QR-кода, если есть, иначе первую доступную
        const omoneyUrl = paymentUrls['O!Money'] || paymentUrls['omoney'] || Object.values(paymentUrls)[0]
        
        return omoneyUrl ? (
          <QRCodeWithText url={omoneyUrl} />
        ) : null
      })()}

      {/* Выбор банка */}
      <section className="card space-y-2">
        <div className="label text-xs">{t.selectBank}</div>
        {Object.keys(paymentUrls).length > 0 ? (
          <BankButtons
            onPick={handleBankSelect}
            selected={selectedBank}
            disabled={loading}
            allBankUrls={paymentUrls}
            enabledBanks={enabledBanks}
          />
        ) : (
          <div className="text-center text-white/70 text-xs py-3">
            Загрузка ссылок для оплаты...
          </div>
        )}
        {loading && (
          <div className="text-center text-white/70 text-xs py-2">
            {t.loading}
          </div>
        )}
      </section>

      {/* Загрузка чека */}
      <section className="card space-y-2">
          <div className="label text-xs">{t.uploadReceipt}</div>
          <div className="text-white/60 text-xs">{t.uploadReceiptDesc}</div>
          
          <div className="relative">
            <input 
              type="file"
              accept="image/*"
              onChange={handleReceiptChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              id="receipt-upload"
              disabled={uploadingReceipt}
            />
            <label 
              htmlFor="receipt-upload"
              className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-sky-400/30 rounded-xl bg-gradient-to-br from-slate-900/20 to-slate-800/30 hover:border-sky-400/50 hover:bg-slate-800/40 transition-all duration-300 cursor-pointer group relative"
            >
              <div className="flex flex-col items-center space-y-2">
                <div className="w-7 h-7 rounded-full bg-sky-500/20 flex items-center justify-center group-hover:bg-sky-500/30 transition-colors">
                  <svg className="w-3.5 h-3.5 text-sky-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-xs font-medium text-white group-hover:text-sky-300 transition-colors">
                    {receiptFile ? 'Файл выбран' : (uploadingReceipt ? t.uploading : t.uploadReceipt)}
                  </p>
                  <p className="text-[11px] text-white/60 mt-1">
                    {receiptFile ? receiptFile.name : t.receiptFileTypes}
                  </p>
                </div>
              </div>
            </label>
          </div>
          
          {/* Предварительный просмотр - как в админ-панели */}
          {receiptPreview && (
            <div className="mt-3 p-3 bg-black/20 rounded-xl border border-sky-400/20">
              <div className="text-center mb-2">
                <span className="text-xs text-sky-300 font-medium">Предварительный просмотр:</span>
              </div>
              <div className="flex justify-center bg-gray-900 rounded-lg overflow-hidden" style={{ minHeight: '160px' }}>
                <img 
                  src={receiptPreview} 
                  alt="Receipt Preview" 
                  className="w-full h-auto max-h-72 rounded-lg object-contain"
                  style={{ display: 'block' }}
                  onError={(e) => {
                    console.error('❌ Ошибка загрузки изображения чека')
                    e.currentTarget.style.display = 'none'
                  }}
                  onLoad={() => {
                    console.log('✅ Изображение чека успешно загружено')
                  }}
                />
              </div>
            </div>
          )}
        </section>

      <div className="flex gap-3">
        <button 
          className="btn btn-ghost flex-1" 
          onClick={() => router.back()}
          disabled={loading || uploadingReceipt}
        >
          {t.back}
        </button>
        <button 
          className="btn btn-primary flex-1" 
          onClick={handlePaymentConfirmed}
          disabled={loading || uploadingReceipt || !selectedBank}
        >
          {t.paidButton}
        </button>
      </div>
    </main>
  )
}

export default function DepositStep3() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <FixedHeaderControls />
        <div className="text-white">Загрузка...</div>
      </div>
    }>
      <DepositStep3Content />
    </Suspense>
  )
}


