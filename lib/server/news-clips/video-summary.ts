import { parseTranscript } from "../../news-clips/transcript.ts"
import {
  buildVideoSummaryTranscriptChunks,
  normalizeVideoSummaryPlan,
  videoSummaryPlanIsComplete,
  type VideoSummaryPlan,
  type VideoSummaryRangeRole,
  type VideoSummaryTranscriptChunk,
} from "../../news-clips/video-summary.ts"

type VideoSummaryTextGenerator = (
  system: string,
  user: string,
  maxTokens: number
) => Promise<string>

type ExtractVideoSummaryOptions = {
  sourceId: string
  sourceTitle?: string
  maxChunkCharacters?: number
  concurrency?: number
  /** 테스트나 다른 LLM 연결에서도 같은 순수 파이프라인을 쓴다. */
  generateText?: VideoSummaryTextGenerator
}

type ChunkMoment = {
  id: string
  title: string
  summary: string
  keywords: string[]
  sourceStart: number
  sourceEnd: number
}

type ChunkAnalysis = {
  chunkId: string
  summary: string
  moments: ChunkMoment[]
}

/**
 * 전체 영상을 앞부분만 잘라 보지 않고 청크 요약 → 전체 주제 조립으로 분석한다.
 * 최종 구간은 normalizeVideoSummaryPlan에서 실제 문장·단어 타임코드로 다시 잠긴다.
 */
export async function extractVideoSummaryPlan(
  transcriptText: string,
  options: ExtractVideoSummaryOptions
): Promise<VideoSummaryPlan> {
  const transcript = parseTranscript(transcriptText)
  const chunks = buildVideoSummaryTranscriptChunks(
    transcript,
    options.maxChunkCharacters ?? 10_000
  )
  if (!chunks.length) throw new Error("empty-video-transcript")

  const generateText = options.generateText ?? defaultVideoSummaryTextGenerator
  const chunkAnalyses = await mapWithConcurrency(
    chunks,
    Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2))),
    async (chunk) =>
      analyzeTranscriptChunk(chunk, options.sourceTitle ?? "", generateText)
  )
  const moments = chunkAnalyses.flatMap((analysis) => analysis.moments)
  // 짧은 영상이나 모델이 일부 moment를 누락한 경우에도 실제 전사에서
  // 보충한 3개 이상의 발언이 있으면 3개 후보를 구성할 수 있다.
  if (moments.length < 3) throw new Error("insufficient-summary-moments")

  let reduced: Record<string, unknown> = {}
  try {
    const reducedText = await generateText(
      [
        "너는 긴 한국어 영상을 요약형 쇼츠로 재구성하는 편집자다.",
        "아래는 전체 영상을 누락 없이 나눈 청크별 요약과, 실제 타임코드가 있는 moment 목록이다.",
        "overallSummary는 영상 전체 흐름을 4~7문장의 자연스러운 한국어로 정리한다.",
        "topics는 서로 겹치지 않는 핵심 주제 후보 3~5개다.",
        "각 주제는 서로 떨어진 moment를 2~6개 선택해 하나의 완결된 요약 영상으로 조립할 수 있어야 한다.",
        "같은 발언을 반복하지 말고, sourceRanges는 원본 시간순으로 배치한다.",
        "rangeId는 아래 moments에 있는 id만 사용한다. 시간과 내용을 새로 만들지 않는다.",
        "role은 hook, context, evidence, conclusion 중 하나다.",
        "JSON 객체만 출력한다:",
        '{"overallSummary":"...","topics":[{"id":"topic-1","title":"...","summary":"...","keywords":["..."],"sourceRanges":[{"rangeId":"summary-chunk-1-moment-1","role":"hook"}]}]}',
      ].join("\n"),
      JSON.stringify({
        sourceTitle: options.sourceTitle ?? "",
        chunks: chunkAnalyses.map((analysis) => ({
          id: analysis.chunkId,
          summary: analysis.summary,
        })),
        moments,
      }),
      2600
    )
    reduced = asRecord(parseJson(reducedText))
  } catch {
    // 모델 응답이 일시적으로 깨져도 아래의 실제 전사 기반 복구 계획을 쓴다.
  }
  const momentById = new Map(moments.map((moment) => [moment.id, moment]))
  const rawTopics = Array.isArray(reduced.topics) ? reduced.topics : []
  const topics = rawTopics.map((topic) => {
    const record = asRecord(topic)
    const refs = Array.isArray(record.sourceRanges)
      ? record.sourceRanges
      : Array.isArray(record.rangeIds)
        ? record.rangeIds
        : []
    return {
      id: record.id,
      title: record.title,
      summary: record.summary,
      keywords: record.keywords,
      sourceRanges: refs.flatMap((reference) => {
        const ref = asRecord(reference)
        const rangeId =
          typeof reference === "string"
            ? reference
            : typeof ref.rangeId === "string"
              ? ref.rangeId
              : ""
        const moment = momentById.get(rangeId)
        if (!moment) return []
        return [
          {
            id: moment.id,
            label: moment.title,
            summary: moment.summary,
            sourceStart: moment.sourceStart,
            sourceEnd: moment.sourceEnd,
            role: normalizeRole(ref.role),
          },
        ]
      }),
    }
  })
  let plan = normalizeVideoSummaryPlan(
    {
      sourceId: options.sourceId,
      overallSummary: reduced.overallSummary,
      topics,
    },
    transcript,
    { sourceId: options.sourceId }
  )
  if (!videoSummaryPlanIsComplete(plan)) {
    plan = normalizeVideoSummaryPlan(
      {
        sourceId: options.sourceId,
        overallSummary:
          plan.overallSummary || fallbackOverallSummary(chunkAnalyses, moments),
        topics: [...topics, ...fallbackTopics(moments)],
      },
      transcript,
      { sourceId: options.sourceId }
    )
  }
  if (!videoSummaryPlanIsComplete(plan)) {
    throw new Error("incomplete-video-summary")
  }
  return plan
}

