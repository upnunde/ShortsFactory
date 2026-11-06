import type { RemovedRange } from "./types.ts"

export function parseSilenceOutput(output: string): RemovedRange[] {
  const starts = [...output.matchAll(/silence_start:\s*([\d.]+)/g)].map(
    (match) => Number(match[1])
  )
  const ends = [...output.matchAll(/silence_end:\s*([\d.]+)/g)].map((match) =>
    Number(match[1])
  )
  const ranges: RemovedRange[] = []
  for (
    let index = 0;
    index < Math.min(starts.length, ends.length);
    index += 1
  ) {
    const start = starts[index] + 0.08
    const end = ends[index] - 0.08
    if (end - start <= 0.04) continue
    ranges.push({
      id: `vad-${index + 1}`,
      start: round(start),
      end: round(end),
      reason: "silence",
      restored: false,
    })
  }
  return ranges
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
