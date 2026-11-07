import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

import {
  buildChannelBaselines,
  issueTokens,
  scoreLightweightCandidates,
  type LightweightVideo,
} from "@/lib/news-clips/discovery"
import {
  preferShortsSourceDurations,
  publicSearchEntriesToVideos,
  type YtDlpSearchEntry,
} from "@/lib/news-clips/youtube-search"
import { NEWS_MAX_AGE_MS, isWithinNewsMaxAge } from "@/lib/news-clips/freshness"
import { isPrimarilyKorean } from "@/lib/news-clips/language"
import {
  scoreSourceRelevance,
  type SourceRelevanceContext,
} from "@/lib/news-clips/source-relevance"
import type { NewsSearchChannel, NewsSource } from "@/lib/news-clips/types"
import type { CommunityIssue } from "@/lib/server/news-clips/community"
import { readYouTubeDataKey } from "@/lib/server/credentials"

type YoutubeSearchItem = {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    channelId?: string
    channelTitle?: string
    publishedAt?: string
    description?: string
    defaultLanguage?: string
    defaultAudioLanguage?: string
  }
}

type YoutubeVideoItem = {
  id?: string
  snippet?: YoutubeSearchItem["snippet"]
  contentDetails?: { duration?: string }
  statistics?: { viewCount?: string; commentCount?: string }
}