async function defaultVideoSummaryTextGenerator(
  system: string,
  user: string,
  maxTokens: number
) {
  const { claudeText } = await import("../anthropic.ts")
  return claudeText(system, user, maxTokens)
}

async function analyzeTranscriptChunk(
  chunk: VideoSummaryTranscriptChunk,
  sourceTitle: string,
  generateText: VideoSummaryTextGenerator
): Promise<ChunkAnalysis> {
  let parsed: Record<string, unknown> = {}
  try {
    const response = await generateText(
      [
        "너는 한국어 영상 전사에서 요약 재료를 추출하는 분석가다.",
        "입력은 전체 영상의 하나의 연속 청크다.",
        "summary는 이 청크의 핵심을 2~4문장의 한국어로 요약한다.",
        "moments는 후보 영상에 쓸 수 있는 서로 다른 핵심 발언 4~8개다.",
        "moment의 sourceStart/sourceEnd는 입력 segment의 실제 start/end 범위만 쓴다.",
        "주어·대상·결론이 있는 완결된 발언을 선택하고, 같은 내용을 반복하지 않는다.",
        "원문에 없는 사실을 추가하지 않는다.",
        "JSON 객체만 출력한다:",
        '{"summary":"...","moments":[{"title":"...","summary":"...","keywords":["..."],"sourceStart":0,"sourceEnd":10}]}',
      ].join("\n"),
      JSON.stringify({ sourceTitle, chunk }),
      1500
    )
    parsed = asRecord(parseJson(response))
  } catch {
    // 이 청크만 실제 전사 문장으로 복구해 전체 분석 실패를 막는다.
  }
  const rawMoments = Array.isArray(parsed.moments) ? parsed.moments : []
  const generatedMoments = rawMoments
    .flatMap((value, index) => {
      const record = asRecord(value)
      const sourceStart = finiteNumber(record.sourceStart)
      const sourceEnd = finiteNumber(record.sourceEnd)
      if (
        sourceStart === null ||
        sourceEnd === null ||
        sourceEnd <= sourceStart ||
        sourceEnd < chunk.sourceStart ||
        sourceStart > chunk.sourceEnd
      ) {
        return []
      }
      return [
        {
          id: `${chunk.id}-moment-${index + 1}`,
          title: cleanText(record.title, 80),
          summary: cleanText(record.summary, 300),
          keywords: Array.isArray(record.keywords)
            ? record.keywords
                .filter(
                  (keyword): keyword is string => typeof keyword === "string"
                )
                .map((keyword) => cleanText(keyword, 40))
                .filter(Boolean)
                .slice(0, 6)
            : [],
          sourceStart: Math.max(chunk.sourceStart, sourceStart),
          sourceEnd: Math.min(chunk.sourceEnd, sourceEnd),
        },
      ]
    })
    .filter(
      (moment) =>
        moment.title && moment.summary && moment.sourceEnd > moment.sourceStart
    )
    .slice(0, 8)
  const moments = supplementChunkMoments(generatedMoments, chunk)
  return {
    chunkId: chunk.id,
    summary:
      cleanText(parsed.summary, 700) ||
      cleanText(chunk.segments.map((segment) => segment.text).join(" "), 700),
    moments,
  }
}

