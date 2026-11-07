import type { LightweightVideo } from "./discovery.ts"
import { isPrimarilyKorean } from "./language.ts"

export type YtDlpSearchEntry = {
  id?: unknown
  title?: unknown
  description?: unknown
  duration?: unknown
  channel_id?: unknown
  channel?: unknown
  uploader?: unknown
  timestamp?: unknown
  release_timestamp?: unknown
  view_count?: unknown
  language?: unknown
}

export function publicSearchEntriesToVideos(
  entries: YtDlpSearchEntry[],
  now = Date.now()
): LightweightVideo[] {
  return entries.flatMap((entry): LightweightVideo[] => {
    const id = stringValue(entry.id)
    const title = stringValue(entry.title)
    const language = stringValue(entry.language)
    if (
      !/^[0-9A-Za-z_-]{6,20}$/.test(id) ||
      !title ||
      !isPrimarilyKorean(title) ||
      (language && !/^ko(?:-|$)/i.test(language))
    )
      return []
    const description = stringValue(entry.description)
    return [
      {
        id,
        title,
        channelId: stringValue(entry.channel_id) || `unknown-${id}`,
        channel:
          stringValue(entry.channel) ||
          stringValue(entry.uploader) ||
          "채널 정보 없음",
        publishedAt: publicPublishedAt(entry, description, now),
        durationSeconds: numberValue(entry.duration),
        viewCount: numberValue(entry.view_count),
        commentCount: 0,
        description,
        transcriptExcerpt: "",
      },
    ]
  })
}

export function preferShortsSourceDurations(
  videos: LightweightVideo[],
  minimumCandidates = 5
) {
  const suitable = videos.filter(
    (video) => video.durationSeconds >= 45 && video.durationSeconds <= 30 * 60
  )
  if (suitable.length >= minimumCandidates) return suitable
  const suitableIds = new Set(suitable.map((video) => video.id))
  return [...suitable, ...videos.filter((video) => !suitableIds.has(video.id))]
}

function publicPublishedAt(
  entry: YtDlpSearchEntry,
  description: string,
  now: number
) {
  const timestamp =
    numberValue(entry.timestamp) || numberValue(entry.release_timestamp)
  if (timestamp > 0) return new Date(timestamp * 1000).toISOString()
  const match = description.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/)
  if (match) {
    const parsed = new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    )
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString()
  }
  // 게시일을 모를 때는 허용 창(2일) 안으로 가정해 후보에 남긴다.
  return new Date(now - 12 * 3_600_000).toISOString()
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0
}
