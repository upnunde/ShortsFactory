import {
  replaceTranscriptRange,
  transcriptRangeLooksHallucinated,
} from "./transcript.ts"
import type { TranscriptSegment, TranscriptWord } from "./types.ts"

export type TranscriptQualityRange = { start: number; end: number }

export type ConfidencePocket = {
  start: number
  end: number
  wordCount: number
  averageConfidence: number
  lowConfidenceRatio: number
}

export type WordConfidenceStats = {
  wordCount: number
  ratedWordCount: number
  lowConfidenceWordCount: number
  averageConfidence: number | null
  lowConfidenceRatio: number | null
  confidenceCoverage: number
  worstWindowAverageConfidence: number | null
  worstWindowLowConfidenceRatio: number | null
  confidencePockets: ConfidencePocket[]
}

export type NearbyPhraseRegeneration = {
  regenerated: boolean
  candidateTokenCount: number
  precedingTokenCount: number
  overlapTokenCount: number
  overlapRatio: number
  longestMatchLength: number
  longestMatchRatio: number
  start: number | null
  end: number | null
}

export type TranscriptTextConflict = {
  conflict: boolean
  similarity: number | null
  worstLocalSimilarity: number | null
  localComparisonCount: number
  localConflictRatio: number
  candidateTokenCount: number
  baselineTokenCount: number
}

export type TranscriptQualityReason =
  | "empty-candidate"
  | "low-word-confidence"
  | "local-low-confidence-pocket"
  | "nearby-phrase-regeneration"
  | "repetitive-transcript-pattern"
  | "baseline-text-conflict"
  | "missing-confidence"

export type TranscriptQualityAssessment = {
  decision: "accept" | "retry" | "reject"
  suspicious: boolean
  averageConfidence: number | null
  lowConfidenceRatio: number | null
  confidenceCoverage: number
  worstWindowAverageConfidence: number | null
  worstWindowLowConfidenceRatio: number | null
  lowConfidencePocketCount: number
  precedingOverlap: number
  baselineSimilarity: number | null
  hallucinated: boolean
  reasons: TranscriptQualityReason[]
  confidence: WordConfidenceStats
  regeneration: NearbyPhraseRegeneration
  baselineConflict: TranscriptTextConflict
}

const LOW_CONFIDENCE = 0.45
const LOCAL_WINDOW_WORDS = 6
const LOCAL_WINDOW_MAX_SECONDS = 12
const NEARBY_CONTEXT_SECONDS = 45

function orderedRange(range: TranscriptQualityRange) {
  return {
    start: Math.min(range.start, range.end),
    end: Math.max(range.start, range.end),
  }
}

function overlapsRange(
  start: number,
  end: number,
  range?: TranscriptQualityRange
) {
  if (!range) return true
  const ordered = orderedRange(range)
  return end > ordered.start && start < ordered.end
}

function finiteConfidence(word: TranscriptWord) {
  return typeof word.confidence === "number" &&
    Number.isFinite(word.confidence) &&
    word.confidence >= 0 &&
    word.confidence <= 1
    ? word.confidence
    : null
}

function average(values: number[]) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null
}

function confidencePocket(
  words: Array<TranscriptWord & { confidence: number }>
): ConfidencePocket {
  const values = words.map((word) => word.confidence)
  return {
    start: Math.min(...words.map((word) => word.start)),
    end: Math.max(...words.map((word) => word.end)),
    wordCount: words.length,
    averageConfidence: average(values) ?? 0,
    lowConfidenceRatio:
      values.filter((value) => value < LOW_CONFIDENCE).length / values.length,
  }
}

function mergeConfidencePockets(pockets: ConfidencePocket[]) {
  const merged: ConfidencePocket[] = []
  for (const pocket of pockets.sort(
    (left, right) => left.start - right.start
  )) {
    const previous = merged.at(-1)
    if (!previous || pocket.start > previous.end + 0.2) {
      merged.push({ ...pocket })
      continue
    }
    previous.end = Math.max(previous.end, pocket.end)
    previous.wordCount = Math.max(previous.wordCount, pocket.wordCount)
    previous.averageConfidence = Math.min(
      previous.averageConfidence,
      pocket.averageConfidence
    )
    previous.lowConfidenceRatio = Math.max(
      previous.lowConfidenceRatio,
      pocket.lowConfidenceRatio
    )
  }
  return merged
}

