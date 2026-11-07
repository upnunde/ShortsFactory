import { issueTokens } from "./discovery.ts"
import { isWithinNewsMaxAge } from "./freshness.ts"
import { isPrimarilyKorean } from "./language.ts"

export type NewsIssueArticle = {
  title: string
  url: string
  source: string
  publishedAt: string
}

export type NewsIssueCommunitySignal = {
  label: string
  neutralTerms: string[]
  mentionCount: number
}

export type RecommendedNewsIssue = {
  id: string
  title: string
  searchQuery: string
  keywords: string[]
  score: number
  trendScore: number
  articleCount: number
  sourceCount: number
  communityMentionCount: number
  recommendationReason: string
  articles: NewsIssueArticle[]
  directSource?: boolean
  directSourceUrl?: string
}

export type NewsIssueSearchState = {
  query: string
  issues: RecommendedNewsIssue[]
  dismissedIssueKeys: string[]
}

export function normalizeNewsIssueSearchState(
  value: unknown
): NewsIssueSearchState {
  const raw = value && typeof value === "object" ? value : {}
  const record = raw as Partial<NewsIssueSearchState>
  return {
    query: typeof record.query === "string" ? record.query.slice(0, 120) : "",
    issues: Array.isArray(record.issues)
      ? record.issues
          .filter((issue): issue is RecommendedNewsIssue =>
            Boolean(
              issue &&
              typeof issue === "object" &&
              typeof issue.id === "string" &&
              typeof issue.title === "string" &&
              isPrimarilyKorean(issue.title) &&
              typeof issue.searchQuery === "string" &&
              Array.isArray(issue.articles)
            )
          )
          .map((issue) => ({
            ...issue,
            trendScore:
              typeof issue.trendScore === "number"
                ? Math.max(0, Math.min(100, Math.round(issue.trendScore)))
                : 0,
          }))
          .slice(0, 12)
      : [],
    dismissedIssueKeys: Array.isArray(record.dismissedIssueKeys)
      ? record.dismissedIssueKeys
          .filter((key): key is string => typeof key === "string")
          .slice(0, 30)
      : [],
  }
}

type IssueGroup = {
  articles: NewsIssueArticle[]
  tokens: Set<string>
}

const CRITICAL_ANGLE =
  /모순|말\s*바꾸|번복|공약\s*불이행|불이행|권력\s*남용|특혜|의혹|논란|비판|반발|책임|실패|거짓|왜곡|조작|위법|강행|폭주|파행|은폐|해명|사과|수사|기소/g
const PUBLIC_IMPACT =
  /세금|재정|예산|물가|부동산|집값|전세|일자리|고용|기업|규제|소득|연금|건보|국민|서민|가계|피해|부담|안보|외교|사법/g
const EVIDENCE_SIGNAL =
  /\d[\d,.]*\s*(?:%|원|명|건|배|조|억|만)?|직접\s*발언|녹취|공식\s*자료|감사|통계|보고서|판결|법원|전후\s*비교|국정감사/g
const DIRECTION_TARGET = /현\s*정부|정부|민주당|대통령|정권|국회/g

export function rankRecommendedIssues(
  articles: NewsIssueArticle[],
  communitySignals: NewsIssueCommunitySignal[] = [],
  now = Date.now(),
  limit = 5,
  priorityContext = ""
): RecommendedNewsIssue[] {
  const priorityTokens = issueTokens(priorityContext)
  const groups: IssueGroup[] = []
  for (const article of articles
    .filter((item) => validArticle(item, now))
    .sort(
      (left, right) =>
        new Date(right.publishedAt).getTime() -
        new Date(left.publishedAt).getTime()
    )) {
    const tokens = issueTokens(article.title)
    if (tokens.length === 0) continue
    const match = groups.find(
      (group) =>
        overlap(tokens, [...group.tokens]) >= Math.min(2, tokens.length)
    )
    if (match) {
      match.articles.push(article)
      tokens.forEach((token) => match.tokens.add(token))
    } else {
      groups.push({ articles: [article], tokens: new Set(tokens) })
    }
  }

  return groups
    .map((group) => scoreGroup(group, communitySignals, priorityTokens, now))
    .sort(
      (left, right) =>
        right.score - left.score || right.articleCount - left.articleCount
    )
    .slice(0, Math.max(1, Math.min(20, Math.floor(limit))))
    .map((issue, index) => ({ ...issue, id: `recommended-issue-${index + 1}` }))
}

