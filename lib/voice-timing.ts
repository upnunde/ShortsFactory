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
  return words.map((word, index) => ({
    word: word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""),
    start: round((duration * index) / words.length),
    end: round((duration * (index + 1)) / words.length),
  }))
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
