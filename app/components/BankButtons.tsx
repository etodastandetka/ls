"use client"
import { useCallback, useMemo, memo } from 'react'
import Image from 'next/image'
import { throttle } from '../utils/debounce'

type Bank = { code: string; name: string; emoji?: string; image?: string }
const ALL_BANKS: Bank[] = [
  { code: 'kompanion', name: 'Компаньон', emoji: '💼', image: '/images/companion.png' },
  { code: 'demirbank', name: 'DemirBank', emoji: '🏦', image: '/images/demirbank.jpg' },
  { code: 'omoney', name: 'O!Money', emoji: '🟡', image: '/images/omoney.jpg' },
  { code: 'balance', name: 'Balance.kg', emoji: '⚖️', image: '/images/balance.jpg' },
  { code: 'bakai', name: 'Bakai', emoji: '🏪', image: '/images/bakai.jpg' },
  { code: 'megapay', name: 'MegaPay', emoji: '💳', image: '/images/megapay.jpg' },
  { code: 'mbank', name: 'MBank', emoji: '📱', image: '/images/mbank.png' },
]

// Банки для депозитов (без Компаньона)
const DEPOSIT_BANKS: Bank[] = ALL_BANKS.filter(bank => bank.code !== 'kompanion')

// Банки для выводов (все банки включая Компаньон)
const WITHDRAWAL_BANKS: Bank[] = ALL_BANKS

