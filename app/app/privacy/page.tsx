"use client"
import { useLanguage } from '../../components/LanguageContext'
import FixedHeaderControls from '../../components/FixedHeaderControls'
import { BackIcon } from '../../components/Icons'
import LuxonLogo from '../../components/LuxonLogo'

export default function PrivacyPage() {
  const { language } = useLanguage()

  const translations = {
    ru: {
      title: 'Политика конфиденциальности',
      lastUpdated: 'Последнее обновление: 10 ноября 2025',
      introduction: {
        title: '1. Введение',
        content: 'LUXON — это сервис для пополнения и вывода средств через Telegram бота. Настоящая Политика конфиденциальности описывает, как мы собираем, используем, храним и защищаем ваши персональные данные.'
      },
      dataCollection: {
        title: '2. Сбор данных',
        content: 'Мы собираем следующие данные для предоставления наших услуг:',
        items: [
          'Telegram ID пользователя — уникальный идентификатор в Telegram',
          'Имя и фамилия — из профиля Telegram',
          'Username (если указан) — для связи и идентификации',
          'ID игрока — для обработки заявок',
          'Номер телефона — для вывода средств на банковские карты',
          'Фото чеков об оплате — для подтверждения транзакций',
          'История транзакций — все операции пополнения и вывода',
          'Реферальные данные — информация о реферальной программе'
        ]
      },
      dataUsage: {
        title: '3. Использование данных',
        content: 'Ваши данные используются исключительно для:',
        items: [
          'Обработки заявок на пополнение и вывод средств',
          'Связи с вами по вопросам транзакций',
          'Работы реферальной программы',
          'Улучшения качества сервиса',
          'Технической поддержки и решения проблем',
          'Соблюдения требований безопасности'
        ]
      },
      dataStorage: {
        title: '4. Хранение данных',
        content: 'Все данные хранятся на защищенных серверах с использованием современных методов шифрования. Данные хранятся в течение срока, необходимого для предоставления услуг, или до момента удаления аккаунта пользователем.'
      },
      thirdParty: {
        title: '5. Передача данных третьим лицам',
        content: 'Мы передаем данные только в следующих случаях:',
        items: [
          'Партнерам — для обработки заявок на пополнение и вывод (ID игрока, сумма)',
          'Банкам и платежным системам — для обработки платежей (номер телефона, сумма)',
          'По требованию законодательства — при наличии официального запроса от уполномоченных органов'
        ],
        note: 'Мы не продаем и не передаем ваши данные в маркетинговых целях.'
      },
      userRights: {
        title: '6. Права пользователей',
        content: 'Вы имеете право:',
        items: [
          'Получить доступ к своим персональным данным',
          'Исправить неточные данные',
          'Запросить удаление ваших данных',
          'Отозвать согласие на обработку данных',
          'Подать жалобу в случае нарушения ваших прав'
        ],
        contact: 'Для реализации этих прав свяжитесь с нами через поддержку: @operator_luxon_bot'
      },
      security: {
        title: '7. Безопасность',
        content: 'Мы применяем следующие меры безопасности:',
        items: [
          'Шифрование данных при передаче (HTTPS)',
          'Защита серверов от несанкционированного доступа',
          'Регулярное обновление систем безопасности',
          'Ограниченный доступ к данным только для уполномоченных сотрудников',
          'Резервное копирование данных'
        ]
      },
      cookies: {
        title: '8. Cookies и технологии отслеживания',
        content: 'Наш сервис использует минимальное количество технических данных для работы Telegram WebApp. Мы не используем сторонние cookies или системы отслеживания для рекламы. Все данные используются исключительно для функциональности сервиса.'
      },
      changes: {
        title: '9. Изменения в политике',
        content: 'Мы оставляем за собой право вносить изменения в настоящую Политику конфиденциальности. О существенных изменениях мы уведомим пользователей через бота или на сайте. Продолжение использования сервиса после изменений означает ваше согласие с новой версией политики.'
      },
      contacts: {
        title: '10. Контакты',
        content: 'Если у вас есть вопросы по поводу обработки ваших персональных данных или вы хотите реализовать свои права, свяжитесь с нами:',
        telegram: 'Telegram: @operator_luxon_bot',
        responseTime: 'Время ответа: 5-30 минут'
      },
      backToMain: 'На главную'
    },
    ky: {
      title: 'Купуялык саясаты',
      lastUpdated: 'Акыркы жаңылоо: 10 ноябрь 2025',
      introduction: {
        title: '1. Кирүү',
        content: 'LUXON — бул Telegram бот аркылуу каражаттарды толтуруу жана чыгаруу үчүн кызмат. Бул Купуялык саясаты биздин жеке маалыматтарды кантип топтоп, колдонуп, сактап жана коргой турганыбызды сүрөттөйт.'
      },
      dataCollection: {
        title: '2. Маалыматтарды топтоо',
        content: 'Биз кызматтарды көрсөтүү үчүн төмөнкү маалыматтарды топтойбуз:',
        items: [
          'Колдонуучунун Telegram ID — Telegramдагы уникалдуу идентификатор',
          'Аты жана фамилиясы — Telegram профилинен',
          'Username (белгиленсе) — байланыш жана идентификация үчүн',
          'Оюнчунун ID — өтүнүчтөрдү иштетүү үчүн',
          'Телефон номуру — банктык карталарга каражаттарды чыгаруу үчүн',
          'Төлөм квитанциясынын фотосу — транзакцияларды ырастоо үчүн',
          'Транзакциялардын тарыхы — бардык толтуруу жана чыгаруу амалдары',
          'Рефералдык маалыматтар — рефералдык программа жөнүндө маалымат'
        ]
      },
      dataUsage: {
        title: '3. Маалыматтарды колдонуу',
        content: 'Сиздин маалыматтардыз гана төмөнкү максаттар үчүн колдонулат:',
        items: [
          'Каражаттарды толтуруу жана чыгаруу өтүнүчтөрүн иштетүү',
          'Транзакциялар боюнча сиз менен байланышуу',
          'Рефералдык программанын иштеши',
          'Кызматтын сапатын жакшыртуу',
          'Техникалык колдоо жана көйгөйлөрдү чечүү',
          'Коопсуздук талаптарын сактау'
        ]
      },
      dataStorage: {
        title: '4. Маалыматтарды сактоо',
        content: 'Бардык маалыматтар заманбап шифрлөө ыкмаларын колдонуп, корголгон серверлерде сакталат. Маалыматтар кызматтарды көрсөтүү үчүн зарыл болгон мөөнөттө же колдонуучу аккаунтту өчүргөнгө чейин сакталат.'
      },
      thirdParty: {
        title: '5. Үчүнчү тарапка маалыматтарды берүү',
        content: 'Биз маалыматтарды гана төмөнкү учурларда беребиз:',
        items: [
          'Партнерлерге — толтуруу жана чыгаруу өтүнүчтөрүн иштетүү үчүн (оюнчунун ID, сумма)',
          'Банктарга жана төлөм системаларына — төлөмдөрдү иштетүү үчүн (телефон номуру, сумма)',
          'Мыйзам талабы боюнча — уруксат берилген органдардан расмий суроо болгондо'
        ],
        note: 'Биз сиздин маалыматтарыңызды сатууга же маркетинг максатында берүүгө жол бербейбиз.'
      },
      userRights: {
        title: '6. Колдонуучунун укуктары',
        content: 'Сизде төмөнкү укуктар бар:',
        items: [
          'Өз жеке маалыматтарыңызга кирүү',
          'Туура эмес маалыматтарды оңдоо',
          'Маалыматтарыңызды өчүрүүнү суроо',
          'Маалыматтарды иштетүүгө макулдугун кайтарып алуу',
          'Укуктарыңыз бузулган учурда арыз берүү'
        ],
        contact: 'Бул укуктарды ишке ашыруу үчүн биз менен байланышыңыз: @operator_luxon_bot'
      },
      security: {
        title: '7. Коопсуздук',
        content: 'Биз төмөнкү коопсуздук чараларын колдонобуз:',
        items: [
          'Маалыматтарды берүүдө шифрлөө (HTTPS)',
          'Серверлерди уруксатсыз кирүүдөн коргоо',
          'Коопсуздук системаларын тез-тез жаңылоо',
          'Маалыматтарга кирүүнү гана уруксат берилген кызматкерлерге чектөө',
          'Маалыматтарды резервдик көчүрүү'
        ]
      },
      cookies: {
        title: '8. Cookies жана көзөмөлдөө технологиялары',
        content: 'Биздин кызмат Telegram WebAppтин иштеши үчүн минималдуу техникалык маалыматтарды колдонот. Биз реклама үчүн үчүнчү тараптын cookies же көзөмөлдөө системаларын колдонбойбуз. Бардык маалыматтар гана кызматтын функционалдуулугу үчүн колдонулат.'
      },
      changes: {
        title: '9. Саясаттагы өзгөрүүлөр',
        content: 'Биз бул Купуялык саясатына өзгөрүүлөр киргизүү укугун өзүбүзгө калтырабыз. Маанилүү өзгөрүүлөр жөнүндө биз колдонуучуларды бот аркылуу же сайтта эскертебиз. Өзгөрүүлөрдөн кийин кызматты колдонууну улантуу жаңы саясаттын версиясына макулдугуңузду билдирет.'
      },
      contacts: {
        title: '10. Байланыштар',
        content: 'Эгерде сиздин жеке маалыматтарыңызды иштетүү жөнүндө суроолоруңуз болсо же укуктарыңызды ишке ашыргыңыз келсе, биз менен байланышыңыз:',
        telegram: 'Telegram: @operator_luxon_bot',
        responseTime: 'Жооп берүү убактысы: 5-30 мүнөт'
      },
      backToMain: 'Башкы баракка'
    },
    uz: {
      title: 'Maxfiylik siyosati',
      lastUpdated: 'Oxirgi yangilanish: 10 noyabr 2025',
      introduction: {
        title: '1. Kirish',
        content: 'LUXON — bu Telegram bot orqali bukmekerlik kontorlariga mablag\'larni to\'ldirish va chiqarish uchun xizmat. Ushbu Maxfiylik siyosati bizning shaxsiy ma\'lumotlarni qanday to\'playmiz, ishlatamiz, saqlaymiz va himoya qilamizligini tasvirlaydi.'
      },
      dataCollection: {
        title: '2. Ma\'lumotlarni to\'plash',
        content: 'Biz xizmatlarni ko\'rsatish uchun quyidagi ma\'lumotlarni to\'playmiz:',
        items: [
          'Foydalanuvchining Telegram ID — Telegramdagi noyob identifikator',
          'Ism va familiya — Telegram profilidan',
          'Username (ko\'rsatilgan bo\'lsa) — aloqa va identifikatsiya uchun',
          'Bukmekerlik kontoridagi o\'yinchining ID — so\'rovlarni qayta ishlash uchun',
          'Telefon raqami — bank kartalariga mablag\'larni chiqarish uchun',
          'To\'lov kvitansiyasining fotosi — tranzaksiyalarni tasdiqlash uchun',
          'Tranzaksiyalar tarixi — barcha to\'ldirish va chiqarish operatsiyalari',
          'Referal ma\'lumotlari — referal dastur haqida ma\'lumot'
        ]
      },
      dataUsage: {
        title: '3. Ma\'lumotlardan foydalanish',
        content: 'Sizning ma\'lumotlaringiz faqat quyidagi maqsadlar uchun ishlatiladi:',
        items: [
          'Mablag\'larni to\'ldirish va chiqarish so\'rovlarini qayta ishlash',
          'Tranzaksiyalar bo\'yicha siz bilan aloqaga chiqish',
          'Referal dasturining ishlashi',
          'Xizmat sifatini yaxshilash',
          'Texnik yordam va muammolarni hal qilish',
          'Xavfsizlik talablariga rioya qilish'
        ]
      },
      dataStorage: {
        title: '4. Ma\'lumotlarni saqlash',
        content: 'Barcha ma\'lumotlar zamonaviy shifrlash usullaridan foydalangan holda himoyalangan serverlarda saqlanadi. Ma\'lumotlar xizmatlarni ko\'rsatish uchun zarur bo\'lgan muddat davomida yoki foydalanuvchi hisobni o\'chirguncha saqlanadi.'
      },
      thirdParty: {
        title: '5. Uchinchi tomonlarga ma\'lumotlarni uzatish',
        content: 'Biz ma\'lumotlarni faqat quyidagi hollarda uzatamiz:',
        items: [
          'Bukmekerlik kontorlariga — to\'ldirish va chiqarish so\'rovlarini qayta ishlash uchun (o\'yinchining ID, summa)',
          'Banklar va to\'lov tizimlariga — to\'lovlarni qayta ishlash uchun (telefon raqami, summa)',
          'Qonunchilik talabiga binoan — vakolatli organlardan rasmiy so\'rov bo\'lganda'
        ],
        note: 'Biz sizning ma\'lumotlaringizni sotmaymiz yoki marketing maqsadida uzatmaymiz.'
      },
      userRights: {
        title: '6. Foydalanuvchi huquqlari',
        content: 'Sizda quyidagi huquqlar bor:',
        items: [
          'O\'z shaxsiy ma\'lumotlaringizga kirish',
          'Noto\'g\'ri ma\'lumotlarni tuzatish',
          'Ma\'lumotlaringizni o\'chirishni so\'rash',
          'Ma\'lumotlarni qayta ishlashga roziligingizni qaytarib olish',
          'Huquqlaringiz buzilgan taqdirda shikoyat qilish'
        ],
        contact: 'Ushbu huquqlarni amalga oshirish uchun biz bilan bog\'laning: @operator_luxon_bot'
      },
      security: {
        title: '7. Xavfsizlik',
        content: 'Biz quyidagi xavfsizlik choralarini qo\'llaymiz:',
        items: [
          'Ma\'lumotlarni uzatishda shifrlash (HTTPS)',
          'Serverlarni ruxsatsiz kirishdan himoya qilish',
          'Xavfsizlik tizimlarini muntazam yangilash',
          'Ma\'lumotlarga kirishni faqat vakolatli xodimlarga cheklash',
          'Ma\'lumotlarni zaxiralash'
        ]
      },
      cookies: {
        title: '8. Cookies va kuzatish texnologiyalari',
        content: 'Bizning xizmatimiz Telegram WebAppning ishlashi uchun minimal miqdordagi texnik ma\'lumotlardan foydalanadi. Biz reklama uchun uchinchi tomonning cookies yoki kuzatish tizimlaridan foydalanmaymiz. Barcha ma\'lumotlar faqat xizmatning funksionalligi uchun ishlatiladi.'
      },
      changes: {
        title: '9. Siyosatdagi o\'zgarishlar',
        content: 'Biz ushbu Maxfiylik siyosatiga o\'zgarishlar kiritish huquqini o\'zimizga qoldiramiz. Muhim o\'zgarishlar haqida biz foydalanuvchilarni bot orqali yoki saytda xabardor qilamiz. O\'zgarishlardan keyin xizmatdan foydalanishni davom ettirish yangi siyosat versiyasiga roziligingizni bildiradi.'
      },
      contacts: {
        title: '10. Aloqalar',
        content: 'Agar sizning shaxsiy ma\'lumotlaringizni qayta ishlash bo\'yicha savollaringiz bo\'lsa yoki huquqlaringizni amalga oshirmoqchi bo\'lsangiz, biz bilan bog\'laning:',
        telegram: 'Telegram: @operator_luxon_bot',
        responseTime: 'Javob berish vaqti: 5-30 daqiqa'
      },
      backToMain: 'Bosh sahifaga'
    }
  }

  const t = translations[language as keyof typeof translations] || translations.ru

  return (
    <main className="space-y-6 pb-8">
      <FixedHeaderControls />
      
      {/* Заголовок с логотипом */}
      <div className="text-center space-y-4 fade-in">
        <div className="flex justify-center">
          <LuxonLogo size="lg" />
        </div>
        <h1 className="text-3xl font-bold text-white">{t.title}</h1>
        <p className="text-sm text-white/60">{t.lastUpdated}</p>
      </div>

      {/* Основной контент */}
      <div className="space-y-4">
        {/* Введение */}
        <div className="card slide-in-left delay-100">
          <h2 className="text-xl font-bold text-white mb-3">{t.introduction.title}</h2>
          <p className="text-white/80 leading-relaxed">{t.introduction.content}</p>
        </div>

        {/* Сбор данных */}
        <div className="card slide-in-left delay-200">
          <h2 className="text-xl font-bold text-white mb-3">{t.dataCollection.title}</h2>
          <p className="text-white/80 mb-3">{t.dataCollection.content}</p>
          <ul className="space-y-2">
            {t.dataCollection.items.map((item, index) => (
              <li key={index} className="text-white/70 flex items-start gap-2">
                <span className="text-green-400 mt-1">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Использование данных */}
        <div className="card slide-in-left delay-300">
          <h2 className="text-xl font-bold text-white mb-3">{t.dataUsage.title}</h2>
          <p className="text-white/80 mb-3">{t.dataUsage.content}</p>
          <ul className="space-y-2">
            {t.dataUsage.items.map((item, index) => (
              <li key={index} className="text-white/70 flex items-start gap-2">
                <span className="text-green-400 mt-1">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Хранение данных */}
        <div className="card slide-in-left delay-400">
          <h2 className="text-xl font-bold text-white mb-3">{t.dataStorage.title}</h2>
          <p className="text-white/80 leading-relaxed">{t.dataStorage.content}</p>
        </div>

        {/* Передача данных третьим лицам */}
        <div className="card slide-in-left delay-500">
          <h2 className="text-xl font-bold text-white mb-3">{t.thirdParty.title}</h2>
          <p className="text-white/80 mb-3">{t.thirdParty.content}</p>
          <ul className="space-y-2 mb-3">
            {t.thirdParty.items.map((item, index) => (
              <li key={index} className="text-white/70 flex items-start gap-2">
                <span className="text-green-400 mt-1">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-white/70 italic">{t.thirdParty.note}</p>
        </div>

        {/* Права пользователей */}
        <div className="card slide-in-left delay-600">
          <h2 className="text-xl font-bold text-white mb-3">{t.userRights.title}</h2>
          <p className="text-white/80 mb-3">{t.userRights.content}</p>
          <ul className="space-y-2 mb-3">
            {t.userRights.items.map((item, index) => (
              <li key={index} className="text-white/70 flex items-start gap-2">
                <span className="text-green-400 mt-1">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-white/70">{t.userRights.contact}</p>
        </div>

        {/* Безопасность */}
        <div className="card slide-in-left delay-700">
          <h2 className="text-xl font-bold text-white mb-3">{t.security.title}</h2>
          <p className="text-white/80 mb-3">{t.security.content}</p>
          <ul className="space-y-2">
            {t.security.items.map((item, index) => (
              <li key={index} className="text-white/70 flex items-start gap-2">
                <span className="text-green-400 mt-1">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Cookies */}
        <div className="card slide-in-left delay-800">
          <h2 className="text-xl font-bold text-white mb-3">{t.cookies.title}</h2>
          <p className="text-white/80 leading-relaxed">{t.cookies.content}</p>
        </div>

        {/* Изменения в политике */}
        <div className="card slide-in-left delay-900">
          <h2 className="text-xl font-bold text-white mb-3">{t.changes.title}</h2>
          <p className="text-white/80 leading-relaxed">{t.changes.content}</p>
        </div>

        {/* Контакты */}
        <div className="card slide-in-left delay-1000">
          <h2 className="text-xl font-bold text-white mb-3">{t.contacts.title}</h2>
          <p className="text-white/80 mb-3">{t.contacts.content}</p>
          <div className="space-y-2">
            <p className="text-green-400 font-semibold">{t.contacts.telegram}</p>
            <p className="text-white/60 text-sm">{t.contacts.responseTime}</p>
          </div>
        </div>
      </div>

      {/* Кнопка назад */}
      <div className="text-center">
        <a 
          href="/" 
          className="inline-flex items-center gap-2 btn btn-ghost px-6 py-3 rounded-lg font-semibold transition-all"
        >
          <BackIcon className="w-5 h-5" />
          {t.backToMain}
        </a>
      </div>
    </main>
  )
}

