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
  /** 사용자가 지정한 핵심 키워드·문장. 있으면 관련 moment·주제를 우선한다. */
  focus?: string
  maxChunkCharacters?: number
  concurrency?: number
  /** 최종 1분 영상에서 원본 발언에 배정할 목표·최대 시간. */
  targetDurationSeconds?: number
  maxDurationSeconds?: number
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
  score: number
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
  const focus = options.focus?.trim() ?? ""
  const chunkAnalyses = await mapWithConcurrency(
    chunks,
    Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2))),
    async (chunk) =>
      analyzeTranscriptChunk(
        chunk,
        options.sourceTitle ?? "",
        generateText,
        focus
      )
  )
  const moments = chunkAnalyses.flatMap((analysis) => analysis.moments)
  if (moments.length < 1) throw new Error("insufficient-summary-moments")
  const minTopics = moments.length >= 3 ? 3 : 1
  const minRangesPerTopic = moments.length >= 2 ? 2 : 1
  const targetDurationSeconds = Math.max(
    5,
    Math.min(120, options.targetDurationSeconds ?? 45)
  )
  const maxDurationSeconds = Math.max(
    targetDurationSeconds,
    Math.min(120, options.maxDurationSeconds ?? 50)
  )

  let reduced: Record<string, unknown> = {}
  try {
    const reducedText = await generateText(
      [
        "너는 긴 한국어 영상을 요약형 쇼츠로 재구성하는 편집자다.",
        "아래는 전체 영상을 누락 없이 나눈 청크별 요약과, 실제 타임코드가 있는 moment 목록이다.",
        "전체 내용을 순서대로 골고루 줄이지 않는다. 영상에서 가장 중요하고 시청자의 관심을 끌 수 있는 핵심 논점 하나를 먼저 정한 뒤 그 논점을 증명하는 구간만 고른다.",
        "자극적인 표현을 새로 만들지 말고 원본 안에서 강한 발언·반전·모순·수치·결론을 훅으로 선택한다.",
        "overallSummary는 영상 전체 흐름을 3~5문장, 500자 이내의 자연스러운 한국어로 정리한다.",
        `topics는 서로 겹치지 않는 핵심 주제 후보 ${minTopics}~5개다.`,
        `각 주제는 서로 떨어진 moment를 ${minRangesPerTopic}~8개 선택한다. 선택 구간 합계는 약 ${Math.round(targetDurationSeconds)}초를 목표로 하고 ${Math.round(maxDurationSeconds)}초를 넘기지 않는다.`,
        "각 주제는 hook → 필요한 context → 결정적 evidence → conclusion 흐름으로 완결되어야 한다. 배경 설명·인사·반복 발언은 핵심 이해에 꼭 필요하지 않으면 제외한다.",
        "moment의 score가 높을수록 핵심성과 주목도가 높은 구간이다. 점수만 기계적으로 따르지 말고 하나의 논점으로 이어지는지 함께 판단한다.",
        "원본의 핵심 발화 전체가 목표 시간보다 짧으면 억지로 늘리거나 실패시키지 말고, 있는 핵심만 완결되게 사용한다.",
        "같은 발언을 반복하지 말고, sourceRanges는 원본 시간순으로 배치한다.",
        "rangeId는 아래 moments에 있는 id만 사용한다. 시간과 내용을 새로 만들지 않는다.",
        "role은 hook, context, evidence, conclusion 중 하나다.",
        focus
          ? "사용자가 focus에 원하는 키워드나 주요 내용을 적었다. focus와 의미가 가까운 moment를 최우선으로 고르고, topics의 제목·요약도 focus 논점을 중심으로 구성한다. 원본에 없는 내용은 만들지 않는다."
          : "",
        "JSON 객체만 출력한다:",
        '{"overallSummary":"...","topics":[{"id":"topic-1","title":"...","summary":"...","keywords":["..."],"sourceRanges":[{"rangeId":"summary-chunk-1-moment-1","role":"hook"}]}]}',
      ]
        .filter(Boolean)
        .join("\n"),
      JSON.stringify({
        sourceTitle: options.sourceTitle ?? "",
        focus,
        chunks: chunkAnalyses.map((analysis) => ({
          id: analysis.chunkId,
          summary: analysis.summary,
        })),
        moments,
      }),
      2200
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
    {
      sourceId: options.sourceId,
      minTopics,
      minRangesPerTopic,
      maxRangesPerTopic: 8,
      targetDurationSeconds,
      maxDurationSeconds,
    }
  )
  const completeness = { minTopics, minRangesPerTopic }
  if (!videoSummaryPlanIsComplete(plan, completeness)) {
    plan = normalizeVideoSummaryPlan(
      {
        sourceId: options.sourceId,
        overallSummary:
          plan.overallSummary || fallbackOverallSummary(chunkAnalyses, moments),
        topics: [
          ...topics,
          ...fallbackTopics(moments, targetDurationSeconds, maxDurationSeconds),
        ],
      },
      transcript,
      {
        sourceId: options.sourceId,
        minTopics,
        minRangesPerTopic,
        maxRangesPerTopic: 8,
        targetDurationSeconds,
        maxDurationSeconds,
      }
    )
  }
  if (!videoSummaryPlanIsComplete(plan, completeness)) {
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
  generateText: VideoSummaryTextGenerator,
  focus = ""
): Promise<ChunkAnalysis> {
  let parsed: Record<string, unknown> = {}
  try {
    const response = await generateText(
      [
        "너는 한국어 영상 전사에서 요약 재료를 추출하는 분석가다.",
        "입력은 전체 영상의 하나의 연속 청크다.",
        "summary는 이 청크의 핵심을 2~4문장의 한국어로 요약한다.",
        "moments는 후보 영상에 쓸 수 있는 서로 다른 핵심 발언 3~8개다.",
        "각 moment는 가능하면 5~15초 안의 완결된 발언으로 잡고 18초를 넘기지 않는다.",
        "인사·서론·반복 설명보다 핵심 주장, 반전, 모순, 구체적 수치, 강한 결론을 우선한다.",
        "score는 원본 안에서의 핵심성과 시청 주목도를 함께 평가한 0~100 정수다. 과장된 낚시 가능성이 아니라 내용 자체의 힘을 평가한다.",
        "moment의 sourceStart/sourceEnd는 입력 segment의 실제 start/end 범위만 쓴다.",
        "주어·대상·결론이 있는 완결된 발언을 선택하고, 같은 내용을 반복하지 않는다.",
        "원문에 없는 사실을 추가하지 않는다.",
        focus
          ? "사용자가 focus에 원하는 키워드나 주요 내용을 적었다. focus와 의미가 가까운 발언을 moments에 더 많이·우선적으로 넣는다. 단어가 정확히 일치하지 않아도 같은 논점이면 포함한다."
          : "",
        "JSON 객체만 출력한다:",
        '{"summary":"...","moments":[{"title":"...","summary":"...","keywords":["..."],"sourceStart":0,"sourceEnd":10,"score":90}]}',
      ]
        .filter(Boolean)
        .join("\n"),
      JSON.stringify({ sourceTitle, focus, chunk }),
      1300
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
          score: Math.max(
            0,
            Math.min(100, Math.round(finiteNumber(record.score) ?? 50))
          ),
        },
      ]
    })
    .filter(
      (moment) =>
        moment.title && moment.summary && moment.sourceEnd > moment.sourceStart
    )
    .slice(0, 8)
  const moments = supplementChunkMoments(generatedMoments, chunk, focus)
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
  chunk: VideoSummaryTranscriptChunk,
  focus = ""
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
      score: editorialMomentScore(text, focus),
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
    500
  )
}

