import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { claudeText } from "@/lib/server/anthropic"
import {
  rankRecommendedIssues,
  type NewsIssueArticle,
  type RecommendedNewsIssue,
} from "@/lib/news-clips/issues"
import { readPublicCommunityIssues } from "@/lib/server/news-clips/community"

const cacheRoot = path.join(
  process.cwd(),
  "outputs",
  "news-clips",
  "cache",
  "recommended-issues"
)

export async function discoverRecommendedNewsIssues(
  query: string,
  communityEnabled: boolean,
  communityCacheMinutes: number,
  limit = 5,
  searchGuidance = ""
) {
  const normalizedQuery = query.trim().slice(0, 120)
  const normalizedGuidance = searchGuidance.trim().slice(0, 500)
  const normalizedLimit = Math.max(1, Math.min(20, Math.floor(limit)))
  const cacheKey = createHash("sha256")
    .update(
      JSON.stringify({
        scoreVersion: 6,
        normalizedQuery,
        normalizedGuidance,
        communityEnabled,
        normalizedLimit,
      })
    )
    .digest("hex")
    .slice(0, 16)
  const cachePath = path.join(cacheRoot, `${cacheKey}.json`)
  const cached = await readCache(cachePath)
  if (
    cached &&
    Date.now() - new Date(cached.fetchedAt).getTime() < 10 * 60_000
  ) {
    return { issues: cached.issues, cached: true }
  }

  const [articleGroups, community] = await Promise.all([
    Promise.all(
      feedUrls(normalizedQuery, normalizedGuidance).map(readGoogleNewsFeed)
    ),
    readPublicCommunityIssues(communityEnabled, communityCacheMinutes),
  ])
  const articles = uniqueArticles(articleGroups.flat())
  const rankedIssues = rankRecommendedIssues(
    articles,
    community.issues,
    Date.now(),
    Math.min(20, Math.max(normalizedLimit, normalizedLimit * 3)),
    normalizedGuidance
  )
  const issues = (
    normalizedGuidance
      ? await refineDirectionScores(rankedIssues, normalizedGuidance).catch(
          () => rankedIssues
        )
      : rankedIssues
  )
    .sort(
      (left, right) =>
        right.score - left.score || right.articleCount - left.articleCount
    )
    .slice(0, normalizedLimit)
    .map((issue, index) => ({
      ...issue,
      id: `recommended-issue-${index + 1}`,
    }))
  await mkdir(cacheRoot, { recursive: true })
  await writeFile(
    cachePath,
    `${JSON.stringify({ fetchedAt: new Date().toISOString(), issues }, null, 2)}\n`
  )
  return { issues, cached: false }
}

async function refineDirectionScores(
  issues: RecommendedNewsIssue[],
  direction: string
) {
  const response = await claudeText(
    [
      "너는 시사 쇼츠 채널의 이슈 적합도 평가자다.",
      "기사 제목에 실제로 드러난 정보만 사용하고, 제목에 없는 사실이나 논조를 추측하지 않는다.",
      "단순히 대상 이름이 언급됐다는 이유로 높은 점수를 주지 않는다. 채널이 비판하려는 대상과 기사에서 실제 비판받는 대상이 같은지 구분한다.",
      "점수는 100점 만점이다: 채널 방향과 비판 대상 일치 35점, 모순·말 바꾸기·공약 불이행·권력 남용 등 비판 지점 30점, 국민 생활의 구체적 피해 15점, 수치·직접 발언·공식 자료 등 검증 근거 15점, 최근성과 복수 매체 확인 5점.",
      "친정부·옹호성 주장이나 비판 대상이 반대인 기사는 관련 인물이 등장해도 낮게 평가한다.",
      "reason은 높은 점수 또는 감점의 핵심 이유를 한국어 한 문장으로 쓴다.",
      "JSON 배열만 출력한다: [{id:string,score:number,reason:string}]",
    ].join("\n"),
    JSON.stringify({
      channelDirection: direction,
      issues: issues.map((issue) => ({
        id: issue.id,
        title: issue.title,
        articleTitles: issue.articles.map((article) => article.title),
        articleCount: issue.articleCount,
        sourceCount: issue.sourceCount,
      })),
    }),
    1400
  )
  const parsed = JSON.parse(stripFence(response)) as unknown
  if (!Array.isArray(parsed)) return issues
  const scores = new Map(
    parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const value = item as Record<string, unknown>
      if (
        typeof value.id !== "string" ||
        typeof value.score !== "number" ||
        typeof value.reason !== "string"
      )
        return []
      return [
        [
          value.id,
          {
            score: Math.max(0, Math.min(100, Math.round(value.score))),
            reason: value.reason.trim().slice(0, 180),
          },
        ] as const,
      ]
    })
  )
  return issues.map((issue) => {
    const refined = scores.get(issue.id)
    return refined
      ? {
          ...issue,
          score: refined.score,
          recommendationReason: refined.reason || issue.recommendationReason,
        }
      : issue
  })
}

function stripFence(value: string) {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
}

function feedUrls(query: string, searchGuidance: string) {
  const guidanceTopics = searchGuidance
    .split(/[\n,.;]+/)
    .map((topic) => topic.trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 4)
  if (query) {
    return [
      googleNewsSearch(`${query} when:2d`),
      ...guidanceTopics
        .slice(0, 2)
        .map((topic) => googleNewsSearch(`${query} ${topic} when:2d`)),
    ]
  }
  return [
    ...guidanceTopics.map((topic) => googleNewsSearch(`${topic} when:2d`)),
    googleNewsSearch("정치 정부 국회 when:1d"),
    googleNewsSearch("경제 세금 일자리 기업 when:1d"),
    googleNewsSearch("외교 안보 사법 when:1d"),
    "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko",
  ]
}

function googleNewsSearch(query: string) {
  const url = new URL("https://news.google.com/rss/search")
  url.search = new URLSearchParams({
    q: query,
    hl: "ko",
    gl: "KR",
    ceid: "KR:ko",
  }).toString()
  return url.toString()
}

async function readGoogleNewsFeed(url: string) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "user-agent": "ShortsFactory/1.0 issue-discovery" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return []
    return parseRss(await response.text())
  } catch {
    return []
  }
}

export function parseRss(xml: string): NewsIssueArticle[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const item = match[1]
    const title = decodeXml(tag(item, "title")).trim()
    const url = decodeXml(tag(item, "link")).trim()
    const source = decodeXml(tag(item, "source")).trim()
    const publishedAt = tag(item, "pubDate").trim()
    if (!title || !/^https?:\/\//.test(url) || !publishedAt) return []
    return [{ title, url, source, publishedAt }]
  })
}

function tag(value: string, name: string) {
  const match = value.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i")
  )
  return (match?.[1] ?? "").replace(/^<!\[CDATA\[|\]\]>$/g, "")
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

function uniqueArticles(articles: NewsIssueArticle[]) {
  const seen = new Set<string>()
  return articles.filter((article) => {
    const key = `${article.title}|${article.source}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function readCache(file: string) {
  try {
    return JSON.parse(await readFile(file, "utf8")) as {
      fetchedAt: string
      issues: RecommendedNewsIssue[]
    }
  } catch {
    return null
  }
}
