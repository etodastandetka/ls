"use client"
import { useEffect } from 'react'
import { useLanguage } from '../../components/LanguageContext'
import FixedHeaderControls from '../../components/FixedHeaderControls'
import { InstructionIcon, DepositIcon, WithdrawIcon, SupportIcon, BackIcon } from '../../components/Icons'
import { useRouter } from 'next/navigation'

export default function InstructionPage() {
  const { language } = useLanguage()
  const router = useRouter()

  useEffect(() => {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('[data-step-reveal="true"]'))
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            obs.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.2, rootMargin: '0px 0px -10% 0px' }
    )

    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  const translations = {
    ru: {
      title: 'Инструкция',
      subtitle: 'Пошаговое руководство по использованию платформы',
      depositTitle: '💰 Пополнение счета',
      depositSubtitle: 'Как пополнить баланс в казино',
      depositSteps: [
        {
          number: '1',
          title: 'Выбор букмекера',
          description: 'Выберите казино из списка: 1XBET, 1WIN, MELBET, MOSTBET, WINWIN, 888STARZ'
        },
        {
          number: '2',
          title: 'Ввод ID игрока',
          description: 'Введите ваш ID игрока в казино. ID можно найти в личном кабинете букмекера'
        },
        {
          number: '3',
          title: 'Указание суммы',
          description: 'Укажите сумму пополнения (лимиты указаны в форме)'
        },
        {
          number: '4',
          title: 'Выбор банка и QR',
          description: 'Выберите банк и отсканируйте QR-код для оплаты'
        },
        {
          number: '5',
          title: 'Оплата и чек',
          description: 'Оплатите в приложении банка и загрузите фото чека'
        },
        {
          number: '6',
          title: 'Подтверждение',
          description: 'Нажмите «Оплатил» и дождитесь пополнения (обычно 1-5 минут)'
        }
      ],
      withdrawTitle: '💸 Вывод средств',
      withdrawSubtitle: 'Как вывести средства с баланса казино',
      withdrawSteps: [
        {
          number: '1',
          title: 'Выбор букмекера',
          description: 'Выберите казино, с баланса которого хотите вывести средства'
        },
        {
          number: '2',
          title: 'Выбор банка',
          description: 'Выберите банк для получения средств'
        },
        {
          number: '3',
          title: 'Номер телефона',
          description: 'Введите номер телефона для получения средств (в формате +996XXXXXXXXX)'
        },
        {
          number: '4',
          title: 'QR-код кошелька',
          description: 'Загрузите фото QR-кода кошелька'
        },
        {
          number: '5',
          title: 'Код подтверждения',
          description: 'Введите код подтверждения с сайта букмекера'
        },
        {
          number: '6',
          title: 'Ожидание',
          description: 'Ожидайте подтверждения администратора (обычно 5-30 минут)'
        }
      ],
      importantTitle: '⚠️ Важные замечания',
      importantNotes: [
        {
          icon: '🔒',
          text: 'Все операции проходят через администратора для вашей безопасности'
        },
        {
          icon: '⏱️',
          text: 'Время обработки операций: 5-30 минут в рабочее время'
        },
        {
          icon: '💬',
          text: 'При возникновении проблем обращайтесь в поддержку @operator_luxon_bot'
        },
        {
          icon: '📸',
          text: 'Сохраняйте скриншоты всех операций для подтверждения'
        },
        {
          icon: '🚫',
          text: 'Никогда не передавайте коды подтверждения третьим лицам'
        },
        {
          icon: '✅',
          text: 'Проверяйте правильность введенных данных перед отправкой заявки'
        }
      ],
      supportTitle: '💬 Поддержка',
      supportText: 'Если у вас возникли вопросы или проблемы, наша служба поддержки всегда готова помочь:',
      supportContact: '@operator_luxon_bot',
      backToMain: 'На главную'
    },
    en: {
      title: 'Instruction',
      subtitle: 'Step-by-step guide to using the platform',
      depositTitle: '💰 Account Deposit',
      depositSubtitle: 'How to deposit funds to casino',
      depositSteps: [
        {
          number: '1',
          title: 'Choose bookmaker',
          description: 'Select a casino from the list: 1XBET, 1WIN, MELBET, MOSTBET, WINWIN, 888STARZ'
        },
        {
          number: '2',
          title: 'Enter player ID',
          description: 'Enter your player ID in the casino. You can find ID in your bookmaker account'
        },
        {
          number: '3',
          title: 'Specify amount',
          description: 'Specify the deposit amount (limits are shown in the form)'
        },
        {
          number: '4',
          title: 'Choose bank and QR',
          description: 'Select a bank and scan the QR code for payment'
        },
        {
          number: '5',
          title: 'Payment and receipt',
          description: 'Pay in your banking app and upload the receipt photo'
        },
        {
          number: '6',
          title: 'Confirmation',
          description: 'Tap “Paid” and wait for crediting (usually 1-5 minutes)'
        }
      ],
      withdrawTitle: '💸 Withdraw Funds',
      withdrawSubtitle: 'How to withdraw funds from casino balance',
      withdrawSteps: [
        {
          number: '1',
          title: 'Choose bookmaker',
          description: 'Select a casino from whose balance you want to withdraw funds'
        },
        {
          number: '2',
          title: 'Choose bank',
          description: 'Select a bank to receive funds'
        },
        {
          number: '3',
          title: 'Phone number',
          description: 'Enter phone number to receive funds (format: +996XXXXXXXXX)'
        },
        {
          number: '4',
          title: 'Wallet QR code',
          description: 'Upload a photo of your wallet QR code'
        },
        {
          number: '5',
          title: 'Confirmation code',
          description: 'Enter confirmation code from bookmaker website'
        },
        {
          number: '6',
          title: 'Wait',
          description: 'Wait for administrator confirmation (usually 5-30 minutes)'
        }
      ],
      importantTitle: '⚠️ Important Notes',
      importantNotes: [
        {
          icon: '🔒',
          text: 'All operations go through administrator for your security'
        },
        {
          icon: '⏱️',
          text: 'Processing time: 5-30 minutes during business hours'
        },
        {
          icon: '💬',
          text: 'If you have problems, contact support @operator_luxon_bot'
        },
        {
          icon: '📸',
          text: 'Save screenshots of all operations for confirmation'
        },
        {
          icon: '🚫',
          text: 'Never share confirmation codes with third parties'
        },
        {
          icon: '✅',
          text: 'Check the correctness of entered data before submitting request'
        }
      ],
      supportTitle: '💬 Support',
      supportText: 'If you have questions or problems, our support team is always ready to help:',
      supportContact: '@operator_luxon_bot',
      backToMain: 'Back to main'
    }
  }

  const t = translations[language as keyof typeof translations] || translations.ru

  return (
    <main className="space-y-6 pb-6">
      <FixedHeaderControls />
      
      {/* Заголовок */}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <InstructionIcon className="w-6 h-6 text-white" />
          <h1 className="text-2xl font-bold text-white pr-20">{t.title}</h1>
        </div>
        <p className="text-sm text-white/70">{t.subtitle}</p>
      </div>

      {/* Пополнение */}
      <section className="card space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-white/10">
          <DepositIcon className="w-6 h-6 text-sky-300" />
          <div>
            <h2 className="text-xl font-bold text-white">{t.depositTitle}</h2>
            <p className="text-sm text-white/60">{t.depositSubtitle}</p>
          </div>
        </div>
        
        <div className="space-y-4">
          {t.depositSteps.map((step, index) => (
            <div
              key={index}
              data-step-reveal="true"
              className="step-reveal flex items-start gap-4 p-4 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors"
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-full flex items-center justify-center text-lg font-bold shadow-lg">
                {step.number}
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-white mb-1">{step.title}</h3>
                <p className="text-sm text-white/80 leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Вывод */}
      <section className="card space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-white/10">
          <WithdrawIcon className="w-6 h-6 text-blue-400" />
          <div>
            <h2 className="text-xl font-bold text-white">{t.withdrawTitle}</h2>
            <p className="text-sm text-white/60">{t.withdrawSubtitle}</p>
          </div>
        </div>
        
        <div className="space-y-4">
          {t.withdrawSteps.map((step, index) => (
            <div
              key={index}
              data-step-reveal="true"
              className="step-reveal flex items-start gap-4 p-4 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors"
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-sky-500 to-blue-600 text-white rounded-full flex items-center justify-center text-lg font-bold shadow-lg">
                {step.number}
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-white mb-1">{step.title}</h3>
                <p className="text-sm text-white/80 leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Важные замечания */}
      <section className="card space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-white/10">
          <svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-xl font-bold text-white">{t.importantTitle}</h2>
        </div>
        <div className="space-y-3">
          {t.importantNotes.map((note, index) => (
            <div
              key={index}
              data-step-reveal="true"
              className="step-reveal flex items-start gap-3 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/20"
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <span className="text-2xl flex-shrink-0">{note.icon}</span>
              <p className="text-sm text-white/90 leading-relaxed flex-1">{note.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Поддержка */}
      <section className="card space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-white/10">
          <SupportIcon className="w-6 h-6 text-orange-400" />
          <h2 className="text-xl font-bold text-white">{t.supportTitle}</h2>
        </div>
        <p className="text-sm text-white/80 leading-relaxed">{t.supportText}</p>
        <a 
          href="https://t.me/operator_luxon_bot" 
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg hover:shadow-xl"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.297 1.545-1.507 5.295-2.128 7.02-.317 1.02-.617 1.36-1.012 1.39-.34.027-.936-.18-1.297-.33-.574-.19-1.01-.31-1.45-.63-.64-.4-1.12-.93-1.56-.98-.44-.05-1.01.03-1.57.05-.54.02-1.18-.03-1.85-.12-.67-.09-1.28-.14-1.77-.28-.49-.14-1.17-.34-1.01-.72.16-.38.48-.77.84-1.08 2.9-2.58 6.07-5.15 8.54-7.4.39-.36.78-.75 1.17-1.14.13-.13.25-.26.37-.39.19-.2.4-.42.63-.6.23-.18.47-.33.7-.48.23-.15.46-.28.68-.4.22-.12.43-.22.63-.3.2-.08.39-.14.57-.18.18-.04.35-.06.51-.06.16 0 .31.02.45.06.14.04.27.1.39.18.12.08.23.18.33.3.1.12.18.26.25.42.07.16.12.34.16.54.04.2.07.42.09.66.02.24.03.5.03.78 0 .28-.01.58-.03.9-.02.32-.05.66-.09 1.02z"/>
          </svg>
          {t.supportContact}
        </a>
      </section>

      {/* Навигация */}
      <div className="text-center">
        <button
          onClick={() => router.push('/')}
          className="inline-flex items-center gap-2 bg-gray-600/80 text-white px-6 py-3 rounded-lg font-semibold hover:bg-gray-600 transition-colors"
        >
          <BackIcon className="w-5 h-5" />
          {t.backToMain}
        </button>
      </div>
    </main>
  )
}

