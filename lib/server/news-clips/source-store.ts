import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { ffmpegBin } from "@/lib/server/ffmpeg-bin"
import type {
  NewsCandidateMetrics,
  NewsSource,
  NewsSourceKind,
} from "@/lib/news-clips/types"

const root = path.join(process.cwd(), "outputs", "news-clips")
const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"])
const subtitleExtensions = new Set([".srt", ".vtt", ".txt"])

export async function createUploadedSource(input: {
  file: File
  subtitle?: File | null
  title: string
  channel: string
  originalUrl: string
}) {
  const extension = path.extname(input.file.name).toLowerCase()
  if (
    !videoExtensions.has(extension) ||
    input.file.size === 0 ||
    input.file.size > 4 * 1024 * 1024 * 1024
  ) {
    throw new Error("unsupported-video")
  }
  const id = randomUUID()
  const folder = path.join(root, id)
  await mkdir(folder, { recursive: true })
  const localFile = path.join(folder, `source${extension}`)
  await writeFile(localFile, new Uint8Array(await input.file.arrayBuffer()))
  if (input.subtitle && input.subtitle.size > 0) {
    const subtitleExtension = path.extname(input.subtitle.name).toLowerCase()
    if (
      !subtitleExtensions.has(subtitleExtension) ||
      input.subtitle.size > 20 * 1024 * 1024
    ) {
      throw new Error("unsupported-subtitle")
    }
    await writeFile(
      path.join(folder, `transcript${subtitleExtension}`),
      new Uint8Array(await input.subtitle.arrayBuffer())
    )
  }
  const source: NewsSource = {
    id,
    kind: "upload",
    title: input.title.trim() || path.basename(input.file.name, extension),
    channel: input.channel.trim() || "사용자 원본",
    publishedAt: "",
    durationSeconds: 0,
    viewCount: 0,
    commentCount: 0,
    originalUrl: input.originalUrl.trim(),
    summary: "업로드한 원본 영상",
    localFile,
    approved: true,
    requiresUpload: false,
    searchMetrics: null,
  }
  await writeSource(source)
  return source
}

export async function createRemoteSource(input: {
  url: string
  title: string
  channel: string
  summary: string
  kind?: NewsSourceKind
  publishedAt?: string
  durationSeconds?: number
  viewCount?: number
  commentCount?: number
  searchMetrics?: NewsCandidateMetrics | null
}) {
  const url = safeHttpUrl(input.url)
  if (!url) throw new Error("invalid-url")
  const source: NewsSource = {
    id: randomUUID(),
    kind: input.kind === "search" ? "search" : "youtube",
    title: input.title.trim() || "원본 뉴스 영상",
    channel: input.channel.trim() || "채널 정보 없음",
    publishedAt: input.publishedAt ?? "",
    durationSeconds: input.durationSeconds ?? 0,
    viewCount: input.viewCount ?? 0,
    commentCount: input.commentCount ?? 0,
    originalUrl: url,
    summary: input.summary.trim(),
    localFile: "",
    approved: true,
    requiresUpload: true,
    searchMetrics: input.searchMetrics ?? null,
  }
  await writeSource(source)
  return source
}

export async function downloadApprovedSource(id: string) {
  const source = await readSource(id)
  if (!source?.approved || source.localFile) return source
  const bin = ytDlpBin()
  const folder = path.join(root, id)
  await mkdir(folder, { recursive: true })
  try {
    await run(bin, [
      "--no-playlist",
      "--no-warnings",
      "--js-runtimes",
      "node",
      "--ffmpeg-location",
      ffmpegBin(),
      "--merge-output-format",
      "mp4",
      "--write-info-json",
      "-f",
      "bv*[height<=1080]+ba/b[height<=1080]",
      "-o",
      path.join(folder, "source.%(ext)s"),
      source.originalUrl,
    ])
  } catch {
    await copyDownloadedSubtitle(folder)
    return source
  }
  await downloadSubtitles(bin, folder, source.originalUrl)
  await copyDownloadedSubtitle(folder)
  const files = await readdir(folder)
  const downloaded = files.find(
    (file) =>
      file.startsWith("source.") && videoExtensions.has(path.extname(file))
  )
  if (!downloaded) return source
  const metadata = await readDownloadedMetadata(folder)
  const next = {
    ...source,
    title: metadata.title || source.title,
    channel: metadata.channel || source.channel,
    summary: metadata.description || source.summary,
    publishedAt: metadata.publishedAt || source.publishedAt,
    durationSeconds: metadata.durationSeconds || source.durationSeconds,
    viewCount: metadata.viewCount || source.viewCount,
    commentCount: metadata.commentCount || source.commentCount,
    localFile: path.join(folder, downloaded),
    requiresUpload: false,
  }
  await writeSource(next)
  return next
}

