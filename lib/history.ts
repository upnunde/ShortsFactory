import type { StepId } from "@/lib/types"

export type HistoryEntry = {
  id: string
  topic: string
  step: StepId
  updatedAt: string
  hasVideo: boolean
  signature: string
}

export function isHistoryId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}
