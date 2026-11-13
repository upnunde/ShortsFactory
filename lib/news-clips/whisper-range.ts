export function paddedWhisperRange(
  range: { start: number; end: number },
  paddingSeconds = 1.5
) {
  const padding = Math.max(0, Math.min(15, paddingSeconds))
  const rangeStart = Math.min(range.start, range.end)
  const rangeEnd = Math.max(range.start, range.end)
  const start = Math.max(0, rangeStart - padding)
  return {
    start,
    end: Math.max(start + 0.5, rangeEnd + padding),
  }
}
