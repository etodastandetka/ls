/**
 * Централизованная конфигурация приложения
 * Все значения берутся из переменных окружения с fallback на разумные значения по умолчанию
 */

/**
 * Конфигурация сервера
 */
export const SERVER_CONFIG = {
  // Порт сервера
  PORT: parseInt(process.env.PORT || process.env.ADMIN_PORT || '3001', 10),
  
  // Режим работы
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Включен ли режим отладки
  DEBUG: process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development',
} as const

/**
 * Конфигурация безопасности и rate limiting
 */
export const SECURITY_CONFIG = {
  // Rate limiting по умолчанию
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10), // 1 минута
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '60', 10),
  RATE_LIMIT_BLOCK_DURATION_MS: parseInt(process.env.RATE_LIMIT_BLOCK_DURATION_MS || '86400000', 10), // 24 часа
  
  // Очистка rate limit store
  RATE_LIMIT_CLEANUP_INTERVAL_MS: parseInt(process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS || '300000', 10), // 5 минут
  
  // Максимальный размер запроса
  MAX_REQUEST_SIZE_MB: parseInt(process.env.MAX_REQUEST_SIZE_MB || '5', 10),
  MAX_REQUEST_SIZE_BYTES: parseInt(process.env.MAX_REQUEST_SIZE_MB || '5', 10) * 1024 * 1024,
  
  // Максимальная длина параметра запроса
  MAX_PARAM_LENGTH: parseInt(process.env.MAX_PARAM_LENGTH || '1000', 10),
} as const

/**
 * Конфигурация базы данных
 */
export const DATABASE_CONFIG = {
  // Лимиты запросов
  DEFAULT_PAGE_SIZE: parseInt(process.env.DEFAULT_PAGE_SIZE || '10', 10),
  MAX_PAGE_SIZE: parseInt(process.env.MAX_PAGE_SIZE || '100', 10),
  
  // Лимит сообщений в чате
  CHAT_MESSAGES_LIMIT: parseInt(process.env.CHAT_MESSAGES_LIMIT || '50', 10),
  
  // Лимит истории транзакций
  TRANSACTION_HISTORY_LIMIT: parseInt(process.env.TRANSACTION_HISTORY_LIMIT || '50', 10),
} as const

/**
 * Конфигурация автопополнения
 */
export const AUTO_DEPOSIT_CONFIG = {
  // Окно поиска заявок (в миллисекундах)
  REQUEST_SEARCH_WINDOW_MS: parseInt(process.env.AUTO_DEPOSIT_SEARCH_WINDOW_MS || '300000', 10), // 5 минут
  
  // Максимальный "возраст" заявки (после создания), когда её ещё можно автосопоставлять с платежом
  // По умолчанию 8 часов (покрывает кейсы с задержкой оплаты ночью)
  MAX_REQUEST_AGE_MS: parseInt(process.env.AUTO_DEPOSIT_MAX_REQUEST_AGE_MS || String(8 * 60 * 60 * 1000), 10),

  // Максимальная задержка прихода платежа после создания заявки, чтобы считать его валидным для автопополнения
  // По умолчанию 8 часов
  PAYMENT_DATE_MAX_DELAY_MS: parseInt(process.env.AUTO_DEPOSIT_PAYMENT_MAX_DELAY_MS || String(8 * 60 * 60 * 1000), 10),
  
  // Задержка уведомления о депозите (в миллисекундах)
  DELAYED_NOTIFICATION_MS: parseInt(process.env.DELAYED_NOTIFICATION_MS || '60000', 10), // 1 минута
  
  // Таймаут проверки автопополнения (в миллисекундах)
  CHECK_TIMEOUT_MS: parseInt(process.env.AUTO_DEPOSIT_CHECK_TIMEOUT_MS || '300000', 10), // 5 минут
} as const

/**
 * Конфигурация депозитов
 */