export async function searchRecentNews(
  query: string,
  preferredChannels: NewsSearchChannel[],
  communityIssues: CommunityIssue[] = [],
  relevanceContext: SourceRelevanceContext = {
    title: query,
    keywords: issueTokens(query),
  }
): Promise<NewsSource[]> {
  const apiKey = await readYouTubeDataKey()
  const channels = preferredChannels
    .filter(
      (channel) =>
        channel.enabled &&
        /^UC[0-9A-Za-z_-]{8,}$/.test(channel.youtubeChannelId)
    )
    .sort((a, b) => b.priority - a.priority)
  const issueQuery =
    query.trim() ||
    communityIssues
      .slice(0, 3)
      .map((issue) => issue.label)
      .join("|") ||
    "정치 경제 사회 주요 뉴스"
  const sourceQuery = buildSourceQuery(issueQuery, relevanceContext)
  if (!apiKey) {
    return searchPublicYouTube(
      sourceQuery,
      channels,
      communityIssues,
      relevanceContext
    )
  }
  const publishedAfter = new Date(
    Date.now() - NEWS_MAX_AGE_MS
  ).toISOString()
  const [globalItems, preferredItems] = await Promise.all([
    searchYouTube("", sourceQuery, publishedAfter, apiKey, 50),
    Promise.all(
      channels
        .slice(0, 5)
        .map((channel) =>
          searchYouTube(
            channel.youtubeChannelId,
            sourceQuery,
            publishedAfter,
            apiKey,
            8
          ).catch(() => [])
        )
    ).then((items) => items.flat()),
  ])
  const items = uniqueSearchItems([...preferredItems, ...globalItems])
  const ids = [...new Set(items.flatMap((item) => item.id?.videoId ?? []))]
  if (ids.length === 0) return []
  const details = await videoDetails(ids, apiKey)
  const lightweight = preferShortsSourceDurations(toLightweight(items, details))
  const { videos: relevantVideos, scores: relevanceScores } =
    relevantVideosOnly(lightweight, relevanceContext)
  const baselines = buildChannelBaselines(relevantVideos)
  const priority = new Map(
    channels.map((channel) => [channel.youtubeChannelId, channel.priority])
  )
  return scoreLightweightCandidates(relevantVideos, Date.now(), baselines)
    .sort(
      (left, right) =>
        (relevanceScores.get(right.id)?.score ?? 0) -
          (relevanceScores.get(left.id)?.score ?? 0) ||
        rankedScore(right, priority) - rankedScore(left, priority) ||
        right.metrics.viewsPerHour - left.metrics.viewsPerHour
    )
    .slice(0, 5)
    .map((video) => {
      const relevance = relevanceScores.get(video.id)!
      const communityMatch = communityIssues.find((issue) =>
        issue.neutralTerms.some((term) =>
          issueTokens(video.title).includes(term)
        )
      )
      const riskFactors = [...video.metrics.riskFactors]
      const preferredPriority = priority.get(video.channelId) ?? 0
      if (!video.transcriptExcerpt)
        riskFactors.push("검색 단계에서 자막 일부 미확인")
      if (preferredPriority === 0)
        riskFactors.push("전체 YouTube 검색 결과 · 출처 확인 필요")
      return {
        id: `search-${video.id}`,
        kind: "search" as const,
        title: video.title,
        channel: video.channel,
        publishedAt: video.publishedAt,
        durationSeconds: video.durationSeconds,
        viewCount: video.viewCount,
        commentCount: video.commentCount,
        originalUrl: `https://www.youtube.com/watch?v=${video.id}`,
        summary: video.description.slice(0, 280),
        localFile: "",
        approved: false,
        requiresUpload: true,
        searchMetrics: {
          ...video.metrics,
          relevanceScore: relevance.score,
          relevanceReason: relevance.reason,
          recommendationScore: Math.min(
            100,
            video.metrics.recommendationScore + preferredPriority * 2
          ),
          riskFactors,
          recommendationReason: [
            "선택 논점 기준 v2",
            `주제 연관도 ${relevance.score}점`,
            video.metrics.recommendationReason,
            preferredPriority > 0 ? "등록한 우선 채널" : "YouTube 전체 검색",
            communityMatch
              ? `공개 커뮤니티에서 '${communityMatch.label}' 관심 증가`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
        },
      } satisfies NewsSource
    })
}

async function searchPublicYouTube(
  query: string,
  channels: NewsSearchChannel[],
  communityIssues: CommunityIssue[],
  relevanceContext: SourceRelevanceContext
) {
  const entries = await runYtDlpSearch(query)
  const lightweight = preferShortsSourceDurations(
    publicSearchEntriesToVideos(entries)
  )
  const { videos: relevantVideos, scores: relevanceScores } =
    relevantVideosOnly(lightweight, relevanceContext)
  const baselines = buildChannelBaselines(relevantVideos)
  const priority = new Map(
    channels.map((channel) => [channel.youtubeChannelId, channel.priority])
  )
  return scoreLightweightCandidates(relevantVideos, Date.now(), baselines)
    .sort(
      (left, right) =>
        (relevanceScores.get(right.id)?.score ?? 0) -
          (relevanceScores.get(left.id)?.score ?? 0) ||
        rankedScore(right, priority) - rankedScore(left, priority) ||
        right.metrics.viewsPerHour - left.metrics.viewsPerHour
    )
    .slice(0, 5)
    .map((video) => {
      const relevance = relevanceScores.get(video.id)!
      const communityMatch = communityIssues.find((issue) =>
        issue.neutralTerms.some((term) =>
          issueTokens(video.title).includes(term)
        )
      )
      const preferredPriority = priority.get(video.channelId) ?? 0
      return {
        id: `search-${video.id}`,
        kind: "search" as const,
        title: video.title,
        channel: video.channel,
        publishedAt: video.publishedAt,
        durationSeconds: video.durationSeconds,
        viewCount: video.viewCount,
        commentCount: 0,
        originalUrl: `https://www.youtube.com/watch?v=${video.id}`,
        summary: video.description.slice(0, 280),
        localFile: "",
        approved: false,
        requiresUpload: true,
        searchMetrics: {
          ...video.metrics,
          relevanceScore: relevance.score,
          relevanceReason: relevance.reason,
          recommendationScore: Math.min(
            100,
            video.metrics.recommendationScore + preferredPriority * 2
          ),
          riskFactors: [
            ...video.metrics.riskFactors,
            "공개 검색 보조 경로 · 게시일과 댓글 지표 제한",
          ],
          recommendationReason: [
            "선택 논점 기준 v2",
            `주제 연관도 ${relevance.score}점`,
            video.metrics.recommendationReason,
            preferredPriority > 0 ? "등록한 우선 채널" : "YouTube 공개 검색",
            communityMatch
              ? `공개 커뮤니티에서 '${communityMatch.label}' 관심 증가`
              : "",
          ]
            .filter(Boolean)
            .join(" · "),
        },
      } satisfies NewsSource
    })
}

function relevantVideosOnly(
  videos: LightweightVideo[],
  context: SourceRelevanceContext
) {
  const freshVideos = videos.filter((video) =>
    isWithinNewsMaxAge(video.publishedAt)
  )
  const scores = new Map(
    freshVideos.map((video) => [
      video.id,
      scoreSourceRelevance(context, {
        title: video.title,
        description: video.description,
        transcriptExcerpt: video.transcriptExcerpt,
        publishedAt: video.publishedAt,
      }),
    ])
  )
  const strict = freshVideos.filter((video) => scores.get(video.id)?.passes)
  if (strict.length >= 3) return { videos: strict, scores }

  const selected = new Map(strict.map((video) => [video.id, video]))
  const relaxed = freshVideos
    .filter((video) => {
      const relevance = scores.get(video.id)
      return (
        relevance &&
        relevance.score >= 48 &&
        relevance.titleMatches.length >= 1 &&
        new Set([
          ...relevance.titleMatches,
          ...relevance.descriptionMatches,
          ...relevance.transcriptMatches,
        ]).size >= 2
      )
    })
    .sort(
      (left, right) =>
        (scores.get(right.id)?.score ?? 0) - (scores.get(left.id)?.score ?? 0)
    )
  for (const video of relaxed) selected.set(video.id, video)

  // 검색 메타데이터에 설명과 자막이 모두 없을 때만 사용하는 마지막 안전망이다.
  // 이슈의 구체 핵심어가 제목에 직접 등장한 후보만 허용한다.
  if (selected.size === 0) {
    const directTitleMatches = videos
      .filter((video) => {
        const relevance = scores.get(video.id)
        return (
          relevance &&
          relevance.score >= 33 &&
          relevance.titleMatches.length >= 1
        )
      })
      .sort(
        (left, right) =>
          (scores.get(right.id)?.score ?? 0) - (scores.get(left.id)?.score ?? 0)
      )
      .slice(0, 5)
    for (const video of directTitleMatches) selected.set(video.id, video)
  }
  return { videos: [...selected.values()], scores }
}

async function runYtDlpSearch(query: string): Promise<YtDlpSearchEntry[]> {
  const output = await execFileText(ytDlpSearchBin(), [
    "--flat-playlist",
    "--dump-single-json",
    "--no-warnings",
    "--playlist-end",
    "50",
    `ytsearch50:${query}`,
  ])
  const parsed = JSON.parse(output) as { entries?: YtDlpSearchEntry[] }
  return Array.isArray(parsed.entries) ? parsed.entries : []
}

function buildSourceQuery(fallback: string, context: SourceRelevanceContext) {
  const generic = new Set([
    "정부",
    "정책",
    "논란",
    "관련",
    "발표",
    "사건",
    "뉴스",
    "국회",
    "통과",
  ])
  const topicTerms = issueTokens(context.title).filter(
    (term) => term.length >= 2 && !generic.has(term)
  )
  const angleTerms = topicTerms
    .slice(-3)
    .filter((term) => !/(?:나|까|인가|되나|하나)$/u.test(term))
  const focusedTopicTerms = [
    ...topicTerms.filter((term) => !/^\d/.test(term)).slice(0, 2),
    ...angleTerms.slice(-2),
  ]
  const terms = [
    ...focusedTopicTerms,
    ...context.keywords,
    ...issueTokens(fallback),
  ]
    .flatMap(issueTokens)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !generic.has(term))
  const unique = [...new Set(terms)]
  return unique.slice(0, 4).join(" ") || fallback
}

