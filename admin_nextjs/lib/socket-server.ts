import { Server as SocketIOServer } from 'socket.io'

// Получаем Socket.IO сервер из global (инициализируется в server.js)
export function getSocketIO(): SocketIOServer | null {
  if (typeof global !== 'undefined' && (global as any).io) {
    return (global as any).io as SocketIOServer
  }
  return null
}

// Функция для отправки событий пользователю
export function emitToUser(userId: string, event: string, data: any) {
  const io = getSocketIO()
  if (!io) {
    console.warn('⚠️ Socket.IO server not initialized')
    return
  }
  
  const room = `user:${userId}`
  io.to(room).emit(event, data)
  console.log(`📤 Socket.IO: Emitted ${event} to ${room}`)
}

// Функция для отправки события всем подключенным клиентам
export function emitToAll(event: string, data: any) {
  const io = getSocketIO()
  if (!io) {
    console.warn('⚠️ Socket.IO server not initialized')
    return
  }
  
  io.emit(event, data)
  console.log(`📤 Socket.IO: Emitted ${event} to all clients`)
}

