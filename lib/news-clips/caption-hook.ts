import { scaleQuoteTimelineSeconds } from "./playback.ts"
import type { NewsReportScene, SubtitleCue } from "./types.ts"

export const CAPTION_HOOK_MIN_DURATION_SECONDS = 0.8
export const CAPTION_HOOK_MAX_DURATION_SECONDS = 7

const ADJACENT_CUE_GAP_SECONDS = 0.12

type SelectedCue = {
  cue: SubtitleCue
  sourceStart: number
  sourceEnd: number
}

type HookGroup = {
  sourceStart: number
  sourceEnd: number
  cues: SelectedCue[]
}

export type CaptionHookSelection = {
  scenes: NewsReportScene[]
  subtitles: SubtitleCue[]
  durationSeconds: number
}

/** 선택한 본문 자막의 원본 구간만 시간순으로 이어 붙인 핵심 훅을 만든다. */
export function buildCaptionHookSelection(
  cues: SubtitleCue[],
  primarySourceId: string
): CaptionHookSelection {
  const selected = cues.flatMap<SelectedCue>((cue) => {
    const sourceStart = Number(cue.sourceStart)
    const sourceEnd = Number(cue.sourceEnd)
    if (
      !Number.isFinite(sourceStart) ||
      !Number.isFinite(sourceEnd) ||
      sourceEnd - sourceStart < 0.04
    ) {
      return []
    }
    return [{ cue, sourceStart, sourceEnd }]
  })
  const groups = groupAdjacentCues(selected)
  const scenes: NewsReportScene[] = []
  const subtitles: SubtitleCue[] = []
  let outputCursor = 0

  groups.forEach((group, groupIndex) => {
    const sceneId = `buildup2-hook-selection-${groupIndex + 1}`
    scenes.push({
      id: sceneId,
      narration: "",
      part: "hook",
      audioMode: "original",
      visualMode: "quote",
      visual: "quote",
      sourceId: primarySourceId || undefined,
      sourceStart: round(group.sourceStart),
      sourceEnd: round(group.sourceEnd),
    })

    const groupOutputStart = outputCursor
    for (const selectedCue of group.cues) {
      const localStart = scaleQuoteTimelineSeconds(
        Math.max(0, selectedCue.sourceStart - group.sourceStart)
      )
      const localEnd = scaleQuoteTimelineSeconds(
        Math.max(
          selectedCue.sourceEnd - group.sourceStart,
          selectedCue.sourceStart - group.sourceStart + 0.04
        )
      )
      subtitles.push({
        id: `${sceneId}-caption-${subtitles.length + 1}`,
        sceneId,
        start: round(groupOutputStart + localStart),
        end: round(groupOutputStart + localEnd),
        sourceStart: round(selectedCue.sourceStart),
        sourceEnd: round(selectedCue.sourceEnd),
        text: selectedCue.cue.text,
        emphasis: [...selectedCue.cue.emphasis],
        emphasisColor: selectedCue.cue.emphasisColor,
        edited: true,
        originalText: selectedCue.cue.text,
        originalEmphasis: [...selectedCue.cue.emphasis],
      })
    }
    outputCursor += scaleQuoteTimelineSeconds(
      group.sourceEnd - group.sourceStart
    )
  })

  return {
    scenes,
    subtitles,
    durationSeconds: round(outputCursor),
  }
}

export function isCaptionHookDurationValid(durationSeconds: number) {
  return (
    Number.isFinite(durationSeconds) &&
    durationSeconds >= CAPTION_HOOK_MIN_DURATION_SECONDS &&
    durationSeconds <= CAPTION_HOOK_MAX_DURATION_SECONDS
  )
}

/** 신규 복수 훅과 기존 단일 훅을 같은 규칙으로 판별한다. */
export function isBuildupHookScene(
  scene: Pick<NewsReportScene, "id" | "part">
) {
  return scene.part === "hook" || /^buildup2-hook(?:-|$)/.test(scene.id)
}

export function buildupHookScenes(scenes: NewsReportScene[]) {
  return scenes.filter(isBuildupHookScene)
}

export function buildupHookDuration(scenes: NewsReportScene[]) {
  return round(
    buildupHookScenes(scenes).reduce(
      (total, scene) =>
        total + Math.max(0, scene.sourceEnd - scene.sourceStart),
      0
    )
  )
}

export function removeBuildupHookScenes(scenes: NewsReportScene[]) {
  return scenes.filter((scene) => !isBuildupHookScene(scene))
}

/**
 * 기존 훅 자막을 새 선택 자막으로 교체하고, 뒤에 오는 서두·본문·마무리의
 * 편집 내용은 그대로 둔 채 훅 길이 차이만큼 시간만 이동한다.
 */
export function replaceCaptionHookSubtitles(
  allCues: SubtitleCue[],
  previousHookScenes: NewsReportScene[],
  nextHookCues: SubtitleCue[],
  previousDurationSeconds: number,
  nextDurationSeconds: number
) {
  const previousHookSceneIds = new Set(
    buildupHookScenes(previousHookScenes).map((scene) => scene.id)
  )
  const delta = nextDurationSeconds - previousDurationSeconds
  const retained = allCues
    .filter((cue) => !cue.sceneId || !previousHookSceneIds.has(cue.sceneId))
    .map((cue) => ({
      ...cue,
      start: round(Math.max(0, cue.start + delta)),
      end: round(Math.max(0.04, cue.end + delta)),
    }))
  return [...nextHookCues, ...retained]
}

function groupAdjacentCues(cues: SelectedCue[]) {
  const groups: HookGroup[] = []
  for (const selected of cues) {
    const previous = groups.at(-1)
    if (
      previous &&
      selected.sourceStart >= previous.sourceStart &&
      selected.sourceStart <= previous.sourceEnd + ADJACENT_CUE_GAP_SECONDS
    ) {
      previous.sourceEnd = Math.max(previous.sourceEnd, selected.sourceEnd)
      previous.cues.push(selected)
      continue
    }
    groups.push({
      sourceStart: selected.sourceStart,
      sourceEnd: selected.sourceEnd,
      cues: [selected],
    })
  }
  return groups
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