function supplementChunkMoments(
  generated: ChunkMoment[],
  chunk: VideoSummaryTranscriptChunk
) {
  const target = Math.min(6, chunk.segments.length)
  if (generated.length >= target) return generated.slice(0, 8)
  const moments = [...generated]
  const covered = (start: number, end: number) =>
    moments.some(
      (moment) =>
        Math.abs(moment.sourceStart - start) <= 0.08 &&
        Math.abs(moment.sourceEnd - end) <= 0.08
    )
  for (const [index, segment] of evenlySpaced(chunk.segments).entries()) {
    if (moments.length >= target) break
    if (covered(segment.start, segment.end)) continue
    const text = cleanText(segment.text, 300)
    if (!text) continue
    moments.push({
      id: `${chunk.id}-fallback-${index + 1}`,
      title: cleanText(text, 36),
      summary: text,
      keywords: [],
      sourceStart: segment.start,
      sourceEnd: segment.end,
    })
  }
  return moments
    .toSorted(
      (left, right) =>
        left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    )
    .slice(0, 8)
}

function fallbackOverallSummary(
  analyses: ChunkAnalysis[],
  moments: ChunkMoment[]
) {
  const chunkText = analyses
    .map((analysis) => analysis.summary)
    .filter(Boolean)
    .join(" ")
  return cleanText(
    chunkText || moments.map((moment) => moment.summary).join(" "),
    1200
  )
}

function fallbackTopics(moments: ChunkMoment[]) {
  const transcriptFallbacks = moments.filter((moment) =>
    moment.id.includes("-fallback-")
  )
  const source = transcriptFallbacks.length >= 3 ? transcriptFallbacks : moments
  const pool = source
    .toSorted(
      (left, right) =>
        left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    )
    .filter(
      (moment, index, values) =>
        index === 0 ||
        Math.abs(moment.sourceStart - values[index - 1]!.sourceStart) > 0.08 ||
        Math.abs(moment.sourceEnd - values[index - 1]!.sourceEnd) > 0.08
    )
  const pairs = fallbackMomentPairs(pool.length)
  return pairs.map(([firstIndex, secondIndex], index) => {
    const first = pool[firstIndex]!
    const second = pool[secondIndex]!
    return {
      id: `summary-fallback-topic-${index + 1}`,
      title: cleanText(first.title, 60),
      summary: cleanText(`${first.summary} ${second.summary}`, 420),
      keywords: [...new Set([...first.keywords, ...second.keywords])].slice(
        0,
        8
      ),
      sourceRanges: [
        {
          id: first.id,
          label: first.title,
          summary: first.summary,
          sourceStart: first.sourceStart,
          sourceEnd: first.sourceEnd,
          role: "hook",
        },
        {
          id: second.id,
          label: second.title,
          summary: second.summary,
          sourceStart: second.sourceStart,
          sourceEnd: second.sourceEnd,
          role: "evidence",
        },
      ],
    }
  })
}

function fallbackMomentPairs(length: number): Array<[number, number]> {
  if (length < 3) return []
  const last = length - 1
  const middle = Math.floor(last / 2)
  const candidates: Array<[number, number]> = [
    [0, last],
    [Math.min(1, last - 1), Math.max(2, last - 1)],
    [0, Math.max(1, middle)],
    [Math.min(last - 1, middle), last],
    [Math.min(2, last - 1), last],
  ]
  const seen = new Set<string>()
  return candidates.filter(([left, right]) => {
    const first = Math.min(left, right)
    const second = Math.max(left, right)
    if (first === second || first < 0 || second >= length) return false
    const key = `${first}-${second}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function evenlySpaced<T>(values: T[]) {
  if (values.length <= 6) return values
  return Array.from(
    { length: 6 },
    (_, index) => values[Math.round((index / 5) * (values.length - 1))]
  ).filter((value): value is T => value !== undefined)
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length)
  let cursor = 0
  async function worker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(values[index]!, index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  )
  return results
}

function parseJson(value: string): unknown {
  const stripped = value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
  try {
    return JSON.parse(stripped)
  } catch {
    const start = stripped.indexOf("{")
    const end = stripped.lastIndexOf("}")
    if (start < 0 || end <= start) throw new Error("invalid-video-summary-json")
    return JSON.parse(stripped.slice(start, end + 1))
  }
}

function normalizeRole(value: unknown): VideoSummaryRangeRole {
  return value === "hook" || value === "context" || value === "conclusion"
    ? value
    : "evidence"
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

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : ""
}
