export type NewsAngleOption = {
  id: string
  title: string
  summary: string
  keywords: string[]
  /** 선택 구간에서 실제로 확인되는 원문 일부. AI 요약과 원본 근거를 구분한다. */
  evidence: string
  /** 이 주제를 뒷받침하는 원본 구간(초). 없으면 0. */
  sourceStart: number
  sourceEnd: number
}

export function angleHasLockedRange(
  angle: Pick<NewsAngleOption, "sourceStart" | "sourceEnd">
) {
  return (
    Number.isFinite(angle.sourceStart) &&
    Number.isFinite(angle.sourceEnd) &&
    angle.sourceEnd - angle.sourceStart >= 3
  )
}

export function normalizeAngleOptions(value: unknown): NewsAngleOption[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return []
      const record = item as Partial<NewsAngleOption> & {
        source_start?: unknown
        source_end?: unknown
        start?: unknown
        end?: unknown
      }
      const title = typeof record.title === "string" ? record.title.trim() : ""
      const summary =
        typeof record.summary === "string" ? record.summary.trim() : ""
      if (!title || !summary) return []
      const rawStart = Number(
        record.sourceStart ?? record.source_start ?? record.start
      )
      const rawEnd = Number(record.sourceEnd ?? record.source_end ?? record.end)
      const sourceStart = Number.isFinite(rawStart) ? Math.max(0, rawStart) : 0
      const sourceEnd = Number.isFinite(rawEnd)
        ? Math.max(sourceStart, rawEnd)
        : sourceStart
      return [
        {
          id:
            typeof record.id === "string" && record.id.trim()
              ? record.id.trim()
              : `angle-${index + 1}`,
          title: title.slice(0, 80),
          summary: summary.slice(0, 180),
          keywords: Array.isArray(record.keywords)
            ? record.keywords
                .filter((term): term is string => typeof term === "string")
                .map((term) => term.trim())
                .filter(Boolean)
                .slice(0, 6)
            : [],
          evidence:
            typeof record.evidence === "string"
              ? record.evidence.trim().slice(0, 260)
              : "",
          sourceStart: Math.round(sourceStart * 100) / 100,
          sourceEnd: Math.round(sourceEnd * 100) / 100,
        } satisfies NewsAngleOption,
      ]
    })
    .slice(0, 6)
}
