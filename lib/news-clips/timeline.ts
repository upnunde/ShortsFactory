import type {
  KeepRange,
  NewsClipCandidate,
  NewsClipSettings,
  RemovedRange,
  TranscriptSegment,
  TranscriptWord,
} from "./types"

const TOPIC_PATTERNS = [
  /노조|파업|노란봉투|기업|일자리/g,
  /외교|안보|중국|북한|굴욕/g,
  /재판|사법|권력|심판|판결/g,
  /세금|부동산|규제|요금|비용/g,
  /내로남불|말바꾸기|녹취|직접 발언/g,
  /피해|부담|위험|손해|영향/g,
]

const NUMBER_PATTERN = /\d[\d,.]*\s*(?:%|원|명|건|배|조|억|만)?/g
const HOOK_PATTERN = /그런데|실제로|문제는|왜냐하면|결국|다만|어떻게|이게/g
const CLAIM_PATTERN = /한다더라|카더라|들었다|소문|추정/g

export function detectSilenceRanges(
  words: TranscriptWord[],
  start: number,
  end: number,
  threshold = 0.25,
  padding = 0.08
): RemovedRange[] {
  const selected = words
    .filter((word) => word.end > start && word.start < end)
    .sort((a, b) => a.start - b.start)
  const ranges: RemovedRange[] = []
  let cursor = start
  for (const word of selected) {
    const gapStart = Math.max(start, cursor)
    const gapEnd = Math.min(end, word.start)
    if (gapEnd - gapStart >= threshold) {
      const cutStart = Math.min(gapEnd, gapStart + padding)
      const cutEnd = Math.max(cutStart, gapEnd - padding)
      if (cutEnd - cutStart > 0.04) {
        ranges.push({
          id: `silence-${ranges.length + 1}`,
          start: round(cutStart),
          end: round(cutEnd),
          reason: "silence",
          restored: false,
        })
      }
    }
    cursor = Math.max(cursor, word.end)
  }
  if (end - cursor >= threshold) {
    const cutStart = Math.min(end, cursor + padding)
    const cutEnd = Math.max(cutStart, end - padding)
    if (cutEnd - cutStart > 0.04) {
      ranges.push({
        id: `silence-${ranges.length + 1}`,
        start: round(cutStart),
        end: round(cutEnd),
        reason: "silence",
        restored: false,
      })
    }
  }
  return mergeRanges(ranges)
}

export function makeKeepRanges(
  start: number,
  end: number,
  removed: RemovedRange[]
): KeepRange[] {
  const active = mergeRanges(
    removed.filter(
      (range) => !range.restored && range.end > start && range.start < end
    )
  )
  const keep: KeepRange[] = []
  let sourceCursor = start
  let outputCursor = 0
  for (const range of active) {
    const cutStart = Math.max(start, range.start)
    const cutEnd = Math.min(end, range.end)
    if (cutStart > sourceCursor) {
      const duration = cutStart - sourceCursor
      keep.push({
        sourceStart: round(sourceCursor),
        sourceEnd: round(cutStart),
        outputStart: round(outputCursor),
        outputEnd: round(outputCursor + duration),
      })
      outputCursor += duration
    }
    sourceCursor = Math.max(sourceCursor, cutEnd)
  }
  if (sourceCursor < end) {
    const duration = end - sourceCursor
    keep.push({
      sourceStart: round(sourceCursor),
      sourceEnd: round(end),
      outputStart: round(outputCursor),
      outputEnd: round(outputCursor + duration),
    })
  }
  return keep
}

export function sourceToOutputTime(time: number, keep: KeepRange[]) {
  const exact = keep.find(
    (range) => time >= range.sourceStart && time <= range.sourceEnd
  )
  if (exact) {
    return round(exact.outputStart + (time - exact.sourceStart))
  }
  const next = keep.find((range) => time < range.sourceStart)
  return next ? next.outputStart : (keep.at(-1)?.outputEnd ?? 0)
}

export function editedDuration(keep: KeepRange[]) {
  return round(
    keep.reduce((sum, range) => sum + range.outputEnd - range.outputStart, 0)
  )
}

export function finalDurationAllowed(duration: number, hardMaximum = 59) {
  return (
    Number.isFinite(duration) &&
    duration > 0 &&
    duration < Math.min(59, hardMaximum)
  )
}

export type EditFitResult = {
  removedRanges: RemovedRange[]
  keepRanges: KeepRange[]
  finalDurationSeconds: number
  withinAllowed: boolean
  meetsIdeal: boolean
}

