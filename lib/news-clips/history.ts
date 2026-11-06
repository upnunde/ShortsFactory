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
  hasPreview: boolean
  hasFinal: boolean
  durationSeconds: number
}

export function isNewsHistoryId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  )
}
