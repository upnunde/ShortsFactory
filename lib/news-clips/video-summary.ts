import { isPrimarilyKorean } from "./language.ts"
import { snapSourceRangeToCompleteUtterance } from "./speech-bounds.ts"
import type { NewsAngleOption } from "./angles.ts"
import type { TranscriptSegment } from "./types.ts"

export type VideoSummaryRangeRole =
  "hook" | "context" | "evidence" | "conclusion"

export type VideoSummarySourceRange = {
  id: string
  sourceId: string
  sourceStart: number
  sourceEnd: number
  order: number
  role: VideoSummaryRangeRole
  label: string
  summary: string
  evidence: string
  transcriptSegmentIds: string[]
}

export type VideoSummaryTopicOption = {
  id: string
  title: string
  summary: string
  keywords: string[]
  sourceRanges: VideoSummarySourceRange[]
  /** 확정된 복수 구간의 원문을 재생 순서로 이은 검수용 미리보기. */
  assemblyPreview: string
  /** 구간 사이의 버려진 시간을 제외한 실제 재생 예상 길이. */
  estimatedDurationSeconds: number
}

export type VideoSummaryCoverage = {
  sourceStart: number
  sourceEnd: number
  transcriptSegmentCount: number
  transcriptWordCount: number
}

export type VideoSummaryPlan = {
  sourceId: string
  overallSummary: string
  topics: VideoSummaryTopicOption[]
  coverage: VideoSummaryCoverage
}

export type VideoSummaryTranscriptChunk = {
  id: string
  sourceStart: number
  sourceEnd: number
  segments: Array<{
    id: string
    start: number
    end: number
    text: string
  }>
}

type NormalizeVideoSummaryOptions = {
  sourceId?: string
  minTopics?: number
  maxTopics?: number
  minRangesPerTopic?: number
  maxRangesPerTopic?: number
}

/**
 * AI가 제안한 시간을 그대로 믿지 않고 기존 전사의 문장·단어 경계로 재확정한다.
 * evidence와 assemblyPreview도 모델 문구가 아닌 확정 원문에서만 만든다.
 */
export function normalizeVideoSummaryPlan(
  value: unknown,
  transcript: TranscriptSegment[],
  options: NormalizeVideoSummaryOptions = {}
): VideoSummaryPlan {
  const record = asRecord(value)
  const sourceId = cleanText(options.sourceId ?? record.sourceId, 160)
  const minTopics = clampInteger(options.minTopics ?? 3, 1, 5)
  const maxTopics = clampInteger(options.maxTopics ?? 5, minTopics, 5)
  const minRanges = clampInteger(options.minRangesPerTopic ?? 2, 1, 6)
  const maxRanges = clampInteger(options.maxRangesPerTopic ?? 6, minRanges, 8)
  const orderedTranscript = validTranscript(transcript)
  const coverage = transcriptCoverage(orderedTranscript)
  const overallSummary = koreanText(record.overallSummary, 1200)
  const rawTopics = Array.isArray(record.topics) ? record.topics : []
  const topics = rawTopics
    .flatMap((topic, index) => {
      const normalized = normalizeTopic(topic, index, orderedTranscript, {
        sourceId,
        minRanges,
        maxRanges,
        coverage,
      })
      return normalized ? [normalized] : []
    })
    .slice(0, maxTopics)

  return {
    sourceId,
    overallSummary,
    topics,
    coverage,
  }
}

export function videoSummaryPlanIsComplete(
  plan: VideoSummaryPlan,
  options: { minTopics?: number; minRangesPerTopic?: number } = {}
) {
  const minTopics = clampInteger(options.minTopics ?? 3, 1, 5)
  const minRanges = clampInteger(options.minRangesPerTopic ?? 2, 1, 6)
  return (
    plan.overallSummary.length > 0 &&
    isPrimarilyKorean(plan.overallSummary) &&
    plan.topics.length >= minTopics &&
    plan.topics.every(
      (topic) =>
        topic.sourceRanges.length >= minRanges &&
        topic.sourceRanges.every(
          (range) => range.sourceEnd > range.sourceStart && range.evidence
        )
    )
  )
}

/**
 * 신규 요약 탭이 기존 각도 선택 흐름을 재사용할 수 있는 경계.
 * overallSummary는 project.sourceOverview에, 반환값은 angleOptions에 저장하면 된다.
 */
