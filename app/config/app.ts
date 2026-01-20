/**
 * Минимальная конфигурация приложения для клиентского сайта
 */

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