function ytDlpSearchBin() {
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

function execFileText(bin: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      bin,
      args,
      { maxBuffer: 16 * 1024 * 1024, timeout: 45_000 },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
  })
}

function toLightweight(
  items: YoutubeSearchItem[],
  details: Map<string, YoutubeVideoItem>
) {
  const seen = new Set<string>()
  return items.flatMap((item): LightweightVideo[] => {
    const videoId = item.id?.videoId
    const detail = videoId ? details.get(videoId) : undefined
    if (!videoId || !detail || seen.has(videoId)) return []
    seen.add(videoId)
    const snippet = detail.snippet ?? item.snippet
    const title = decode(snippet?.title ?? "뉴스 영상")
    const language =
      snippet?.defaultAudioLanguage ?? snippet?.defaultLanguage ?? ""
    if (
      !isPrimarilyKorean(title) ||
      (language && !/^ko(?:-|$)/i.test(language))
    )
      return []
    return [
      {
        id: videoId,
        title,
        channelId: snippet?.channelId ?? "",
        channel: decode(snippet?.channelTitle ?? ""),
        publishedAt: snippet?.publishedAt ?? "",
        durationSeconds: isoDuration(detail.contentDetails?.duration ?? ""),
        viewCount: Number(detail.statistics?.viewCount ?? 0),
        commentCount: Number(detail.statistics?.commentCount ?? 0),
        description: decode(snippet?.description ?? "").slice(0, 500),
        transcriptExcerpt: "",
      },
    ]
  })
}

