import { randomUUID } from "node:crypto"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { selectPreferredStoredTranscript } from "@/lib/news-clips/transcript-storage"
import { ffmpegBin } from "@/lib/server/ffmpeg-bin"
import {
  LICENSED_WEB_IMAGE_MAX_BYTES,
  validateLicensedWebImageDownload,
} from "@/lib/server/news-clips/licensed-web-image"
import { findReusableDownloadedSource } from "@/lib/server/news-clips/source-cache"
import type { WikimediaCommonsImage } from "@/lib/server/news-clips/wikimedia-commons"
import {
  youtubeSubtitleDownloadArgs,
  youtubeVideoDownloadArgs,
  ytDlpFailureKind,
} from "@/lib/server/news-clips/ytdlp-options"
import type {
  NewsCandidateMetrics,
  NewsSource,
  NewsSourceKind,
} from "@/lib/news-clips/types"

const root = path.join(process.cwd(), "outputs", "news-clips")
const videoExtensions = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"])
const imageMimeByExtension = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
])
const subtitleExtensions = new Set([".srt", ".vtt", ".txt"])
const timedTranscriptExtensions = [".srt", ".vtt"] as const
const IMAGE_SOURCE_DURATION_SECONDS = 12

/** 공개 라이선스 이미지를 기존 영상 UI·FFmpeg가 읽는 12초 무음 MP4로 만든다. */
export async function createLicensedWebImageSource(
  candidate: WikimediaCommonsImage
): Promise<NewsSource> {
  const preferredImageUrl = candidate.previewUrl || candidate.downloadUrl
  const candidateValidation = validateLicensedWebImageDownload({
    url: preferredImageUrl,
    declaredMimeType: candidate.mimeType,
  })
  if (!candidateValidation.ok) throw new Error(candidateValidation.reason)

  const response = await fetchLicensedWebImage(candidateValidation.url)
  const responseLength = Number(response.headers.get("content-length") || 0)
  const responseValidation = validateLicensedWebImageDownload({
    url: response.url || candidateValidation.url,
    declaredMimeType: candidateValidation.mimeType,
    responseMimeType: response.headers.get("content-type") || "",
    contentLength: responseLength,
  })
  if (!responseValidation.ok) throw new Error(responseValidation.reason)

  const bytes = await readLimitedWebImage(response)
  if (!imageSignatureMatches(bytes, responseValidation.mimeType)) {
    throw new Error("unsupported-web-image")
  }

  const id = randomUUID()
  const folder = path.join(root, id)
  await mkdir(folder, { recursive: true })
  const imageFile = path.join(
    folder,
    `source-image${responseValidation.extension}`
  )
  const localFile = path.join(folder, "source.mp4")
  await writeFile(imageFile, bytes)
  try {
    await renderImageSourceVideo(imageFile, localFile, "cover")
  } catch {
    throw new Error("web-image-conversion-failed")
  }

  const attribution = [
    candidate.author,
    candidate.license.name,
    "Wikimedia Commons",
  ]
    .filter(Boolean)
    .join(" · ")
  const source: NewsSource = {
    id,
    kind: "web",
    mediaType: "image",
    title: candidate.title.trim() || "공개 라이선스 이미지",
    channel: "Wikimedia Commons",
    provider: "wikimedia_commons",
    publishedAt: "",
    durationSeconds: IMAGE_SOURCE_DURATION_SECONDS,
    viewCount: 0,
    commentCount: 0,
    originalUrl: candidate.pageUrl,
    pageUrl: candidate.pageUrl,
    thumbnailUrl: candidate.previewUrl || candidate.downloadUrl,
    creator: candidate.author,
    licenseName: candidate.license.name,
    licenseUrl: candidate.license.url,
    attribution,
    summary:
      candidate.descriptionKo ||
      candidate.descriptionEn ||
      "Wikimedia Commons 공개 라이선스 이미지",
    localFile,
    approved: true,
    requiresUpload: false,
    searchMetrics: null,
  }
  await writeSource(source)
  return source
}

