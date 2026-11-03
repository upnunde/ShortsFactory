import type { StepId } from "@/lib/types"

export type HistoryBadge = "scenes" | "film" | "upload"

export type HistoryEntry = {
  id: string
  topic: string
  step: StepId
  updatedAt: string
  hasVideo: boolean
  hasUpload: boolean
  signature: string
  profileId: string
}

export const HISTORY_BADGE_LABEL: Record<HistoryBadge, string> = {
  scenes: "씬완료",
  film: "영상완료",
  upload: "업로드완료",
}

export function isHistoryId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  )
}

export function historyBadge(entry: Pick<HistoryEntry, "hasUpload" | "hasVideo">): HistoryBadge {
  if (entry.hasUpload) {
    return "upload"
  }
  if (entry.hasVideo) {
    return "film"
  }
  return "scenes"
}

export function historyListable(
  entry: Pick<HistoryEntry, "step" | "hasVideo" | "hasUpload">
) {
  return (
    entry.hasUpload ||
    entry.hasVideo ||
    entry.step === "scenes" ||
    entry.step === "film" ||
    entry.step === "upload"
  )
}
