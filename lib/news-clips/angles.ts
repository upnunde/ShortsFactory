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

export type AngleTranscriptSegment = {
  id: string
  text: string
  start: number
  end: number
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

/** 실제 사용할 원본 구간과 겹치는 전사 문장을 빠짐없이 시간순으로 반환한다. */
export function transcriptForAngle<T extends AngleTranscriptSegment>(
  angle: Pick<NewsAngleOption, "sourceStart" | "sourceEnd">,
  transcript: T[]
) {
  if (!angleHasLockedRange(angle)) return []

  return transcript
    .filter(
      (segment) =>
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end > angle.sourceStart &&
        segment.start < angle.sourceEnd &&
        segment.text.trim().length > 0
    )
    .toSorted((a, b) => a.start - b.start || a.end - b.end)
}

/** 2번에서 보여주는 문장 범위와 실제 영상 범위를 동일하게 맞춘다. */
export function lockAngleRangeToTranscript<T extends NewsAngleOption>(
  angle: T,
  transcript: AngleTranscriptSegment[]
): T {
  const segments = transcriptForAngle(angle, transcript)
  const first = segments[0]
  const last = segments.at(-1)
  if (!first || !last) return angle

  return {
    ...angle,
    sourceStart: Math.round(first.start * 100) / 100,
    sourceEnd: Math.round(last.end * 100) / 100,
  }
}

/** 주어·대상이 없는 짧은 서술어부터 시작하면 바로 앞 발언까지 포함한다. */
export function includeLeadingContext<T extends NewsAngleOption>(
  angle: T,
  transcript: AngleTranscriptSegment[]
): T {
  const ordered = transcript
    .filter(
      (segment) =>
        segment.text.trim() &&
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end > segment.start
    )
    .toSorted((left, right) => left.start - right.start || left.end - right.end)
  const firstIndex = ordered.findIndex(
    (segment) =>
      segment.end > angle.sourceStart && segment.start < angle.sourceEnd
  )
  if (firstIndex <= 0) return angle
  const firstText = ordered[firstIndex]!.text.replace(/\s+/g, " ").trim()
  if (!openingNeedsContext(firstText)) return angle

  let contextIndex = firstIndex - 1
  while (
    contextIndex > 0 &&
    !/[.!?。！？]["'”’)]*\s*$/.test(ordered[contextIndex - 1]!.text.trim())
  ) {
    contextIndex -= 1
  }
  return {
    ...angle,
    sourceStart: Math.round(ordered[contextIndex]!.start * 100) / 100,
  }
}

function openingNeedsContext(text: string) {
  if (!text) return false
  if (
    /^(?:그래서|그런데|하지만|그러나|그리고|그러니까|때문에|결국|반면|또한|즉|그러면서|이 때문에|그 결과|이런 상황에서|그게|이게)(?:\s|[,，])/u.test(
      text
    )
  ) {
    return true
  }
  const compact = text.replace(/\s+/g, "")
  const hasExplicitSubject =
    /[가-힣A-Za-z0-9]+(?:은|는|이|가|께서)(?:\s|[,，])/u.test(text)
  return (!text.includes(" ") || compact.length <= 14) && !hasExplicitSubject
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
