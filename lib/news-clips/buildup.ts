import { snapKeepEndsToSpeech, snapSourceRangeToSpeech } from "./speech-bounds.ts"
import { fitEditPlan } from "./timeline.ts"
import type {
  NewsClipCandidate,
  NewsClipSettings,
  NewsReportScene,
  RemovedRange,
  TranscriptSegment,
} from "./types.ts"

export const BUILDUP_TEASER_PROMPT_HINT =
  "시청자가 바로 원본 발언을 듣고 싶게 만드는 시니컬한 서두 1~2문장"

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

export function expandScenesWithSilenceCuts(
  scenes: NewsReportScene[],
  silences: RemovedRange[],
  minSilenceSeconds = 0.2,
  transcript: TranscriptSegment[] = []
): NewsReportScene[] {
  return scenes.flatMap((scene) => {
    // quote: 원본 음성과 함께 공백을 잘라 장면을 나눈다.
    // source: 장면 메타는 유지하고, 렌더 단계에서 densify로 jump-cut 한다.
    if (scene.visual !== "quote") return [scene]
    const rawKeeps = keepRangesInside(
      scene.sourceStart,
      scene.sourceEnd,
      silences,
      minSilenceSeconds
    )
    const keeps = transcript.length
      ? snapKeepEndsToSpeech(rawKeeps, transcript)
      : rawKeeps
    if (keeps.length <= 1) {
      const only = keeps[0]
      if (!only) return [scene]
      return [
        {
          ...scene,
          sourceStart: round(only.start),
          sourceEnd: round(only.end),
        },
      ]
    }
    return keeps.map((keep, index) => ({
      ...scene,
      id: `${scene.id}-cut-${index + 1}`,
      narration: index === 0 ? scene.narration : "",
      sourceStart: round(keep.start),
      sourceEnd: round(keep.end),
    }))
  })
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

export function localBuildupDraft(
  transcript: TranscriptSegment[],
  candidate: NewsClipCandidate,
  settings: Pick<
    NewsClipSettings,
    | "targetMinSeconds"
    | "targetMaxSeconds"
    | "idealMinSeconds"
    | "idealMaxSeconds"
    | "titleCardSeconds"
  >,
  silences: RemovedRange[],
  primarySourceId = ""
) {
  const teaser = buildLocalTeaser(transcript, candidate)
  const plan = fitEditPlan({
    segments: transcript,
    start: candidate.sourceStart,
    end: candidate.sourceEnd,
    silenceRanges: silences,
    titleSeconds: settings.titleCardSeconds,
    targetMinSeconds: settings.targetMinSeconds,
    targetMaxSeconds: settings.targetMaxSeconds,
    idealMinSeconds: settings.idealMinSeconds,
    idealMaxSeconds: settings.idealMaxSeconds,
  })
  const highlightStart =
    plan.keepRanges[0]?.sourceStart ?? candidate.sourceStart
  const highlightEnd =
    plan.keepRanges.at(-1)?.sourceEnd ?? candidate.sourceEnd
  const quoteText = transcript
    .filter(
      (segment) =>
        segment.end > highlightStart && segment.start < highlightEnd
    )
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
  const scenes: NewsReportScene[] = [
    {
      id: "buildup-teaser",
      narration: teaser,
      visual: "source",
      sourceId: primarySourceId || undefined,
      sourceStart: round(highlightStart),
      sourceEnd: round(Math.min(highlightStart + 3, highlightEnd)),
    },
    {
      id: "buildup-highlight",
      narration: quoteText.slice(0, 400),
      visual: "quote",
      sourceId: primarySourceId || undefined,
      sourceStart: round(highlightStart),
      sourceEnd: round(highlightEnd),
    },
  ]
  return {
    script: teaser,
    preferred: scenes,
    removedRanges: plan.removedRanges,
    keepRanges: plan.keepRanges,
  }
}

export function buildBuildupScenes(
  teaser: string,
  highlightStart: number,
  highlightEnd: number,
  transcript: TranscriptSegment[],
  primarySourceId = "",
  preferred?: NewsReportScene[]
): NewsReportScene[] {
  const quoteText = transcript
    .filter(
      (segment) =>
        segment.end > highlightStart && segment.start < highlightEnd
    )
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
  const teaserScene = preferred?.find((scene) => scene.id === "buildup-teaser")
  const highlightScene = preferred?.find(
    (scene) =>
      scene.id === "buildup-highlight" || scene.id.startsWith("buildup-highlight")
  )
  const teaserRange = snapSourceRangeToSpeech(
    highlightStart,
    Math.min(highlightStart + 3, highlightEnd),
    transcript,
    { maxExtendSeconds: 0.8, maxTrimSeconds: 1 }
  )
  const quoteRange = snapSourceRangeToSpeech(
    highlightStart,
    highlightEnd,
    transcript
  )
  return [
    {
      id: teaserScene?.id || "buildup-teaser",
      narration: teaser.trim(),
      visual: "source",
      sourceId: teaserScene?.sourceId || primarySourceId || undefined,
      sourceStart: round(teaserRange.start),
      sourceEnd: round(teaserRange.end),
      ...(teaserScene?.crop ? { crop: teaserScene.crop } : {}),
    },
    {
      id: highlightScene?.id || "buildup-highlight",
      narration: quoteText.slice(0, 400),
      visual: "quote",
      sourceId: highlightScene?.sourceId || primarySourceId || undefined,
      sourceStart: round(quoteRange.start),
      sourceEnd: round(quoteRange.end),
      ...(highlightScene?.crop ? { crop: highlightScene.crop } : {}),
    },
  ]
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
    return "이 발언, 그냥 넘기기 어렵더라. 어떤 내용인지 들어봐."
  }
  return `${snippet}… 이 말, 그냥 넘기기 어렵더라. 어떤 내용인지 들어봐.`
}

function round(value: number) {
  return Math.round(value * 100) / 100
}
