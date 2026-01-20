/**
 * Централизованная конфигурация приложения для клиентского сайта
 * Все значения берутся из переменных окружения с fallback на разумные значения по умолчанию
 */

/**
 * Конфигурация сервера
 */
export const SERVER_CONFIG = {
  // Порт сервера
  PORT: parseInt(process.env.PORT || process.env.CLIENT_PORT || '3000', 10),
  
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
 * Конфигурация депозитов
 */
export const DEPOSIT_CONFIG = {
  // Время на оплату депозита (в секундах)
  TIMEOUT_SECONDS: parseInt(process.env.DEPOSIT_TIMEOUT_SECONDS || '300', 10), // 5 минут
  
  // Минимальная сумма депозита
  MIN_AMOUNT: parseFloat(process.env.MIN_DEPOSIT_AMOUNT || '35'),
  
  // Максимальная сумма депозита
  MAX_AMOUNT: parseFloat(process.env.MAX_DEPOSIT_AMOUNT || '100000'),
} as const
/**
 * Конфигурация API запросов
 */
export const API_CONFIG = {
  // Таймаут запросов (в миллисекундах)
  TIMEOUT_MS: parseInt(process.env.API_TIMEOUT_MS || '30000', 10), // 30 секунд
  
  // Количество повторных попыток при ошибке
  RETRY_ATTEMPTS: parseInt(process.env.API_RETRY_ATTEMPTS || '3', 10),
  
  // Задержка между попытками (в миллисекундах)
  RETRY_DELAY_MS: parseInt(process.env.API_RETRY_DELAY_MS || '1000', 10), // 1 секунда
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
  ],
} as const

/**
 * Конфигурация таймеров
 */
export const TIMER_CONFIG = {
  // Интервал обновления данных (в миллисекундах)
  REFRESH_INTERVAL_MS: parseInt(process.env.REFRESH_INTERVAL_MS || '5000', 10), // 5 секунд
} as const

/**
 * Получить все конфигурации
 */
export function getAppConfig() {
  return {
    server: SERVER_CONFIG,
    deposit: DEPOSIT_CONFIG,
    api: API_CONFIG,
    file: FILE_CONFIG,
    timer: TIMER_CONFIG,
  }
}


