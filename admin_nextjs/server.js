const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { Server } = require('socket.io')

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = parseInt(process.env.PORT || '3001', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('Error occurred handling', req.url, err)
      res.statusCode = 500
      res.end('internal server error')
    }
  })

  // Инициализируем Socket.IO
  const io = new Server(httpServer, {
    path: '/api/socket/io',
    cors: {
      origin: process.env.NEXT_PUBLIC_API_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  })

  // Middleware для аутентификации
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || 
                  socket.handshake.headers?.authorization?.replace('Bearer ', '')
    
    if (!token) {
      return next(new Error('Authentication error: No token provided'))
    }

    try {
      // Импортируем verifyToken динамически
      const { verifyToken } = require('./lib/auth')
      const user = verifyToken(token)
      if (!user) {
        return next(new Error('Authentication error: Invalid token'))
      }
      socket.data.user = user
      next()
    } catch (error) {
      next(new Error('Authentication error: Token verification failed'))
    }
  })

  io.on('connection', (socket) => {
    console.log(`✅ Socket.IO: Client connected: ${socket.id}`)

    socket.on('subscribe:user', (userId) => {
      const room = `user:${userId}`
      socket.join(room)
      console.log(`📨 Socket.IO: Client ${socket.id} subscribed to ${room}`)
    })

    socket.on('unsubscribe:user', (userId) => {
      const room = `user:${userId}`
      socket.leave(room)
      console.log(`📨 Socket.IO: Client ${socket.id} unsubscribed from ${room}`)
    })

    socket.on('disconnect', () => {
      console.log(`❌ Socket.IO: Client disconnected: ${socket.id}`)
    })
  })

  // Экспортируем io для использования в API routes
  global.io = io

  httpServer
    .once('error', (err) => {
      console.error(err)
      process.exit(1)
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`)
    })
})