/** 단어 신뢰도의 전체 평균과 긴 전사 안에 묻힌 국소 저신뢰 구간을 함께 계산한다. */
export function wordConfidenceStats(
  segments: TranscriptSegment[],
  range?: TranscriptQualityRange
): WordConfidenceStats {
  const words = segments
    .flatMap((segment) => segment.words)
    .filter((word) => overlapsRange(word.start, word.end, range))
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const ratedWords = words
    .map((word) => {
      const confidence = finiteConfidence(word)
      return confidence === null ? null : { ...word, confidence }
    })
    .filter(
      (word): word is TranscriptWord & { confidence: number } => word !== null
    )
  const values = ratedWords.map((word) => word.confidence)
  const lowConfidenceWordCount = values.filter(
    (value) => value < LOW_CONFIDENCE
  ).length

  const rawPockets: ConfidencePocket[] = []
  if (ratedWords.length >= LOCAL_WINDOW_WORDS) {
    for (
      let index = 0;
      index <= ratedWords.length - LOCAL_WINDOW_WORDS;
      index += 1
    ) {
      const window = ratedWords.slice(index, index + LOCAL_WINDOW_WORDS)
      const pocket = confidencePocket(window)
      if (
        pocket.end - pocket.start <= LOCAL_WINDOW_MAX_SECONDS &&
        pocket.averageConfidence <= 0.42 &&
        pocket.lowConfidenceRatio >= 0.5
      ) {
        rawPockets.push(pocket)
      }
    }
  }

  for (const segment of segments) {
    const segmentWords = segment.words
      .filter((word) => overlapsRange(word.start, word.end, range))
      .map((word) => {
        const confidence = finiteConfidence(word)
        return confidence === null ? null : { ...word, confidence }
      })
      .filter(
        (word): word is TranscriptWord & { confidence: number } => word !== null
      )
    if (segmentWords.length < 4) continue
    const pocket = confidencePocket(segmentWords)
    if (
      pocket.end - pocket.start <= LOCAL_WINDOW_MAX_SECONDS &&
      pocket.averageConfidence <= 0.38 &&
      pocket.lowConfidenceRatio >= 0.5
    ) {
      rawPockets.push(pocket)
    }
  }

  const confidencePockets = mergeConfidencePockets(rawPockets)
  return {
    wordCount: words.length,
    ratedWordCount: ratedWords.length,
    lowConfidenceWordCount,
    averageConfidence: average(values),
    lowConfidenceRatio: values.length
      ? lowConfidenceWordCount / values.length
      : null,
    confidenceCoverage: words.length ? ratedWords.length / words.length : 0,
    worstWindowAverageConfidence: confidencePockets.length
      ? Math.min(...confidencePockets.map((pocket) => pocket.averageConfidence))
      : null,
    worstWindowLowConfidenceRatio: confidencePockets.length
      ? Math.max(
          ...confidencePockets.map((pocket) => pocket.lowConfidenceRatio)
        )
      : null,
    confidencePockets,
  }
}

function normalizeTokens(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean)
}

function segmentTokens(segment: TranscriptSegment) {
  if (segment.words.length) {
    return segment.words.flatMap((word) => normalizeTokens(word.text))
  }
  return normalizeTokens(segment.text)
}

function segmentsTokens(segments: TranscriptSegment[]) {
  return [...segments]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .flatMap(segmentTokens)
}

function longestCommonContiguousMatch(left: string[], right: string[]) {
  if (!left.length || !right.length) return 0
  let previous = new Array<number>(right.length + 1).fill(0)
  let longest = 0
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Array<number>(right.length + 1).fill(0)
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      if (left[leftIndex - 1] !== right[rightIndex - 1]) continue
      current[rightIndex] = previous[rightIndex - 1] + 1
      longest = Math.max(longest, current[rightIndex])
    }
    previous = current
  }
  return longest
}

