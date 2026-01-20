import { NextRequest } from 'next/server'
import { verifyToken, TokenPayload } from './auth'

export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export function getAuthUser(request: NextRequest): TokenPayload | null {
  // Сначала проверяем заголовок Authorization (Bearer токен)
  const authHeader = request.headers.get('authorization')
  let token: string | null = null
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7) // Убираем "Bearer "
  } else {
    // Если нет в заголовке, проверяем cookie
    token = request.cookies.get('auth_token')?.value || null
  }

  if (!token) {
    return null
  }

  return verifyToken(token)
}

export function createApiResponse<T>(
  data?: T,
  error?: string,
  message?: string
): ApiResponse<T> {
  if (error) {
    return { success: false, error }
  }
  return { success: true, data, message }
}

export function requireAuth(request: NextRequest): TokenPayload {
  const user = getAuthUser(request)
  if (!user) {
    throw new Error('Unauthorized')
  }
  return user
}