export function expandSourceRange(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  minimumSourceSeconds = 70,
  maximumSourceSeconds = 100
) {
  if (segments.length === 0) return { start, end }
  const firstIncluded = Math.max(
    0,
    segments.findIndex((segment) => segment.end > start)
  )
  const lastIncluded = Math.max(
    firstIncluded,
    segments.findLastIndex((segment) => segment.start < end)
  )
  let left = firstIncluded
  let right = lastIncluded
  let nextStart = Math.min(start, segments[left]?.start ?? start)
  let nextEnd = Math.max(end, segments[right]?.end ?? end)
  while (
    nextEnd - nextStart < minimumSourceSeconds &&
    (left > 0 || right < segments.length - 1)
  ) {
    const leftDuration =
      left > 0 ? nextEnd - segments[left - 1].start : Number.POSITIVE_INFINITY
    const rightDuration =
      right < segments.length - 1
        ? segments[right + 1].end - nextStart
        : Number.POSITIVE_INFINITY
    if (leftDuration <= rightDuration && left > 0) {
      left -= 1
      nextStart = segments[left].start
    } else if (right < segments.length - 1) {
      right += 1
      nextEnd = segments[right].end
    } else {
      break
    }
    if (nextEnd - nextStart > maximumSourceSeconds) break
  }
  return { start: round(nextStart), end: round(nextEnd) }
}

export function fitEditPlan(input: {
  segments: TranscriptSegment[]
  start: number
  end: number
  silenceRanges: RemovedRange[]
  titleSeconds: number
  targetMinSeconds?: number
  targetMaxSeconds?: number
  idealMinSeconds?: number
  idealMaxSeconds?: number
}): EditFitResult {
  const targetMin = input.targetMinSeconds ?? 45
  const targetMax = Math.min(58, input.targetMaxSeconds ?? 58)
  const idealMin = input.idealMinSeconds ?? 50
  const idealMax = Math.min(55, input.idealMaxSeconds ?? 55)
  let removed = input.silenceRanges.map((range) => ({ ...range }))
  let keep = makeKeepRanges(input.start, input.end, removed)
  let duration = editedDuration(keep) + input.titleSeconds
  const removable = input.segments
    .filter(
      (segment) =>
        segment.start >= input.start &&
        segment.end <= input.end &&
        segment.end - segment.start >= 0.45
    )
    .map((segment, index, all) => ({
      segment,
      importance: segmentImportance(segment, index, all.length),
    }))
    .sort(
      (a, b) => a.importance - b.importance || a.segment.start - b.segment.start
    )

  const removeLowImportance = (ceiling: number, floor: number) => {
    for (const item of removable) {
      if (duration <= ceiling) break
      if (removed.some((range) => range.id === `low-${item.segment.id}`)) {
        continue
      }
      const nextRemoved: RemovedRange[] = [
        ...removed,
        {
          id: `low-${item.segment.id}`,
          start: item.segment.start,
          end: item.segment.end,
          reason: "low_importance",
          restored: false,
        },
      ]
      const nextKeep = makeKeepRanges(input.start, input.end, nextRemoved)
      const nextDuration = editedDuration(nextKeep) + input.titleSeconds
      if (nextDuration >= floor && nextDuration < duration) {
        removed = nextRemoved
        keep = nextKeep
        duration = nextDuration
      }
    }
  }

  removeLowImportance(idealMax, idealMin)
  if (duration > targetMax) {
    removeLowImportance(targetMax, targetMin)
  }

  if (duration > targetMax) {
    const edgeCut = bestEdgeCut(
      input.segments,
      input.start,
      input.end,
      removed,
      input.titleSeconds,
      targetMin,
      targetMax
    )
    if (edgeCut) {
      removed = [...removed, edgeCut]
      keep = makeKeepRanges(input.start, input.end, removed)
      duration = editedDuration(keep) + input.titleSeconds
    }
  }

  return {
    removedRanges: removed,
    keepRanges: keep,
    finalDurationSeconds: round(duration),
    withinAllowed: duration >= targetMin && duration <= targetMax,
    meetsIdeal: duration >= idealMin && duration <= idealMax,
  }
}

export function buildCandidateWindows(
  segments: TranscriptSegment[],
  settings: Pick<NewsClipSettings, "targetMinSeconds" | "targetMaxSeconds">
): NewsClipCandidate[] {
  if (segments.length === 0) return []
  const targetSource = Math.max(settings.targetMaxSeconds + 18, 72)
  const windows = segments.map((segment, index) => {
    let endIndex = index
    while (
      endIndex + 1 < segments.length &&
      segments[endIndex].end - segment.start < targetSource
    ) {
      endIndex += 1
    }
    const slice = segments.slice(index, endIndex + 1)
    const text = slice.map((item) => item.text).join(" ")
    const sourceStart = slice[0].start
    const sourceEnd = slice.at(-1)?.end ?? sourceStart
    return candidateOf(text, sourceStart, sourceEnd, index)
  })

  const ranked = windows.sort((a, b) => b.scores.total - a.scores.total)
  const selected: NewsClipCandidate[] = []
  for (const candidate of ranked) {
    const overlaps = selected.some(
      (item) =>
        Math.min(item.sourceEnd, candidate.sourceEnd) -
          Math.max(item.sourceStart, candidate.sourceStart) >
        15
    )
    if (!overlaps) selected.push(candidate)
    if (selected.length === 3) break
  }
  for (const candidate of ranked) {
    if (selected.length === 3) break
    if (!selected.some((item) => item.id === candidate.id))
      selected.push(candidate)
  }
  return selected.map((candidate, index) => ({
    ...candidate,
    id: `candidate-${index + 1}`,
  }))
}