function ngramCoverage(candidate: string[], preceding: string[], size = 3) {
  if (candidate.length < size || preceding.length < size) return 0
  const precedingNgrams = new Set<string>()
  for (let index = 0; index <= preceding.length - size; index += 1) {
    precedingNgrams.add(preceding.slice(index, index + size).join("\u0000"))
  }
  const covered = new Set<number>()
  for (let index = 0; index <= candidate.length - size; index += 1) {
    if (
      !precedingNgrams.has(candidate.slice(index, index + size).join("\u0000"))
    ) {
      continue
    }
    for (let offset = 0; offset < size; offset += 1) {
      covered.add(index + offset)
    }
  }
  return covered.size / candidate.length
}

function tokenSequenceOverlap(candidate: string[], preceding: string[]) {
  const limitedPreceding = preceding.slice(-280)
  const longestMatchLength = longestCommonContiguousMatch(
    candidate,
    limitedPreceding
  )
  const coverage = ngramCoverage(candidate, limitedPreceding)
  return {
    precedingTokenCount: limitedPreceding.length,
    overlapTokenCount: Math.max(
      longestMatchLength,
      Math.round(coverage * candidate.length)
    ),
    overlapRatio: Math.max(
      coverage,
      candidate.length ? longestMatchLength / candidate.length : 0
    ),
    longestMatchLength,
    longestMatchRatio: candidate.length
      ? longestMatchLength / candidate.length
      : 0,
  }
}

/** 후보 전사의 국소 구간이 바로 앞 문장을 재생성했는지 찾는다. */
export function nearbyPhraseRegeneration(
  candidate: TranscriptSegment[],
  preceding: TranscriptSegment[]
): NearbyPhraseRegeneration {
  const orderedCandidate = [...candidate].sort(
    (left, right) => left.start - right.start || left.end - right.end
  )
  let best: NearbyPhraseRegeneration = {
    regenerated: false,
    candidateTokenCount: 0,
    precedingTokenCount: 0,
    overlapTokenCount: 0,
    overlapRatio: 0,
    longestMatchLength: 0,
    longestMatchRatio: 0,
    start: null,
    end: null,
  }

  for (
    let startIndex = 0;
    startIndex < orderedCandidate.length;
    startIndex += 1
  ) {
    for (
      let endIndex = startIndex;
      endIndex < Math.min(orderedCandidate.length, startIndex + 3);
      endIndex += 1
    ) {
      const group = orderedCandidate.slice(startIndex, endIndex + 1)
      const start = group[0]?.start ?? 0
      const end = group.at(-1)?.end ?? start
      if (end - start > LOCAL_WINDOW_MAX_SECONDS) break
      const candidateTokens = segmentsTokens(group)
      if (candidateTokens.length < 6 || candidateTokens.length > 60) continue

      const context = [...preceding, ...orderedCandidate.slice(0, startIndex)]
        .filter(
          (segment) =>
            segment.end <= start + 0.1 &&
            segment.end >= start - NEARBY_CONTEXT_SECONDS
        )
        .sort((left, right) => left.start - right.start || left.end - right.end)
      const precedingTokens = segmentsTokens(context)
      if (precedingTokens.length < 5) continue
      const overlap = tokenSequenceOverlap(candidateTokens, precedingTokens)
      const regenerated =
        end - start >= 2 &&
        ((overlap.longestMatchLength >= 5 && overlap.overlapRatio >= 0.5) ||
          (overlap.longestMatchLength >= 3 && overlap.overlapRatio >= 0.65))
      const score =
        overlap.overlapRatio +
        Math.min(1, overlap.longestMatchLength / 8) * 0.25
      const bestScore =
        best.overlapRatio + Math.min(1, best.longestMatchLength / 8) * 0.25
      if (score <= bestScore && !(regenerated && !best.regenerated)) continue
      best = {
        regenerated,
        candidateTokenCount: candidateTokens.length,
        ...overlap,
        start,
        end,
      }
    }
  }

  return best
}

function normalizedCompactText(segments: TranscriptSegment[]) {
  return [...segments]
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .map((segment) => segment.text)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
}

function ngramCounts(value: string, size: number) {
  const counts = new Map<string, number>()
  for (let index = 0; index <= value.length - size; index += 1) {
    const ngram = value.slice(index, index + size)
    counts.set(ngram, (counts.get(ngram) ?? 0) + 1)
  }
  return counts
}

