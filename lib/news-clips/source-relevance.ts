import { issueTokens } from "./discovery.ts"

const GENERIC_TERMS = new Set([
  "정부",
  "정책",
  "논란",
  "관련",
  "발표",
  "사건",
  "상황",
  "문제",
  "오늘",
  "최근",
  "뉴스",
  "국회",
  "영상",
  "보도",
  "단독",
  "속보",
  "통과",
  "추진",
  "시작",
  "확대",
  "대한",
  "위해",
  "번째",
  "에도",
])

export type SourceRelevanceContext = {
  title: string
  keywords: string[]
}

export type SourceRelevanceInput = {
  title: string
  description: string
  transcriptExcerpt?: string
  publishedAt?: string
}

export function scoreSourceRelevance(
  context: SourceRelevanceContext,
  source: SourceRelevanceInput
) {
  const keywordTerms = context.keywords.flatMap(issueTokens)
  const topicTerms = issueTokens(context.title)
  // 저장된 예전 프로젝트의 keywords가 대표 제목과 어긋나더라도 현재 화면의
  // 이슈 제목이 항상 우선하도록 제목 토큰을 앞에 둔다.
  const allTerms = uniqueTerms([...topicTerms, ...keywordTerms]).slice(0, 10)
  const coreTerms = uniqueTerms(
    [...topicTerms, ...keywordTerms].filter((term) => !GENERIC_TERMS.has(term))
  ).slice(0, 6)
  const effectiveCore = coreTerms.length ? coreTerms : allTerms.slice(0, 6)
  if (!effectiveCore.length) {
    return emptyRelevance("이슈 핵심어를 확인할 수 없음")
  }

  const titleMatches = matchingTerms(effectiveCore, source.title)
  const descriptionMatches = matchingTerms(effectiveCore, source.description)
  const transcriptMatches = matchingTerms(
    effectiveCore,
    source.transcriptExcerpt ?? ""
  )
  const matchedCore = new Set([
    ...titleMatches,
    ...descriptionMatches,
    ...transcriptMatches,
  ])
  // 주제명만 겹치는 영상보다 제목 끝의 구체 논점까지 다루는 영상을 위로
  // 올린다. 예: 기본소득 일반 영상보다 '지방재정 부담' 영상.
  const coverage = matchedCore.size / effectiveCore.length
  const titleCoverage = titleMatches.length / Math.min(3, effectiveCore.length)
  const evidenceCoverage =
    new Set([...descriptionMatches, ...transcriptMatches]).size /
    Math.min(3, effectiveCore.length)
  const corePoints = 50 * Math.min(1, coverage)
  const titlePoints = 25 * Math.min(1, titleCoverage)
  const evidencePoints = 20 * Math.min(1, evidenceCoverage)
  const recencyPoints = recentWithinDays(source.publishedAt, 7) ? 5 : 0
  const score = Math.min(
    100,
    Math.round(
      Math.max(
        corePoints + titlePoints + evidencePoints + recencyPoints,
        titleMatches.length >= 2 ? 55 : 0
      )
    )
  )
  const passes =
    (matchedCore.size >= 2 && titleMatches.length >= 1 && score >= 55) ||
    (titleMatches.length >= 1 && transcriptMatches.length >= 1 && score >= 48)
  const reason = passes
    ? `핵심어 ${matchedCore.size}개 일치 · 제목 ${titleMatches.length}개 · 근거 ${descriptionMatches.length + transcriptMatches.length}개`
    : `주제 연관도 부족 · 핵심어 ${matchedCore.size}개 · 제목 ${titleMatches.length}개`

  return {
    score,
    passes,
    reason,
    coreTerms: effectiveCore,
    titleMatches,
    descriptionMatches,
    transcriptMatches,
  }
}

function emptyRelevance(reason: string) {
  return {
    score: 0,
    passes: false,
    reason,
    coreTerms: [] as string[],
    titleMatches: [] as string[],
    descriptionMatches: [] as string[],
    transcriptMatches: [] as string[],
  }
}

function uniqueTerms(values: string[]) {
  return [...new Set(values.map(normalizeTerm).filter(Boolean))]
}

function normalizeTerm(value: string) {
  return value
    .trim()
    .replace(
      /(?:에서|으로|으로는|에게|부터|까지|이라는|라는|은|는|이|가|을|를|의|에|와|과|로|도|만)$/u,
      ""
    )
}

function matchingTerms(terms: string[], value: string) {
  const normalized = value.toLowerCase().replace(/[^0-9a-z가-힣]/g, "")
  return terms.filter((term) => {
    const needle = term.toLowerCase().replace(/[^0-9a-z가-힣]/g, "")
    return needle.length >= 2 && normalized.includes(needle)
  })
}

function recentWithinDays(value: string | undefined, days: number) {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  return (
    Number.isFinite(timestamp) &&
    timestamp <= Date.now() + 86_400_000 &&
    timestamp >= Date.now() - days * 86_400_000
  )
}
