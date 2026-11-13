import type { NewsIssueSearchState } from "./issues.ts"
import type {
  NewsClipProject,
  NewsClipStep,
  NewsSourceSearchState,
} from "./types.ts"

export type NewsHistorySnapshot = {
  step: NewsClipStep
  furthestStep: NewsClipStep
  project: NewsClipProject
  transcriptDraft: string
  issueSearch: NewsIssueSearchState
  sourceSearch: NewsSourceSearchState
  finalized: boolean
  completedAt?: string
  savedAt: string
}

export type NewsHistoryEntry = {
  id: string
  profileId: string
  title: string
  issueTitle: string
  step: NewsClipStep
  updatedAt: string
  finalized: boolean
  completedAt?: string
  hasPreview: boolean
  hasFinal: boolean
  durationSeconds: number
}

export function newsHistoryActivityAt(entry: NewsHistoryEntry) {
  return entry.finalized && validHistoryDate(entry.completedAt)
    ? entry.completedAt
    : entry.updatedAt
}

export function resolveNewsHistoryCompletedAt({
  finalized,
  requested,
  existing,
  fallback,
}: {
  finalized: boolean
  requested?: string
  existing?: string
  fallback: string
}) {
  const known = [requested, existing]
    .filter(validHistoryDate)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  if (known[0]) return known[0]
  return finalized && validHistoryDate(fallback) ? fallback : undefined
}

export function isNewsHistoryId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
}

function validHistoryDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime())
}
