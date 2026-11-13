import { makeKeepRanges } from "./timeline.ts"
import type { KeepRange, NewsReportScene, RemovedRange } from "./types.ts"

const MINIMUM_BODY_PIECE_SECONDS = 0.1

type BodyBounds = { start: number; end: number }

export type BuildupBodyCutPlan = {
  scenes: NewsReportScene[]
  keepRanges: KeepRange[]
  activeCuts: RemovedRange[]
  deletedDuration: number
  reason: "" | "body-cut-range-invalid" | "body-cut-removes-all"
}

export function activeManualBodyCuts(
  removedRanges: RemovedRange[],
  bounds: BodyBounds
) {
  const start = Math.min(bounds.start, bounds.end)
  const end = Math.max(bounds.start, bounds.end)
  return removedRanges
    .filter(
      (range) =>
        range.reason === "manual" &&
        !range.restored &&
        Number.isFinite(range.start) &&
        Number.isFinite(range.end) &&
        range.end > range.start &&
        range.end > start &&
        range.start < end
    )
    .map((range) => ({
      ...range,
      start: round(Math.max(start, range.start)),
      end: round(Math.min(end, range.end)),
    }))
    .sort((left, right) => left.start - right.start || left.end - right.end)
}

export function sourceRangeOverlapsManualCut(
  start: number,
  end: number,
  cuts: RemovedRange[]
) {
  return cuts.some((range) => range.end > start && range.start < end)
}

/**
 * 수동 삭제 구간을 원본 quote 장면의 빈틈으로 표현한다.
 * 렌더러는 각 quote-cut의 영상·원본 음성을 순서대로 이어 붙이고 자막을
 * 다시 계산하므로 삭제 이후의 타임라인이 같은 길이만큼 자동으로 당겨진다.
 */
export function applyBuildupBodyCuts(
  scenes: NewsReportScene[],
  bounds: BodyBounds,
  removedRanges: RemovedRange[],
  options: {
    primarySourceId?: string
    templates?: NewsReportScene[]
  } = {}
): BuildupBodyCutPlan {
  const start = Math.max(0, Math.min(bounds.start, bounds.end))
  const end = Math.max(start, Math.max(bounds.start, bounds.end))
  const activeCuts = activeManualBodyCuts(removedRanges, { start, end })
  const unchanged = {
    scenes,
    keepRanges: [] as KeepRange[],
    activeCuts,
    deletedDuration: 0,
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.2) {
    return { ...unchanged, reason: "body-cut-range-invalid" }
  }

  const rawKeeps = makeKeepRanges(start, end, activeCuts).filter(
    (range) => range.sourceEnd - range.sourceStart >= MINIMUM_BODY_PIECE_SECONDS
  )
  if (!rawKeeps.length) {
    return { ...unchanged, reason: "body-cut-removes-all" }
  }
  const keepRanges = reindexKeepRanges(rawKeeps)
  const quoteTemplates = (options.templates ?? scenes).filter(isBuildupQuote)
  const fallbackTemplate = quoteTemplates[0] ?? scenes.find(isBuildupQuote)
  if (!fallbackTemplate) {
    return { ...unchanged, reason: "body-cut-range-invalid" }
  }

  const quoteScenes = keepRanges.map((keep, index): NewsReportScene => {
    const template =
      bestTemplateForRange(quoteTemplates, keep) ?? fallbackTemplate
    const split = activeCuts.length > 0 || keepRanges.length > 1
    return {
      ...template,
      id: split ? `buildup2-quote-cut-${index + 1}` : "buildup2-quote",
      narration: "",
      part: "body",
      audioMode: "original",
      visualMode: "quote",
      visual: "quote",
      sourceId: template.sourceId || options.primarySourceId || undefined,
      sourceStart: keep.sourceStart,
      sourceEnd: keep.sourceEnd,
      ...(template.crop ? { crop: { ...template.crop } } : {}),
    }
  })
  const firstQuoteIndex = scenes.findIndex(isBuildupQuote)
  const withoutQuotes = scenes.filter((scene) => !isBuildupQuote(scene))
  const insertionIndex =
    firstQuoteIndex < 0
      ? Math.max(
          0,
          withoutQuotes.findIndex((scene) => scene.id === "end-cta")
        )
      : scenes
          .slice(0, firstQuoteIndex)
          .filter((scene) => !isBuildupQuote(scene)).length
  const nextScenes = [
    ...withoutQuotes.slice(0, insertionIndex),
    ...quoteScenes,
    ...withoutQuotes.slice(insertionIndex),
  ]
  const keptDuration = keepRanges.reduce(
    (total, range) => total + range.sourceEnd - range.sourceStart,
    0
  )

  return {
    scenes: nextScenes,
    keepRanges,
    activeCuts,
    deletedDuration: round(Math.max(0, end - start - keptDuration)),
    reason: "",
  }
}

function isBuildupQuote(scene: Pick<NewsReportScene, "id">) {
  return (
    scene.id === "buildup2-quote" || /^buildup2-quote-cut-\d+$/i.test(scene.id)
  )
}

function bestTemplateForRange(
  templates: NewsReportScene[],
  range: Pick<KeepRange, "sourceStart" | "sourceEnd">
) {
  return templates
    .map((scene) => ({
      scene,
      overlap: Math.max(
        0,
        Math.min(scene.sourceEnd, range.sourceEnd) -
          Math.max(scene.sourceStart, range.sourceStart)
      ),
    }))
    .sort((left, right) => right.overlap - left.overlap)[0]?.scene
}

function reindexKeepRanges(ranges: KeepRange[]) {
  let outputCursor = 0
  return ranges.map((range) => {
    const duration = range.sourceEnd - range.sourceStart
    const next = {
      sourceStart: round(range.sourceStart),
      sourceEnd: round(range.sourceEnd),
      outputStart: round(outputCursor),
      outputEnd: round(outputCursor + duration),
    }
    outputCursor += duration
    return next
  })
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
