import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

import type { NewsSource } from "../../news-clips/types.ts"

const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"])

/**
 * 같은 원본 URL로 이미 정상 다운로드한 파일이 있으면 다시 받지 않고 재사용한다.
 * JSON에 경로만 남은 경우나 소스 폴더 밖을 가리키는 경로는 캐시로 인정하지 않는다.
 */
export async function findReusableDownloadedSource(
  value: string,
  storageRoot: string
) {
  const targetUrl = canonicalSourceUrl(value)
  if (!targetUrl) return null

  let folders
  try {
    folders = await readdir(storageRoot, { withFileTypes: true })
  } catch {
    return null
  }

  for (const folder of folders) {
    if (!folder.isDirectory() || !/^[0-9a-f-]{36}$/i.test(folder.name)) continue
    const sourceFolder = path.resolve(storageRoot, folder.name)
    try {
      const source = JSON.parse(
        await readFile(path.join(sourceFolder, "source.json"), "utf8")
      ) as NewsSource
      if (
        !source.approved ||
        source.requiresUpload ||
        !source.localFile ||
        canonicalSourceUrl(source.originalUrl) !== targetUrl
      ) {
        continue
      }
      const localFile = path.resolve(source.localFile)
      if (
        !localFile.startsWith(`${sourceFolder}${path.sep}`) ||
        !videoExtensions.has(path.extname(localFile).toLowerCase()) ||
        !existsSync(localFile)
      ) {
        continue
      }
      return source
    } catch {
      // 손상되었거나 덜 저장된 항목은 건너뛰고 다음 캐시를 확인한다.
    }
  }
  return null
}

/** 추적 파라미터가 다른 동일 YouTube 영상도 하나의 원본으로 식별한다. */
export function canonicalSourceUrl(value: string) {
  const safe = safeHttpUrl(value)
  if (!safe) return ""
  const url = new URL(safe)
  url.hash = ""
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "")
  const youtubeId = youtubeVideoId(url, hostname)
  if (youtubeId) return `https://www.youtube.com/watch?v=${youtubeId}`

  for (const key of [...url.searchParams.keys()]) {
    if (
      /^utm_/i.test(key) ||
      ["fbclid", "gclid", "dclid", "si", "feature"].includes(
        key.toLowerCase()
      )
    ) {
      url.searchParams.delete(key)
    }
  }
  url.searchParams.sort()
  url.hostname = hostname
  url.pathname =
    url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/"
  return url.toString()
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : ""
  } catch {
    return ""
  }
}

function youtubeVideoId(url: URL, hostname: string) {
  let value = ""
  if (hostname === "youtu.be") {
    value = url.pathname.split("/").filter(Boolean)[0] ?? ""
  } else if (
    hostname === "youtube.com" ||
    hostname === "m.youtube.com" ||
    hostname === "music.youtube.com" ||
    hostname === "youtube-nocookie.com"
  ) {
    const parts = url.pathname.split("/").filter(Boolean)
    value =
      parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live"
        ? parts[1] ?? ""
        : url.searchParams.get("v") ?? ""
  }
  const normalized = value.trim()
  return /^[A-Za-z0-9_-]{6,20}$/.test(normalized) ? normalized : ""
}