export function videoSummaryPlanToAngleOptions(
  plan: VideoSummaryPlan
): NewsAngleOption[] {
  return plan.topics.map((topic) => {
    const first = topic.sourceRanges[0]
    const last = topic.sourceRanges.at(-1)
    return {
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      keywords: [...topic.keywords],
      evidence: topic.assemblyPreview.slice(0, 260),
      sourceStart: first?.sourceStart ?? 0,
      sourceEnd: last?.sourceEnd ?? first?.sourceEnd ?? 0,
      ranges: topic.sourceRanges.map((range) => ({
        id: range.id,
        label: range.label,
        summary: range.summary,
        evidence: range.evidence,
        sourceStart: range.sourceStart,
        sourceEnd: range.sourceEnd,
      })),
      estimatedDurationSeconds: topic.estimatedDurationSeconds,
    }
  })
}

/** 전체 전사를 누락 없이 AI 분석용 청크로 나눈다. */
export function buildVideoSummaryTranscriptChunks(
  transcript: TranscriptSegment[],
  maxCharacters = 10_000
): VideoSummaryTranscriptChunk[] {
  const limit = Math.max(80, Math.floor(maxCharacters))
  const segments = validTranscript(transcript)
  const chunks: VideoSummaryTranscriptChunk[] = []
  let current: VideoSummaryTranscriptChunk["segments"] = []
  let currentCharacters = 0

  const flush = () => {
    const first = current[0]
    const last = current.at(-1)
    if (!first || !last) return
    chunks.push({
      id: `summary-chunk-${chunks.length + 1}`,
      sourceStart: first.start,
      sourceEnd: last.end,
      segments: current,
    })
    current = []
    currentCharacters = 0
  }

  for (const segment of segments) {
    const bounds = transcriptSegmentSpeechBounds(segment)
    const next = {
      id: segment.id,
      start: bounds.start,
      end: bounds.end,
      text: normalizeWhitespace(segment.text),
    }
    const characters =
      next.text.length + next.id.length + String(next.start).length + 24
    if (current.length > 0 && currentCharacters + characters > limit) flush()
    current.push(next)
    currentCharacters += characters
  }
  flush()
  return chunks
}

function normalizeTopic(
  value: unknown,
  index: number,
  transcript: TranscriptSegment[],
  options: {
    sourceId: string
    minRanges: number
    maxRanges: number
    coverage: VideoSummaryCoverage
  }
): VideoSummaryTopicOption | null {
  const record = asRecord(value)
  const title = koreanText(record.title, 80)
  const summary = koreanText(record.summary, 420)
  if (!title || !summary) return null

  const id = cleanIdentifier(record.id, `summary-topic-${index + 1}`)
  const rawRanges = Array.isArray(record.sourceRanges)
    ? record.sourceRanges
    : Array.isArray(record.ranges)
      ? record.ranges
      : []
  const lockedRanges = rawRanges
    .flatMap((range, rangeIndex) => {
      const normalized = normalizeSourceRange(
        range,
        `${id}-range-${rangeIndex + 1}`,
        options.sourceId,
        transcript,
        options.coverage
      )
      return normalized ? [normalized] : []
    })
    .toSorted(
      (left, right) =>
        left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    )
  const sourceRanges = coalesceSourceRanges(
    lockedRanges,
    transcript,
    options.sourceId
  )
    .slice(0, options.maxRanges)
    .map((range, order) => ({ ...range, order }))
  if (sourceRanges.length < options.minRanges) return null

  const keywords = Array.isArray(record.keywords)
    ? record.keywords
        .filter((keyword): keyword is string => typeof keyword === "string")
        .map((keyword) => normalizeWhitespace(keyword).slice(0, 40))
        .filter(Boolean)
        .slice(0, 8)
    : []
  const assemblyPreview = sourceRanges
    .map((range) => range.evidence)
    .filter(Boolean)
    .join("\n\n")
  const estimatedDurationSeconds = round(
    sourceRanges.reduce(
      (total, range) => total + (range.sourceEnd - range.sourceStart),
      0
    )
  )
  return {
    id,
    title,
    summary,
    keywords,
    sourceRanges,
    assemblyPreview,
    estimatedDurationSeconds,
  }
}

function normalizeSourceRange(
  value: unknown,
  fallbackId: string,
  sourceId: string,
  transcript: TranscriptSegment[],
  coverage: VideoSummaryCoverage
): VideoSummarySourceRange | null {
  const record = asRecord(value)
  const requestedStart = finiteNumber(
    record.sourceStart ?? record.source_start ?? record.start
  )
  const requestedEnd = finiteNumber(
    record.sourceEnd ?? record.source_end ?? record.end
  )
  if (requestedStart === null || requestedEnd === null) return null
  if (
    requestedEnd <= requestedStart ||
    coverage.sourceEnd <= coverage.sourceStart
  )
    return null

  const snapped = snapSourceRangeToCompleteUtterance(
    requestedStart,
    requestedEnd,
    transcript,
    {
      minimumStart: coverage.sourceStart,
      maximumEnd: coverage.sourceEnd,
    }
  )
  return lockedRangeFromBounds(
    snapped.start,
    snapped.end,
    cleanIdentifier(record.id, fallbackId),
    sourceId,
    normalizeRole(record.role),
    cleanText(record.label ?? record.title, 80),
    cleanText(record.summary, 300),
    transcript
  )
}

