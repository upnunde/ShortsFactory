import { narrationSeconds, subtitleCues } from "./timing.ts"
import type { Scene, YoutubeMeta } from "./types.ts"

export const EVERGREEN_TAGS = [
  "shorts",
  "facts",
  "trivia",
  "didyouknow",
  "knowledge",
] as const
export const COMMENT_PROMPT =
  "Which fact surprised you the most? Comment below!"
export const YOUTUBE_CATEGORY_ID = "27"
export const YOUTUBE_UPLOAD_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
] as const

const TAG_LIMIT = 500

export function tagList(value: string) {
  const seen = new Set<string>()
  const tags: string[] = []
  const add = (raw: string) => {
    const tag = raw.trim().replace(/^#+/, "")
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) {
      return
    }
    seen.add(key)
    tags.push(tag)
  }
  for (const tag of EVERGREEN_TAGS) {
    add(tag)
  }
  for (const tag of value.split(",")) {
    add(tag)
  }
  const kept: string[] = []
  let length = 0
  for (const tag of tags) {
    const next = length === 0 ? tag.length : length + 1 + tag.length
    if (next > TAG_LIMIT) {
      break
    }
    kept.push(tag)
    length = next
  }
  return kept
}

export function formatTags(value: string) {
  return tagList(value).join(", ")
}

export function withEnglishDescription(description: string) {
  return description
    .split(/\n/)
    .filter(
      (line) =>
        line.trim().toLowerCase() !== COMMENT_PROMPT.toLowerCase() &&
        !/^\s*(?:#[\w-]+\s*)+$/i.test(line)
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function applyYoutubeCopy(
  youtube: Pick<YoutubeMeta, "title" | "description" | "tags">
) {
  return {
    title: youtube.title.trim(),
    description: withEnglishDescription(youtube.description),
    tags: formatTags(youtube.tags),
  }
}

export function inKoreaUploadWindow(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) {
    return false
  }
  const minutes = Number(match[4]) * 60 + Number(match[5])
  return minutes >= 6 * 60 && minutes <= 9 * 60
}

export function nextKoreaUploadSlot(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  let year = read("year")
  let month = read("month")
  let day = read("day")
  const hour = read("hour")
  if (hour >= 7) {
    const date = new Date(Date.UTC(year, month - 1, day))
    date.setUTCDate(date.getUTCDate() + 1)
    year = date.getUTCFullYear()
    month = date.getUTCMonth() + 1
    day = date.getUTCDate()
  }
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${year}-${pad(month)}-${pad(day)}T07:00`
}

export function scheduleForUpload(value: string, now = new Date()) {
  const at = koreaInstant(value)
  // 오전 6~9시는 권장 공개 시간일 뿐, 사용자가 고른 미래 시각을
  // 강제로 다음 날 오전 7시로 바꾸면 안 된다.
  if (!at || at <= now.getTime()) {
    return nextKoreaUploadSlot(now)
  }
  return value
}

export function koreaPublishAt(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(value)
  if (!match) {
    return null
  }
  const instant = new Date(`${match[1]}:00+09:00`)
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString()
}

export function buildSrt(scenes: Scene[]) {
  let cursor = 0
  let index = 1
  const blocks: string[] = []
  for (const scene of scenes) {
    const cues = subtitleCues(scene.subtitle, scene.scriptTarget)
    if (cues.length === 0) {
      continue
    }
    const weights = cues.map((cue) =>
      Math.max(1, cue.split(/\s+/).filter(Boolean).length)
    )
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0)
    const sceneMs = Math.max(
      Math.round(narrationSeconds(scene.scriptTarget) * 1000),
      cues.length * 800
    )
    cues.forEach((cue, cueIndex) => {
      const duration = Math.max(
        400,
        Math.round((sceneMs * weights[cueIndex]) / weightTotal)
      )
      const start = cursor
      const end = start + duration
      cursor = end
      blocks.push(`${index}\n${stamp(start)} --> ${stamp(end)}\n${cue}`)
      index += 1
    })
  }
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`
}

export function youtubeVideoResource(input: {
  title: string
  description: string
  tags: string
  scheduledAt: string
}) {
  const copy = applyYoutubeCopy(input)
  const publishAt = koreaPublishAt(scheduleForUpload(input.scheduledAt))
  return {
    snippet: {
      title: copy.title,
      description: copy.description,
      tags: tagList(copy.tags),
      categoryId: YOUTUBE_CATEGORY_ID,
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
    },
    status: {
      privacyStatus: "private" as const,
      publishAt,
      selfDeclaredMadeForKids: false,
      embeddable: true,
    },
  }
}

export function englishCaptionSnippet(videoId: string) {
  return {
    snippet: {
      videoId,
      language: "en",
      name: "English",
      isDraft: false,
    },
  }
}

function koreaInstant(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/.exec(value)
  if (!match) {
    return 0
  }
  return Date.parse(`${match[1]}:00+09:00`)
}

function stamp(ms: number) {
  const total = Math.max(0, ms)
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const millis = total % 1000
  const pad = (value: number, size = 2) => String(value).padStart(size, "0")
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`
}