function diceSimilarity(left: string, right: string) {
  if (!left || !right) return null
  if (left === right) return 1
  const size = Math.min(left.length, right.length) < 8 ? 2 : 3
  const leftCounts = ngramCounts(left, size)
  const rightCounts = ngramCounts(right, size)
  let intersection = 0
  for (const [ngram, leftCount] of leftCounts) {
    intersection += Math.min(leftCount, rightCounts.get(ngram) ?? 0)
  }
  const leftTotal = [...leftCounts.values()].reduce(
    (total, count) => total + count,
    0
  )
  const rightTotal = [...rightCounts.values()].reduce(
    (total, count) => total + count,
    0
  )
  return leftTotal + rightTotal
    ? (2 * intersection) / (leftTotal + rightTotal)
    : 0
}

/** 기준 SRT는 정답이 아니라 독립적인 불일치 신호로만 비교한다. */
export function transcriptTextConflict(
  candidate: TranscriptSegment[],
  baseline: TranscriptSegment[]
): TranscriptTextConflict {
  const candidateText = normalizedCompactText(candidate)
  const baselineText = normalizedCompactText(baseline)
  const similarity = diceSimilarity(candidateText, baselineText)
  const localSimilarities: number[] = []

  for (const segment of candidate) {
    if (normalizedCompactText([segment]).length < 6) continue
    const alignedBaseline = baseline.filter(
      (item) =>
        item.end > segment.start - 0.35 && item.start < segment.end + 0.35
    )
    if (
      !alignedBaseline.length ||
      normalizedCompactText(alignedBaseline).length < 6
    ) {
      continue
    }
    const localSimilarity = diceSimilarity(
      normalizedCompactText([segment]),
      normalizedCompactText(alignedBaseline)
    )
    if (localSimilarity !== null) localSimilarities.push(localSimilarity)
  }

  const localConflictCount = localSimilarities.filter(
    (value) => value < 0.22
  ).length
  const localConflictRatio = localSimilarities.length
    ? localConflictCount / localSimilarities.length
    : 0
  return {
    conflict:
      (similarity !== null && similarity < 0.32) || localConflictCount > 0,
    similarity,
    worstLocalSimilarity: localSimilarities.length
      ? Math.min(...localSimilarities)
      : null,
    localComparisonCount: localSimilarities.length,
    localConflictRatio,
    candidateTokenCount: segmentsTokens(candidate).length,
    baselineTokenCount: segmentsTokens(baseline).length,
  }
}

function segmentsInRange(
  segments: TranscriptSegment[],
  range?: TranscriptQualityRange
) {
  if (!range) return segments
  const ordered = orderedRange(range)
  return segments
    .filter(
      (segment) => segment.end > ordered.start && segment.start < ordered.end
    )
    .map((segment) => {
      if (!segment.words.length) return segment
      const words = segment.words.filter((word) =>
        overlapsRange(word.start, word.end, ordered)
      )
      return {
        ...segment,
        text: words.length ? words.map((word) => word.text).join(" ") : "",
        words,
      }
    })
    .filter((segment) => segment.text.trim() || segment.words.length)
}

function transcriptRange(segments: TranscriptSegment[]) {
  if (!segments.length) return null
  return {
    start: Math.min(...segments.map((segment) => segment.start)),
    end: Math.max(...segments.map((segment) => segment.end)),
  }
}

function rangesOverlap(
  left: { start: number | null; end: number | null },
  right: TranscriptQualityRange
) {
  return (
    left.start !== null &&
    left.end !== null &&
    left.end > right.start &&
    left.start < right.end
  )
}

