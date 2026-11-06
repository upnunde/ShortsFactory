import { issueTokens } from "./discovery.ts"

const WEAK_FOCUS_TERMS = new Set([
  "정부",
  "정책",
  "논란",
  "관련",
  "발표",
  "국회",
  "통과",
  "확대",
  "추진",
  "시작",
  "오늘",
  "최근",
  "뉴스",
])

export type NewsIssueFocus = {
  title: string
  keywords: string[]
  reason?: string
  articleTitles?: string[]
}

export function issueCoreTerms(issue: NewsIssueFocus) {
  const titleTerms = issueTokens(issue.title).filter(
    (term) => !WEAK_FOCUS_TERMS.has(term)
  )
  const keywordTerms = issue.keywords
    .flatMap(issueTokens)
    .filter((term) => !WEAK_FOCUS_TERMS.has(term))
  return [...new Set([...titleTerms, ...keywordTerms])].slice(0, 10)
}

export function issueAngleTerms(issue: NewsIssueFocus) {
  const titleTerms = issueTokens(issue.title).filter(
    (term) => !WEAK_FOCUS_TERMS.has(term)
  )
  const ending = titleTerms.slice(-3)
  const withoutQuestionEnding = ending.filter(
    (term) => !/(?:나|까|인가|되나|하나)$/u.test(term)
  )
  return withoutQuestionEnding.length ? withoutQuestionEnding : ending
}

export function scriptMatchesIssueFocus(script: string, issue: NewsIssueFocus) {
  if (!issue.title.trim()) return true
  const normalized = compact(script)
  const coreTerms = issueCoreTerms(issue)
  const angleTerms = issueAngleTerms(issue)
  const coreMatches = matchingCount(normalized, coreTerms)
  const angleMatches = matchingCount(normalized, angleTerms)
  return (
    coreMatches >= Math.min(2, coreTerms.length) &&
    angleMatches >= Math.min(2, angleTerms.length)
  )
}

function matchingCount(value: string, terms: string[]) {
  return terms.filter((term) => value.includes(compact(term))).length
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]/g, "")
}