export const DEPOSIT_CONFIG = {
  // Минимальная сумма депозита (по умолчанию)
  MIN_DEPOSIT_AMOUNT: parseFloat(process.env.MIN_DEPOSIT_AMOUNT || '35'),
  
  // Минимальная сумма депозита для 1win
  MIN_DEPOSIT_AMOUNT_1WIN: parseFloat(process.env.MIN_DEPOSIT_AMOUNT_1WIN || '100'),
  
  // Минимальная сумма депозита для Mostbet
  MIN_DEPOSIT_AMOUNT_MOSTBET: parseFloat(process.env.MIN_DEPOSIT_AMOUNT_MOSTBET || '400'),
  
  // Максимальная сумма депозита
  MAX_DEPOSIT_AMOUNT: parseFloat(process.env.MAX_DEPOSIT_AMOUNT || '100000'),
  
  // Время на оплату депозита (в секундах)
  DEPOSIT_TIMEOUT_SECONDS: parseInt(process.env.DEPOSIT_TIMEOUT_SECONDS || '300', 10), // 5 минут
} as const

/**
 * Конфигурация чата
 */
export const CHAT_CONFIG = {
  // Интервал обновления чата (в миллисекундах)
  REFRESH_INTERVAL_MS: parseInt(process.env.CHAT_REFRESH_INTERVAL_MS || '3000', 10), // 3 секунды
  
  // Лимит сообщений при загрузке
  MESSAGES_LIMIT: parseInt(process.env.CHAT_MESSAGES_LIMIT || '50', 10),
} as const

/**
 * Конфигурация файлов
 */
export const FILE_CONFIG = {
  // Максимальный размер файла (в байтах)
  MAX_FILE_SIZE_BYTES: parseInt(process.env.MAX_FILE_SIZE_BYTES || '10485760', 10), // 10 MB
  
  // Максимальный размер файла (в MB)
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10),
  
  // Разрешенные типы файлов для загрузки
  ALLOWED_FILE_TYPES: process.env.ALLOWED_FILE_TYPES?.split(',') || [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/ogg',
    'application/pdf',
  ],
} as const

/**
 * Конфигурация реферальной системы
 */
export const REFERRAL_CONFIG = {
  // Лимит топ игроков
  TOP_PLAYERS_LIMIT: parseInt(process.env.TOP_PLAYERS_LIMIT || '10', 10),
  
  // Лимит лидерборда
  LEADERBOARD_LIMIT: parseInt(process.env.LEADERBOARD_LIMIT || '100', 10),
} as const

/**
 * Конфигурация таймеров и интервалов
 */
export const TIMER_CONFIG = {
  // Интервал обновления дашборда (в миллисекундах)
  DASHBOARD_REFRESH_INTERVAL_MS: parseInt(process.env.DASHBOARD_REFRESH_INTERVAL_MS || '5000', 10), // 5 секунд
  
  // Интервал проверки заявок (в миллисекундах)
  REQUESTS_CHECK_INTERVAL_MS: parseInt(process.env.REQUESTS_CHECK_INTERVAL_MS || '3000', 10), // 3 секунды
} as const

/**
 * Конфигурация API endpoints
 */
export const API_CONFIG = {
  // Таймаут запросов к внешним API (в миллисекундах)
  EXTERNAL_API_TIMEOUT_MS: parseInt(process.env.EXTERNAL_API_TIMEOUT_MS || '30000', 10), // 30 секунд
  
  // Количество повторных попыток при ошибке
  RETRY_ATTEMPTS: parseInt(process.env.API_RETRY_ATTEMPTS || '3', 10),
  
  // Задержка между попытками (в миллисекундах)
  RETRY_DELAY_MS: parseInt(process.env.API_RETRY_DELAY_MS || '1000', 10), // 1 секунда
} as const

/**
 * Получить все конфигурации
 */
export function getAppConfig() {
  return {
    server: SERVER_CONFIG,
    security: SECURITY_CONFIG,
    database: DATABASE_CONFIG,
    autoDeposit: AUTO_DEPOSIT_CONFIG,
    deposit: DEPOSIT_CONFIG,
    chat: CHAT_CONFIG,
    file: FILE_CONFIG,
    referral: REFERRAL_CONFIG,
    timer: TIMER_CONFIG,
    api: API_CONFIG,
  }
}

