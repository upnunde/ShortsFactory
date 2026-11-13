export type NewsAngleSourceRange = {
  id: string
  label: string
  summary: string
  evidence: string
  sourceStart: number
  sourceEnd: number
}

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
  /** 영상 요약형에서 하나의 주제를 조립하는 복수 원본 구간. */
  ranges?: NewsAngleSourceRange[]
  /** 공백 구간을 제외한 ranges 실제 재생 시간 합계. */
  estimatedDurationSeconds?: number
}

export type AngleTranscriptSegment = {
  id: string
  text: string
  start: number
  end: number
  words?: Array<{ text: string; start: number; end: number }>
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
    .filter((segment) => {
      const speech = angleTranscriptSpeechBounds(segment)
      return (
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        speech.end > angle.sourceStart &&
        speech.start < angle.sourceEnd &&
        segment.text.trim().length > 0
      )
    })
    .toSorted((a, b) => {
      const aSpeech = angleTranscriptSpeechBounds(a)
      const bSpeech = angleTranscriptSpeechBounds(b)
      return aSpeech.start - bSpeech.start || aSpeech.end - bSpeech.end
    })
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
    sourceStart:
      Math.round(angleTranscriptSpeechBounds(first).start * 100) / 100,
    sourceEnd: Math.round(angleTranscriptSpeechBounds(last).end * 100) / 100,
  }
}

/** 주어·대상이 없는 짧은 서술어부터 시작하면 바로 앞 발언까지 포함한다. */
export function includeLeadingContext<T extends NewsAngleOption>(
  angle: T,
  transcript: AngleTranscriptSegment[]
): T {
  const ordered = transcript
    .filter((segment) => {
      const speech = angleTranscriptSpeechBounds(segment)
      return (
        segment.text.trim() &&
        Number.isFinite(speech.start) &&
        Number.isFinite(speech.end) &&
        speech.end > speech.start
      )
    })
    .toSorted((left, right) => {
      const leftSpeech = angleTranscriptSpeechBounds(left)
      const rightSpeech = angleTranscriptSpeechBounds(right)
      return (
        leftSpeech.start - rightSpeech.start || leftSpeech.end - rightSpeech.end
      )
    })
  const firstIndex = ordered.findIndex((segment) => {
    const speech = angleTranscriptSpeechBounds(segment)
    return speech.end > angle.sourceStart && speech.start < angle.sourceEnd
  })
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
    sourceStart:
      Math.round(
        angleTranscriptSpeechBounds(ordered[contextIndex]!).start * 100
      ) / 100,
  }
}

/** 자막 표시 tail이 아닌 단어 타임스탬프를 각도 범위의 기준으로 쓴다. */
function angleTranscriptSpeechBounds(segment: AngleTranscriptSegment) {
  const words = (segment.words ?? []).filter(
    (word) =>
      word.text.trim() &&
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start
  )
  if (!words.length) return { start: segment.start, end: segment.end }
  return {
    start: Math.min(...words.map((word) => word.start)),
    end: Math.max(...words.map((word) => word.end)),
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
      const ranges = normalizeAngleRanges(record.ranges)
      const rawStart = Number(
        record.sourceStart ??
          record.source_start ??
          record.start ??
          ranges[0]?.sourceStart
      )
      const rawEnd = Number(
        record.sourceEnd ??
          record.source_end ??
          record.end ??
          ranges.at(-1)?.sourceEnd
      )
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
          ...(ranges.length ? { ranges } : {}),
          ...(ranges.length ||
          Number.isFinite(Number(record.estimatedDurationSeconds))
            ? {
                estimatedDurationSeconds:
                  Math.round(
                    (ranges.length
                      ? ranges.reduce(
                          (total, range) =>
                            total + (range.sourceEnd - range.sourceStart),
                          0
                        )
                      : Math.max(0, Number(record.estimatedDurationSeconds))) *
                      100
                  ) / 100,
              }
            : {}),
        } satisfies NewsAngleOption,
      ]
    })
    .slice(0, 6)
}

function normalizeAngleRanges(value: unknown): NewsAngleSourceRange[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item, index) => {
      if (!item || typeof item !== "object") return []
      const record = item as Partial<NewsAngleSourceRange> & {
        source_start?: unknown
        source_end?: unknown
        start?: unknown
        end?: unknown
      }
      const rawStart = Number(
        record.sourceStart ?? record.source_start ?? record.start
      )
      const rawEnd = Number(record.sourceEnd ?? record.source_end ?? record.end)
      if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return []
      const sourceStart = Math.max(0, rawStart)
      const sourceEnd = Math.max(sourceStart, rawEnd)
      if (sourceEnd - sourceStart < 0.12) return []
      return [
        {
          id:
            typeof record.id === "string" && record.id.trim()
              ? record.id.trim().slice(0, 120)
              : `angle-range-${index + 1}`,
          label:
            typeof record.label === "string"
              ? record.label.trim().slice(0, 80)
              : `핵심 구간 ${index + 1}`,
          summary:
            typeof record.summary === "string"
              ? record.summary.trim().slice(0, 300)
              : "",
          evidence:
            typeof record.evidence === "string"
              ? record.evidence.trim().slice(0, 600)
              : "",
          sourceStart: Math.round(sourceStart * 100) / 100,
          sourceEnd: Math.round(sourceEnd * 100) / 100,
        },
      ]
    })
    .toSorted(
      (left, right) =>
        left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    )
    .slice(0, 8)
}
