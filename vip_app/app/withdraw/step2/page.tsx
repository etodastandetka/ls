"use client"
import { useState, useEffect, useRef } from 'react'
import FixedHeaderControls from '../../../components/FixedHeaderControls'
import { useRouter } from 'next/navigation'
import { useLanguage } from '../../../components/LanguageContext'
import { getApiBase } from '../../../utils/fetch'
import { compressImage, fileToBase64 } from '../../../utils/imageCompression'
import { useRequireAuth } from '../../../hooks/useRequireAuth'


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

export default function WithdrawStep2() {
  useBankUiTheme()
  const router = useRouter()
  const { language } = useLanguage()
  const isAuthorized = useRequireAuth()
  const [bank, setBank] = useState('omoney')
  const [phone, setPhone] = useState('+996')
  const [qrPhoto, setQrPhoto] = useState<File | null>(null)
  const [qrPhotoPreview, setQrPhotoPreview] = useState<string | null>(null)
  const phoneSectionRef = useRef<HTMLDivElement>(null)
  const qrSectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    
    const bookmaker = localStorage.getItem('withdraw_bookmaker')
    if (!bookmaker) {
      router.push('/withdraw/step1')
    }
  }, [router])

  useEffect(() => {
    const savedPhone = localStorage.getItem('withdraw_phone')
    const savedQrPhoto = localStorage.getItem('withdraw_qr_photo')
    localStorage.setItem('withdraw_bank', 'omoney')
    
    if (savedPhone) {
      setPhone(savedPhone.startsWith('+') ? savedPhone : `+${savedPhone}`)
    }
    
    if (savedQrPhoto) {
      setQrPhotoPreview(savedQrPhoto)
    }
  }, [])

  
  useEffect(() => {
    if (qrPhotoPreview) {
      setTimeout(() => {
        if (qrSectionRef.current) {
          const elementPosition = qrSectionRef.current.getBoundingClientRect().top
          const offsetPosition = elementPosition + window.pageYOffset - 20
          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          })
        }
      }, 200)
    }
  }, [qrPhotoPreview])

  // Не показываем контент, пока проверяется авторизация
  if (isAuthorized === null || isAuthorized === false) {
    return null
  }

  const translations = {
    ru: {
      title: 'Вывод средств',
      selectBank: 'Выберите банк',
      phone: 'Номер телефона',
      phonePlaceholder: '+996...',
      qrCode: 'QR-код кошелька',
      uploadQr: 'Загрузить фото QR-кода',
      next: 'Далее',
      back: 'Назад'
    },
    en: {
      title: 'Withdraw',
      selectBank: 'Select bank',
      phone: 'Phone number',
      phonePlaceholder: '+996...',
      qrCode: 'Wallet QR code',
      uploadQr: 'Upload QR code photo',
      next: 'Next',
      back: 'Back'
    },
    ky: {
      title: 'Акчаны чыгаруу',
      selectBank: 'Банкты тандаңыз',
      phone: 'Телефон номуру',
      phonePlaceholder: '+996...',
      qrCode: 'Капчыктын QR-коду',
      uploadQr: 'QR-код сүрөтүн жүктөө',
      next: 'Кийинки',
      back: 'Артка'
    },
    uz: {
      title: 'Pulni yechib olish',
      selectBank: 'Bankni tanlang',
      phone: 'Telefon raqami',
      phonePlaceholder: '+996...',
      qrCode: 'Hamyon QR kodi',
      uploadQr: 'QR kod rasmini yuklash',
      next: 'Keyingi',
      back: 'Orqaga'
    }
  }

  const t = translations[language as keyof typeof translations] || translations.ru

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value
    
    if (!value.startsWith('+996')) {
      if (value.length < 4) {
        value = '+996'
      } else if (!value.startsWith('+')) {
        value = '+996' + value.replace(/[^\d]/g, '')
      } else {
        value = '+996' + value.replace(/^\+996/, '').replace(/[^\d]/g, '')
      }
    } else {
      const after996 = value.slice(4).replace(/[^\d]/g, '')
      value = '+996' + after996
    }
    
    setPhone(value)
  }

  const handleQrPhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

      setQrPhoto(processedFile)

      // Конвертируем в base64 с опциональным сжатием
      try {
        const base64 = await fileToBase64(processedFile, false) // Уже сжато выше
        setQrPhotoPreview(base64)
        localStorage.setItem('withdraw_qr_photo', base64)
      } catch (error) {
        console.error('Ошибка конвертации в base64:', error)
        alert('Ошибка при загрузке фото. Попробуйте еще раз.')
      }
    } catch (error) {
      console.error('Ошибка обработки изображения:', error)
      alert('Ошибка при обработке фото. Попробуйте еще раз.')
    }
  }

  const handleNext = () => {
    const cleanPhone = phone.replace(/[^\d]/g, '')
    if (!cleanPhone || cleanPhone.length < 12) {
      alert('Введите корректный номер телефона')
      return
    }
    
    if (!qrPhotoPreview) {
      alert('Загрузите фото QR-кода')
      return
    }
    
    localStorage.setItem('withdraw_bank', bank || 'omoney')
    localStorage.setItem('withdraw_phone', cleanPhone)
    router.push('/withdraw/step3')
  }

  const handleBack = () => {
    router.push('/withdraw/step1')
  }

  return (
    <main className="space-y-4" style={{ scrollBehavior: 'smooth' }}>
      <FixedHeaderControls />
      <div className="pr-20">
        <h1 className="text-xl font-bold">{t.title}</h1>
      </div>
      
      <div className="card space-y-4">
        <div className="text-center">
          <h2 className="text-lg font-semibold">Шаг 2 из 3</h2>
          <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
            <div className="bg-accent h-2 rounded-full" style={{width: '66%'}}></div>
          </div>
        </div>

        <div ref={phoneSectionRef}>
          <label className="label">{t.phone}</label>
          <input 
            className="input w-full"
            type="tel"
            value={phone}
            onChange={handlePhoneChange}
            placeholder={t.phonePlaceholder}
          />
        </div>
        
        
        <div ref={qrSectionRef}>
          <label className="label">{t.qrCode}</label>
          <div className="relative">
            <input 
              type="file"
              accept="image/*"
              onChange={handleQrPhotoChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              id="qr-upload"
            />
            <label 
              htmlFor="qr-upload"
              className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-sky-400/30 rounded-xl bg-gradient-to-br from-slate-900/20 to-slate-800/30 hover:border-sky-400/50 hover:bg-slate-800/40 transition-all duration-300 cursor-pointer group relative"
            >
              <div className="flex flex-col items-center space-y-2">
                <div className="w-8 h-8 rounded-full bg-sky-500/20 flex items-center justify-center group-hover:bg-sky-500/30 transition-colors">
                  <svg className="w-4 h-4 text-sky-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-white group-hover:text-sky-300 transition-colors">
                    {qrPhoto ? 'Файл выбран' : t.uploadQr}
                  </p>
                  <p className="text-xs text-white/60 mt-1">
                    {qrPhoto ? qrPhoto.name : 'PNG, JPG до 20MB'}
                  </p>
                </div>
              </div>
            </label>
          </div>
          
          {qrPhotoPreview && (
            <div className="mt-4 p-4 bg-black/20 rounded-xl border border-sky-400/20">
              <div className="text-center mb-3">
                <span className="text-sm text-sky-300 font-medium">Предварительный просмотр:</span>
              </div>
              <div className="flex justify-center">
                <img 
                  src={qrPhotoPreview} 
                  alt="QR Preview" 
                  className="max-w-xs max-h-48 rounded-lg shadow-lg border border-sky-400/30"
                />
              </div>
            </div>
          )}
        </div>
        
        <div className="flex gap-2">
          <button 
            className="btn btn-ghost flex-1"
            onClick={handleBack}
          >
            {t.back}
          </button>
          <button 
            className="btn btn-primary flex-1"
            onClick={handleNext}
            disabled={!bank || !qrPhotoPreview || phone.replace(/[^\d]/g, '').length < 12}
          >
            {t.next}
          </button>
        </div>
      </div>
    </main>
  )
}