export function assessTranscriptQuality({
  candidate,
  baseline = [],
  preceding = [],
  range,
}: {
  candidate: TranscriptSegment[]
  baseline?: TranscriptSegment[]
  preceding?: TranscriptSegment[]
  range?: TranscriptQualityRange
}): TranscriptQualityAssessment {
  const scopedCandidate = segmentsInRange(candidate, range)
  const scopedBaseline = segmentsInRange(baseline, range)
  const effectiveRange = range ?? transcriptRange(scopedCandidate)
  const confidence = wordConfidenceStats(scopedCandidate)
  const regeneration = nearbyPhraseRegeneration(scopedCandidate, preceding)
  const baselineConflict = transcriptTextConflict(
    scopedCandidate,
    scopedBaseline
  )
  const duration = effectiveRange
    ? Math.max(0, effectiveRange.end - effectiveRange.start)
    : 0
  const hallucinated = effectiveRange
    ? transcriptRangeLooksHallucinated(scopedCandidate, effectiveRange)
    : false
  const reasons: TranscriptQualityReason[] = []

  if (!scopedCandidate.length || !segmentsTokens(scopedCandidate).length) {
    reasons.push("empty-candidate")
  }
  const sufficientlyRated =
    confidence.ratedWordCount >= 3 && confidence.confidenceCoverage >= 0.45
  const globallyLowConfidence =
    sufficientlyRated &&
    ((confidence.averageConfidence ?? 1) < 0.5 ||
      (confidence.lowConfidenceRatio ?? 0) >= 0.5)
  const stronglyLowConfidencePocket = confidence.confidencePockets.some(
    (pocket) =>
      pocket.averageConfidence <= 0.32 && pocket.lowConfidenceRatio >= 0.5
  )
  const regenerationHasLowConfidencePocket =
    regeneration.regenerated &&
    confidence.confidencePockets.some((pocket) =>
      rangesOverlap(regeneration, pocket)
    )
  const shortHighConfidenceChant =
    duration <= 6 &&
    sufficientlyRated &&
    (confidence.averageConfidence ?? 0) >= 0.72

  if (globallyLowConfidence) reasons.push("low-word-confidence")
  if (confidence.confidencePockets.length) {
    reasons.push("local-low-confidence-pocket")
  }
  if (regeneration.regenerated && !shortHighConfidenceChant) {
    reasons.push("nearby-phrase-regeneration")
  }
  if (hallucinated && !shortHighConfidenceChant) {
    reasons.push("repetitive-transcript-pattern")
  }
  if (baselineConflict.conflict && scopedBaseline.length) {
    reasons.push("baseline-text-conflict")
  }
  if (confidence.wordCount > 0 && confidence.confidenceCoverage < 0.45) {
    reasons.push("missing-confidence")
  }

  let decision: TranscriptQualityAssessment["decision"] = "accept"
  if (reasons.includes("empty-candidate")) {
    decision = "reject"
  } else if (
    regeneration.regenerated &&
    !shortHighConfidenceChant &&
    (regenerationHasLowConfidencePocket || globallyLowConfidence)
  ) {
    decision = "reject"
  } else if (
    hallucinated &&
    !shortHighConfidenceChant &&
    (stronglyLowConfidencePocket || globallyLowConfidence)
  ) {
    decision = "reject"
  } else if (
    (hallucinated || regeneration.regenerated) &&
    !shortHighConfidenceChant
  ) {
    decision = "retry"
  } else if (
    (stronglyLowConfidencePocket || globallyLowConfidence) &&
    baselineConflict.conflict
  ) {
    decision = "retry"
  } else if (stronglyLowConfidencePocket || globallyLowConfidence) {
    decision = "retry"
  } else if (
    baselineConflict.conflict &&
    confidence.confidenceCoverage < 0.45
  ) {
    decision = "retry"
  }

  return {
    decision,
    suspicious: decision !== "accept",
    averageConfidence: confidence.averageConfidence,
    lowConfidenceRatio: confidence.lowConfidenceRatio,
    confidenceCoverage: confidence.confidenceCoverage,
    worstWindowAverageConfidence: confidence.worstWindowAverageConfidence,
    worstWindowLowConfidenceRatio: confidence.worstWindowLowConfidenceRatio,
    lowConfidencePocketCount: confidence.confidencePockets.length,
    precedingOverlap: regeneration.overlapRatio,
    baselineSimilarity: baselineConflict.similarity,
    hallucinated,
    reasons,
    confidence,
    regeneration,
    baselineConflict,
  }
}

/** 검증을 통과한 재전사만 기준 타임라인에 적용한다. */
export function selectTranscriptRangeReplacement({
  baseline,
  candidate,
  preceding = [],
  range,
}: {
  baseline: TranscriptSegment[]
  candidate: TranscriptSegment[]
  preceding?: TranscriptSegment[]
  range: TranscriptQualityRange
}) {
  const assessment = assessTranscriptQuality({
    candidate,
    baseline,
    preceding,
    range,
  })
  const accepted = assessment.decision === "accept"
  return {
    accepted,
    assessment,
    transcript: accepted
      ? replaceTranscriptRange(baseline, candidate, range)
      : baseline,
  }
}