export async function createUploadedSource(input: {
  file: File
  subtitle?: File | null
  title: string
  channel: string
  originalUrl: string
}) {
  const extension = path.extname(input.file.name).toLowerCase()
  const imageMimeType = imageMimeByExtension.get(extension)
  const isImage = Boolean(imageMimeType)
  const maximumBytes = isImage ? 30 * 1024 * 1024 : 4 * 1024 * 1024 * 1024
  if (
    (!isImage && !videoExtensions.has(extension)) ||
    input.file.size === 0 ||
    input.file.size > maximumBytes
  ) {
    throw new Error(isImage ? "unsupported-image" : "unsupported-video")
  }
  const id = randomUUID()
  const folder = path.join(root, id)
  await mkdir(folder, { recursive: true })
  const bytes = Buffer.from(await input.file.arrayBuffer())
  let localFile = path.join(folder, `source${extension}`)
  if (isImage && imageMimeType) {
    if (!imageSignatureMatches(bytes, imageMimeType)) {
      throw new Error("unsupported-image")
    }
    const imageFile = path.join(folder, `source-image${extension}`)
    localFile = path.join(folder, "source.mp4")
    await writeFile(imageFile, bytes)
    try {
      // 사용자 첨부는 원본 비율을 유지하고 여백으로 맞춘다.
      await renderImageSourceVideo(imageFile, localFile, "contain")
    } catch {
      throw new Error("image-conversion-failed")
    }
  } else {
    await writeFile(localFile, bytes)
  }
  if (!isImage && input.subtitle && input.subtitle.size > 0) {
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
    mediaType: isImage ? "image" : "video",
    provider: "user_upload",
    title: input.title.trim() || path.basename(input.file.name, extension),
    channel: input.channel.trim() || "사용자 첨부",
    publishedAt: "",
    durationSeconds: isImage ? IMAGE_SOURCE_DURATION_SECONDS : 0,
    viewCount: 0,
    commentCount: 0,
    originalUrl: input.originalUrl.trim(),
    summary: isImage ? "업로드한 이미지" : "업로드한 영상",
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
  const reusable = await findReusableDownloadedSource(url, root)
  if (reusable) {
    const next: NewsSource = {
      ...reusable,
      kind: input.kind === "search" ? "search" : "youtube",
      mediaType: "video",
      provider: input.kind === "search" ? "youtube_search" : "youtube",
      title: reusable.title || input.title.trim() || "원본 뉴스 영상",
      channel: reusable.channel || input.channel.trim() || "채널 정보 없음",
      publishedAt: reusable.publishedAt || input.publishedAt || "",
      durationSeconds: reusable.durationSeconds || input.durationSeconds || 0,
      viewCount: reusable.viewCount || input.viewCount || 0,
      commentCount: reusable.commentCount || input.commentCount || 0,
      summary: reusable.summary || input.summary.trim(),
      approved: true,
      requiresUpload: false,
      searchMetrics: input.searchMetrics ?? reusable.searchMetrics ?? null,
    }
    await writeSource(next)
    return next
  }
  const source: NewsSource = {
    id: randomUUID(),
    kind: input.kind === "search" ? "search" : "youtube",
    mediaType: "video",
    provider: input.kind === "search" ? "youtube_search" : "youtube",
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

export async function downloadApprovedSource(
  id: string,
  options: { onProgress?: (percent: number) => void | Promise<void> } = {}
) {
  const source = await readSource(id)
  if (!source?.approved || source.localFile) return source
  const folder = path.join(root, id)
  await mkdir(folder, { recursive: true })
  try {
    await runYtDlp(
      youtubeVideoDownloadArgs({
        folder,
        url: source.originalUrl,
        ffmpegPath: ffmpegBin(),
      }),
      options.onProgress
    )
  } catch (error) {
    await copyDownloadedSubtitle(folder)
    throw error
  }
  await downloadSubtitles(folder, source.originalUrl)
  await copyDownloadedSubtitle(folder)
  const files = await readdir(folder)
  const downloaded = files.find(
    (file) =>
      file.startsWith("source.") && videoExtensions.has(path.extname(file))
  )
  if (!downloaded) throw new Error("video-download-failed")
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

async function downloadSubtitles(folder: string, url: string) {
  for (const languages of ["ko.*,ko", "en.*,en"]) {
    try {
      await runYtDlp(youtubeSubtitleDownloadArgs({ folder, url, languages }))
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

function ytDlpBins() {
  const bins: string[] = []
  const fromEnv = process.env.YTDLP_BIN?.trim()
  if (fromEnv && existsSync(fromEnv)) bins.push(fromEnv)
  const standalone = path.join(process.cwd(), ".tools", "yt-dlp")
  if (existsSync(standalone)) bins.push(standalone)
  const pythonPackage = path.join(
    process.cwd(),
    ".tools",
    "yt-dlp-venv",
    "bin",
    "yt-dlp"
  )
  if (existsSync(pythonPackage)) bins.push(pythonPackage)
  bins.push("yt-dlp")
  return [...new Set(bins)]
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
  const generated = await readOptionalTranscriptFile(
    path.join(folder, "transcript.json")
  )
  const originalTimed = await readFirstTranscriptFile(
    timedTranscriptExtensions.map((extension) =>
      path.join(folder, `transcript${extension}`)
    )
  )
  const originalPlain = await readOptionalTranscriptFile(
    path.join(folder, "transcript.txt")
  )
  const downloadedFilename = await findDownloadedTranscriptFilename(folder)
  const downloadedOriginal = downloadedFilename
    ? await readOptionalTranscriptFile(path.join(folder, downloadedFilename))
    : null
  const downloadedIsTimed = transcriptHasTimedFilename(downloadedFilename ?? "")
  return selectPreferredStoredTranscript({
    originalTimed:
      originalTimed || (downloadedIsTimed ? downloadedOriginal : null),
    originalPlain:
      originalPlain || (!downloadedIsTimed ? downloadedOriginal : null),
    generated,
  })
}

async function readOptionalTranscriptFile(filename: string) {
  try {
    return await readFile(filename, "utf8")
  } catch {
    return null
  }
}

async function readFirstTranscriptFile(filenames: string[]) {
  for (const filename of filenames) {
    const transcript = await readOptionalTranscriptFile(filename)
    if (transcript?.trim()) return transcript
  }
  return null
}

async function findDownloadedTranscriptFilename(folder: string) {
  try {
    return (await readdir(folder))
      .filter(
        (file) =>
          file.startsWith("source.") &&
          subtitleExtensions.has(path.extname(file).toLowerCase())
      )
      .sort((left, right) => subtitleRank(left) - subtitleRank(right))[0]
  } catch {
    return undefined
  }
}

function transcriptHasTimedFilename(filename: string) {
  const extension = path.extname(filename).toLowerCase()
  return extension === ".srt" || extension === ".vtt"
}

export async function writeStoredTranscript(id: string, transcript: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !transcript.trim()) return
  const folder = path.join(root, id)
  await mkdir(folder, { recursive: true })
  await writeFile(
    path.join(
      folder,
      transcriptIsTimestampJson(transcript)
        ? "transcript.json"
        : "transcript.srt"
    ),
    transcript
  )
}

function transcriptIsTimestampJson(value: string) {
  const text = value.trim()
  if (!text.startsWith("{") && !text.startsWith("[")) return false
  try {
    const parsed = JSON.parse(text) as { segments?: unknown }
    return Array.isArray(parsed?.segments)
  } catch {
    return false
  }
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

async function fetchLicensedWebImage(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(url, {
      headers: { Accept: "image/jpeg,image/png,image/webp" },
      redirect: "error",
      signal: controller.signal,
    })
    if (!response.ok) throw new Error("web-image-download-failed")
    return response
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "web-image-download-failed"
    ) {
      throw error
    }
    throw new Error("web-image-download-failed")
  } finally {
    clearTimeout(timeout)
  }
}

async function readLimitedWebImage(response: Response) {
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > LICENSED_WEB_IMAGE_MAX_BYTES) {
      throw new Error("web-image-too-large")
    }
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > LICENSED_WEB_IMAGE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new Error("web-image-too-large")
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

function imageSignatureMatches(bytes: Buffer, mimeType: string) {
  if (mimeType === "image/jpeg") {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    )
  }
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
  }
  if (mimeType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    )
  }
  if (mimeType === "image/gif") {
    if (bytes.length < 6) return false
    const header = bytes.subarray(0, 6).toString("ascii")
    return header === "GIF87a" || header === "GIF89a"
  }
  return false
}

function renderImageSourceVideo(
  imageFile: string,
  outputFile: string,
  fit: "contain" | "cover" = "cover"
) {
  const isGif = path.extname(imageFile).toLowerCase() === ".gif"
  // contain: 원본 비율 유지(여백/크롭 없음). 최종 배치에서 프레임에 맞춘다.
  const containVf =
    "fps=30,scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1"
  // GIF는 애니메이션을 유지한다.
  if (isGif) {
    const gifVf =
      fit === "contain"
        ? containVf
        : "fps=30,scale=2560:1440:force_original_aspect_ratio=increase:force_divisible_by=2,crop=2560:1440,setsar=1"
    return run(ffmpegBin(), [
      "-y",
      "-stream_loop",
      "-1",
      "-i",
      imageFile,
      "-t",
      String(IMAGE_SOURCE_DURATION_SECONDS),
      "-vf",
      gifVf,
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputFile,
    ])
  }
  if (fit === "contain") {
    return run(ffmpegBin(), [
      "-y",
      "-framerate",
      "30",
      "-loop",
      "1",
      "-i",
      imageFile,
      "-t",
      String(IMAGE_SOURCE_DURATION_SECONDS),
      "-vf",
      containVf,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outputFile,
    ])
  }
  return run(ffmpegBin(), [
    "-y",
    "-framerate",
    "30",
    "-loop",
    "1",
    "-i",
    imageFile,
    "-t",
    String(IMAGE_SOURCE_DURATION_SECONDS),
    "-vf",
    "scale=2560:1440:force_original_aspect_ratio=increase:force_divisible_by=2,crop=2560:1440,zoompan=z='min(1+on*0.00014,1.05)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:s=1280x720:fps=30,setsar=1",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputFile,
  ])
}

async function runYtDlp(
  args: string[],
  onProgress?: (percent: number) => void | Promise<void>
) {
  let retryableFailure = false
  for (const bin of ytDlpBins()) {
    try {
      await run(bin, args, onProgress)
      return
    } catch (error) {
      const details =
        error instanceof ProcessFailure ? error.details : String(error)
      const failureKind = ytDlpFailureKind(details)
      if (failureKind === "video-unavailable") {
        throw new Error("video-unavailable")
      }
      if (failureKind === "retryable") retryableFailure = true
    }
  }
  throw new Error(
    retryableFailure ? "video-download-failed" : "video-downloader-unavailable"
  )
}

class ProcessFailure extends Error {
  constructor(readonly details: string) {
    super("process-failed")
  }
}

function run(
  bin: string,
  args: string[],
  onProgress?: (percent: number) => void | Promise<void>
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    let progressText = ""
    let lastProgress = -1
    let progressWrites = Promise.resolve()
    const collect = (chunk: Buffer) => {
      const text = chunk.toString("utf8")
      output = `${output}${text}`.slice(-12_000)
      progressText = `${progressText}${text}`.slice(-1_000)
      const matches = [...progressText.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)]
      const value = Number(matches.at(-1)?.[1])
      if (
        onProgress &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 100 &&
        Math.floor(value) !== lastProgress
      ) {
        lastProgress = Math.floor(value)
        const nextProgress = lastProgress
        progressWrites = progressWrites
          .then(() => onProgress(nextProgress))
          .then(() => undefined)
          .catch(() => undefined)
      }
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    child.on("error", (error) =>
      reject(new ProcessFailure(`${error.message}\n${output}`))
    )
    child.on("exit", (code) => {
      void progressWrites.then(() => {
        if (code === 0) resolve()
        else {
          reject(new ProcessFailure(output || `exit code ${code ?? "unknown"}`))
        }
      })
    })
  })
}
