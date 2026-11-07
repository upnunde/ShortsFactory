import { collapseBuildupHighlightCuts } from "./buildup.ts"
import {
  NEWS_TOTAL_GAP_SECONDS,
  appendEndCtaScenes,
  estimateReportScenesDuration,
  isEndCtaScene,
  normalizeQuoteScenes,
  reportCaptionPhrases,
  reportSubtitles,
  splitEndCtaFromScript,
} from "./report.ts"
import { normalizeSubtitleCues } from "./text-layout.ts"
import type {
  NewsClipProject,
  NewsClipSettings,
  NewsReportScene,
} from "./types.ts"

type PrepareSettings = Pick<
  NewsClipSettings,
  "titleVoiceRate" | "bodySubtitleText" | "titleCardSeconds"
>

/**
 * FFmpeg 렌더 직전·3번 미리보기 직전 공통 계약.
 * 장면은 정규화하고, 자막은 기본으로 수동 수정을 유지한다.
 * 대본/장면 구조가 바뀐 때만 rebuildSubtitles로 다시 만든다.
 */
export function prepareRenderProject(
  project: NewsClipProject,
  settings: PrepareSettings,
  options: { rebuildSubtitles?: boolean } = {}
): { project: NewsClipProject; reason: string } {
  const primarySourceId = project.source?.id ?? ""
  let reportScenes = normalizeQuoteScenes(
    collapseBuildupHighlightCuts(project.reportScenes),
    primarySourceId ? { [primarySourceId]: project.transcript } : {},
    primarySourceId,
    settings.titleVoiceRate
  )

  const { body, cta } = splitEndCtaFromScript(project.reportScript)
  const existingCta = reportScenes.find((scene) => isEndCtaScene(scene))
  const ctaText = (existingCta?.narration || cta || "").trim()
  if (ctaText) {
    // 기존 end-cta의 구간·크롭을 유지하도록 장면 목록을 그대로 넘긴다.
    reportScenes = appendEndCtaScenes(
      reportScenes,
      ctaText,
      primarySourceId
    )
  }

  reportScenes = lockSceneSources(reportScenes, primarySourceId)

  const reason = renderContractReason(project, reportScenes)
  if (reason) {
    return { project, reason }
  }

  const generatedSubtitles = normalizeSubtitleCues(
    reportSubtitles(
      reportScenes,
      undefined,
      reportCaptionPhrases(body || project.reportScript),
      project.transcript
    ),
    settings.bodySubtitleText
  )
  const subtitles =
    options.rebuildSubtitles || project.subtitles.length === 0
      ? generatedSubtitles
      : normalizeSubtitleCues(project.subtitles, settings.bodySubtitleText)
  const outputBodyDuration = estimateReportScenesDuration(
    reportScenes,
    settings.titleVoiceRate
  )

  return {
    reason: "",
    project: {
      ...project,
      reportScenes,
      subtitles,
      outputDurationSeconds:
        settings.titleCardSeconds +
        outputBodyDuration +
        NEWS_TOTAL_GAP_SECONDS,
      // 렌더 전 계약이 바뀌면 이전 미리보기 서명을 무효화한다.
      previewSignature: "",
      renderSignature: "",
    },
  }
}

/** 장면 구간/크롭만 바뀌었을 때 장면·길이를 갱신하고 수동 자막은 유지한다. */
export function rebuildSubtitlesAfterSceneEdit(
  project: NewsClipProject,
  reportScenes: NewsReportScene[],
  settings: PrepareSettings
) {
  return prepareRenderProject({ ...project, reportScenes }, settings)
}

function lockSceneSources(
  scenes: NewsReportScene[],
  primarySourceId: string
) {
  if (!primarySourceId) return scenes
  return scenes.map((scene) => ({
    ...scene,
    sourceId: scene.sourceId || primarySourceId,
  }))
}

/** 클라이언트·서버 공통으로 쓰는 FFmpeg 입력 최소 계약. */
export function renderContractReason(
  project: NewsClipProject,
  reportScenes: NewsReportScene[] = project.reportScenes
) {
  if (!project.source?.approved) return "source-not-approved"
  if (!project.title.trim()) return "title-required"
  if (!project.reportScript.trim()) return "report-script-required"
  if (!reportScenes.length) return "report-scenes-required"

  const broken = reportScenes.find((scene) => {
    if (scene.visual === "quote") {
      return (
        !Number.isFinite(scene.sourceStart) ||
        !Number.isFinite(scene.sourceEnd) ||
        scene.sourceEnd <= scene.sourceStart
      )
    }
    return !scene.narration.trim()
  })
  if (broken) {
    return broken.visual === "quote"
      ? "report-scene-quote-range-invalid"
      : "report-scene-narration-required"
  }

  if (project.productionMode === "buildup") {
    const hasTeaser = reportScenes.some((scene) => scene.id === "buildup-teaser")
    const hasHighlight = reportScenes.some(
      (scene) =>
        scene.id === "buildup-highlight" ||
        /^buildup-highlight-cut-\d+/i.test(scene.id)
    )
    if (!hasTeaser || !hasHighlight) return "report-scenes-required"
    if (!project.transcript.length) return "report-script-required"
  }

  return ""
}