function scoreGroup(
  group: IssueGroup,
  communitySignals: NewsIssueCommunitySignal[],
  priorityTokens: string[],
  now: number
) {
  const sources = new Set(
    group.articles.map((article) => article.source).filter(Boolean)
  )
  const latestAt = Math.max(
    ...group.articles.map((article) => new Date(article.publishedAt).getTime())
  )
  const ageHours = Math.max(0, (now - latestAt) / 3_600_000)
  const matchingCommunity = communitySignals.filter((signal) =>
    signal.neutralTerms.some((term) => group.tokens.has(term))
  )
  const communityMentionCount = matchingCommunity.reduce(
    (total, signal) => total + signal.mentionCount,
    0
  )
  const priorityMatches = overlap([...group.tokens], priorityTokens)
  const corpus = group.articles.map((article) => article.title).join(" ")
  const targetHits = matchCount(corpus, DIRECTION_TARGET)
  const criticalHits = matchCount(corpus, CRITICAL_ANGLE)
  const impactHits = matchCount(corpus, PUBLIC_IMPACT)
  const evidenceHits = matchCount(corpus, EVIDENCE_SIGNAL)
  const directionPoints = Math.min(
    35,
    priorityMatches * 5 + Math.min(15, targetHits * 5)
  )
  const criticalPoints = Math.min(25, criticalHits * 5)
  const impactPoints = Math.min(15, impactHits * 5)
  const evidencePoints = Math.min(15, evidenceHits * 5)
  const verificationPoints = Math.min(
    10,
    Math.min(5, sources.size * 2) + Math.max(0, 5 * Math.exp(-ageHours / 24))
  )
  const score = Math.round(
    directionPoints +
      criticalPoints +
      impactPoints +
      evidencePoints +
      verificationPoints
  )
  const articlePoints = Math.min(35, group.articles.length * 9)
  const diversityPoints = Math.min(25, sources.size * 7)
  const recencyPoints = Math.max(0, 25 * Math.exp(-ageHours / 24))
  const communityPoints = Math.min(15, communityMentionCount * 2)
  const trendScore = Math.round(
    articlePoints + diversityPoints + recencyPoints + communityPoints
  )
  const representative = [...group.articles].sort(
    (left, right) =>
      articleDirectionSignals(right.title, priorityTokens) -
        articleDirectionSignals(left.title, priorityTokens) ||
      new Date(right.publishedAt).getTime() -
        new Date(left.publishedAt).getTime()
  )[0]
  const title = cleanIssueTitle(representative.title)
  // 그룹에는 공통 단어가 우연히 겹친 다른 기사가 섞일 수 있다. 검색어는
  // 그룹 최초 기사의 토큰이 아니라 화면에 보여 주는 대표 기사에서 만든다.
  // 그래야 제목과 전혀 다른 YouTube 검색어가 저장되지 않는다.
  const representativeTokens = issueTokens(title)
  const keywords = representativeTokens.slice(0, 8)
  const reasons = []
  if (directionPoints > 0) reasons.push("채널 방향과 관련")
  if (criticalPoints > 0) reasons.push("비판 포인트 확인")
  if (impactPoints > 0) reasons.push("국민 생활 영향")
  if (evidencePoints > 0) reasons.push("수치·직접 발언 등 근거 가능")
  if (sources.size >= 2) reasons.push(`${sources.size}개 매체 교차 확인`)
  if (communityMentionCount > 0) {
    reasons.push(`공개 커뮤니티 관심 ${communityMentionCount}건`)
  }
  return {
    id: "",
    title,
    searchQuery: sourceSearchTerms(representativeTokens).join(" ") || title,
    keywords,
    score: Math.min(100, score),
    trendScore: Math.min(100, trendScore),
    articleCount: group.articles.length,
    sourceCount: Math.max(1, sources.size),
    communityMentionCount,
    recommendationReason:
      reasons.join(" · ") || "채널 방향과의 직접 관련성이 낮음",
    articles: group.articles.slice(0, 3),
  } satisfies RecommendedNewsIssue
}

const SOURCE_SEARCH_WEAK_TERMS = new Set([
  "정부",
  "관련",
  "논란",
  "발표",
  "오늘",
  "최근",
  "뉴스",
  "번째",
  "에도",
  "위해",
  "대한",
])

function sourceSearchTerms(tokens: string[]) {
  const specific = tokens.filter(
    (token) => !SOURCE_SEARCH_WEAK_TERMS.has(token)
  )
  return [...specific, ...tokens]
    .filter((token, index, values) => values.indexOf(token) === index)
    .slice(0, 4)
}

function articleDirectionSignals(title: string, priorityTokens: string[]) {
  return (
    overlap(issueTokens(title), priorityTokens) * 3 +
    matchCount(title, DIRECTION_TARGET) * 2 +
    matchCount(title, CRITICAL_ANGLE) * 2 +
    matchCount(title, PUBLIC_IMPACT) +
    matchCount(title, EVIDENCE_SIGNAL)
  )
}

function matchCount(value: string, pattern: RegExp) {
  pattern.lastIndex = 0
  const count = value.match(pattern)?.length ?? 0
  pattern.lastIndex = 0
  return count
}

function validArticle(article: NewsIssueArticle, now = Date.now()) {
  return (
    article.title.trim().length >= 4 &&
    isPrimarilyKorean(article.title) &&
    /^https?:\/\//.test(article.url) &&
    Number.isFinite(new Date(article.publishedAt).getTime()) &&
    isWithinNewsMaxAge(article.publishedAt, now)
  )
}

function cleanIssueTitle(value: string) {
  return value
    .replace(/\s+-\s+[^-]{2,30}$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72)
}

function overlap(left: string[], right: string[]) {
  const rightSet = new Set(right)
  return left.filter((token) => rightSet.has(token)).length
}
