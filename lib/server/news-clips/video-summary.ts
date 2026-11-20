import { parseTranscript } from "../../news-clips/transcript.ts"
import { NEWS_SOURCE_ASSEMBLY_MAX_RANGES } from "../../news-clips/source-assembly.ts"
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
  /** 최종 약 1분 영상에서 원본 발언에 배정할 소프트 목표 시간. */
  targetDurationSeconds?: number
  /** 2분 이상도 허용한다는 판단 기준이며 강제 상한이 아니다. */
  maxDurationSeconds?: number
  /** 테스트나 다른 LLM 연결에서도 같은 순수 파이프라인을 쓴다. */
  generateText?: VideoSummaryTextGenerator
}

type ChunkMoment = {
  id: string
  title: string
  summary: string
  /** 모델의 재서술이 아닌, 해당 시간대의 실제 전사. */
  evidence: string
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
  const sourceTitle = options.sourceTitle?.trim() ?? ""
  const chunkAnalyses = await mapWithConcurrency(
    chunks,
    Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2))),
    async (chunk) =>
      analyzeTranscriptChunk(chunk, sourceTitle, generateText, focus)
  )
  const moments = chunkAnalyses.flatMap((analysis) => analysis.moments)
  if (moments.length < 1) throw new Error("insufficient-summary-moments")
  const minTopics = 1
  const minRangesPerTopic = moments.length >= 2 ? 2 : 1
  const targetDurationSeconds = Math.max(
    5,
    Math.min(600, options.targetDurationSeconds ?? 53)
  )
  const extendedDurationThresholdSeconds = Math.max(
    targetDurationSeconds,
    Math.min(600, options.maxDurationSeconds ?? 120)
  )

  const reductionSystem = [
    "너는 긴 한국어 영상을 요약형 쇼츠로 재구성하는 편집자다.",
    "아래는 전체 영상을 누락 없이 나눈 청크별 요약과, 실제 타임코드가 있는 moment 목록이다.",
    "먼저 영상 전체의 내용 지도를 만들고, 서로 다른 핵심 논점을 찾아라. 하나의 논점을 문구만 바꿔 중복 제안하지 마라.",
    "핵심 논점은 '누가·무엇을 주장했는지, 그렇게 보는 근거는 무엇인지, 결론이나 파장은 무엇인지'가 이해되는 정도로 완결되어야 한다.",
    "자극적인 표현을 새로 만들지 말고, 원본의 주장·모순·수치·사례·반박·결론을 근거로 삼아라.",
    "overallSummary는 영상 전체의 주제와 흐름을 4~6문장, 800자 이내의 자연스러운 한국어로 정리한다. 단순 목록이 아니라 전체 논리가 이해되게 쓴다.",
    "topics는 서로 겹치지 않는 핵심 주제 후보를 1~10개 만든다. 실제로 독립된 핵심 논점이 있는 만큼만 만들고, 개수를 채우기 위한 중복·약한 후보는 만들지 않는다.",
    `각 주제는 보통 서로 떨어진 moment를 ${minRangesPerTopic}~5개만 선택한다. ${NEWS_SOURCE_ASSEMBLY_MAX_RANGES}개는 주장이 왜곡되지 않게 보존해야 할 때만 쓰는 기술적 예외 상한이다.`,
    "각 후보는 명확한 주장 하나만 다룬다. 훅, 이해에 꼭 필요한 최소 배경, 그 주장을 가장 직접적으로 입증하는 결정적 근거 1~3개, 실제로 새로운 의미를 더하는 결론만 남긴다.",
    `선택 구간 합계 약 ${Math.round(targetDurationSeconds)}초는 채워야 할 목표가 아니라 소프트 상한 가이드다. 20~40초만으로 주제와 근거가 강하게 완결되면 즉시 끝내고, 시간을 채우려고 관련성이 약한 moment를 추가하지 마라.`,
    `${Math.round(extendedDurationThresholdSeconds)}초를 넘기는 것은 그 구간을 빼면 주장이 왜곡되거나 핵심 근거가 성립하지 않을 때만 허용한다. 단순히 같은 주제와 관련 있다는 이유만으로 늘리지 마라.`,
    "시간을 맞추려고 원문 문장을 중간에서 자르거나 핵심 근거를 요약문으로 대체하지 마라. 길이가 늘어나더라도 실제 발화의 논리 완결성을 우선한다.",
    "sourceRanges는 서로 연속일 필요가 없다. 긴 핵심 구간 안에서도 실제로 필요한 완결 발화만 고르고, 반복·부연·전환부는 range 사이의 제외 구간으로 남긴다. 넓은 시간 범위 하나로 불필요한 내용까지 감싸지 마라.",
    "각 주제는 hook → 필요한 context → 결정적 evidence → conclusion 흐름으로 완결되어야 한다. 같은 내용의 반복은 빼되, 주어나 배경을 빼서 무슨 말인지 모르게 만들지 마라.",
    "topic.title은 단편적인 키워드가 아니라, 이 후보가 설명하는 핵심 주장을 하나의 완결된 문장으로 쓴다.",
    "topic.summary는 2~3문장으로 짧고 명확하게 쓴다. 첫 문장에 중심 주장을, 다음 문장에 가장 강한 원본 근거와 의미를 담고 같은 말을 반복하지 마라.",
    "moment의 score가 높을수록 핵심성과 주목도가 높은 구간이다. 점수만 기계적으로 따르지 말고 하나의 논점으로 이어지는지 함께 판단한다.",
    "원본의 핵심 발화 전체가 목표 시간보다 짧으면 억지로 늘리거나 실패시키지 말고, 있는 핵심만 완결되게 사용한다.",
    "같은 발언을 반복하지 말고, sourceRanges는 원본 시간순으로 배치한다.",
    "rangeId는 아래 moments에 있는 id만 사용한다. 시간과 내용을 새로 만들지 않는다.",
    "role은 hook, context, evidence, conclusion 중 하나다.",
    sourceTitle
      ? "sourceTitle은 원본 영상 제작자가 내세운 핵심 논점이므로 분석의 중심 가설로 삼는다. 단, 단순 파일명·날짜·ID처럼 의미 없는 제목이면 이 규칙을 무시한다. overallSummary는 제목이 말하는 사건·주장부터 설명하고, topics 중 첫 후보는 제목의 핵심을 가장 잘 설명하는 실제 발언·배경·근거·결론으로 구성한다. 제목과 직접 연결되는 moment를 우선하되, 제목이 과장됐거나 전사와 다르면 억지로 맞추지 말고 실제 발언을 우선한다. 제목과 내용의 차이 자체가 원본에서 확인될 때만 그 차이를 논점으로 다룬다."
      : "",
    focus
      ? "사용자가 focus에 원하는 키워드나 주요 내용을 적었다. 명시적인 focus는 sourceTitle보다 우선한다. focus와 의미가 가까운 moment를 최우선으로 고르고, topics의 제목·요약도 focus 논점을 중심으로 구성한다. 원본에 없는 내용은 만들지 않는다."
      : "",
    "JSON 객체만 출력한다:",
    '{"overallSummary":"...","topics":[{"id":"topic-1","title":"...","summary":"...","keywords":["..."],"sourceRanges":[{"rangeId":"summary-chunk-1-moment-1","role":"hook"}]}]}',
  ]
    .filter(Boolean)
    .join("\n")
  const reductionInput = JSON.stringify({
    sourceTitle,
    focus,
    chunks: chunkAnalyses.map((analysis) => ({
      id: analysis.chunkId,
      summary: analysis.summary,
    })),
    moments,
  })
  let reduced: Record<string, unknown> = {}
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const reducedText = await generateText(
        attempt === 0
          ? reductionSystem
          : `${reductionSystem}\n이전 출력이 필수 주제 수나 서로 다른 근거 구간 수를 채우지 못했다. 요구 조건을 모두 충족한 완전한 JSON으로 다시 작성하라.`,
        reductionInput,
        5000
      )
      const candidate = asRecord(parseJson(reducedText))
      if (reductionHasMinimumShape(candidate, minTopics, minRangesPerTopic)) {
        reduced = candidate
        break
      }
    } catch {
      // 한 번 더 시도한 뒤에도 깨지면 실제 전사 기반 복구 계획을 쓴다.
    }
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
    const selectedMoments = refs.flatMap((reference) => {
      const ref = asRecord(reference)
      const rangeId =
        typeof reference === "string"
          ? reference
          : typeof ref.rangeId === "string"
            ? ref.rangeId
            : ""
      const moment = momentById.get(rangeId)
      return moment ? [moment] : []
    })
    return {
      id: record.id,
      title: record.title,
      summary: explanatoryTopicSummary(record.summary, selectedMoments),
      keywords: record.keywords,
      sourceRanges: refs.flatMap((reference, referenceIndex) => {
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
            role: normalizeRole(ref.role, referenceIndex, refs.length),
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
      maxRangesPerTopic: NEWS_SOURCE_ASSEMBLY_MAX_RANGES,
      targetDurationSeconds,
      maxDurationSeconds: extendedDurationThresholdSeconds,
    }
  )
  const completeness = { minTopics, minRangesPerTopic }
  if (!videoSummaryPlanIsComplete(plan, completeness)) {
    plan = normalizeVideoSummaryPlan(
      {
        sourceId: options.sourceId,
        overallSummary:
          plan.overallSummary || fallbackOverallSummary(chunkAnalyses, moments),
        topics: [...topics, ...fallbackTopics(moments, minRangesPerTopic)],
      },
      transcript,
      {
        sourceId: options.sourceId,
        minTopics,
        minRangesPerTopic,
        maxRangesPerTopic: NEWS_SOURCE_ASSEMBLY_MAX_RANGES,
        targetDurationSeconds,
        maxDurationSeconds: extendedDurationThresholdSeconds,
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
        "summary는 이 청크에서 다루는 주요 논점을 3~6문장의 한국어로 요약한다. 누가 무엇을 말했는지와 근거·결론이 드러나야 한다.",
        "moments는 나중에 하나의 핵심 주제를 설명하는 영상으로 조립할 수 있는 서로 다른 발화 단위 4~10개다.",
        "각 moment는 가능하면 6~20초 안에서 주어·주장·근거가 이해되는 완결된 호흡으로 잡고 24초를 넘기지 않는다.",
        "중요한 내용이 4~6분 연속되더라도 큰 구간 하나로 묶지 마라. 필요한 발화를 여러 moment로 나누고, 그 사이 반복·부연·전환 멘트·의미 없는 맞장구와 환호는 선택하지 않아 빈 구간으로 남긴다.",
        "인사·반복·의미 없는 맞장구는 제외한다. 다만 핵심 주장을 이해하는 데 필요한 배경 설명은 빼지 마라.",
        "moment.title은 키워드가 아니라 해당 발화의 주장을 짧은 완결 문장으로 쓴다.",
        "moment.summary는 해당 구간이 어떤 논점의 무엇을 설명하는지 1~2문장으로 쓴다. 단편적 단어나 표어만 쓰지 마라.",
        "score는 원본 안에서의 핵심성과 시청 주목도를 함께 평가한 0~100 정수다. 과장된 낚시 가능성이 아니라 내용 자체의 힘을 평가한다.",
        "moment의 sourceStart/sourceEnd는 입력 segment의 실제 start/end 범위만 쓴다.",
        "주어·대상·결론이 있는 완결된 발언을 선택하고, 같은 내용을 반복하지 않는다.",
        "원문에 없는 사실을 추가하지 않는다.",
        sourceTitle
          ? "sourceTitle은 원본 영상이 내세운 핵심 논점이다. 단순 파일명·날짜·ID처럼 의미 없는 제목이면 무시한다. 제목을 설명·입증·반박하거나 필요한 배경을 주는 발언을 moments에 우선 포함하고 관련 moment의 score를 높게 평가한다. 단, 제목 문구를 전사에 없는 사실처럼 덧붙이거나 제목에 억지로 맞추지 않는다."
          : "",
        focus
          ? "사용자가 focus에 원하는 키워드나 주요 내용을 적었다. 명시적인 focus는 sourceTitle보다 우선한다. focus와 의미가 가까운 발언을 moments에 더 많이·우선적으로 넣는다. 단어가 정확히 일치하지 않아도 같은 논점이면 포함한다."
          : "",
        "JSON 객체만 출력한다:",
        '{"summary":"...","moments":[{"title":"...","summary":"...","keywords":["..."],"sourceStart":0,"sourceEnd":10,"score":90}]}',
      ]
        .filter(Boolean)
        .join("\n"),
      JSON.stringify({ sourceTitle, focus, chunk }),
      1900
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
      const clampedStart = Math.max(chunk.sourceStart, sourceStart)
      const clampedEnd = Math.min(chunk.sourceEnd, sourceEnd)
      const evidence = transcriptEvidence(chunk, clampedStart, clampedEnd)
      return [
        {
          id: `${chunk.id}-moment-${index + 1}`,
          title: cleanText(record.title, 100) || cleanText(evidence, 100),
          summary: cleanText(record.summary, 360) || evidence,
          evidence,
          keywords: Array.isArray(record.keywords)
            ? record.keywords
                .filter(
                  (keyword): keyword is string => typeof keyword === "string"
                )
                .map((keyword) => cleanText(keyword, 40))
                .filter(Boolean)
                .slice(0, 6)
            : [],
          sourceStart: clampedStart,
          sourceEnd: clampedEnd,
          score: Math.max(
            0,
            Math.min(100, Math.round(finiteNumber(record.score) ?? 50))
          ),
        },
      ]
    })
    .filter(
      (moment) =>
        moment.title &&
        moment.summary &&
        moment.evidence &&
        moment.sourceEnd > moment.sourceStart
    )
    .slice(0, 10)
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
  if (generated.length >= target) return generated.slice(0, 10)
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
      evidence: text,
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
    .slice(0, 10)
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
    800
  )
}

