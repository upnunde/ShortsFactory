import type { NewsClipProject, NewsReportScene, SubtitleCue } from "./types.ts"

type SavedEditorialTimeline = Pick<
  NewsClipProject,
  "subtitleTimingsLocked" | "reportScenes" | "subtitles"
>

export type LockedEditorialSnapshot = {
  reportScenes: NewsReportScene[]
  subtitles: SubtitleCue[]
}

/**
 * 4번에서 확정한 장면·자막은 새로고침 마이그레이션의 입력이 아니다.
 * 장면 ID·원본 구간·크롭과 자막 ID·문구·시간을 그대로 복제한다.
 */
export function restoreLockedEditorialSnapshot(
  saved: SavedEditorialTimeline
): LockedEditorialSnapshot | null {
  if (
    saved.subtitleTimingsLocked !== true ||
    !Array.isArray(saved.subtitles) ||
    saved.subtitles.length === 0
  ) {
    return null
  }

  const reportScenes = Array.isArray(saved.reportScenes)
    ? saved.reportScenes.map((scene) => ({
        ...scene,
        ...(scene.crop ? { crop: { ...scene.crop } } : {}),
      }))
    : []
  const subtitles = saved.subtitles.map((cue) => ({
    ...cue,
    emphasis: Array.isArray(cue.emphasis) ? [...cue.emphasis] : [],
    ...(Array.isArray(cue.originalEmphasis)
      ? { originalEmphasis: [...cue.originalEmphasis] }
      : {}),
  }))

  return { reportScenes, subtitles }
}
