import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import { readSource } from "@/lib/server/news-clips/source-store"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const sourceId = new URL(request.url).searchParams.get("sourceId") ?? ""
  const source = await readSource(sourceId)
  const root = path.resolve(process.cwd(), "outputs", "news-clips")
  const localFile = source?.localFile ? path.resolve(source.localFile) : ""
  if (
    !source?.approved ||
    !localFile ||
    !localFile.startsWith(`${root}${path.sep}`)
  ) {
    return new Response("Not found", { status: 404 })
  }

  let fileSize = 0
  try {
    fileSize = (await stat(localFile)).size
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const contentType = videoContentType(path.extname(localFile).toLowerCase())
  const range = parseByteRange(request.headers.get("range"), fileSize)
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${fileSize}` },
    })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? fileSize - 1
  const stream = createReadStream(localFile, { start, end })
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: range ? 206 : 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Length": String(end - start + 1),
      "Content-Type": contentType,
      ...(range
        ? { "Content-Range": `bytes ${start}-${end}/${fileSize}` }
        : {}),
    },
  })
}

function parseByteRange(value: string | null, fileSize: number) {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match) return "invalid" as const
  const hasStart = Boolean(match[1])
  const requestedStart = hasStart ? Number(match[1]) : 0
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1
  const start = hasStart ? requestedStart : Math.max(0, fileSize - requestedEnd)
  const end = hasStart ? Math.min(fileSize - 1, requestedEnd) : fileSize - 1
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize ||
    (!hasStart && requestedEnd <= 0)
  ) {
    return "invalid" as const
  }
  return { start, end }
}

function videoContentType(extension: string) {
  if (extension === ".webm") return "video/webm"
  if (extension === ".mov") return "video/quicktime"
  if (extension === ".mkv") return "video/x-matroska"
  if (extension === ".m4v") return "video/x-m4v"
  return "video/mp4"
}