function lockedRangeFromBounds(
  start: number,
  end: number,
  id: string,
  sourceId: string,
  role: VideoSummaryRangeRole,
  label: string,
  summary: string,
  transcript: TranscriptSegment[]
): VideoSummarySourceRange | null {
  const segments = transcript.filter((segment) => {
    const speech = transcriptSegmentSpeechBounds(segment)
    return speech.end > start + 0.001 && speech.start < end - 0.001
  })
  const first = segments[0]
  const last = segments.at(-1)
  if (!first || !last) return null
  const sourceStart = round(transcriptSegmentSpeechBounds(first).start)
  const sourceEnd = round(transcriptSegmentSpeechBounds(last).end)
  if (sourceEnd - sourceStart < 0.12) return null
  const evidence = segments
    .map((segment) => normalizeWhitespace(segment.text))
    .filter(Boolean)
    .join(" ")
  return {
    id,
    sourceId,
    sourceStart,
    sourceEnd,
    order: 0,
    role,
    label: label || `핵심 구간 ${id.split("-").at(-1) ?? ""}`.trim(),
    summary: summary || evidence,
    evidence,
    transcriptSegmentIds: segments.map((segment) => segment.id),
  }
}

function coalesceSourceRanges(
  ranges: VideoSummarySourceRange[],
  transcript: TranscriptSegment[],
  sourceId: string
) {
  const merged: VideoSummarySourceRange[] = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (!previous || range.sourceStart > previous.sourceEnd + 0.08) {
      merged.push(range)
      continue
    }
    const combined = lockedRangeFromBounds(
      previous.sourceStart,
      Math.max(previous.sourceEnd, range.sourceEnd),
      previous.id,
      sourceId,
      previous.role,
      previous.label,
      previous.summary,
      transcript
    )
    if (combined) merged[merged.length - 1] = combined
  }
  return merged
}

function transcriptCoverage(
  transcript: TranscriptSegment[]
): VideoSummaryCoverage {
  const first = transcript[0]
  const last = transcript.at(-1)
  return {
    sourceStart: first ? round(transcriptSegmentSpeechBounds(first).start) : 0,
    sourceEnd: last ? round(transcriptSegmentSpeechBounds(last).end) : 0,
    transcriptSegmentCount: transcript.length,
    transcriptWordCount: transcript.reduce(
      (count, segment) => count + validWords(segment).length,
      0
    ),
  }
}

function validTranscript(transcript: TranscriptSegment[]) {
  return transcript
    .filter((segment) => {
      const bounds = transcriptSegmentSpeechBounds(segment)
      return (
        normalizeWhitespace(segment.text).length > 0 &&
        Number.isFinite(bounds.start) &&
        Number.isFinite(bounds.end) &&
        bounds.end > bounds.start
      )
    })
    .toSorted((left, right) => {
      const leftBounds = transcriptSegmentSpeechBounds(left)
      const rightBounds = transcriptSegmentSpeechBounds(right)
      return (
        leftBounds.start - rightBounds.start || leftBounds.end - rightBounds.end
      )
    })
}

function transcriptSegmentSpeechBounds(segment: TranscriptSegment) {
  const words = validWords(segment)
  if (!words.length) return { start: segment.start, end: segment.end }
  return {
    start: Math.min(...words.map((word) => word.start)),
    end: Math.max(...words.map((word) => word.end)),
  }
}

function validWords(segment: TranscriptSegment) {
  return segment.words.filter(
    (word) =>
      normalizeWhitespace(word.text).length > 0 &&
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start
  )
}

function normalizeRole(value: unknown): VideoSummaryRangeRole {
  return value === "hook" || value === "context" || value === "conclusion"
    ? value
    : "evidence"
}

function koreanText(value: unknown, maxLength: number) {
  const text = cleanText(value, maxLength)
  return text && isPrimarilyKorean(text) ? text : ""
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? normalizeWhitespace(value).slice(0, maxLength)
    : ""
}

function cleanIdentifier(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback
  const normalized = value.trim().replace(/[^0-9A-Za-z_-]/g, "-")
  return normalized ? normalized.slice(0, 120) : fallback
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

function finiteNumber(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clampInteger(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
