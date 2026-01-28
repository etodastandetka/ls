"use client"
import { useState, useEffect } from 'react'
import FixedHeaderControls from '../../components/FixedHeaderControls'

export default function FaqPage(){
  const [language, setLanguage] = useState('ru')

  useEffect(() => {
    }, [])

  const translations = {
    ru: {
      title: 'FAQ',
      depositQuestion: 'Как пополнить баланс?',
      depositAnswer: 'Перейдите в раздел «Пополнение», выберите букмекера, введите ID и сумму, затем выберите банк и следуйте инструкциям.',
      withdrawQuestion: 'Как сделать вывод?',
      withdrawAnswer: 'Откройте «Вывод», выберите букмекера и банк, укажите телефон, код с сайта и подтвердите заявку.',
      timeQuestion: 'Сколько времени занимает обработка?',
      timeAnswer: 'Обычно 5–15 минут. В часы нагрузки возможно дольше.',
      commissionQuestion: 'Есть ли комиссия?',
      commissionAnswer: 'Нет, мы не берем комиссию за пополнения и выводы.',
      limitsQuestion: 'Какие лимиты?',
      limitsAnswer: 'Минимальная сумма пополнения: 35 сом, максимальная: 500,000 сом. Минимальная сумма вывода: 100 сом, без ограничений.',
      supportQuestion: 'Как связаться с поддержкой?',
      supportAnswer: 'Напишите в поддержку: @operator_luxon_bot. Мы отвечаем в течение 5-15 минут.'
    },
    en: {
      title: 'FAQ',
      depositQuestion: 'How to deposit?',
      depositAnswer: 'Go to "Deposit" section, select bookmaker, enter ID and amount, then choose bank and follow instructions.',
      withdrawQuestion: 'How to withdraw?',
      withdrawAnswer: 'Open "Withdraw", select bookmaker and bank, specify phone, site code and confirm request.',
      timeQuestion: 'How long does processing take?',
      timeAnswer: 'Usually 5-15 minutes. During peak hours it may take longer.',
      commissionQuestion: 'Is there a commission?',
      commissionAnswer: 'No, we don\'t charge commission for deposits and withdrawals.',
      limitsQuestion: 'What are the limits?',
      limitsAnswer: 'Minimum deposit: 35 som, maximum: 500,000 som. Minimum withdrawal: 100 som, no limit.',
      supportQuestion: 'How to contact support?',
      supportAnswer: 'Write to support: @operator_luxon_bot. We respond within 5-15 minutes.'
    },
    ky: {
      title: 'Суроолор',
      depositQuestion: 'Кантип депозит кылуу?',
      depositAnswer: '«Депозит» бөлүмүнө өтүңүз, букмекерди тандаңыз, ID жана сумманы киргизиңиз, андан кийин банкты тандаңыз жана көрсөтмөлөрдү аткарыңыз.',
      withdrawQuestion: 'Кантип чыгаруу?',
      withdrawAnswer: '«Чыгаруу» бөлүмүн ачыңыз, букмекер жана банкты тандаңыз, телефон, сайт кодун көрсөтүңүз жана өтүнүчтү ырастаңыз.',
      timeQuestion: 'Канча убакыт иштетүү?',
      timeAnswer: 'Адатта 5-15 мүнөт. Жүктөө убактысында көбүрөөк болушу мүмкүн.',
      commissionQuestion: 'Комиссия барбы?',
      commissionAnswer: 'Жок, биз депозит жана чыгаруу үчүн комиссия албайбыз.',
      limitsQuestion: 'Лимиттер кандай?',
      limitsAnswer: 'Эң аз депозит суммасы: 35 сом, эң көп: 500,000 сом. Эң аз чыгаруу суммасы: 100 сом, чектөө жок.',
      supportQuestion: 'Колдоого кантип байланышуу?',
      supportAnswer: 'Колдоого жазыңыз: @operator_luxon_bot. Биз 5-15 мүнөт ичинде жооп беребиз.'
    },
    uz: {
      title: 'Savollar',
      depositQuestion: 'Qanday depozit qilish?',
      depositAnswer: '«Depozit» bo\'limiga o\'ting, bukmekerni tanlang, ID va miqdorni kiriting, keyin bankni tanlang va ko\'rsatmalarga amal qiling.',
      withdrawQuestion: 'Qanday chiqarish?',
      withdrawAnswer: '«Chiqarish» bo\'limini oching, bukmeker va bankni tanlang, telefon, sayt kodini ko\'rsating va so\'rovni tasdiqlang.',
      timeQuestion: 'Qayta ishlash qancha vaqt?',
      timeAnswer: 'Odatda 5-15 daqiqa. Yuqori yuklanish vaqtida uzoqroq bo\'lishi mumkin.',
      commissionQuestion: 'Komissiya bormi?',
      commissionAnswer: 'Yo\'q, biz depozit va chiqarish uchun komissiya olmaymiz.',
      limitsQuestion: 'Limitlar qanday?',
      limitsAnswer: 'Minimal depozit: 35 som, maksimal: 500,000 som. Minimal chiqarish: 100 som, cheklov yo\'q.',
      supportQuestion: 'Qanday qo\'llab-quvvatlash bilan bog\'lanish?',
      supportAnswer: 'Qo\'llab-quvvatlashga yozing: @operator_luxon_bot. Biz 5-15 daqiqa ichida javob beramiz.'
    }
  }

  const t = translations[language as keyof typeof translations] || translations.ru

  const faqItems = [
    {
      question: t.depositQuestion,
      answer: t.depositAnswer
    },
    {
      question: t.withdrawQuestion,
      answer: t.withdrawAnswer
    },
    {
      question: t.timeQuestion,
      answer: t.timeAnswer
    },
    {
      question: t.commissionQuestion,
      answer: t.commissionAnswer
    },
    {
      question: t.limitsQuestion,
      answer: t.limitsAnswer
    },
    {
      question: t.supportQuestion,
      answer: t.supportAnswer
    }
  ]

  return (
    <main className="space-y-4">
      <FixedHeaderControls />
      <h1 className="text-xl font-bold pr-20">{t.title}</h1>
      
      <section className="card space-y-3">
        {faqItems.map((item, index) => (
          <details key={index} className="bg-white/5 rounded-lg p-3">
            <summary className="cursor-pointer font-semibold hover:text-accent transition-colors">
              {item.question}
            </summary>
            <div className="mt-2 text-sm text-white/80">
              {item.answer}
            </div>
          </details>
        ))}
      </section>
    </main>
  )
}

