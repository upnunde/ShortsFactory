import { collapseBuildup2HighlightCuts } from "./buildup.ts"
import { angleHasLockedRange } from "./angles.ts"
import { applyBuildupBodyCuts } from "./body-cuts.ts"
import {
  partitionSubtitlesByPart,
  removeTrailingCtaFromLead,
  reportScenePart,
  splitScenesByClipPart,
} from "./clip-parts.ts"
import {
  snapSourceRangeToCompleteUtterance,
  tightenLockedSourceRangeToSpeech,
} from "./speech-bounds.ts"
import {
  NEWS_TOTAL_GAP_SECONDS,
  appendEndCtaScenes,
  canonicalReportScript,
  estimateReportScenesDuration,
  isEndCtaScene,
  mergeEditedSubtitleText,
  normalizeQuoteScenes,
  reportSceneAudioMode,
  reportSceneVisualMode,
  reportCaptionPhrases,
  reportSubtitles,
  splitEndCtaFromScript,
} from "./report.ts"
import {
  automaticSubtitleCueCharacterLimit,
  layoutTimedSubtitleCues,
  normalizeSubtitleCues,
  subtitleLineCharacterLimit,
} from "./text-layout.ts"
import { normalizeTranscriptCalendarDates } from "./transcript.ts"
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
  options: { rebuildSubtitles?: boolean; lockTimeline?: boolean } = {}
): { project: NewsClipProject; reason: string } {
  const primarySourceId = project.source?.id ?? ""
  const transcript = normalizeTranscriptCalendarDates(project.transcript)
  const selectedAngle = project.angleOptions.find(
    (angle) => angle.id === project.selectedAngleId
  )
  const selectedCandidate = project.candidates.find(
    (candidate) => candidate.id === project.selectedCandidateId
  )
  const hasManualCutHistory = project.removedRanges.some(
    (range) => range.reason === "manual"
  )
  const rawLockedBuildupRange =
    project.productionMode === "buildup2" &&
    selectedAngle &&
    angleHasLockedRange(selectedAngle)
      ? {
          start: Math.min(selectedAngle.sourceStart, selectedAngle.sourceEnd),
          end: Math.max(selectedAngle.sourceStart, selectedAngle.sourceEnd),
        }
      : null
  const lockedBuildupRange = rawLockedBuildupRange
    ? tightenLockedSourceRangeToSpeech(
        rawLockedBuildupRange.start,
        rawLockedBuildupRange.end,
        transcript
      )
    : null
  const rawCandidateBuildupRange =
    project.productionMode === "buildup2" &&
    hasManualCutHistory &&
    selectedCandidate &&
    Number.isFinite(selectedCandidate.sourceStart) &&
    Number.isFinite(selectedCandidate.sourceEnd) &&
    selectedCandidate.sourceEnd - selectedCandidate.sourceStart >= 0.2
      ? {
          start: selectedCandidate.sourceStart,
          end: selectedCandidate.sourceEnd,
        }
      : null
  const candidateBuildupRange = rawCandidateBuildupRange
    ? tightenLockedSourceRangeToSpeech(
        rawCandidateBuildupRange.start,
        rawCandidateBuildupRange.end,
        transcript
      )
    : null
  const canonicalBuildupRange = lockedBuildupRange ?? candidateBuildupRange
  let keepRanges = project.keepRanges
  let reportScenes =
    project.productionMode === "report"
      ? project.reportScenes.map((scene) => ({
          ...scene,
          part: reportScenePart(scene, "report"),
          audioMode: "tts" as const,
          visualMode:
            reportSceneVisualMode(scene) === "quote"
              ? scene.sourceId && scene.sourceId !== primarySourceId
                ? ("supporting" as const)
                : ("source" as const)
              : reportSceneVisualMode(scene),
          visual: "source" as const,
        }))
      : options.lockTimeline
        ? project.reportScenes.map((scene) => ({ ...scene }))
        : normalizeQuoteScenes(
            collapseBuildup2HighlightCuts(project.reportScenes),
            primarySourceId ? { [primarySourceId]: transcript } : {},
            primarySourceId,
            settings.titleVoiceRate
          )
  const uploadedImageSourceIds = new Set(
    [project.source, ...project.supportingSources]
      .filter(
        (source) =>
          source?.mediaType === "image" && source.channel === "사용자 첨부"
      )
      .map((source) => source!.id)
  )
  if (uploadedImageSourceIds.size) {
    reportScenes = reportScenes.map((scene) => {
      const crop = scene.crop
      const hasNeutralLayout =
        !crop ||
        (Math.abs(crop.x - 50) < 0.01 &&
          Math.abs(crop.y - 50) < 0.01 &&
          Math.abs(crop.zoom - 1) < 0.01)
      return uploadedImageSourceIds.has(scene.sourceId || "") &&
        hasNeutralLayout &&
        scene.fit !== "contain"
        ? { ...scene, fit: "contain" as const }
        : scene
    })
  }
  if (
    !options.lockTimeline &&
    project.productionMode === "buildup2" &&
    transcript.length
  ) {
    reportScenes = reportScenes.map((scene) => {
      if (scene.id !== "buildup2-quote" || scene.visual !== "quote") {
        return scene
      }
      const requestedStart = canonicalBuildupRange?.start ?? scene.sourceStart
      const requestedEnd = canonicalBuildupRange?.end ?? scene.sourceEnd
      const completed = snapSourceRangeToCompleteUtterance(
        requestedStart,
        requestedEnd,
        transcript,
        // 주제 선택에서 이미 확정한 시작점이다. 검수용 자막 segment의
        // 표시 tail을 실제 발화로 오인해 이전 문장으로 되감지 않는다.
        {
          minimumStart: canonicalBuildupRange?.start ?? scene.sourceStart,
          maximumEnd: canonicalBuildupRange?.end,
        }
      )
      return {
        ...scene,
        sourceStart: completed.start,
        sourceEnd: completed.end,
      }
    })
  }
  if (project.productionMode === "buildup2" && hasManualCutHistory) {
    const quote = reportScenes.find(
      (scene) =>
        scene.id === "buildup2-quote" ||
        /^buildup2-quote-cut-\d+$/i.test(scene.id)
    )
    const bounds =
      canonicalBuildupRange ??
      (quote ? { start: quote.sourceStart, end: quote.sourceEnd } : null)
    if (bounds) {
      const cutPlan = applyBuildupBodyCuts(
        reportScenes,
        bounds,
        project.removedRanges,
        {
          primarySourceId,
          templates: project.reportScenes,
        }
      )
      if (cutPlan.reason) {
        return { project, reason: "report-scenes-required" }
      }
      reportScenes = cutPlan.scenes
      keepRanges = cutPlan.keepRanges
    }
  }

  // 원본 음성 본문의 영상·음성 경계는 실제로 채택할 수 있는 단어 범위와
  // 같아야 한다. 기존 잠긴 프로젝트도 이 단계에서 양끝의 무자막 영상을 복구한다.
  if (project.productionMode === "buildup2" && transcript.length) {
    reportScenes = reportScenes.map((scene) => {
      if (
        reportSceneAudioMode(scene) !== "original" ||
        scene.id !== "buildup2-quote"
      ) {
        return scene
      }
      const tightened = tightenLockedSourceRangeToSpeech(
        scene.sourceStart,
        scene.sourceEnd,
        transcript
      )
      return Math.abs(tightened.start - scene.sourceStart) < 0.01 &&
        Math.abs(tightened.end - scene.sourceEnd) < 0.01
        ? scene
        : {
            ...scene,
            sourceStart: tightened.start,
            sourceEnd: tightened.end,
          }
    })
  }
  const quoteEdgesChanged = reportScenes.some((scene) => {
    if (reportSceneAudioMode(scene) !== "original") return false
    const saved = project.reportScenes.find((item) => item.id === scene.id)
    return (
      saved !== undefined &&
      (Math.abs(saved.sourceStart - scene.sourceStart) >= 0.01 ||
        Math.abs(saved.sourceEnd - scene.sourceEnd) >= 0.01)
    )
  })

  const { cta } = splitEndCtaFromScript(project.reportScript)
  const existingCta = reportScenes.find((scene) => isEndCtaScene(scene))
  const ctaText = (existingCta?.narration || cta || "").trim()
  if (project.productionMode === "buildup2" && ctaText) {
    reportScenes = reportScenes.map((scene) =>
      scene.id === "buildup2-lead"
        ? {
            ...scene,
            narration: removeTrailingCtaFromLead(scene.narration, ctaText),
          }
        : scene
    )
  }
  if (ctaText) {
    // 기존 end-cta의 구간·크롭을 유지하도록 장면 목록을 그대로 넘긴다.
    reportScenes = appendEndCtaScenes(reportScenes, ctaText, primarySourceId)
  }

  reportScenes = lockSceneSources(reportScenes, primarySourceId)

  const reason = renderContractReason(project, reportScenes)
  if (reason) {
    return { project, reason }
  }

  const normalizedReportScript =
    project.productionMode === "buildup2"
      ? [
          reportScenes.find((scene) => scene.id === "buildup2-lead")?.narration,
          ctaText,
        ]
          .map((value) => value?.trim() ?? "")
          .filter(Boolean)
          .join("\n")
      : canonicalReportScript(project.reportScript, reportScenes)
  const { body: normalizedBody } = splitEndCtaFromScript(normalizedReportScript)
  const subtitleBody =
    project.productionMode === "buildup2"
      ? reportScenes
          .filter((scene) => !isEndCtaScene(scene))
          .map((scene) => scene.narration.trim())
          .filter(Boolean)
          .join("\n")
      : normalizedBody || normalizedReportScript
  const normalizedGeneratedSubtitles = normalizeSubtitleCues(
    reportSubtitles(
      reportScenes,
      undefined,
      reportCaptionPhrases(subtitleBody),
      transcript,
      {
        maxCaptionCharacters:
          automaticSubtitleCueCharacterLimit(settings.bodySubtitleText),
        preferredCaptionCharacters: subtitleLineCharacterLimit(
          settings.bodySubtitleText
        ),
      }
    ),
    settings.bodySubtitleText
  )
  const generatedSceneParts = splitScenesByClipPart(
    reportScenes,
    project.productionMode
  )
  const generatedSubtitleParts = partitionSubtitlesByPart(
    normalizedGeneratedSubtitles,
    generatedSceneParts.lead,
    generatedSceneParts.body
  )
  // 서두와 보도형 본문은 짧고 빠르게 읽히도록 한 줄을 우선한다.
  // 한 줄 폭을 넘는 문장은 같은 시간 범위 안에서 여러 자막 칸으로 나눈다.
  const generatedSubtitles = [
    ...layoutTimedSubtitleCues(
      generatedSubtitleParts.lead,
      settings.bodySubtitleText,
      { maxLines: 1 }
    ),
    ...(project.productionMode === "report"
      ? layoutTimedSubtitleCues(
          generatedSubtitleParts.body,
          settings.bodySubtitleText,
          { maxLines: 1 }
        )
      : generatedSubtitleParts.body),
    ...generatedSubtitleParts.outro,
  ].sort((left, right) => left.start - right.start || left.end - right.end)
  const subtitles =
    options.lockTimeline && project.subtitles.length > 0 && !quoteEdgesChanged
      ? project.subtitles.map((cue) => ({
          ...cue,
          emphasis: [...cue.emphasis],
          ...(cue.originalEmphasis
            ? { originalEmphasis: [...cue.originalEmphasis] }
            : {}),
        }))
      : quoteEdgesChanged
        ? mergeEditedSubtitleText(generatedSubtitles, project.subtitles)
        : options.rebuildSubtitles || project.subtitles.length === 0
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
      transcript,
      reportScript: normalizedReportScript,
      reportScenes,
      keepRanges,
      subtitles,
      subtitleTimingsLocked: quoteEdgesChanged
        ? false
        : project.subtitleTimingsLocked,
      outputDurationSeconds:
        settings.titleCardSeconds + outputBodyDuration + NEWS_TOTAL_GAP_SECONDS,
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

function lockSceneSources(scenes: NewsReportScene[], primarySourceId: string) {
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
  const reportScript =
    project.productionMode === "report"
      ? canonicalReportScript(project.reportScript, reportScenes)
      : project.reportScript.trim()
  if (!reportScript) return "report-script-required"
  if (!reportScenes.length) return "report-scenes-required"

  const broken = reportScenes.find((scene) => {
    if (project.productionMode === "report") {
      return !scene.narration.trim()
    }
    if (reportSceneAudioMode(scene) === "original") {
      return (
        !Number.isFinite(scene.sourceStart) ||
        !Number.isFinite(scene.sourceEnd) ||
        scene.sourceEnd <= scene.sourceStart
      )
    }
    return !scene.narration.trim()
  })
  if (broken) {
    return reportSceneAudioMode(broken) === "original"
      ? "report-scene-quote-range-invalid"
      : "report-scene-narration-required"
  }

  if (project.productionMode === "buildup2") {
    const hasTeaser = reportScenes.some((scene) => scene.id === "buildup2-lead")
    const hasHighlight = reportScenes.some(
      (scene) =>
        scene.id === "buildup2-quote" ||
        /^buildup2-quote-cut-\d+/i.test(scene.id)
    )
    if (!hasTeaser || !hasHighlight) return "report-scenes-required"
    if (!project.transcript.length) return "report-script-required"
  }

  return ""
}
