import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const projectId = params.get("projectId") ?? ""
  const type = params.get("type")
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(projectId)) {
    return new Response("Not found", { status: 404 })
  }

  const asset =
    type === "video"
      ? { file: "final.mp4", contentType: "video/mp4" }
      : type === "thumbnail"
        ? { file: "thumbnail.png", contentType: "image/png" }
        : null
  if (!asset) return new Response("Not found", { status: 404 })

  const outputRoot = path.resolve(
    process.cwd(),
    "public",
    "news-clips",
    "output"
  )
  const filePath = path.resolve(outputRoot, projectId, asset.file)
  if (!filePath.startsWith(`${outputRoot}${path.sep}`)) {
    return new Response("Not found", { status: 404 })
  }

  let fileSize = 0
  try {
    fileSize = (await stat(filePath)).size
  } catch {
    return new Response("Not found", { status: 404 })
  }

  const requestedName = params.get("name") ?? asset.file
  const extension = path.extname(asset.file)
  const safeName = downloadFileName(requestedName, extension, asset.file)
  const stream = createReadStream(filePath)
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${asset.file}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "Content-Length": String(fileSize),
      "Content-Type": asset.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  })
}

function downloadFileName(value: string, extension: string, fallback: string) {
  const cleaned = value
    .replace(/[\r\n"\\/]/g, "")
    .trim()
    .slice(0, 120)
  if (!cleaned) return fallback
  return cleaned.toLowerCase().endsWith(extension) ? cleaned : `${cleaned}${extension}`
}
