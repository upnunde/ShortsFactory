import {
  snapSourceRangeToCompleteUtterance,
  snapSourceRangeToSpeech,
} from "./speech-bounds.ts"
import type {
  NewsClipCandidate,
  NewsClipSettings,
  NewsReportScene,
  RemovedRange,
  TranscriptSegment,
} from "./types.ts"

export const BUILDUP2_LEAD_PROMPT_HINT =
  "핵심 발언의 모순·온도만 짚는 차분한 반말 서두 1~2문장. '들어봐' 고정 훅·CTA 금지"

export function keepRangesInside(
  start: number,
  end: number,
  silences: RemovedRange[],
  minSilenceSeconds = 0.35
) {
  const spanStart = Math.max(0, start)
  const spanEnd = Math.max(spanStart, end)
  const cuts = silences
    .filter(
      (range) =>
        !range.restored &&
        range.end - range.start >= minSilenceSeconds &&
        range.end > spanStart &&
        range.start < spanEnd
    )
    .map((range) => ({
      start: Math.max(spanStart, range.start),
      end: Math.min(spanEnd, range.end),
    }))
    .filter((range) => range.end - range.start >= minSilenceSeconds)
    .sort((left, right) => left.start - right.start)

  const keeps: Array<{ start: number; end: number }> = []
  let cursor = spanStart
  for (const cut of cuts) {
    if (cut.start > cursor + 0.08) {
      keeps.push({ start: cursor, end: cut.start })
    }
    cursor = Math.max(cursor, cut.end)
  }
  if (spanEnd > cursor + 0.08) {
    keeps.push({ start: cursor, end: spanEnd })
  }
  return keeps.length > 0 ? keeps : [{ start: spanStart, end: spanEnd }]
}

/**
 * 예전엔 quote 장면을 무음 기준으로 쪼갰다.
 * 무음컷은 비선형인데 자막은 원본 타임코드를 쓰거나 선형 스케일만 해서
 * 싱크가 깨지므로 분할하지 않는다. (호출부 호환용 no-op)
 */
export function expandScenesWithSilenceCuts(
  scenes: NewsReportScene[],
  _silences?: RemovedRange[],
  _minSilenceSeconds?: number,
  _transcript?: TranscriptSegment[]
): NewsReportScene[] {
  void _silences
  void _minSilenceSeconds
  void _transcript
  return scenes
}

/** TTS 길이에 맞춰 무음 구간을 건너뛴 원본 keep 조각들을 모은다. */
export function densifySourceKeeps(
  start: number,
  end: number,
  silences: RemovedRange[],
  targetDuration: number,
  sourceDuration: number,
  minSilenceSeconds = 0.2,
  transcript: TranscriptSegment[] = []
): Array<{ start: number; end: number }> {
  const safeTarget = Math.max(0.1, targetDuration)
  const spanStart = Math.max(0, Math.min(sourceDuration, start))
  const searchEnd = Math.max(
    spanStart + 0.1,
    Math.min(sourceDuration, Math.max(end, spanStart + safeTarget * 3))
  )
  const keeps = keepRangesInside(
    spanStart,
    searchEnd,
    silences,
    minSilenceSeconds
  )
  const packed: Array<{ start: number; end: number }> = []
  let remaining = safeTarget
  for (const keep of keeps) {
    if (remaining <= 0.04) break
    const available = keep.end - keep.start
    if (available <= 0.04) continue
    const take = Math.min(available, remaining)
    const raw = {
      start: round(keep.start),
      end: round(keep.start + take),
    }
    const snapped = transcript.length
      ? snapSourceRangeToSpeech(raw.start, raw.end, transcript, {
          maxExtendSeconds: 0.9,
          maxTrimSeconds: 1.1,
        })
      : raw
    // 스냅으로 너무 짧아지면 원본 take 유지
    if (snapped.end - snapped.start < Math.min(0.35, take * 0.55)) {
      packed.push(raw)
      remaining -= take
      continue
    }
    packed.push(snapped)
    remaining -= Math.max(0.04, snapped.end - snapped.start)
  }
  if (packed.length === 0) {
    const fallbackEnd = Math.min(
      sourceDuration,
      spanStart + Math.max(0.1, safeTarget)
    )
    const fallback = { start: round(spanStart), end: round(fallbackEnd) }
    return transcript.length
      ? [
          snapSourceRangeToSpeech(fallback.start, fallback.end, transcript, {
            maxExtendSeconds: 0.9,
            maxTrimSeconds: 1.1,
          }),
        ]
      : [fallback]
  }
  if (remaining > 0.04) {
    const last = packed[packed.length - 1]
    const extended = Math.min(sourceDuration, last.end + remaining)
    if (extended > last.end + 0.04) {
      const next = transcript.length
        ? snapSourceRangeToSpeech(last.start, extended, transcript, {
            maxExtendSeconds: 0.9,
            maxTrimSeconds: 1.1,
          })
        : { ...last, end: round(extended) }
      packed[packed.length - 1] = next
    }
  }
  return packed
}