async function readDownloadedMetadata(folder: string) {
  try {
    const value = JSON.parse(
      await readFile(path.join(folder, "source.info.json"), "utf8")
    ) as Record<string, unknown>
    return {
      title: stringMetadata(value.title),
      channel: stringMetadata(value.channel) || stringMetadata(value.uploader),
      description: stringMetadata(value.description).slice(0, 1200),
      publishedAt: metadataDate(value.timestamp, value.upload_date),
      durationSeconds: numberMetadata(value.duration),
      viewCount: numberMetadata(value.view_count),
      commentCount: numberMetadata(value.comment_count),
    }
  } catch {
    return {
      title: "",
      channel: "",
      description: "",
      publishedAt: "",
      durationSeconds: 0,
      viewCount: 0,
      commentCount: 0,
    }
  }
}

function stringMetadata(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function numberMetadata(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function metadataDate(timestamp: unknown, uploadDate: unknown) {
  const seconds = numberMetadata(timestamp)
  if (seconds > 0) return new Date(seconds * 1000).toISOString()
  const compact = stringMetadata(uploadDate)
  const match = compact.match(/^(20\d{2})(\d{2})(\d{2})$/)
  return match
    ? new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      ).toISOString()
    : ""
}

async function downloadSubtitles(bin: string, folder: string, url: string) {
  for (const languages of ["ko.*,ko", "en.*,en"]) {
    try {
      await run(bin, [
        "--no-playlist",
        "--no-warnings",
        "--js-runtimes",
        "node",
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs",
        languages,
        "--sub-format",
        "srt/vtt/best",
        "-o",
        path.join(folder, "source.%(ext)s"),
        url,
      ])
    } catch {
      // A subtitle rate limit must not discard an already downloaded video.
    }
    if (await copyDownloadedSubtitle(folder)) return
  }
}

async function copyDownloadedSubtitle(folder: string) {
  let files: string[] = []
  try {
    files = await readdir(folder)
  } catch {
    return false
  }
  const downloadedSubtitle = files
    .filter(
      (file) =>
        file.startsWith("source.") &&
        subtitleExtensions.has(path.extname(file).toLowerCase())
    )
    .sort((left, right) => subtitleRank(left) - subtitleRank(right))[0]
  if (!downloadedSubtitle) return false
  const extension = path.extname(downloadedSubtitle).toLowerCase()
  await copyFile(
    path.join(folder, downloadedSubtitle),
    path.join(folder, `transcript${extension}`)
  )
  return true
}

function ytDlpBin() {
  const fromEnv = process.env.YTDLP_BIN?.trim()
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const standalone = path.join(process.cwd(), ".tools", "yt-dlp")
  if (existsSync(standalone)) return standalone
  const pythonPackage = path.join(
    process.cwd(),
    ".tools",
    "yt-dlp-venv",
    "bin",
    "yt-dlp"
  )
  return existsSync(pythonPackage) ? pythonPackage : "yt-dlp"
}

function subtitleRank(file: string) {
  const normalized = file.toLowerCase()
  if (/\.ko(?:[-_.]|$)/.test(normalized)) return 0
  if (/\.en(?:[-_.]|$)/.test(normalized)) return 1
  return 2
}

export async function readSource(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  try {
    return JSON.parse(
      await readFile(path.join(root, id, "source.json"), "utf8")
    ) as NewsSource
  } catch {
    return null
  }
}

export async function readStoredTranscript(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const folder = path.join(root, id)
  for (const extension of subtitleExtensions) {
    try {
      return await readFile(path.join(folder, `transcript${extension}`), "utf8")
    } catch {
      // Try the next supported sidecar.
    }
  }
  try {
    const fallback = (await readdir(folder))
      .filter(
        (file) =>
          file.startsWith("source.") &&
          subtitleExtensions.has(path.extname(file).toLowerCase())
      )
      .sort((left, right) => subtitleRank(left) - subtitleRank(right))[0]
    return fallback ? await readFile(path.join(folder, fallback), "utf8") : null
  } catch {
    return null
  }
}

export async function writeStoredTranscript(id: string, transcript: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !transcript.trim()) return
  const folder = path.join(root, id)
  await mkdir(folder, { recursive: true })
  await writeFile(path.join(folder, "transcript.srt"), transcript)
}

export async function readAnalysisCache(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  try {
    return JSON.parse(
      await readFile(path.join(root, id, "analysis.json"), "utf8")
    ) as unknown
  } catch {
    return null
  }
}

export async function writeAnalysisCache(id: string, value: unknown) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return
  const folder = path.join(root, id)
  await mkdir(folder, { recursive: true })
  await writeFile(
    path.join(folder, "analysis.json"),
    `${JSON.stringify(value, null, 2)}\n`
  )
}

async function writeSource(source: NewsSource) {
  const folder = path.join(root, source.id)
  await mkdir(folder, { recursive: true })
  await writeFile(
    path.join(folder, "source.json"),
    `${JSON.stringify(source, null, 2)}\n`
  )
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

function run(bin: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore" })
    child.on("error", () => reject(new Error("download-unavailable")))
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("download-failed"))
    )
  })
}
