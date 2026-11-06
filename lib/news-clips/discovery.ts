import type { NewsCandidateMetrics } from "./types.ts"

export type LightweightVideo = {
  id: string
  title: string
  channelId: string
  channel: string
  publishedAt: string
  durationSeconds: number
  viewCount: number
  commentCount: number
  description: string
  transcriptExcerpt: string
}

export type ScoredLightweightVideo = LightweightVideo & {
  metrics: NewsCandidateMetrics
}

export type ChannelResponseBaseline = {
  viewsPerHour: number
  commentRate: number
}

const DIRECT_SPEECH = /말하|밝혀|밝히|발언|인터뷰|논란|대담|토론|녹취|직접|"|'/g
const RISK = /속보|단독|추정|의혹|소문|카더라/g
const STOP_WORDS = new Set([
  "뉴스",
  "속보",
  "단독",
  "오늘",
  "영상",
  "관련",
  "대해",
  "현장",
  "발표",
])

export function scoreLightweightCandidates(
  videos: LightweightVideo[],
  now = Date.now(),
  baselines = buildChannelBaselines(videos, now)
): ScoredLightweightVideo[] {
  const enriched = videos.map((video) => {
    const ageHours = Math.max(
      0.25,
      (now - new Date(video.publishedAt).getTime()) / 3_600_000
    )
    return {
      ...video,
      ageHours,
      viewsPerHour: video.viewCount / ageHours,
      commentsPerHour: video.commentCount / ageHours,
      commentRate:
        video.viewCount > 0 ? video.commentCount / video.viewCount : 0,
      tokens: issueTokens(video.title),
    }
  })
  return enriched
    .map((video) => {
      const baseline = baselines.get(video.channelId) ?? {
        viewsPerHour: 1,
        commentRate: 0.001,
      }
      const responseMultiple = video.viewsPerHour / baseline.viewsPerHour
      const commentMultiple = video.commentRate / baseline.commentRate
      const sameIssueChannelCount =
        new Set(
          enriched
            .filter(
              (other) =>
                other.id !== video.id &&
                overlap(video.tokens, other.tokens) >= 1
            )
            .map((other) => other.channelId)
        ).size + 1
      const directSpeechLikelihood = directSpeechScore(video)
      const velocityPoints = Math.min(
        35,
        12 + Math.log2(responseMultiple + 0.5) * 11
      )
      const commentPoints = Math.min(
        25,
        7 +
          Math.log2(commentMultiple + 0.5) * 7 +
          Math.min(6, video.commentsPerHour / 8)
      )
      const crossChannelPoints = Math.min(20, sameIssueChannelCount * 5)
      const recencyPoints = Math.max(0, 10 * Math.exp(-video.ageHours / 48))
      const directPoints = directSpeechLikelihood / 10
      const recommendationScore = Math.round(
        clamp(velocityPoints, 0, 35) +
          clamp(commentPoints, 0, 25) +
          crossChannelPoints +
          recencyPoints +
          directPoints
      )
      const riskFactors = riskFactorsOf(video)
      const expectedShortTitle = shortTitle(video.title)
      const metrics: NewsCandidateMetrics = {
        recommendationScore,
        viewsPerHour: round(video.viewsPerHour),
        commentRate: round(video.commentRate * 100),
        commentsPerHour: round(video.commentsPerHour),
        responseMultiple: round(responseMultiple),
        sameIssueChannelCount,
        ageHours: round(video.ageHours),
        directSpeechLikelihood,
        expectedShortTitle,
        recommendationReason: reasonOf(
          responseMultiple,
          sameIssueChannelCount,
          directSpeechLikelihood
        ),
        riskFactors,
        transcriptExcerpt: video.transcriptExcerpt,
      }
      return { ...video, metrics }
    })
    .sort(
      (a, b) =>
        b.metrics.recommendationScore - a.metrics.recommendationScore ||
        b.viewsPerHour - a.viewsPerHour
    )
}

export function buildChannelBaselines(
  videos: LightweightVideo[],
  now = Date.now()
) {
  const grouped = new Map<
    string,
    { viewsPerHour: number[]; commentRates: number[] }
  >()
  for (const video of videos) {
    const ageHours = Math.max(
      0.25,
      (now - new Date(video.publishedAt).getTime()) / 3_600_000
    )
    const group = grouped.get(video.channelId) ?? {
      viewsPerHour: [],
      commentRates: [],
    }
    group.viewsPerHour.push(video.viewCount / ageHours)
    group.commentRates.push(
      video.viewCount > 0 ? video.commentCount / video.viewCount : 0
    )
    grouped.set(video.channelId, group)
  }
  return new Map<string, ChannelResponseBaseline>(
    [...grouped].map(([channelId, values]) => [
      channelId,
      {
        viewsPerHour: average(values.viewsPerHour) || 1,
        commentRate: average(values.commentRates) || 0.001,
      },
    ])
  )
}

export function issueTokens(value: string) {
  return [
    ...new Set(
      value
        .replace(/[^0-9A-Za-z가-힣\s]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
    ),
  ].slice(0, 12)
}

function directSpeechScore(video: LightweightVideo) {
  const text = `${video.title} ${video.description} ${video.transcriptExcerpt}`
  const hits = text.match(DIRECT_SPEECH)?.length ?? 0
  const durationFit =
    video.durationSeconds >= 90 && video.durationSeconds <= 3_600 ? 20 : 8
  return Math.round(clamp(28 + hits * 18 + durationFit, 0, 100))
}

function riskFactorsOf(video: LightweightVideo) {
  const risks: string[] = []
  const text = `${video.title} ${video.description}`
  if (RISK.test(text)) risks.push("확인되지 않은 주장 가능성")
  RISK.lastIndex = 0
  if (video.durationSeconds < 60) risks.push("전체 맥락이 짧을 수 있음")
  if (video.commentCount === 0) risks.push("댓글 반응 정보 없음")
  return risks
}

function reasonOf(
  responseMultiple: number,
  sameIssueChannels: number,
  directSpeech: number
) {
  const parts = [
    `평소 대비 반응 ${round(responseMultiple)}배`,
    `${sameIssueChannels}개 등록 채널에서 동일 이슈 포착`,
  ]
  if (directSpeech >= 60) parts.push("직접 발언 구간 가능성이 높음")
  return parts.join(" · ")
}

function shortTitle(value: string) {
  return value
    .replace(/\[[^\]]+\]|\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 34)
}

function overlap(left: string[], right: string[]) {
  const rightSet = new Set(right)
  return left.filter((token) => rightSet.has(token)).length
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