async function searchYouTube(
  channelId: string,
  query: string,
  publishedAfter: string,
  apiKey: string,
  maxResults: number
) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search")
  const params: Record<string, string> = {
    part: "snippet",
    type: "video",
    order: query ? "relevance" : "date",
    maxResults: String(maxResults),
    publishedAfter,
    relevanceLanguage: "ko",
    regionCode: "KR",
    key: apiKey,
  }
  if (channelId) params.channelId = channelId
  if (query) params.q = query
  url.search = new URLSearchParams(params).toString()
  const response = await fetch(url, { cache: "no-store" })
  if (!response.ok) throw new Error("search-failed")
  const body = (await response.json()) as { items?: YoutubeSearchItem[] }
  return body.items ?? []
}

function uniqueSearchItems(items: YoutubeSearchItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const id = item.id?.videoId
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function rankedScore(
  video: { channelId: string; metrics: { recommendationScore: number } },
  priority: Map<string, number>
) {
  return (
    video.metrics.recommendationScore + (priority.get(video.channelId) ?? 0) * 2
  )
}

async function videoDetails(ids: string[], apiKey: string) {
  const chunks = Array.from(
    { length: Math.ceil(ids.length / 50) },
    (_, index) => ids.slice(index * 50, index * 50 + 50)
  )
  const responses = await Promise.all(
    chunks.map(async (chunk) => {
      const url = new URL("https://www.googleapis.com/youtube/v3/videos")
      url.search = new URLSearchParams({
        part: "snippet,contentDetails,statistics",
        id: chunk.join(","),
        key: apiKey,
      }).toString()
      const response = await fetch(url, { cache: "no-store" })
      if (!response.ok) throw new Error("search-failed")
      const body = (await response.json()) as { items?: YoutubeVideoItem[] }
      return body.items ?? []
    })
  )
  return new Map<string, YoutubeVideoItem>(
    responses
      .flat()
      .flatMap((item) => (item.id ? [[item.id, item] as const] : []))
  )
}

function isoDuration(value: string) {
  const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  return match
    ? Number(match[1] ?? 0) * 3600 +
        Number(match[2] ?? 0) * 60 +
        Number(match[3] ?? 0)
    : 0
}

function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}