function fallbackTopics(moments: ChunkMoment[], minRangesPerTopic: number) {
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
  if (!ranked.length) return []
  // AI 축약이 깨진 경우에도 1분을 채우지 않는다. 점수가 가장 높은 최소
  // 근거 세트만 골라 하나의 간결한 후보로 복구한다.
  const selected = ranked
    .slice(0, Math.min(ranked.length, Math.max(minRangesPerTopic, 3)))
    .toSorted(
      (left, right) =>
        left.sourceStart - right.sourceStart || left.sourceEnd - right.sourceEnd
    )
  const strongest = ranked[0]!
  return [
    {
      id: "summary-fallback-topic-1",
      title: cleanText(strongest.title, 60),
      summary: cleanText(
        selected.map((moment) => moment.summary).join(" "),
        300
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
            : rangeIndex === selected.length - 1 && selected.length > 1
              ? "conclusion"
              : "evidence",
      })),
    },
  ]
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

function reductionHasMinimumShape(
  value: Record<string, unknown>,
  minTopics: number,
  minRangesPerTopic: number
) {
  const topics = Array.isArray(value.topics) ? value.topics : []
  if (!cleanText(value.overallSummary, 800) || topics.length < minTopics) {
    return false
  }
  return topics.every((topic) => {
    const record = asRecord(topic)
    const ranges = Array.isArray(record.sourceRanges)
      ? record.sourceRanges
      : Array.isArray(record.rangeIds)
        ? record.rangeIds
        : []
    const distinctRangeIds = new Set(
      ranges
        .map((range) => {
          if (typeof range === "string") return range
          const record = asRecord(range)
          return typeof record.rangeId === "string" ? record.rangeId : ""
        })
        .filter(Boolean)
    )
    return (
      cleanText(record.title, 100).length > 0 &&
      cleanText(record.summary, 420).length > 0 &&
      distinctRangeIds.size >= minRangesPerTopic
    )
  })
}

