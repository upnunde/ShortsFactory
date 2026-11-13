import type { KeepRange, RemovedRange } from "./types.ts"

export type SourceAssemblyRange = { start: number; end: number }

export function buildSourceAssemblyPlan(value: unknown): {
  ranges: SourceAssemblyRange[]
  keepRanges: KeepRange[]
  removedRanges: RemovedRange[]
  duration: number
} {
  const ranges = normalizeSourceAssemblyRanges(value)
  let outputCursor = 0
  const keepRanges = ranges.map((range) => {
    const duration = range.end - range.start
    const keep = {
      sourceStart: range.start,
      sourceEnd: range.end,
      outputStart: outputCursor,
      outputEnd: outputCursor + duration,
    }
    outputCursor += duration
    return keep
  })
  const removedRanges = ranges.slice(0, -1).flatMap((range, index) => {
    const next = ranges[index + 1]
    if (!next || next.start <= range.end + 0.08) return []
    return [
      {
        id: `summary-gap-${index + 1}`,
        start: range.end,
        end: next.start,
        reason: "manual" as const,
        restored: false,
      },
    ]
  })
  return { ranges, keepRanges, removedRanges, duration: outputCursor }
}

export function normalizeSourceAssemblyRanges(value: unknown) {
  if (!Array.isArray(value)) return []
  const normalized = value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const record = item as {
        start?: unknown
        end?: unknown
        sourceStart?: unknown
        sourceEnd?: unknown
      }
      const rawStart = Number(record.start ?? record.sourceStart)
      const rawEnd = Number(record.end ?? record.sourceEnd)
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return []
      const start = Math.max(0, Math.min(rawStart, rawEnd))
      const end = Math.max(start, Math.max(rawStart, rawEnd))
      return end - start >= 0.12 ? [{ start, end }] : []
    })
    .toSorted((left, right) => left.start - right.start || left.end - right.end)
  const merged: SourceAssemblyRange[] = []
  for (const range of normalized) {
    const previous = merged.at(-1)
    if (!previous || range.start > previous.end + 0.08) {
      merged.push(range)
    } else {
      previous.end = Math.max(previous.end, range.end)
    }
  }
  return merged.slice(0, 8)
}