function candidateOf(
  text: string,
  sourceStart: number,
  sourceEnd: number,
  index: number
): NewsClipCandidate {
  const topicalHits = TOPIC_PATTERNS.reduce(
    (sum, pattern) => sum + (text.match(pattern)?.length ?? 0),
    0
  )
  const numberHits = text.match(NUMBER_PATTERN)?.length ?? 0
  const hookHits = text.match(HOOK_PATTERN)?.length ?? 0
  const claimHits = text.match(CLAIM_PATTERN)?.length ?? 0
  const complete = /[다요죠니까.!?][\s"'’”]*$/.test(text.trim())
  const audienceFit = bounded(46 + topicalHits * 9)
  const timeliness = bounded(58 + topicalHits * 4)
  const hook = bounded(42 + hookHits * 13 + Math.min(numberHits, 2) * 6)
  const specificity = bounded(44 + numberHits * 12 + topicalHits * 3)
  const standalone = bounded(complete ? 78 : 54)
  const contextIntegrity = bounded(86 - claimHits * 16)
  const mediaQuality = 78
  const total = Math.round(
    audienceFit * 0.22 +
      timeliness * 0.12 +
      hook * 0.18 +
      specificity * 0.16 +
      standalone * 0.12 +
      contextIntegrity * 0.15 +
      mediaQuality * 0.05
  )
  const preview = text.trim().slice(0, 180)
  const risk = claimHits > 1 || !complete ? "medium" : "low"
  const titleBase = titleFrom(text)
  return {
    id: `window-${index}`,
    sourceStart: round(sourceStart),
    sourceEnd: round(sourceEnd),
    estimatedFinalSeconds: round(Math.max(0, sourceEnd - sourceStart) * 0.72),
    reason: `${topicalHits ? "채널 관심 주제와 연결되고" : "독립적으로 이해할 수 있고"} ${numberHits ? "숫자로 피해를 구체화한" : "직접 발언이 담긴"} 구간입니다.`,
    preview,
    contextRisk: risk,
    scores: {
      audienceFit,
      timeliness,
      hook,
      specificity,
      standalone,
      contextIntegrity,
      mediaQuality,
      total,
    },
    titleOptions: [
      titleBase,
      `"그 말"이 보여준 진짜 문제`,
      `숫자로 드러난 ${titleBase}`,
    ],
  }
}

function segmentImportance(
  segment: TranscriptSegment,
  index: number,
  total: number
) {
  const text = segment.text
  const topicHits = TOPIC_PATTERNS.reduce(
    (sum, pattern) => sum + (text.match(pattern)?.length ?? 0),
    0
  )
  const numberHits = text.match(NUMBER_PATTERN)?.length ?? 0
  const hookHits = text.match(HOOK_PATTERN)?.length ?? 0
  const contextDependency =
    text.match(/하지만|그런데|반면|때문에|따라서|즉|아니|않/g)?.length ?? 0
  const edgeBonus = index === 0 || index === total - 1 ? 5 : 0
  return (
    topicHits * 7 +
    numberHits * 8 +
    hookHits * 5 +
    contextDependency * 7 +
    edgeBonus +
    Math.min(4, text.length / 30)
  )
}

function bestEdgeCut(
  segments: TranscriptSegment[],
  start: number,
  end: number,
  removed: RemovedRange[],
  titleSeconds: number,
  minimum: number,
  maximum: number
) {
  const options: { range: RemovedRange; duration: number }[] = []
  const inside = segments.filter(
    (segment) => segment.start > start && segment.end < end
  )
  for (const segment of inside) {
    const ranges: RemovedRange[] = [
      {
        id: `low-tail-${segment.id}`,
        start: segment.start,
        end,
        reason: "low_importance",
        restored: false,
      },
      {
        id: `low-head-${segment.id}`,
        start,
        end: segment.end,
        reason: "low_importance",
        restored: false,
      },
    ]
    for (const range of ranges) {
      const keep = makeKeepRanges(start, end, [...removed, range])
      const duration = editedDuration(keep) + titleSeconds
      if (duration >= minimum && duration <= maximum) {
        options.push({ range, duration })
      }
    }
  }
  options.sort((a, b) => Math.abs(a.duration - 53) - Math.abs(b.duration - 53))
  return options[0]?.range ?? null
}

function titleFrom(text: string) {
  const clean = text
    .replace(/\s+/g, " ")
    .replace(/^[,.그런데실제로 ]+/, "")
    .trim()
  const first = clean.split(/[.?!]/)[0].slice(0, 28).trim()
  return first || "핵심 발언이 드러난 순간"
}

function mergeRanges(ranges: RemovedRange[]) {
  const sorted = ranges
    .map((range) => ({ ...range }))
    .sort((a, b) => a.start - b.start)
  const merged: RemovedRange[] = []
  for (const range of sorted) {
    const previous = merged.at(-1)
    if (
      previous &&
      previous.restored === range.restored &&
      previous.reason === range.reason &&
      range.start <= previous.end
    ) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push(range)
    }
  }
  return merged
}

function bounded(value: number) {
  return Math.max(0, Math.min(100, value))
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
