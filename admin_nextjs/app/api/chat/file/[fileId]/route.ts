import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import mime from 'mime-types'

export async function GET(
  _req: NextRequest,
  { params }: { params: { fileId: string } }
) {
  try {
    const uploadDir = path.join(process.cwd(), 'tmp', 'chat_uploads')
    const filePath = path.join(uploadDir, params.fileId)

    // Без выхода за директорию
    const normalized = path.normalize(filePath)
    if (!normalized.startsWith(uploadDir)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const exists = await fs.promises
      .access(normalized, fs.constants.R_OK)
      .then(() => true)
      .catch(() => false)

    if (!exists) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const fileBuffer = await fs.promises.readFile(normalized)
    const contentType = mime.lookup(normalized) || 'application/octet-stream'

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType.toString(),
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    })
  } catch (error) {
    console.error('File serve error:', error)
    return NextResponse.json({ error: 'Failed to fetch file' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'









































































