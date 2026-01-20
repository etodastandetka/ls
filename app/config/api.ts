/**
 * Unified API Configuration
 * Centralized configuration for all API endpoints
 * Uses environment variables and centralized domain config
 */

import { getAdminApiUrl } from './domains'

// Используем централизованную конфигурацию доменов
const ADMIN_API_BASE_URL = getAdminApiUrl()

/**
 * API endpoint URLs
 */
export const API_URLS = {
  BASE: ADMIN_API_BASE_URL,
  // Используем локальный endpoint для рефералов (в клиентском сайте)
  REFERRAL_DATA: typeof window !== 'undefined' 
    ? `${window.location.origin}/api/public/referral-data` 
    : '/api/public/referral-data',
  TRANSACTION_HISTORY: `${ADMIN_API_BASE_URL}/api/transaction-history/`,
  REQUISITES_LIST: `${ADMIN_API_BASE_URL}/api/public/requisites/list/`,
  PAYMENT: `${ADMIN_API_BASE_URL}/api/payment`,
  PAYMENT_SETTINGS: `${ADMIN_API_BASE_URL}/api/public/payment-settings`,
  LEADERBOARD: `${ADMIN_API_BASE_URL}/api/public/leaderboard`,
} as const

/**
 * Get the base API URL
 * @returns Base URL for API requests
 */
export function getApiBase(): string {
  return ADMIN_API_BASE_URL
}

export default API_URLS

