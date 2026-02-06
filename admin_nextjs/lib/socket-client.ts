'use client'

import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocketClient(): Socket | null {
  if (typeof window === 'undefined') {
    return null
  }

  if (socket?.connected) {
    return socket
  }

  // Получаем токен из cookie
  const getToken = () => {
    const cookies = document.cookie.split(';')
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=')
      if (name === 'auth_token') {
        return decodeURIComponent(value)
      }
    }
    return null
  }

  const token = getToken()
  if (!token) {
    console.warn('⚠️ No auth token found for Socket.IO connection')
    return null
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || window.location.origin

  socket = io(apiUrl, {
    path: '/api/socket/io',
    auth: {
      token,
    },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
  })

  socket.on('connect', () => {
    console.log('✅ Socket.IO: Connected to server')
  })

  socket.on('disconnect', () => {
    console.log('❌ Socket.IO: Disconnected from server')
  })

  socket.on('connect_error', (error) => {
    console.error('❌ Socket.IO: Connection error:', error)
  })

  return socket
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