function normalizeRole(
  value: unknown,
  index = 0,
  total = 1
): VideoSummaryRangeRole {
  if (value === "hook" || value === "context" || value === "conclusion") {
    return value
  }
  if (value === "evidence") return value
  if (index === 0) return "hook"
  if (index === total - 1 && total > 1) return "conclusion"
  if (index === 1 && total >= 4) return "context"
  return "evidence"
}

function transcriptEvidence(
  chunk: VideoSummaryTranscriptChunk,
  start: number,
  end: number
) {
  return cleanText(
    chunk.segments
      .filter(
        (segment) => segment.end > start + 0.001 && segment.start < end - 0.001
      )
      .map((segment) => segment.text)
      .join(" "),
    900
  )
}

/**
 * 모델이 제목을 반복한 한 문장만 내놓아도 2번 화면에서는
 * 선택한 실제 구간의 논리가 함께 보이도록 보강한다.
 */
function explanatoryTopicSummary(value: unknown, moments: ChunkMoment[]) {
  let summary = cleanText(value, 300)
  if (summary.length >= 90 && sentenceCount(summary) >= 2) return summary

  const seen = new Set<string>()
  const additions = moments
    .map((moment) => cleanText(moment.summary, 260))
    .filter((text) => {
      if (!text || summary.includes(text) || seen.has(text)) return false
      seen.add(text)
      return true
    })
  for (const addition of additions) {
    summary = cleanText([summary, addition].filter(Boolean).join(" "), 300)
    if (summary.length >= 90 && sentenceCount(summary) >= 2) break
  }
  return summary
}

function sentenceCount(value: string) {
  const matches = value.match(/[.!?]|(?:다|요|죠|어|했어)(?=\s|$)/g)
  return matches?.length ?? (value ? 1 : 0)
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