function fallbackTopics(
  moments: ChunkMoment[],
  targetDurationSeconds: number,
  maxDurationSeconds: number
) {
  const transcriptFallbacks = moments.filter((moment) =>
    moment.id.includes("-fallback-")
  )
  const generated = moments.filter(
    (moment) => !moment.id.includes("-fallback-")
  )
  const source = generated.length
    ? [...generated, ...transcriptFallbacks]
    : transcriptFallbacks
  const ranked: ChunkMoment[] = []
  for (const moment of source.toSorted(
    (left, right) =>
      right.score - left.score || left.sourceStart - right.sourceStart
  )) {
    if (
      ranked.some(
        (selected) =>
          Math.abs(moment.sourceStart - selected.sourceStart) <= 0.08 &&
          Math.abs(moment.sourceEnd - selected.sourceEnd) <= 0.08
      )
    ) {
      continue
    }
    ranked.push(moment)
  }
  const pool = ranked
    .slice(0, 8)
    .toSorted(
      (left, right) =>
        left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    )
  if (!pool.length) return []
  const groups =
    pool.length === 1
      ? [[0]]
      : pool.length === 2
        ? [[0, 1]]
        : fallbackMomentPairs(pool.length).map((pair) =>
            expandFallbackMomentGroup(
              pool,
              pair,
              targetDurationSeconds,
              maxDurationSeconds
            )
          )
  return groups.map((indexes, index) => {
    const selected = indexes.map((itemIndex) => pool[itemIndex]!)
    const first = selected[0]!
    const last = selected.at(-1)!
    return {
      id: `summary-fallback-topic-${index + 1}`,
      title: cleanText(first.title, 60),
      summary: cleanText(
        selected.map((moment) => moment.summary).join(" "),
        420
      ),
      keywords: [
        ...new Set(selected.flatMap((moment) => moment.keywords)),
      ].slice(0, 8),
      sourceRanges: selected.map((moment, rangeIndex) => ({
        id: moment.id,
        label: moment.title,
        summary: moment.summary,
        sourceStart: moment.sourceStart,
        sourceEnd: moment.sourceEnd,
        role:
          rangeIndex === 0
            ? "hook"
            : rangeIndex === selected.length - 1 && last !== first
              ? "conclusion"
              : "evidence",
      })),
    }
  })
}

