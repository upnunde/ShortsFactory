const SUBTITLE_TIMELINE_KEYS = new Set([
  "source",
  "selectedCandidateId",
  "selectedAngleId",
  "reportScript",
  "reportScenes",
  "transcript",
  "removedRanges",
  "keepRanges",
  "title",
  "titleCardDurationSeconds",
])

/** 화면·음량·메타데이터 변경은 확정 자막의 시간 잠금을 풀지 않는다. */
export function projectPatchInvalidatesSubtitleTimeline(keys: string[]) {
  return keys.some((key) => SUBTITLE_TIMELINE_KEYS.has(key))
}