function BankButtons({ onPick, selected, disabled, paymentUrl, allBankUrls, enabledBanks, compact = false }: { 
  onPick: (code: string) => void; 
  selected?: string; 
  disabled?: boolean;
  paymentUrl?: string;
  allBankUrls?: Record<string, string>;
  enabledBanks?: string[];
  compact?: boolean;
}) {
  // Определяем, это вывод (без ссылок) или депозит (со ссылками)
  // Если allBankUrls передан (даже если пустой объект), это депозит
  // Если paymentUrl передан (даже если пустая строка), это депозит
  // Только если оба не переданы (undefined), это вывод
  const isWithdrawal = allBankUrls === undefined && paymentUrl === undefined
  
  const handleBankClick = useCallback((bankCode: string) => {
    // Сначала выбираем банк
    onPick(bankCode)
    
    // Для вывода просто выбираем банк без открытия ссылок
    if (isWithdrawal) {
      console.log('🏦 Bank selected for withdrawal:', bankCode)
      return // Просто выбор, без ссылок и без ошибок
    }
    
    // Если мы здесь - это депозит, но проверяем еще раз для безопасности
    if (!paymentUrl && (!allBankUrls || Object.keys(allBankUrls).length === 0)) {
      console.log('🏦 Bank selected (no payment URLs available):', bankCode)
      return // Просто выбор, без ошибок
    }
    
    // Для депозита - ищем и открываем ссылку для оплаты
    let bankUrl = paymentUrl && paymentUrl.trim() !== '' ? paymentUrl : undefined
    
    console.log('🏦 Bank clicked for deposit:', bankCode)
    console.log('📦 All bank URLs:', allBankUrls)
    console.log('🔗 Default payment URL:', paymentUrl)
    
    if (allBankUrls) {
      // Маппинг кодов банков на возможные варианты названий в API
      // API может вернуть ключи с заглавными буквами ('DemirBank', 'O!Money') 
      // или в нижнем регистре ('demirbank', 'omoney')
      const bankMappingVariants: Record<string, string[]> = {
        'kompanion': ['Компаньон', 'kompanion', 'Kompanion'],
        'demirbank': ['DemirBank', 'demirbank', 'Demir'],
        'omoney': ['O!Money', 'omoney', 'O!Money', 'Odengi'],
        'balance': ['Balance.kg', 'balance', 'Balance'],
        'bakai': ['Bakai', 'bakai'],
        'megapay': ['MegaPay', 'megapay'],
        'mbank': ['MBank', 'mbank', 'MBank']
      }
      
      const variants = bankMappingVariants[bankCode] || [bankCode]
      console.log('🔍 Looking for bank variants:', variants)
      
      // Пробуем найти ссылку по каждому варианту ключа
      for (const variant of variants) {
        if (allBankUrls[variant]) {
          bankUrl = allBankUrls[variant]
          console.log(`✅ Found bank URL for variant "${variant}":`, bankUrl)
          break
        }
      }
      
      // Если не нашли по маппингу, пробуем напрямую по коду банка
      if (!bankUrl || bankUrl === paymentUrl) {
        if (allBankUrls[bankCode]) {
          bankUrl = allBankUrls[bankCode]
          console.log(`✅ Found bank URL by direct code "${bankCode}":`, bankUrl)
        } else {
          console.warn('⚠️ Bank URL not found for any variant of:', bankCode)
        }
      }
    }
    
    // Если есть ссылка для оплаты, открываем её
    if (bankUrl) {
      console.log('🚀 Opening URL:', bankUrl)
      // Используем Telegram WebApp API для открытия ссылки вне мини-приложения
      if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
        console.log('✅ Opening with Telegram WebApp API')
        window.Telegram.WebApp.openLink(bankUrl)
      } else {
        console.log('⚠️ Telegram WebApp not available, using fallback')
        window.open(bankUrl, '_blank')
      }
    } else {
      // Проверяем еще раз - это точно депозит?
      const hasPaymentUrl = paymentUrl && paymentUrl.trim() !== ''
      const hasAllBankUrls = allBankUrls && Object.keys(allBankUrls).length > 0
      
      if (hasPaymentUrl || hasAllBankUrls) {
        // Это депозит, но ссылка не найдена - показываем ошибку
        console.error('❌ No payment URL available for deposit!')
        alert('Ссылка для оплаты не найдена. Попробуйте обновить страницу.')
      } else {
        // Это вывод - просто выбираем банк без ошибки
        console.log('🏦 Bank selected (withdrawal, no URL needed):', bankCode)
      }
    }
  }, [onPick, isWithdrawal, paymentUrl, allBankUrls])

  // Throttle обработчик клика для предотвращения множественных кликов
  const throttledHandleBankClick = useMemo(
    () => throttle(handleBankClick, 500),
    [handleBankClick]
  )

  // Фильтруем банки согласно настройкам
  // Маппинг: код банка в компоненте -> код банка в настройках админки
  const bankMappingToAdmin: Record<string, string> = {
    'demirbank': 'demir',
    'omoney': 'omoney',
    'balance': 'balance',
    'bakai': 'bakai',
    'megapay': 'megapay',
    'mbank': 'mbank',
    'kompanion': 'kompanion' // Для выводов
  }
  
  // Обратный маппинг: код из админки -> код в компоненте
  const bankMappingFromAdmin: Record<string, string> = {
    'demir': 'demirbank',
    'demirbank': 'demirbank',
    'omoney': 'omoney',
    'balance': 'balance',
    'bakai': 'bakai',
    'megapay': 'megapay',
    'mbank': 'mbank',
    'kompanion': 'kompanion',
    'odengi': 'omoney' // O!Money для выводов
  }

  // Определяем список банков в зависимости от типа операции (депозит или вывод)
  // Для депозитов исключаем Компаньон, для выводов показываем все
  const availableBanks = isWithdrawal ? WITHDRAWAL_BANKS : DEPOSIT_BANKS

  // Фильтруем банки согласно настройкам
  // Если enabledBanks не передан (undefined), показываем все банки
  // Если enabledBanks передан (даже пустой массив), фильтруем строго
  const filteredBanks = useMemo(() => availableBanks.filter(bank => {
    // Если enabledBanks не передан вообще - показываем все
    if (enabledBanks === undefined) {
      return true
    }
    
    // Если enabledBanks передан, даже пустой - фильтруем строго
    // Проверяем, есть ли банк в списке разрешенных (учитываем оба маппинга)
    const adminCode = bankMappingToAdmin[bank.code]
    const componentCode = bankMappingFromAdmin[bank.code] || bank.code
    
    return enabledBanks.includes(adminCode) || 
           enabledBanks.includes(componentCode) || 
           enabledBanks.includes(bank.code)
  }), [enabledBanks])
  
  console.log('🏦 BankButtons - enabledBanks:', enabledBanks)
  console.log('🏦 BankButtons - filteredBanks:', filteredBanks.map(b => b.code))

  const buttonSizeClass = compact ? 'text-xs py-2 px-2.5 h-12' : 'text-sm py-3 px-4 h-16'
  const iconWrapClass = compact ? 'relative w-6 h-6' : 'relative w-8 h-8'
  const emojiClass = compact ? 'mr-1 text-base' : 'mr-1 text-xl'

  return (
    <div className={`grid grid-cols-2 ${compact ? 'gap-1.5' : 'gap-1'}`}>
      {filteredBanks.map(b => (
        <button 
          key={b.code} 
          className={`btn transition-all duration-200 flex items-center justify-center gap-3 ${buttonSizeClass} ${
            selected === b.code 
              ? 'btn-primary' 
              : 'btn-ghost'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:btn-primary'}`}
          onClick={() => !disabled && throttledHandleBankClick(b.code)}
          disabled={disabled}
        >
          {b.image ? (
            <div className={iconWrapClass}>
              <Image 
                src={b.image} 
                alt={b.name}
                fill
                sizes="32px"
                loading="lazy"
                quality={80}
                className="object-contain rounded"
              />
            </div>
          ) : (
            <span className={emojiClass}>{b.emoji}</span>
          )}
          <span className="truncate">{b.name}</span>
        </button>
      ))}
    </div>
  )
}

export default memo(BankButtons)