function expandFallbackMomentGroup(
  moments: ChunkMoment[],
  seed: [number, number],
  targetDurationSeconds: number,
  maxDurationSeconds: number
) {
  const selected = new Set(seed)
  if (moments.length >= 5) {
    const center = (seed[0] + seed[1]) / 2
    const candidates = moments
      .map((_, index) => index)
      .filter((index) => !selected.has(index))
      .toSorted(
        (left, right) =>
          Math.abs(left - center) - Math.abs(right - center) || left - right
      )
    let duration = [...selected].reduce(
      (sum, index) =>
        sum + moments[index]!.sourceEnd - moments[index]!.sourceStart,
      0
    )
    for (const index of candidates) {
      if (duration >= targetDurationSeconds) break
      const nextDuration =
        moments[index]!.sourceEnd - moments[index]!.sourceStart
      if (duration + nextDuration > maxDurationSeconds) continue
      selected.add(index)
      duration += nextDuration
    }
  }
  return [...selected].toSorted((left, right) => left - right)
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

function editorialMomentScore(text: string, focus: string) {
  const normalized = text.replace(/\s+/g, " ").trim()
  let score = Math.min(25, Math.round(normalized.length / 4)) + 30
  if (/\d|%|원|명|건|배|조|억|만/u.test(normalized)) score += 12
  if (
    /하지만|그런데|결국|반면|문제|핵심|거짓|모순|책임|피해|증거/u.test(
      normalized
    )
  ) {
    score += 14
  }
  const focusTokens = focus
    .replace(/[^0-9A-Za-z가-힣\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2)
  if (focusTokens.some((token) => normalized.includes(token))) score += 20
  return Math.max(0, Math.min(100, score))
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
