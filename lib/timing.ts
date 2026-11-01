const WORDS_PER_SECOND = 2.4
const TARGET_SECONDS = 50

export function narrationSeconds(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  if (words === 0) {
    return 0
  }
  return words / WORDS_PER_SECOND
}

export function formatSeconds(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds))
  return `${rounded}초`
}

export function targetSeconds() {
  return TARGET_SECONDS
}

export function narrationTooLong(seconds: number) {
  return seconds >= TARGET_SECONDS
}

export function subtitleLines(text: string, wordsPerLine = 4) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  for (let index = 0; index < words.length; index += wordsPerLine) {
    lines.push(words.slice(index, index + wordsPerLine).join(" "))
  }
  return lines
}

export function defaultSubtitle(text: string) {
  return subtitleLines(text).join("\n")
}

export function subtitleCues(subtitle: string | undefined, narration: string) {
  const source =
    typeof subtitle === "string" ? subtitle : defaultSubtitle(narration)
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}