export function localBuildup2Draft(
  transcript: TranscriptSegment[],
  candidate: NewsClipCandidate,
  _settings: Pick<NewsClipSettings, "titleCardSeconds">,
  _silences: RemovedRange[],
  primarySourceId = ""
) {
  void _settings
  void _silences
  const teaser = buildLocalTeaser(transcript, candidate)
  const completed = snapSourceRangeToCompleteUtterance(
    candidate.sourceStart,
    candidate.sourceEnd,
    transcript
  )
  const scenes = buildBuildup2Scenes(
    teaser,
    completed.start,
    completed.end,
    transcript,
    primarySourceId
  )
  const duration = Math.max(0.12, completed.end - completed.start)
  return {
    script: teaser,
    preferred: scenes,
    removedRanges: [],
    keepRanges: [
      {
        sourceStart: completed.start,
        sourceEnd: completed.end,
        outputStart: 0,
        outputEnd: round(duration),
      },
    ],
  }
}

export function buildBuildup2Scenes(
  teaser: string,
  highlightStart: number,
  highlightEnd: number,
  transcript: TranscriptSegment[],
  primarySourceId = "",
  preferred?: NewsReportScene[]
): NewsReportScene[] {
  const teaserScene = preferred?.find((scene) => scene.id === "buildup2-lead")
  const highlightScene = preferred?.find(
    (scene) =>
      scene.id === "buildup2-quote" || scene.id.startsWith("buildup2-quote")
  )
  const teaserRange = snapSourceRangeToSpeech(
    highlightStart,
    Math.min(highlightStart + 3, highlightEnd),
    transcript,
    { maxExtendSeconds: 0.8, maxTrimSeconds: 1 }
  )
  const quoteRange = snapSourceRangeToCompleteUtterance(
    highlightStart,
    highlightEnd,
    transcript
  )
  return [
    {
      id: teaserScene?.id || "buildup2-lead",
      narration: teaser.trim(),
      visual: "source",
      sourceId: teaserScene?.sourceId || primarySourceId || undefined,
      sourceStart: round(teaserRange.start),
      sourceEnd: round(teaserRange.end),
      ...(teaserScene?.crop ? { crop: teaserScene.crop } : {}),
    },
    {
      // 서두·마무리만 TTS. 하이라이트는 원본 영상+음성, 자막은 전사 기준.
      id: "buildup2-quote",
      narration: "",
      visual: "quote",
      sourceId: highlightScene?.sourceId || primarySourceId || undefined,
      sourceStart: round(quoteRange.start),
      sourceEnd: round(quoteRange.end),
      ...(highlightScene?.crop ? { crop: highlightScene.crop } : {}),
    },
  ]
}

/** 잘린 하이라이트 조각들까지 포함해 전체 원본 구간을 구한다. */
export function buildup2HighlightBounds(
  scenes: NewsReportScene[],
  fallbackStart: number,
  fallbackEnd: number
) {
  const pieces = scenes.filter(
    (scene) =>
      scene.visual === "quote" &&
      (scene.id === "buildup2-quote" ||
        /^buildup2-quote-cut-\d+/i.test(scene.id) ||
        scene.id.startsWith("buildup2-quote"))
  )
  if (!pieces.length) {
    return {
      start: Math.min(fallbackStart, fallbackEnd),
      end: Math.max(fallbackStart, fallbackEnd),
    }
  }
  return {
    start: Math.min(...pieces.map((scene) => scene.sourceStart)),
    end: Math.max(...pieces.map((scene) => scene.sourceEnd)),
  }
}

/** 겹친/중복된 하이라이트 컷을 한 장면으로 합쳐 다시 무음컷할 수 있게 한다. */
export function collapseBuildup2HighlightCuts(
  scenes: NewsReportScene[]
): NewsReportScene[] {
  const highlightPieces = scenes.filter(
    (scene) =>
      scene.id === "buildup2-quote" || /^buildup2-quote-cut-\d+/i.test(scene.id)
  )
  if (!highlightPieces.length) return scenes

  const first = highlightPieces[0]!
  const collapsed: NewsReportScene = {
    ...first,
    id: "buildup2-quote",
    narration: "",
    visual: "quote",
    sourceStart: Math.min(...highlightPieces.map((scene) => scene.sourceStart)),
    sourceEnd: Math.max(...highlightPieces.map((scene) => scene.sourceEnd)),
  }
  const without = scenes.filter(
    (scene) =>
      scene.id !== "buildup2-quote" &&
      !/^buildup2-quote-cut-\d+/i.test(scene.id)
  )
  const teaserIdx = without.findIndex((scene) => scene.id === "buildup2-lead")
  if (teaserIdx >= 0) {
    return [
      ...without.slice(0, teaserIdx + 1),
      collapsed,
      ...without.slice(teaserIdx + 1),
    ]
  }
  return [collapsed, ...without]
}

function buildLocalTeaser(
  transcript: TranscriptSegment[],
  candidate: NewsClipCandidate
) {
  const windowText = transcript
    .filter(
      (segment) =>
        segment.end > candidate.sourceStart &&
        segment.start < candidate.sourceEnd
    )
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
  const snippet = windowText.replace(/\s+/g, " ").trim().slice(0, 42)
  if (!snippet) {
    return "이 말, 숫자랑 온도가 안 맞아."
  }
  return `${snippet}… 이 말, 앞뒤가 안 맞아.`
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
