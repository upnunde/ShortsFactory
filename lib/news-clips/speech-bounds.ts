import type { TranscriptSegment, TranscriptWord } from "./types.ts"

const SENTENCE_END =
  /(?:[.!?。！？…]|다|요|죠|까|네|군|구나|습니다|습니까|거든요|니까요)\s*[\"'”’)]*\s*$/

export function snapSourceRangeToSpeech(
  start: number,
  end: number,
  transcript: TranscriptSegment[],
  options: {
    maxExtendSeconds?: number
    maxTrimSeconds?: number
  } = {}
) {
  const maxExtend = options.maxExtendSeconds ?? 1.2
  const maxTrim = options.maxTrimSeconds ?? 1.6
  const spanStart = Math.max(0, Math.min(start, end))
  const spanEnd = Math.max(spanStart + 0.12, end)
  const words = collectWords(transcript)
  if (!words.length && !transcript.length) {
    return { start: round(spanStart), end: round(spanEnd) }
  }

  const snappedStart = snapStart(spanStart, words, transcript, maxExtend, maxTrim)
  const snappedEnd = snapEnd(
    Math.max(snappedStart + 0.12, spanEnd),
    words,
    transcript,
    maxExtend,
    maxTrim
  )
  return {
    start: round(snappedStart),
    end: round(Math.max(snappedStart + 0.12, snappedEnd)),
  }
}

export function snapKeepEndsToSpeech(
  keeps: Array<{ start: number; end: number }>,
  transcript: TranscriptSegment[],
  options?: {
    maxExtendSeconds?: number
    maxTrimSeconds?: number
  }
) {
  const snapped = keeps.map((keep) => {
    const next = snapSourceRangeToSpeech(
      keep.start,
      keep.end,
      transcript,
      options
    )
    if (next.end <= next.start + 0.08) return keep
    return next
  })
  // 발화 경계로 늘리면 인접 keep이 같은 구간을 다시 재생한다. 겹침을 잘라낸다.
  return resolveOverlappingKeeps(snapped)
}

/** 시간순 keep에서 겹침·중복·너무 짧은 조각을 제거한다. */
export function resolveOverlappingKeeps(
  keeps: Array<{ start: number; end: number }>
): Array<{ start: number; end: number }> {
  const sorted = [...keeps]
    .map((keep) => ({
      start: round(keep.start),
      end: round(keep.end),
    }))
    .filter((keep) => keep.end - keep.start >= 0.08)
    .sort((left, right) => left.start - right.start || left.end - right.end)

  const out: Array<{ start: number; end: number }> = []
  for (const keep of sorted) {
    if (!out.length) {
      out.push(keep)
      continue
    }
    const prev = out[out.length - 1]!
    if (keep.start < prev.end - 0.04) {
      if (keep.end <= prev.end + 0.04) continue
      const start = prev.end
      if (keep.end - start < 0.12) continue
      out.push({ start: round(start), end: keep.end })
      continue
    }
    out.push(keep)
  }
  return out
}

function snapStart(
  time: number,
  words: TranscriptWord[],
  transcript: TranscriptSegment[],
  maxExtend: number,
  maxTrim: number
) {
  const word = words.find(
    (item) => time >= item.start - 0.04 && time <= item.end + 0.04
  )
  if (word) {
    // 말 중간에서 시작하면 그 단어 시작으로 당긴다.
    if (time - word.start <= maxTrim) return word.start
    // 너무 깊게 들어왔으면 다음 단어 시작으로 민다.
    const next = words.find((item) => item.start >= word.end - 0.02)
    if (next && next.start - time <= maxExtend) return next.start
    return word.start
  }

  const containing = transcript.find(
    (segment) => time > segment.start + 0.08 && time < segment.end - 0.08
  )
  if (containing) {
    if (time - containing.start <= maxTrim) return containing.start
    const next = transcript.find((segment) => segment.start >= containing.end - 0.05)
    if (next && next.start - time <= maxExtend) return next.start
    return containing.start
  }

  const previous = [...transcript]
    .reverse()
    .find((segment) => segment.end <= time + 0.05)
  if (previous && time - previous.end <= maxExtend) {
    const next = transcript.find((segment) => segment.start >= previous.end - 0.05)
    return next?.start ?? time
  }
  return time
}

function snapEnd(
  time: number,
  words: TranscriptWord[],
  transcript: TranscriptSegment[],
  maxExtend: number,
  maxTrim: number
) {
  const containing = transcript.find(
    (segment) => time > segment.start + 0.05 && time < segment.end - 0.05
  )
  if (containing) {
    // 문장/발화 끝이 가까우면 그 끝까지 연장
    if (
      isUtteranceEnd(containing.text) &&
      containing.end - time <= maxExtend
    ) {
      return containing.end
    }
    // 말 도중이면 이전 완성 발화 끝으로 당김
    const previousComplete = [...transcript]
      .reverse()
      .find(
        (segment) =>
          segment.end <= time + 0.02 &&
          segment.end >= time - maxTrim &&
          isUtteranceEnd(segment.text)
      )
    if (previousComplete) return previousComplete.end

    // 단어 단위라도 현재 단어가 끝나게
    const word = words.find(
      (item) => time >= item.start - 0.02 && time <= item.end + 0.02
    )
    if (word) {
      if (word.end - time <= maxExtend) return word.end
      const previousWord = [...words]
        .reverse()
        .find((item) => item.end <= time + 0.02 && item.end >= time - maxTrim)
      if (previousWord) return previousWord.end
      return word.start
    }
    if (time - containing.start <= maxTrim) return containing.start
    return containing.end
  }

  // 범위 끝 직전 완성 발화
  const lastComplete = [...transcript]
    .reverse()
    .find(
      (segment) =>
        segment.end <= time + 0.08 &&
        segment.end >= time - maxTrim - 0.4 &&
        isUtteranceEnd(segment.text)
    )
  if (lastComplete) return lastComplete.end

  const lastBefore = [...transcript]
    .reverse()
    .find((segment) => segment.end <= time + 0.08)
  if (lastBefore && time - lastBefore.end <= maxTrim) return lastBefore.end

  const nextComplete = transcript.find(
    (segment) =>
      segment.end >= time &&
      segment.end - time <= maxExtend &&
      isUtteranceEnd(segment.text)
  )
  if (nextComplete) return nextComplete.end

  return time
}

function collectWords(transcript: TranscriptSegment[]) {
  return transcript
    .flatMap((segment) => segment.words)
    .filter((word) => word.text.trim() && word.end > word.start)
    .sort((left, right) => left.start - right.start)
}

function isUtteranceEnd(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim()
  if (!cleaned) return false
  return SENTENCE_END.test(cleaned)
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
