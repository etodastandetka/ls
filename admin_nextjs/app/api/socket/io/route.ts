import { NextRequest } from 'next/server'

// Этот route используется Socket.IO для установки соединения
// Socket.IO обрабатывает этот путь автоматически через middleware
export async function GET(request: NextRequest) {
  return new Response('Socket.IO endpoint', { status: 200 })
}




