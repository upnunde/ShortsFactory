import { narrationTooLong, targetSeconds } from "./timing.ts"

export type WordTiming = {
  word: string
  start: number
  end: number
}

export function wordTimings(text: string, duration: number): WordTiming[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || duration <= 0) {
    return []
  }
  const weights = words.map(speechWeight)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0
  return words.map((word, index) => {
    const start = cursor
    cursor =
      index === words.length - 1
        ? duration
        : cursor + (duration * weights[index]) / total
    return {
      word: word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""),
      start: round(start),
      end: round(cursor),
    }
  })
}

export function speechSpeed(duration: number, target = targetSeconds() - 1) {
  if (!narrationTooLong(duration)) {
    return 1
  }
  return Math.min(1.25, Math.round((duration / target) * 100) / 100)
}

export function videoSecondsForAudio(duration: number) {
  return Math.min(30, Math.max(4, Math.ceil(duration || 4)))
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}

function speechWeight(word: string) {
  const spoken = word.replace(/[^\p{L}\p{N}]+/gu, "")
  const length = Math.max(1, [...spoken].length)
  const pause = /[.!?]["')\]]?$/.test(word)
    ? 0.7
    : /[,;:]["')\]]?$/.test(word)
      ? 0.3
      : 0
  return Math.max(0.65, Math.pow(length, 0.65)) + pause
}
