import type { TranscriptSegment, TranscriptWord } from "./types"

export function parseTranscript(input: string): TranscriptSegment[] {
  const text = input.replace(/^\uFEFF/, "").trim()
  if (!text) return []
  const blocks = text.split(/\r?\n\s*\r?\n/)
  const timed = blocks.flatMap((block, index) => parseTimedBlock(block, index))
  if (timed.length > 0) return timed
  return plainSegments(text)
}

function parseTimedBlock(block: string, index: number): TranscriptSegment[] {
  const lines = block.split(/\r?\n/).map((line) => line.trim())
  const timingIndex = lines.findIndex((line) => line.includes("-->"))
  if (timingIndex < 0) return []
  const [startText, endText] = lines[timingIndex].split("-->")
  const start = parseTime(startText)
  const end = parseTime(endText?.trim().split(/\s+/)[0] ?? "")
  const content = lines
    .slice(timingIndex + 1)
    .join(" ")
    .replace(/<[^>]+>/g, "")
    .trim()
  if (!content || end <= start) return []
  return [segmentOf(content, start, end, index)]
}

function plainSegments(text: string) {
  const sentences = text
    .replace(/\r?\n+/g, " ")
    .split(/(?<=[.!?다요죠])\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
  let cursor = 0
  return sentences.map((sentence, index) => {
    const duration = Math.max(1.2, sentence.length / 6.2)
    const segment = segmentOf(sentence, cursor, cursor + duration, index)
    cursor += duration + 0.18
    return segment
  })
}

function segmentOf(
  text: string,
  start: number,
  end: number,
  index: number
): TranscriptSegment {
  const parts = text.split(/\s+/).filter(Boolean)
  const duration = end - start
  const words: TranscriptWord[] = parts.map((word, wordIndex) => ({
    text: word,
    start: start + (duration * wordIndex) / parts.length,
    end: start + (duration * (wordIndex + 1)) / parts.length,
    speaker: "speaker-1",
  }))
  return {
    id: `segment-${index + 1}`,
    text,
    start,
    end,
    speaker: "speaker-1",
    words,
  }
}

function parseTime(value: string) {
  const match = value.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/)
  if (!match) return 0
  const [, hours = "0", minutes, seconds, millis] = match
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    Number(millis.padEnd(3, "0")) / 1000
  )
}
