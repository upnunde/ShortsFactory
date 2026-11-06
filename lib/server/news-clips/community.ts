import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { issueTokens } from "../../news-clips/discovery.ts"
import type { NewsSource } from "../../news-clips/types.ts"

export type CommunityIssue = {
  label: string
  neutralTerms: string[]
  mentionCount: number
  distinctPostCount: number
  registeredNewsChannelCount: number
  scoreBreakdown: {
    mentionVelocity: number
    diversity: number
    engagementVelocity: number
    persistence: number
    registeredNewsCoverage: number
  }
  score: number
}

type Cached = { fetchedAt: string; issues: CommunityIssue[] }

const cachePath = path.join(
  process.cwd(),
  "outputs",
  "news-clips",
  "cache",
  "community-issues.json"
)

export async function readPublicCommunityIssues(
  enabled: boolean,
  cacheMinutes: number
) {
  if (!enabled) return { issues: [], status: "disabled" as const }
  const cached = await readCache()
  const age = cached
    ? Date.now() - new Date(cached.fetchedAt).getTime()
    : Number.POSITIVE_INFINITY
  if (cached && age < cacheMinutes * 60_000) {
    return { issues: cached.issues, status: "cached" as const }
  }
  const boardUrl =
    process.env.ILBE_PUBLIC_BOARD_URL?.trim() ||
    "https://www.ilbe.com/list/politics"
  try {
    const response = await fetch(boardUrl, {
      headers: {
        "user-agent": "ShortsFactory/1.0 public-trend-cache",
        accept: "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    })
    if (!response.ok) throw new Error("community-unavailable")
    const html = await response.text()
    if (/캡차|captcha|로그인|access denied/i.test(html)) {
      throw new Error("community-blocked")
    }
    const issues = extractIssues(html)
    await writeCache({ fetchedAt: new Date().toISOString(), issues })
    return { issues, status: "fresh" as const }
  } catch {
    return {
      issues: cached?.issues ?? [],
      status: cached ? ("stale" as const) : ("unavailable" as const),
    }
  }
}

export function extractIssues(html: string): CommunityIssue[] {
  const titles = [
    ...html.matchAll(
      /<a\b[^>]*href=["'][^"']*(?:view|\/?\d{5,})[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi
    ),
  ]
    .map((match) => neutralize(stripHtml(match[1])))
    .filter((title) => title.length >= 4 && title.length <= 120)
    .slice(0, 120)
  const groups = new Map<
    string,
    { label: string; posts: Set<string>; terms: Set<string> }
  >()
  for (const title of titles) {
    const tokens = issueTokens(title)
    for (const token of tokens.slice(0, 5)) {
      const group = groups.get(token) ?? {
        label: token,
        posts: new Set<string>(),
        terms: new Set<string>(),
      }
      group.posts.add(title)
      tokens.forEach((item) => group.terms.add(item))
      groups.set(token, group)
    }
  }
  return [...groups.values()]
    .filter((group) => group.posts.size >= 2)
    .map((group) => {
      const mentionCount = group.posts.size
      const mentionVelocity = Math.min(30, mentionCount * 4)
      const diversity = Math.min(20, mentionCount * 3)
      const engagementVelocity = Math.min(20, mentionCount * 2)
      const persistence = Math.min(10, mentionCount)
      return {
        label: group.label,
        neutralTerms: [...group.terms].slice(0, 8),
        mentionCount,
        distinctPostCount: group.posts.size,
        registeredNewsChannelCount: 0,
        scoreBreakdown: {
          mentionVelocity,
          diversity,
          engagementVelocity,
          persistence,
          registeredNewsCoverage: 0,
        },
        score: Math.round(
          mentionVelocity + diversity + engagementVelocity + persistence
        ),
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
}

export function confirmCommunityIssues(
  issues: CommunityIssue[],
  sources: NewsSource[]
) {
  return issues.map((issue) => {
    const matchingChannels = new Set(
      sources
        .filter((source) => {
          const tokens = issueTokens(`${source.title} ${source.summary}`)
          return issue.neutralTerms.some((term) => tokens.includes(term))
        })
        .map((source) => source.channel)
        .filter(Boolean)
    )
    const registeredNewsCoverage = Math.min(20, matchingChannels.size * 5)
    const baseBreakdown = issue.scoreBreakdown ?? baseScores(issue.mentionCount)
    const scoreBreakdown = {
      ...baseBreakdown,
      registeredNewsCoverage,
    }
    return {
      ...issue,
      registeredNewsChannelCount: matchingChannels.size,
      scoreBreakdown,
      score: Math.min(
        100,
        scoreBreakdown.mentionVelocity +
          scoreBreakdown.diversity +
          scoreBreakdown.engagementVelocity +
          scoreBreakdown.persistence +
          registeredNewsCoverage
      ),
    }
  })
}

function baseScores(mentionCount: number) {
  return {
    mentionVelocity: Math.min(30, mentionCount * 4),
    diversity: Math.min(20, mentionCount * 3),
    engagementVelocity: Math.min(20, mentionCount * 2),
    persistence: Math.min(10, mentionCount),
    registeredNewsCoverage: 0,
  }
}

function neutralize(value: string) {
  return value
    .replace(/\b(?:욕설|비하|멸칭)\b/gi, " ")
    .replace(/[!?.]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

async function readCache(): Promise<Cached | null> {
  try {
    const value = JSON.parse(await readFile(cachePath, "utf8")) as Cached
    return Array.isArray(value.issues) && typeof value.fetchedAt === "string"
      ? value
      : null
  } catch {
    return null
  }
}

async function writeCache(value: Cached) {
  await mkdir(path.dirname(cachePath), { recursive: true })
  await writeFile(cachePath, `${JSON.stringify(value, null, 2)}\n`)
}
