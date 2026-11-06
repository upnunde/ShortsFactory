import type {
  KeepRange,
  SubtitleCue,
  TranscriptSegment,
  TranscriptWord,
} from "./types"
import { sourceToOutputTime } from "./timeline.ts"

const EMPHASIS =
  /(?:\d[\d,.]*\s*(?:%|원|명|건|배|조|억|만)?|피해|세금|일자리|안보|재판|규제)/g

export function buildSubtitles(
  segments: TranscriptSegment[],
  keep: KeepRange[],
  maxChars = 22
): SubtitleCue[] {
  const words = segments
    .flatMap((segment) =>
      segment.words.length > 0 ? segment.words : wordsFromSegment(segment)
    )
    .filter((word) =>
      keep.some(
        (range) => word.end > range.sourceStart && word.start < range.sourceEnd
      )
    )
  const groups: TranscriptWord[][] = []
  let current: TranscriptWord[] = []
  for (const word of words) {
    const nextText = [...current, word].map((item) => item.text).join(" ")
    const pause = current.length ? word.start - current.at(-1)!.end : 0
    if (current.length && (nextText.length > maxChars || pause > 0.55)) {
      groups.push(current)
      current = []
    }
    current.push(word)
    if (/[.!?다요죠]$/.test(word.text) && current.length >= 3) {
      groups.push(current)
      current = []
    }
  }
  if (current.length) groups.push(current)

  return groups.flatMap((group, index) => {
    const first = group[0]
    const last = group.at(-1)
    if (!first || !last) return []
    const start = sourceToOutputTime(first.start, keep)
    const end = sourceToOutputTime(last.end, keep)
    if (end <= start) return []
    const text = group
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+([,.!?])/g, "$1")
    return [
      {
        id: `caption-${index + 1}`,
        start,
        end,
        text,
        emphasis: [...new Set(text.match(EMPHASIS) ?? [])],
        emphasisColor: "yellow" as const,
      },
    ]
  })
}

function wordsFromSegment(segment: TranscriptSegment): TranscriptWord[] {
  const parts = segment.text.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return []
  const duration = Math.max(0.1, segment.end - segment.start)
  return parts.map((text, index) => ({
    text,
    start: segment.start + (duration * index) / parts.length,
    end: segment.start + (duration * (index + 1)) / parts.length,
    speaker: segment.speaker,
  }))
}
