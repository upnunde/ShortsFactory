"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { Button, Card, Modal } from "@heroui/react"
import { Pause, Play, RotateCcw, Square } from "lucide-react"
import { NewsFramePreview } from "@/components/news-clips/frame-preview"
import { SegmentedTabs } from "@/components/news-clips/segmented-tabs"
import {
  LoadingButtonLabel,
  busyMatches,
  buttonBusyDisabled,
} from "@/components/news-clips/loading-button-label"
import { introStillTime, selectIntroStillRange } from "@/lib/news-clips/intro"
import { NEWS_SOURCE_PLAYBACK_RATE } from "@/lib/news-clips/playback"
import { newsRenderSettingsKey } from "@/lib/news-clips/render-key"
import {
  FINAL_PLAYBACK_RATES,
  normalizeFinalPlaybackRate,
} from "@/lib/news-clips/final-playback"
import {
  buildBuildup2Scenes,
  buildup2HighlightBounds,
} from "@/lib/news-clips/buildup"
import {
  prepareRenderProject,
  rebuildSubtitlesAfterSceneEdit,
} from "@/lib/news-clips/prepare-render-project"
import {
  partitionSubtitlesByPart,
  removeTrailingCtaFromLead,
  splitScenesByClipPart,
} from "@/lib/news-clips/clip-parts"
import {
  NEWS_TOTAL_GAP_SECONDS,
  appendEndCtaScenes,
  buildReportScenes,
  ensureReportEndCta,
  estimateReportScenesDuration,
  isEndCtaScene,
  shortBreathReviewTranscript,
  splitEndCtaFromScript,
} from "@/lib/news-clips/report"
import { bodySourceCreditText } from "@/lib/news-clips/source-credit"
import {
  automaticSubtitleLineCharacterLimit,
  canMergeSubtitleCueWithNext,
  fitTitleToLineLayouts,
  mergeSubtitleCueWithNext,
  resetEditedSubtitleCue,
  splitIntroTitleLines,
  subtitleLineCharacterLimit,
  titleLineCharacterLimit,
  titleLineFits,
  updateEditedSubtitleCue,
} from "@/lib/news-clips/text-layout"
import {
  clearLegacyAutomaticCaptionBoundaries,
  mergeTranscriptSegmentWithNext,
  updateTranscriptSegmentText,
} from "@/lib/news-clips/transcript"
import {
  inKoreaUploadWindow,
  nextKoreaUploadSlot,
  scheduleForUpload,
} from "@/lib/youtube-metadata"
import type {
  CropPosition,
  NewsClipProject,
  NewsClipSettings,
  NewsClipStep,
  NewsPreviewPart,
  NewsReportScene,
  TranscriptSegment,
} from "@/lib/news-clips/types"
import { NEWS_TTS_VOICES, newsTtsVoiceById } from "@/lib/news-clips/voices"

const field =
  "w-full rounded-xl border border-separator bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"
const cardTitleClass = "text-base font-semibold leading-6"
const cardDescriptionClass = "mt-1 text-sm leading-5 text-muted"
const sectionHeaderClass = "flex min-h-10 items-center justify-between gap-4"
const sectionTitleClass = "text-base font-semibold leading-6"

function splitSubtitleLines(value: string): [string, string] {
  const lines = value.replace(/\r\n/g, "\n").split("\n")
  return [lines[0] ?? "", lines.slice(1).join(" ").trim()]
}

function commitSubtitleLines(first: string, second: string) {
  const normalizedFirst = first.replace(/\s+/g, " ").trim()
  const normalizedSecond = second.replace(/\s+/g, " ").trim()
  return [normalizedFirst, normalizedSecond].filter(Boolean).join("\n")
}

type ReviewMode = Exclude<NewsClipStep, "issue" | "source" | "angles">
type EditorTab = "script" | "captions" | "scenes" | "media"
type CompositionPane = NewsPreviewPart

type SceneLayoutDraft = {
  crop: CropPosition
  sourceStart: number
  sourceEnd: number
}

type IntroLayoutDraft = {
  introStillTimeSeconds: number | null
  introStillZoom: number
  introStillX: number
  introStillY: number
}

function narrationFromScenes(scenes: NewsReportScene[]) {
  return scenes
    .map((scene) => scene.narration.trim())
    .filter(Boolean)
    .join("\n")
}

function partScriptTexts(project: NewsClipProject) {
  const parts = splitScenesByClipPart(
    project.reportScenes,
    project.productionMode
  )
  const scriptParts = splitEndCtaFromScript(project.reportScript)
  const sceneLead = narrationFromScenes(parts.lead)
  const sceneBody = narrationFromScenes(parts.body)
  const sceneOutro = parts.outro
    .map(
      (scene) =>
        splitEndCtaFromScript(scene.narration).cta || scene.narration.trim()
    )
    .filter(Boolean)
    .join("\n")
  if (project.productionMode === "buildup2") {
    return {
      lead:
        removeTrailingCtaFromLead(sceneLead, sceneOutro) ||
        removeTrailingCtaFromLead(scriptParts.body, sceneOutro),
      body: "",
      outro: sceneOutro || scriptParts.cta,
    }
  }
  return {
    lead: sceneLead,
    body: sceneBody,
    outro: scriptParts.cta || sceneOutro,
  }
}

function composePartScripts(
  productionMode: NewsClipProject["productionMode"],
  lead: string,
  body: string,
  outro: string
) {
  const main =
    productionMode === "buildup2"
      ? lead.trim()
      : [lead.trim(), body.trim()].filter(Boolean).join("\n")
  const cta = outro.trim()
  if (!cta) return main
  if (!main) return cta
  return `${main}\n${cta}`
}

function syncNarrationFromSubtitleEdit(
  project: NewsClipProject,
  subtitles: NewsClipProject["subtitles"],
  cueId: string
) {
  const editedCue = subtitles.find((cue) => cue.id === cueId)
  if (!editedCue?.sceneId) {
    return { subtitles, subtitleTimingsLocked: true }
  }
  const parts = splitScenesByClipPart(
    project.reportScenes,
    project.productionMode
  )
  const isLead = parts.lead.some((scene) => scene.id === editedCue.sceneId)
  const isOutro = parts.outro.some((scene) => scene.id === editedCue.sceneId)
  if (!isLead && !isOutro) {
    return { subtitles, subtitleTimingsLocked: true }
  }
  const targetScenes = isLead ? parts.lead : parts.outro
  const targetIds = new Set(targetScenes.map((scene) => scene.id))
  const textByScene = new Map<string, string>()
  for (const scene of targetScenes) {
    const text = subtitles
      .filter((cue) => cue.sceneId === scene.id)
      .sort((left, right) => left.start - right.start)
      .map((cue) => cue.text.replace(/\s*\n\s*/g, " ").trim())
      .filter(Boolean)
      .join(" ")
    if (text) textByScene.set(scene.id, text)
  }
  const reportScenes = project.reportScenes.map((scene) =>
    targetIds.has(scene.id) && textByScene.has(scene.id)
      ? { ...scene, narration: textByScene.get(scene.id)! }
      : scene
  )
  const currentParts = partScriptTexts(project)
  const partText = targetScenes
    .map((scene) => textByScene.get(scene.id) ?? scene.narration.trim())
    .filter(Boolean)
    .join(" ")
  const reportScript = composePartScripts(
    project.productionMode,
    isLead ? partText : currentParts.lead,
    currentParts.body,
    isOutro ? partText : currentParts.outro
  )
  return {
    subtitles,
    subtitleTimingsLocked: true,
    reportScenes,
    reportScript,
  }
}

const EDITOR_TABS: Record<
  ReviewMode,
  Array<{ id: EditorTab; label: string }>
> = {
  script: [{ id: "script", label: "제목·대본" }],
  direction: [
    { id: "scenes", label: "화면 구성" },
    { id: "media", label: "음향 설정" },
  ],
  // 4번은 좌측 인트로/본문/마무리 탭이 기준. 우측은 구간별 편집.
  preview: [],
  final: [],
}

export function NewsClipReviewStep({
  mode,
  project,
  settings,
  note,
  busy,
  previewProgress,
  onBack,
  onProject,
  onSettings,
  onBusy,
  onNote,
  onPreview,
  onCancelPreview,
  onReselect,
  onFinalized,
  onNext,
}: {
  mode: ReviewMode
  project: NewsClipProject
  settings: NewsClipSettings
  note: string
  busy: string
  previewProgress: number | null
  onBack: () => void
  onProject: (
    patch:
      | Partial<NewsClipProject>
      | ((current: NewsClipProject) => Partial<NewsClipProject>)
  ) => void
  onSettings: (patch: Partial<NewsClipSettings>) => void
  onBusy: (value: string) => void
  onNote: (value: string) => void
  onPreview: (
    force?: boolean,
    draft?: NewsClipProject,
    part?: NewsPreviewPart
  ) => boolean | Promise<boolean>
  onCancelPreview: () => void
  onReselect: (
    target?: "all" | "title" | "script" | "outro"
  ) => void | Promise<void>
  onFinalized: (project: NewsClipProject) => boolean | Promise<boolean>
  onNext: () => void
}) {
  const [frameMode, setFrameMode] = useState<"title" | "body">("title")
  const [compositionPane, setCompositionPaneState] =
    useState<CompositionPane>("all")

  function setCompositionPane(pane: CompositionPane) {
    setCompositionPaneState(pane)
    setFrameMode(pane === "intro" ? "title" : "body")
  }

  const [editorTabByMode, setEditorTabByMode] = useState<
    Record<ReviewMode, EditorTab>
  >({
    script: "script",
    direction: "scenes",
    preview: "script",
    final: "media",
  })
  const editorTabs = EDITOR_TABS[mode]
  const savedEditorTab = editorTabByMode[mode]
  const editorTab = editorTabs.some((tab) => tab.id === savedEditorTab)
    ? savedEditorTab
    : (editorTabs[0]?.id ?? "media")
  const initialTitleLines = fittedTitleLines(
    project.title,
    settings.titleCardText,
    settings.titleCardSecondFontSize
  )
  const [titleLine1Draft, setTitleLine1Draft] = useState(initialTitleLines[0])
  const [titleLine2Draft, setTitleLine2Draft] = useState(initialTitleLines[1])
  const [reportScriptDraft, setReportScriptDraft] = useState(
    project.reportScript
  )
  const initialPartScripts = partScriptTexts(project)
  const [leadScriptDraft, setLeadScriptDraft] = useState(
    initialPartScripts.lead
  )
  const [bodyScriptDraft, setBodyScriptDraft] = useState(
    initialPartScripts.body
  )
  const [outroScriptDraft, setOutroScriptDraft] = useState(
    initialPartScripts.outro
  )
  const [supplementOpen, setSupplementOpen] = useState(false)
  const [supplementDraft, setSupplementDraft] = useState(
    project.supplementalContext
  )
  const editingTitleRef = useRef(false)
  const editingReportScriptRef = useRef(false)
  const scriptReviewDirtyRef = useRef(false)
  const reportScriptTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [selectedSubtitleId, setSelectedSubtitleId] = useState("")
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voicePlaying, setVoicePlaying] = useState(false)
  const [audioPanelOpen, setAudioPanelOpen] = useState(false)
  const [youtubeBusy, setYoutubeBusy] = useState(false)
  const [finalPlaybackChoice, setFinalPlaybackChoice] = useState(() => ({
    projectId: project.id,
    rate: normalizeFinalPlaybackRate(project.finalPlaybackRate),
  }))
  const finalPlaybackRate =
    finalPlaybackChoice.projectId === project.id
      ? finalPlaybackChoice.rate
      : normalizeFinalPlaybackRate(project.finalPlaybackRate)
  const [scheduledAt, setScheduledAt] = useState(() => nextKoreaUploadSlot())
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null)
  const scriptFrameVideoRef = useRef<HTMLVideoElement | null>(null)
  const directionVideoRef = useRef<HTMLVideoElement | null>(null)
  const renderedVideoRef = useRef<HTMLVideoElement | null>(null)
  const [selectedDirectionSceneId, setSelectedDirectionSceneId] = useState("")
  const [directionPlaying, setDirectionPlaying] = useState(false)
  const [directionCurrentTime, setDirectionCurrentTime] = useState(0)
  const [sceneLayoutDrafts, setSceneLayoutDrafts] = useState<
    Record<string, SceneLayoutDraft>
  >({})
  const [introLayoutDraft, setIntroLayoutDraft] =
    useState<IntroLayoutDraft | null>(null)
  const selectedDirectionScene = project.reportScenes.find(
    (scene) => scene.id === selectedDirectionSceneId
  )
  // 미리보기 seek용 폴백. 보정 패널 노출은 selectedDirectionScene만 사용.
  const previewDirectionScene =
    selectedDirectionScene ?? project.reportScenes[0]
  const previewSceneLayout = previewDirectionScene
    ? sceneLayoutFor(previewDirectionScene, project, sceneLayoutDrafts)
    : null
  const bodyPreviewCrop =
    previewSceneLayout?.crop ?? selectedDirectionScene?.crop ?? project.crop
  const automaticIntroRange = selectIntroStillRange({
    ...project,
    introStillTimeSeconds: null,
  })
  const automaticIntroTime = introStillTime(automaticIntroRange)
  const introLayout = introLayoutDraft ?? snapshotIntroLayout(project)
  const introCursor = introLayout.introStillTimeSeconds ?? automaticIntroTime
  const introLayoutDirty =
    introLayoutDraft !== null &&
    !sameIntroLayout(introLayoutDraft, snapshotIntroLayout(project))
  const [sourceDuration, setSourceDuration] = useState(() =>
    initialSourceDuration(project)
  )
  const [directionSourceMetadata, setDirectionSourceMetadata] = useState({
    url: "",
    duration: 0,
  })
  const sourceVideoUrl = project.source?.id
    ? `/api/news-clips/source-file?sourceId=${encodeURIComponent(project.source.id)}`
    : ""
  const sourceVideoUrlFor = (sourceId?: string) => {
    const resolvedId =
      sourceId && sourceId === project.source?.id
        ? sourceId
        : project.source?.id
    return resolvedId
      ? `/api/news-clips/source-file?sourceId=${encodeURIComponent(resolvedId)}`
      : sourceVideoUrl
  }
  const directionSourceVideoUrl = sourceVideoUrl
  const scriptBodyVideoUrl = sourceVideoUrl
  const introVideoUrl = sourceVideoUrl
  const titleDraft = composeIntroTitle(titleLine1Draft, titleLine2Draft)
  const baselineTitle = composeIntroTitle(
    ...fittedTitleLines(
      project.title,
      settings.titleCardText,
      settings.titleCardSecondFontSize
    )
  )
  const titleDirty = titleDraft !== baselineTitle
  const titleComplete =
    titleLine1Draft.trim().length > 0 && titleLine2Draft.trim().length > 0
  const firstTitleCharacterLimit = titleLineCharacterLimit(
    settings.titleCardText
  )
  const secondTitleCharacterLimit = titleLineCharacterLimit({
    ...settings.titleCardText,
    fontSize: settings.titleCardSecondFontSize,
  })
  const firstTitleFits = titleLineFits(titleLine1Draft, settings.titleCardText)
  const secondTitleFits = titleLineFits(titleLine2Draft, {
    ...settings.titleCardText,
    fontSize: settings.titleCardSecondFontSize,
  })
  const titleValid = titleComplete && firstTitleFits && secondTitleFits
  const projectPartScripts = partScriptTexts(project)
  const isBuildup2Preview = project.productionMode === "buildup2"
  const composedPartScript = composePartScripts(
    project.productionMode,
    leadScriptDraft,
    bodyScriptDraft,
    outroScriptDraft
  )
  const reportScriptDirty =
    mode === "script"
      ? composedPartScript !== project.reportScript
      : mode === "preview"
        ? compositionPane === "lead"
          ? leadScriptDraft !== projectPartScripts.lead
          : compositionPane === "outro"
            ? outroScriptDraft !== projectPartScripts.outro
            : compositionPane === "body"
              ? isBuildup2Preview
                ? false
                : bodyScriptDraft !== projectPartScripts.body
              : composedPartScript !== project.reportScript
        : reportScriptDraft !== project.reportScript
  const paneScriptValue =
    mode === "preview" && compositionPane === "lead"
      ? leadScriptDraft
      : mode === "preview" && compositionPane === "outro"
        ? outroScriptDraft
        : mode === "preview" && compositionPane === "body"
          ? bodyScriptDraft
          : reportScriptDraft
  const showPaneScriptEditor =
    mode !== "script" &&
    (mode !== "preview" ||
      compositionPane === "lead" ||
      compositionPane === "outro" ||
      (compositionPane === "body" && !isBuildup2Preview))
  const selectedCandidate = project.candidates.find(
    (candidate) => candidate.id === project.selectedCandidateId
  )
  const bodyReviewBounds = selectedCandidate
    ? buildup2HighlightBounds(
        project.reportScenes,
        selectedCandidate.sourceStart,
        selectedCandidate.sourceEnd
      )
    : null
  const bodyReviewStart = bodyReviewBounds?.start
  const bodyReviewEnd = bodyReviewBounds?.end
  const bodyReviewSegments = bodyReviewBounds
    ? project.transcript.filter(
        (segment) =>
          segment.end > bodyReviewBounds.start + 0.01 &&
          segment.start < bodyReviewBounds.end - 0.01
      )
    : []
  const previewBlockedReason = previewButtonBlockedReason({
    busy,
    titleValid,
    titleComplete,
    titleDirty,
    reportScriptDirty,
  })
  const previewIsCurrent =
    Boolean(project.previewUrl) &&
    project.previewRevision === project.editorialRevision
  const finalOutputIsCurrent =
    Boolean(project.outputUrl) &&
    project.finalRevision === project.editorialRevision &&
    normalizeFinalPlaybackRate(project.finalPlaybackRate) === finalPlaybackRate
  const previewSubtitles = project.subtitles
  const selectedSubtitle =
    previewSubtitles.find((caption) => caption.id === selectedSubtitleId) ??
    previewSubtitles[0]
  useEffect(
    () => () => {
      voiceAudioRef.current?.pause()
    },
    []
  )

  useEffect(() => {
    if (editingTitleRef.current) return
    const [firstLine, secondLine] = fittedTitleLines(
      project.title,
      settings.titleCardText,
      settings.titleCardSecondFontSize
    )
    setTitleLine1Draft(firstLine)
    setTitleLine2Draft(secondLine)
  }, [project.title, settings.titleCardSecondFontSize, settings.titleCardText])

  useEffect(() => {
    if (editingReportScriptRef.current) return
    if (scriptReviewDirtyRef.current) return
    const parts = partScriptTexts(project)
    setReportScriptDraft(project.reportScript)
    setLeadScriptDraft(parts.lead)
    setBodyScriptDraft(parts.body)
    setOutroScriptDraft(parts.outro)
  }, [project])

  useEffect(() => {
    if (
      mode !== "script" ||
      project.productionMode !== "buildup2" ||
      bodyReviewStart === undefined ||
      bodyReviewEnd === undefined
    ) {
      return
    }
    const reviewed = shortBreathReviewTranscript(
      project.transcript,
      { start: bodyReviewStart, end: bodyReviewEnd },
      automaticSubtitleLineCharacterLimit(settings.bodySubtitleText)
    )
    if (reviewed === project.transcript) return
    onProject({
      transcript: reviewed,
      subtitles: [],
      subtitleTimingsLocked: false,
      renderSignature: "",
    })
  }, [
    bodyReviewEnd,
    bodyReviewStart,
    mode,
    onProject,
    project.productionMode,
    project.transcript,
    settings.bodySubtitleText,
  ])

  useLayoutEffect(() => {
    resizeTextareaToContent(reportScriptTextareaRef.current)
  }, [
    editorTab,
    compositionPane,
    reportScriptDraft,
    leadScriptDraft,
    bodyScriptDraft,
    outroScriptDraft,
  ])

  useEffect(() => {
    const video = sourceVideoRef.current
    if (video?.readyState) video.currentTime = introCursor
  }, [introCursor, introVideoUrl])

  useEffect(() => {
    const video = scriptFrameVideoRef.current
    if ((mode !== "script" && mode !== "preview") || !video?.readyState) return
    if (frameMode === "body") {
      video.playbackRate = NEWS_SOURCE_PLAYBACK_RATE
    }
    video.currentTime =
      frameMode === "title"
        ? introCursor
        : Math.max(
            0,
            previewSceneLayout?.sourceStart ??
              previewDirectionScene?.sourceStart ??
              0
          )
  }, [
    frameMode,
    introCursor,
    introVideoUrl,
    mode,
    previewDirectionScene?.id,
    previewSceneLayout?.sourceStart,
    previewDirectionScene?.sourceStart,
    scriptBodyVideoUrl,
  ])

  useEffect(() => {
    const video = directionVideoRef.current
    if (mode === "direction" && video?.readyState) {
      video.playbackRate = NEWS_SOURCE_PLAYBACK_RATE
      video.currentTime = Math.max(
        0,
        previewSceneLayout?.sourceStart ??
          previewDirectionScene?.sourceStart ??
          0
      )
    }
  }, [
    mode,
    previewDirectionScene?.id,
    previewSceneLayout?.sourceStart,
    previewDirectionScene?.sourceStart,
    previewDirectionScene?.visual,
    directionSourceVideoUrl,
  ])

  useEffect(() => {
    const video = renderedVideoRef.current
    if (mode !== "preview" || !video?.readyState) return
    // 파트 클립은 각각 0초부터 시작한다.
    video.currentTime = 0
  }, [
    compositionPane,
    mode,
    project.previewIntroUrl,
    project.previewLeadUrl,
    project.previewBodyUrl,
    project.previewOutroUrl,
  ])

  function selectDirectionScene(sceneId: string, sourceStart: number) {
    setSelectedDirectionSceneId(sceneId)
    if (directionVideoRef.current?.readyState) {
      directionVideoRef.current.currentTime = Math.max(0, sourceStart)
      setDirectionCurrentTime(Math.max(0, sourceStart))
    }
    if (scriptFrameVideoRef.current?.readyState && frameMode === "body") {
      scriptFrameVideoRef.current.currentTime = Math.max(0, sourceStart)
    }
  }

  function patchSceneLayoutDraft(
    scene: NewsReportScene,
    patch: Partial<SceneLayoutDraft>
  ) {
    setSceneLayoutDrafts((current) => {
      const baseline = sceneLayoutFor(scene, project, current)
      return {
        ...current,
        [scene.id]: {
          crop: patch.crop ?? baseline.crop,
          sourceStart: patch.sourceStart ?? baseline.sourceStart,
          sourceEnd: patch.sourceEnd ?? baseline.sourceEnd,
        },
      }
    })
  }

  function saveSceneLayout(scene: NewsReportScene) {
    const draft = sceneLayoutFor(scene, project, sceneLayoutDrafts)
    selectDirectionScene(scene.id, draft.sourceStart)
    updateReportScene(scene.id, {
      crop: draft.crop,
      sourceStart: draft.sourceStart,
      sourceEnd: draft.sourceEnd,
    })
    setSceneLayoutDrafts((current) => {
      const next = { ...current }
      delete next[scene.id]
      return next
    })
  }

  function resetSceneLayout(sceneId: string) {
    setSceneLayoutDrafts((current) => {
      const next = { ...current }
      delete next[sceneId]
      return next
    })
  }

  function patchIntroLayout(patch: Partial<IntroLayoutDraft>) {
    setIntroLayoutDraft((current) => ({
      ...(current ?? snapshotIntroLayout(project)),
      ...patch,
    }))
  }

  function selectIntroStill(value: number) {
    const max = Math.max(0, sourceDuration - 0.05)
    const introStillTimeSeconds = Math.max(0, Math.min(max, value))
    if (sourceVideoRef.current) {
      sourceVideoRef.current.currentTime = introStillTimeSeconds
    }
    setFrameMode("title")
    patchIntroLayout({ introStillTimeSeconds })
  }

  function restoreAutomaticIntroStill() {
    if (sourceVideoRef.current) {
      sourceVideoRef.current.currentTime = automaticIntroTime
    }
    setFrameMode("title")
    patchIntroLayout({ introStillTimeSeconds: null })
  }

  function saveIntroLayout() {
    const draft = introLayoutDraft ?? snapshotIntroLayout(project)
    onProject({
      introStillTimeSeconds: draft.introStillTimeSeconds,
      introStillZoom: draft.introStillZoom,
      introStillX: draft.introStillX,
      introStillY: draft.introStillY,
      renderSignature: "",
    })
    setIntroLayoutDraft(null)
  }

  function resetIntroLayout() {
    setIntroLayoutDraft(null)
    if (sourceVideoRef.current) {
      sourceVideoRef.current.currentTime =
        project.introStillTimeSeconds ?? automaticIntroTime
    }
  }

  /** 미리보기/다음 전에 저장 안 한 구간·인트로 드래프트를 프로젝트에 반영한다. */
  function commitPendingLayoutDrafts(base: NewsClipProject): NewsClipProject {
    const hasSceneDrafts = Object.keys(sceneLayoutDrafts).length > 0
    const hasIntroDraft =
      introLayoutDraft !== null &&
      !sameIntroLayout(introLayoutDraft, snapshotIntroLayout(base))
    if (!hasSceneDrafts && !hasIntroDraft) return base

    const intro = introLayoutDraft ?? snapshotIntroLayout(base)
    const reportScenes = base.reportScenes.map((scene) => {
      const draft = sceneLayoutDrafts[scene.id]
      if (!draft) return scene
      return {
        ...scene,
        crop: draft.crop,
        sourceStart: draft.sourceStart,
        sourceEnd: draft.sourceEnd,
      }
    })
    const next: NewsClipProject = {
      ...base,
      reportScenes,
      introStillTimeSeconds: intro.introStillTimeSeconds,
      introStillZoom: intro.introStillZoom,
      introStillX: intro.introStillX,
      introStillY: intro.introStillY,
      renderSignature: "",
    }
    onProject({
      reportScenes: next.reportScenes,
      introStillTimeSeconds: next.introStillTimeSeconds,
      introStillZoom: next.introStillZoom,
      introStillX: next.introStillX,
      introStillY: next.introStillY,
      renderSignature: "",
    })
    setSceneLayoutDrafts({})
    setIntroLayoutDraft(null)
    return next
  }

  function finishReportScript(reportScript: string) {
    const isBuildup2 = project.productionMode === "buildup2"
    const completeReportScript = ensureReportEndCta(
      reportScript,
      project.title,
      project.selectedIssue?.keywords
    )
    const { body: bodyScript, cta: endCtaText } =
      splitEndCtaFromScript(completeReportScript)
    const candidate = project.candidates.find(
      (item) => item.id === project.selectedCandidateId
    )
    if (!candidate) {
      onProject({ reportScript: completeReportScript })
      return
    }
    const highlightBounds = buildup2HighlightBounds(
      project.reportScenes,
      candidate.sourceStart,
      candidate.sourceEnd
    )
    const bodyScenes = isBuildup2
      ? buildBuildup2Scenes(
          bodyScript || completeReportScript,
          highlightBounds.start,
          highlightBounds.end,
          project.transcript,
          project.source?.id ?? "",
          project.reportScenes
        )
      : buildReportScenes(
          bodyScript || completeReportScript,
          project.transcript,
          candidate.sourceStart,
          candidate.sourceEnd,
          project.reportScenes,
          project.source?.id ?? ""
        )
    const prepared = prepareRenderProject(
      {
        ...project,
        reportScript: completeReportScript,
        reportScenes: appendEndCtaScenes(
          [
            ...bodyScenes,
            ...project.reportScenes.filter((scene) => isEndCtaScene(scene)),
          ],
          endCtaText,
          project.source?.id ?? ""
        ),
        subtitles: [],
      },
      settings,
      { rebuildSubtitles: true }
    )
    if (prepared.reason) {
      onNote(
        prepared.reason === "report-scene-narration-required"
          ? "나레이션이 비어 있는 장면이 있습니다."
          : "화면 구성 장면을 확인해주세요."
      )
      return
    }
    onProject({
      reportScript: completeReportScript,
      reportScenes: prepared.project.reportScenes,
      subtitles: prepared.project.subtitles,
      subtitleTimingsLocked: false,
      outputDurationSeconds: prepared.project.outputDurationSeconds,
      titleCardDurationSeconds: 0,
      renderSignature: "",
    })
  }

  function savePartScript(target: "lead" | "outro") {
    const savedParts = partScriptTexts(project)
    const leadText =
      target === "lead" ? leadScriptDraft.trim() : savedParts.lead
    const outroText =
      target === "outro" ? outroScriptDraft.trim() : savedParts.outro
    scriptReviewDirtyRef.current =
      target === "lead"
        ? outroScriptDraft !== savedParts.outro
        : leadScriptDraft !== savedParts.lead

    if (project.productionMode !== "buildup2") {
      finishReportScript(
        composePartScripts(
          project.productionMode,
          leadText,
          savedParts.body,
          outroText
        )
      )
      onNote(
        target === "lead" ? "서두를 저장했습니다." : "마무리를 저장했습니다."
      )
      return
    }

    const completeReportScript = composePartScripts(
      project.productionMode,
      leadText,
      "",
      outroText
    )
    const reportScenes =
      target === "lead"
        ? project.reportScenes.map((scene) =>
            scene.id === "buildup2-lead"
              ? { ...scene, narration: leadText }
              : scene
          )
        : appendEndCtaScenes(
            project.reportScenes,
            outroText,
            project.source?.id ?? ""
          )
    const prepared = prepareRenderProject(
      {
        ...project,
        reportScript: completeReportScript,
        reportScenes,
        subtitles: [],
      },
      settings,
      { rebuildSubtitles: true }
    )
    if (prepared.reason) {
      onNote("수정한 구간을 저장하지 못했습니다.")
      return
    }
    const currentSceneParts = splitScenesByClipPart(
      project.reportScenes,
      project.productionMode
    )
    const currentSubtitleParts = partitionSubtitlesByPart(
      project.subtitles,
      currentSceneParts.lead,
      currentSceneParts.body
    )
    const freshSceneParts = splitScenesByClipPart(
      prepared.project.reportScenes,
      prepared.project.productionMode
    )
    const freshSubtitleParts = partitionSubtitlesByPart(
      prepared.project.subtitles,
      freshSceneParts.lead,
      freshSceneParts.body
    )
    const subtitles =
      target === "lead"
        ? [
            ...freshSubtitleParts.lead,
            ...currentSubtitleParts.body,
            ...currentSubtitleParts.outro,
          ]
        : [
            ...currentSubtitleParts.lead,
            ...currentSubtitleParts.body,
            ...freshSubtitleParts.outro,
          ]
    onProject({
      reportScript: completeReportScript,
      reportScenes: prepared.project.reportScenes,
      subtitles,
      subtitleTimingsLocked: false,
      outputDurationSeconds: prepared.project.outputDurationSeconds,
      titleCardDurationSeconds: 0,
      renderSignature: "",
    })
    onNote(
      target === "lead"
        ? "서두를 저장했습니다. 다시 만들면 TTS와 자막 싱크가 갱신됩니다."
        : "마무리를 저장했습니다. 다시 만들면 TTS와 자막 싱크가 갱신됩니다."
    )
  }

  function finishPreviewPartScript() {
    if (
      mode === "preview" &&
      project.productionMode === "buildup2" &&
      (compositionPane === "lead" || compositionPane === "outro")
    ) {
      savePartScript(compositionPane)
      return
    }
    finishReportScript(
      mode === "preview" ? composedPartScript : reportScriptDraft
    )
  }

  function finishTitleEdit(title: string) {
    const bodyDuration = estimateReportScenesDuration(
      project.reportScenes,
      settings.titleVoiceRate
    )
    onProject({
      title,
      outputDurationSeconds:
        settings.titleCardSeconds + bodyDuration + NEWS_TOTAL_GAP_SECONDS,
      titleCardDurationSeconds: 0,
      metadata: {
        ...project.metadata,
        youtubeTitle: title.replace(/\s*\n\s*/g, " "),
      },
    })
  }

  function updateReportScene(
    sceneId: string,
    patch: Partial<NewsClipProject["reportScenes"][number]>
  ) {
    const reportScenes = project.reportScenes.map((scene) =>
      scene.id === sceneId ? { ...scene, ...patch } : scene
    )
    const prepared = rebuildSubtitlesAfterSceneEdit(
      project,
      reportScenes,
      settings
    )
    if (prepared.reason) {
      onProject({ reportScenes })
      return
    }
    onProject({
      reportScenes: prepared.project.reportScenes,
      subtitles: prepared.project.subtitles,
      subtitleTimingsLocked: false,
      outputDurationSeconds: prepared.project.outputDurationSeconds,
      renderSignature: "",
    })
  }

  async function previewVoice() {
    stopVoicePreview()
    setVoiceBusy(true)
    onNote("")
    try {
      const response = await fetch("/api/news-clips/voice-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          voiceId: settings.titleVoice,
          provider: settings.ttsProvider,
          typecastVoiceId: settings.typecastVoiceId,
          ratePercent: settings.titleVoiceRate,
          text:
            project.reportScenes.find((scene) => scene.visual !== "quote")
              ?.narration || "오늘 주요 소식입니다. 자세한 내용 전해드립니다.",
        }),
      })
      const body = (await response.json()) as {
        url?: string
        provider?: "free" | "typecast"
        message?: string
      }
      if (!response.ok || !body.url) {
        onNote(body.message || "TTS 미리듣기를 만들지 못했습니다.")
        return
      }
      const audio = new Audio(body.url)
      voiceAudioRef.current = audio
      audio.addEventListener(
        "ended",
        () => {
          if (voiceAudioRef.current === audio) voiceAudioRef.current = null
          setVoicePlaying(false)
        },
        { once: true }
      )
      const playback = audio.play()
      setVoicePlaying(true)
      await playback
      onNote(
        body.provider === "typecast"
          ? "Typecast 공통 음성을 재생했습니다."
          : "무료 한국어 공통 음성을 재생했습니다."
      )
    } catch {
      stopVoicePreview()
      onNote("TTS 미리듣기를 재생하지 못했습니다.")
    } finally {
      setVoiceBusy(false)
    }
  }

  function stopVoicePreview() {
    const audio = voiceAudioRef.current
    if (audio) {
      audio.pause()
      audio.currentTime = 0
      voiceAudioRef.current = null
    }
    setVoicePlaying(false)
  }

  function selectProvider(value: string) {
    stopVoicePreview()
    onSettings({
      ttsProvider: value === "free" || value === "typecast" ? value : "auto",
    })
  }

  function selectFreeVoice(value: string) {
    stopVoicePreview()
    onSettings({ titleVoice: newsTtsVoiceById(value).id })
  }

  function selectTypecastVoice(typecastVoiceId: string) {
    stopVoicePreview()
    onSettings({ typecastVoiceId })
  }

  async function render() {
    if (project.previewRevision !== project.editorialRevision) {
      onNote("현재 수정본으로 미리보기를 먼저 만들어 확인해 주세요.")
      return false
    }
    onBusy("render")
    onNote("")
    try {
      const response = await fetch("/api/news-clips/render", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        // 수정된 영상 파트는 강제 재생성하되, 승인된 미리보기와
        // TTS·전사 캐시는 보존해 재호출 비용을 막는다.
        body: JSON.stringify({
          project,
          settings,
          force: true,
          finalPlaybackRate,
        }),
      })
      const body = (await response.json()) as {
        message?: string
        outputUrl?: string
        thumbnailUrl?: string
        signature?: string
        titleCardDurationSeconds?: number
        outputDurationSeconds?: number
        finalPlaybackRate?: number
        subtitles?: NewsClipProject["subtitles"]
        reportScenes?: NewsClipProject["reportScenes"]
      }
      if (!response.ok) {
        onNote(body.message || "최종 렌더링을 시작하지 못했습니다.")
        return false
      }
      const patch: Partial<NewsClipProject> = {
        outputUrl: body.outputUrl ?? "",
        thumbnailUrl: body.thumbnailUrl ?? "",
        renderSignature: body.signature ?? "",
        renderSettingsKey: newsRenderSettingsKey(settings),
        titleCardDurationSeconds:
          body.titleCardDurationSeconds ?? project.titleCardDurationSeconds,
        outputDurationSeconds:
          body.outputDurationSeconds ?? project.outputDurationSeconds,
        finalPlaybackRate: normalizeFinalPlaybackRate(
          body.finalPlaybackRate ?? finalPlaybackRate
        ),
        subtitles: body.subtitles ?? project.subtitles,
        subtitleTimingsLocked: true,
        reportScenes: body.reportScenes ?? project.reportScenes,
        finalRevision: project.editorialRevision,
        youtubeVideoId: "",
        youtubeUploadUrl: "",
      }
      let finalizedProject = { ...project, ...patch }
      if (settings.youtubeAutoUpload) {
        const uploaded = await uploadYoutube(
          finalizedProject,
          scheduleForUpload(scheduledAt)
        )
        if (uploaded) {
          const uploadPatch = {
            youtubeVideoId: uploaded.videoId,
            youtubeUploadUrl: uploaded.url,
          }
          finalizedProject = { ...finalizedProject, ...uploadPatch }
          Object.assign(patch, uploadPatch)
        }
      }
      onProject(patch)
      const saved = await Promise.resolve(onFinalized(finalizedProject)).catch(
        () => false
      )
      onNote(
        saved
          ? finalizedProject.youtubeUploadUrl
            ? "최종본을 만들고 YouTube에 예약 업로드했습니다."
            : body.message || "최종본을 만들었습니다."
          : "영상은 완성했지만 저장하지 못했습니다."
      )
      return true
    } catch {
      onNote("최종 렌더링을 시작하지 못했습니다.")
      return false
    } finally {
      onBusy("")
    }
  }

  async function uploadYoutube(
    target = project,
    publishAt = scheduleForUpload(scheduledAt)
  ) {
    setYoutubeBusy(true)
    try {
      const response = await fetch("/api/news-clips/upload/youtube", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: target, scheduledAt: publishAt }),
      })
      const body = (await response.json()) as {
        message?: string
        videoId?: string
        url?: string
      }
      if (!response.ok || !body.videoId || !body.url) {
        onNote(body.message || "YouTube에 업로드하지 못했습니다.")
        return null
      }
      return { videoId: body.videoId, url: body.url }
    } catch {
      onNote("YouTube에 업로드하지 못했습니다.")
      return null
    } finally {
      setYoutubeBusy(false)
    }
  }

  async function uploadFinalToYoutube() {
    const uploaded = await uploadYoutube(project)
    if (!uploaded) return
    const patch = {
      youtubeVideoId: uploaded.videoId,
      youtubeUploadUrl: uploaded.url,
    }
    const uploadedProject = { ...project, ...patch }
    onProject(patch)
    await Promise.resolve(onFinalized(uploadedProject)).catch(() => false)
    onNote("YouTube에 예약 업로드했습니다.")
  }

  const heading = REVIEW_STEP_COPY[mode]
  const partPreviewUrl =
    compositionPane === "all"
      ? project.previewUrl
      : compositionPane === "intro"
        ? project.previewIntroUrl
        : compositionPane === "lead"
          ? project.previewLeadUrl
          : compositionPane === "body"
            ? project.previewBodyUrl
            : project.previewOutroUrl
  const leadCaptions = project.subtitles.filter(
    (cue) =>
      cue.sceneId &&
      project.reportScenes.some(
        (scene) =>
          scene.id === cue.sceneId &&
          (project.productionMode === "buildup2"
            ? scene.id === "buildup2-lead"
            : project.reportScenes.filter((item) => !isEndCtaScene(item))[0]
                ?.id === scene.id)
      )
  )
  const bodyCaptions = project.subtitles.filter((cue) => {
    if (!cue.sceneId || isEndCtaScene({ id: cue.sceneId })) return false
    if (leadCaptions.some((item) => item.id === cue.id)) return false
    return true
  })
  const outroCaptions = project.subtitles.filter(
    (cue) => cue.sceneId && isEndCtaScene({ id: cue.sceneId })
  )
  const paneCaptions =
    compositionPane === "all"
      ? project.subtitles
      : compositionPane === "outro"
        ? outroCaptions
        : compositionPane === "lead"
          ? leadCaptions
          : compositionPane === "body"
            ? bodyCaptions
            : []
  // 4번: 구간별 클립 재생. 5번: 합본·최종본.
  const showPartPreview = mode === "preview"
  const renderedVideoUrl =
    mode === "final"
      ? project.outputUrl || project.previewUrl
      : showPartPreview
        ? partPreviewUrl || project.previewUrl || ""
        : ""
  const finalStageLabel = project.outputUrl
    ? "최종본"
    : project.previewUrl
      ? "미리보기"
      : "대기"
  const partPreviewLabel =
    compositionPane === "all"
      ? "전체 초안"
      : compositionPane === "intro"
        ? "인트로"
        : compositionPane === "lead"
          ? "서두"
          : compositionPane === "body"
            ? "본문"
            : "마무리"
  const uploadAt = scheduleForUpload(scheduledAt)
  const scheduleInWindow =
    inKoreaUploadWindow(scheduledAt) && uploadAt === scheduledAt

  function draftProjectForPreview(): NewsClipProject | null {
    let draft = commitPendingLayoutDrafts(project)
    if (titleDirty) {
      if (!titleValid) {
        onNote(
          titleComplete
            ? "인트로 제목 폭이 초과됐습니다. 길이를 줄여 주세요."
            : "인트로 제목 1단·2단을 모두 입력해 주세요."
        )
        return null
      }
      if (mode !== "script") finishTitleEdit(titleDraft)
      draft = {
        ...draft,
        title: titleDraft,
        metadata: {
          ...draft.metadata,
          youtubeTitle: titleDraft.replace(/\s*\n\s*/g, " "),
        },
      }
    }
    if (reportScriptDirty) {
      const isBuildup2 = draft.productionMode === "buildup2"
      const scriptForSave =
        mode === "preview" || mode === "script"
          ? composedPartScript
          : reportScriptDraft
      const completeReportScript = ensureReportEndCta(
        scriptForSave,
        draft.title,
        draft.selectedIssue?.keywords
      )
      const { body: bodyScript, cta: endCtaText } =
        splitEndCtaFromScript(completeReportScript)
      const candidate = draft.candidates.find(
        (item) => item.id === draft.selectedCandidateId
      )
      if (!candidate) {
        onNote("선택된 후보 구간이 없습니다.")
        return null
      }
      const highlightBounds = buildup2HighlightBounds(
        draft.reportScenes,
        candidate.sourceStart,
        candidate.sourceEnd
      )
      const bodyScenes = isBuildup2
        ? buildBuildup2Scenes(
            bodyScript || completeReportScript,
            highlightBounds.start,
            highlightBounds.end,
            draft.transcript,
            draft.source?.id ?? "",
            draft.reportScenes
          )
        : buildReportScenes(
            bodyScript || completeReportScript,
            draft.transcript,
            candidate.sourceStart,
            candidate.sourceEnd,
            draft.reportScenes,
            draft.source?.id ?? ""
          )
      if (mode !== "script") finishReportScript(scriptForSave)
      const prepared = prepareRenderProject(
        {
          ...draft,
          reportScript: completeReportScript,
          reportScenes: appendEndCtaScenes(
            [
              ...bodyScenes,
              ...draft.reportScenes.filter((scene) => isEndCtaScene(scene)),
            ],
            endCtaText,
            draft.source?.id ?? ""
          ),
          subtitles: [],
        },
        settings,
        { rebuildSubtitles: true }
      )
      if (prepared.reason) {
        onNote(
          prepared.reason === "report-scenes-required"
            ? "화면 구성 장면이 없습니다. 대본을 저장해 장면을 만들어 주세요."
            : "미리보기 전에 장면·대본을 확인해주세요."
        )
        return null
      }
      draft = {
        ...prepared.project,
        titleCardDurationSeconds: 0,
        subtitleTimingsLocked: false,
      }
    }
    const preparedDraft = prepareRenderProject(draft, settings, {
      // 확정된 자막을 다시 만들 때는 저장된 문구와 연결된 영상 구간을
      // 렌더 직전 정규화 과정에서도 다시 구성하지 않는다.
      lockTimeline: draft.subtitleTimingsLocked,
    })
    if (preparedDraft.reason) {
      onNote(
        preparedDraft.reason === "report-scenes-required"
          ? "화면 구성 장면이 없습니다. 대본을 저장해 장면을 만들어 주세요."
          : "미리보기 전에 장면·대본을 확인해주세요."
      )
      return null
    }
    return preparedDraft.project
  }

  async function createPreviewAndContinue() {
    const prepared = draftProjectForPreview()
    if (!prepared) return
    const cleanedTranscript = bodyReviewBounds
      ? clearLegacyAutomaticCaptionBoundaries(
          prepared.transcript,
          bodyReviewBounds
        )
      : prepared.transcript
    const removedLegacyAutoBoundary = cleanedTranscript !== prepared.transcript
    const preparedDraft = removedLegacyAutoBoundary
      ? { ...prepared, transcript: cleanedTranscript }
      : prepared
    const changed = titleDirty || reportScriptDirty || removedLegacyAutoBoundary
    const draft = changed
      ? {
          ...preparedDraft,
          editorialRevision: project.editorialRevision + 1,
          updatedAt: new Date().toISOString(),
        }
      : preparedDraft
    if (changed) onProject(draft)
    // 자동 구간은 실제 단어 시간과 문장 의미를 기준으로 짧게 구성한다.
    // 사용자가 저장·합치기·나누기로 확정한 경계만 transcript에 남아 우선된다.
    const created = await onPreview(true, {
      ...draft,
      subtitles: [],
      subtitleTimingsLocked: false,
    })
    if (created) onNext()
  }

  const audioSettingsCard = (
    <Card>
      <Card.Header className="min-h-16">
        <Card.Title className={cardTitleClass}>
          {mode === "preview" ? "전체 음향 설정" : "음향 설정"}
        </Card.Title>
        {mode === "preview" ? (
          <Card.Description className={cardDescriptionClass}>
            인트로·서두·본문·마무리 전체에 공통으로 적용됩니다.
          </Card.Description>
        ) : null}
      </Card.Header>
      <Card.Content className="flex flex-col gap-6">
        <section className="flex flex-col gap-4">
          <h4 className={sectionTitleClass}>TTS</h4>
          <label className="flex max-w-md flex-col gap-2">
            <span className="text-sm font-medium">TTS 제공자</span>
            <select
              aria-label="대본 공통 TTS 제공자"
              value={settings.ttsProvider}
              className={`${field} h-[42px]`}
              onChange={(event) => selectProvider(event.currentTarget.value)}
            >
              <option value="auto">자동 · Typecast 우선</option>
              <option value="free">무료 TTS</option>
              <option value="typecast">Typecast</option>
            </select>
          </label>
          <div
            className={`grid items-end gap-3 ${
              settings.ttsProvider === "auto"
                ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_11rem]"
                : "md:grid-cols-[minmax(0,1fr)_11rem]"
            }`}
          >
            {settings.ttsProvider !== "free" ? (
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-sm font-medium">Typecast 목소리</span>
                <select
                  aria-label="등록된 Typecast 목소리"
                  value={settings.typecastVoiceId}
                  className={`${field} h-[42px]`}
                  onChange={(event) =>
                    selectTypecastVoice(event.currentTarget.value)
                  }
                >
                  {settings.typecastVoices.map((voice) => (
                    <option key={voice.id} value={voice.voiceId}>
                      {voice.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {settings.ttsProvider !== "typecast" ? (
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-sm font-medium">
                  {settings.ttsProvider === "auto"
                    ? "무료 대체 음성"
                    : "무료 TTS 목소리"}
                </span>
                <select
                  aria-label="무료 TTS 목소리"
                  value={newsTtsVoiceById(settings.titleVoice).id}
                  className={`${field} h-[42px]`}
                  onChange={(event) =>
                    selectFreeVoice(event.currentTarget.value)
                  }
                >
                  {NEWS_TTS_VOICES.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button
              variant="outline"
              className="h-[42px] w-full justify-center"
              isDisabled={voiceBusy && !voicePlaying}
              onPress={() => {
                if (voicePlaying) {
                  stopVoicePreview()
                  onNote("TTS 미리듣기를 멈췄습니다.")
                } else {
                  void previewVoice()
                }
              }}
            >
              {voiceBusy ? (
                <LoadingButtonLabel
                  loading
                  label="음성 미리듣기"
                  loadingLabel="음성 생성 중"
                />
              ) : voicePlaying ? (
                <span className="inline-flex items-center gap-2">
                  <Square className="size-4 fill-current" />
                  미리듣기 멈추기
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Play className="size-4" />
                  음성 미리듣기
                </span>
              )}
            </Button>
          </div>
        </section>
      </Card.Content>
    </Card>
  )

  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">{heading.title}</h2>
        {mode === "preview" ? (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant={audioPanelOpen ? "secondary" : "outline"}
              onPress={() => setAudioPanelOpen((open) => !open)}
            >
              음향 설정
            </Button>
            <Button
              size="sm"
              variant={project.supplementalContext ? "secondary" : "outline"}
              isDisabled={busy !== ""}
              onPress={() => {
                setSupplementDraft(project.supplementalContext)
                setSupplementOpen(true)
              }}
            >
              내용 첨부
            </Button>
            <Button
              size="sm"
              variant="outline"
              isDisabled={buttonBusyDisabled(busy, "reselect")}
              onPress={() => void onReselect("all")}
            >
              <LoadingButtonLabel
                loading={busyMatches(busy, "reselect")}
                label="전체 재작성"
                loadingLabel="재작성 중"
              />
            </Button>
          </div>
        ) : null}
      </header>
      {mode === "preview" && audioPanelOpen ? audioSettingsCard : null}
      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="sticky top-6 flex flex-col gap-3">
          {mode === "script" ? (
            <SegmentedTabs
              ariaLabel="프레임 미리보기"
              value={frameMode}
              onChange={setFrameMode}
              items={[
                { id: "title", label: "제목 프레임" },
                { id: "body", label: "자막 프레임" },
              ]}
            />
          ) : null}
          {mode === "preview" ? (
            <SegmentedTabs
              ariaLabel="미리보기 구간"
              value={compositionPane}
              onChange={setCompositionPane}
              items={[
                { id: "all", label: "전체" },
                { id: "intro", label: "인트로" },
                { id: "lead", label: "서두" },
                { id: "body", label: "본문" },
                { id: "outro", label: "마무리" },
              ]}
            />
          ) : null}
          {mode === "script" ? (
            <NewsFramePreview
              mode={frameMode}
              title={titleDraft}
              subtitle={
                selectedSubtitle?.text ||
                "아나운서 음성에 맞춰 자막이 표시됩니다"
              }
              sourceCredit={bodySourceCreditText(project.source)}
              settings={settings}
              zoom={bodyPreviewCrop.zoom}
              backgroundContent={
                frameMode === "title" && sourceVideoUrl ? (
                  <video
                    ref={scriptFrameVideoRef}
                    src={sourceVideoUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="size-full object-cover"
                    style={{
                      transform: `scale(${introLayout.introStillZoom})`,
                      transformOrigin: `${introLayout.introStillX}% ${introLayout.introStillY}%`,
                    }}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.currentTime = introCursor
                    }}
                  />
                ) : undefined
              }
              videoContent={
                frameMode === "body" && scriptBodyVideoUrl ? (
                  <video
                    ref={scriptFrameVideoRef}
                    src={scriptBodyVideoUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="size-full object-cover"
                    style={{
                      transform: `scale(${Math.max(1.22, bodyPreviewCrop.zoom)})`,
                      transformOrigin: `${bodyPreviewCrop.x}% ${bodyPreviewCrop.y}%`,
                    }}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.playbackRate =
                        NEWS_SOURCE_PLAYBACK_RATE
                      event.currentTarget.currentTime = Math.max(
                        0,
                        previewSceneLayout?.sourceStart ??
                          previewDirectionScene?.sourceStart ??
                          0
                      )
                    }}
                  />
                ) : undefined
              }
            />
          ) : mode === "direction" && directionSourceVideoUrl ? (
            <div className="flex flex-col gap-3">
              <NewsFramePreview
                mode="body"
                title={titleDraft}
                subtitle={
                  project.subtitles.find(
                    (cue) => cue.sceneId === previewDirectionScene?.id
                  )?.text ||
                  selectedSubtitle?.text ||
                  "본문 자막 미리보기"
                }
                sourceCredit={bodySourceCreditText(project.source)}
                settings={settings}
                zoom={bodyPreviewCrop.zoom}
                videoContent={
                  <video
                    ref={directionVideoRef}
                    key={`${directionSourceVideoUrl}-${previewDirectionScene?.id ?? "scene"}`}
                    src={directionSourceVideoUrl}
                    playsInline
                    preload="metadata"
                    className="size-full object-cover"
                    style={{
                      transform: `scale(${Math.max(1.02, bodyPreviewCrop.zoom)})`,
                      transformOrigin: `${bodyPreviewCrop.x}% ${bodyPreviewCrop.y}%`,
                    }}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.playbackRate =
                        NEWS_SOURCE_PLAYBACK_RATE
                      if (Number.isFinite(event.currentTarget.duration)) {
                        setDirectionSourceMetadata({
                          url: directionSourceVideoUrl,
                          duration: event.currentTarget.duration,
                        })
                      }
                      const start = Math.max(
                        0,
                        previewSceneLayout?.sourceStart ??
                          previewDirectionScene?.sourceStart ??
                          0
                      )
                      event.currentTarget.currentTime = start
                      setDirectionCurrentTime(start)
                    }}
                    onPlay={() => setDirectionPlaying(true)}
                    onPause={() => setDirectionPlaying(false)}
                    onEnded={() => setDirectionPlaying(false)}
                    onTimeUpdate={(event) => {
                      const end =
                        previewSceneLayout?.sourceEnd ??
                        previewDirectionScene?.sourceEnd ??
                        event.currentTarget.duration
                      if (event.currentTarget.currentTime >= end) {
                        event.currentTarget.pause()
                        event.currentTarget.currentTime = Math.max(
                          0,
                          previewSceneLayout?.sourceStart ??
                            previewDirectionScene?.sourceStart ??
                            0
                        )
                      }
                      setDirectionCurrentTime(event.currentTarget.currentTime)
                    }}
                  />
                }
              />
              <div className="flex items-center gap-3 rounded-xl border border-separator bg-default p-3">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={
                    directionPlaying ? "미리보기 일시정지" : "미리보기 재생"
                  }
                  onPress={() => {
                    const video = directionVideoRef.current
                    if (!video) return
                    if (video.paused) {
                      void video.play().catch(() => undefined)
                    } else {
                      video.pause()
                    }
                  }}
                >
                  {directionPlaying ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </Button>
                <input
                  aria-label="화면 미리보기 재생 위치"
                  type="range"
                  min={0}
                  max={Math.max(0.1, directionSourceMetadata.duration)}
                  step={0.1}
                  value={Math.min(
                    directionCurrentTime,
                    Math.max(0.1, directionSourceMetadata.duration)
                  )}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value)
                    if (directionVideoRef.current) {
                      directionVideoRef.current.currentTime = value
                    }
                    setDirectionCurrentTime(value)
                  }}
                  className="min-w-0 flex-1"
                />
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {time(directionCurrentTime)}
                </span>
              </div>
            </div>
          ) : mode === "final" || showPartPreview ? (
            renderedVideoUrl ? (
              <video
                ref={renderedVideoRef}
                // 서명 변경(내용 수정)으로 플레이어를 리마운트하지 않는다. URL이 바뀔 때만 교체.
                key={`${renderedVideoUrl}-${compositionPane}`}
                src={renderedVideoUrl}
                controls
                playsInline
                className="aspect-[9/16] w-full rounded-2xl bg-black shadow-xl"
              />
            ) : mode === "preview" && sourceVideoUrl ? (
              <NewsFramePreview
                mode={compositionPane === "intro" ? "title" : "body"}
                title={titleDraft}
                subtitle={
                  selectedSubtitle?.text ||
                  (busy.includes(":preview") || busy === "preview"
                    ? "초안 영상 만드는 중…"
                    : "초안이 없으면 원본 화면을 보여 줍니다")
                }
                sourceCredit={bodySourceCreditText(project.source)}
                settings={settings}
                zoom={bodyPreviewCrop.zoom}
                backgroundContent={
                  compositionPane === "intro" ? (
                    <video
                      ref={sourceVideoRef}
                      src={sourceVideoUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="size-full object-cover"
                      style={{
                        transform: `scale(${introLayout.introStillZoom})`,
                        transformOrigin: `${introLayout.introStillX}% ${introLayout.introStillY}%`,
                      }}
                      onLoadedMetadata={(event) => {
                        event.currentTarget.currentTime = introCursor
                      }}
                    />
                  ) : undefined
                }
                videoContent={
                  compositionPane !== "intro" ? (
                    <video
                      ref={scriptFrameVideoRef}
                      src={sourceVideoUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="size-full object-cover"
                      style={{
                        transform: `scale(${Math.max(1.22, bodyPreviewCrop.zoom)})`,
                        transformOrigin: `${bodyPreviewCrop.x}% ${bodyPreviewCrop.y}%`,
                      }}
                      onLoadedMetadata={(event) => {
                        event.currentTarget.playbackRate =
                          NEWS_SOURCE_PLAYBACK_RATE
                        event.currentTarget.currentTime = Math.max(
                          0,
                          previewSceneLayout?.sourceStart ??
                            previewDirectionScene?.sourceStart ??
                            0
                        )
                      }}
                    />
                  ) : undefined
                }
              />
            ) : (
              <div className="flex aspect-[9/16] w-full items-center justify-center rounded-2xl border border-dashed border-separator bg-default px-6 text-center text-sm text-muted">
                {mode === "preview"
                  ? `${partPreviewLabel} 초안이 준비되면 여기에 재생됩니다.`
                  : "초안 영상이 준비되면 여기에 재생됩니다."}
              </div>
            )
          ) : (
            <NewsFramePreview
              mode={frameMode}
              title={titleDraft}
              subtitle={
                selectedSubtitle?.text ||
                "아나운서 음성에 맞춰 자막이 표시됩니다"
              }
              sourceCredit={bodySourceCreditText(project.source)}
              settings={settings}
              zoom={bodyPreviewCrop.zoom}
              backgroundContent={
                frameMode === "title" && introVideoUrl ? (
                  <video
                    ref={sourceVideoRef}
                    src={introVideoUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="size-full object-cover"
                    style={{
                      transform: `scale(${introLayout.introStillZoom})`,
                      transformOrigin: `${introLayout.introStillX}% ${introLayout.introStillY}%`,
                    }}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.currentTime = introCursor
                    }}
                  />
                ) : undefined
              }
              videoContent={
                frameMode === "body" && scriptBodyVideoUrl ? (
                  <video
                    ref={scriptFrameVideoRef}
                    src={scriptBodyVideoUrl}
                    muted
                    playsInline
                    preload="metadata"
                    className="size-full object-cover"
                    style={{
                      transform: `scale(${Math.max(1.22, bodyPreviewCrop.zoom)})`,
                      transformOrigin: `${bodyPreviewCrop.x}% ${bodyPreviewCrop.y}%`,
                    }}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.playbackRate =
                        NEWS_SOURCE_PLAYBACK_RATE
                      event.currentTarget.currentTime = Math.max(
                        0,
                        previewSceneLayout?.sourceStart ??
                          previewDirectionScene?.sourceStart ??
                          0
                      )
                    }}
                  />
                ) : undefined
              }
            />
          )}
          <div className="rounded-xl border border-separator bg-default p-3 text-sm">
            {mode === "final" ? (
              <span>
                {finalStageLabel} · 예상 길이{" "}
                {project.outputDurationSeconds.toFixed(1)}초
              </span>
            ) : mode === "preview" ? (
              <span>
                {partPreviewLabel} 미리보기
                {compositionPane !== "intro" && compositionPane !== "all"
                  ? ` · 자막 ${paneCaptions.length}칸`
                  : ""}
                {project.subtitleTimingsLocked ? " · 구간 잠김" : ""}
              </span>
            ) : (
              <span>
                예상 길이 {project.outputDurationSeconds.toFixed(1)}초
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {mode === "preview" && compositionPane === "all" ? (
            <Card>
              <Card.Header className="border-b border-separator pb-4">
                <Card.Title className={cardTitleClass}>전체 초안</Card.Title>
                <Card.Description className={cardDescriptionClass}>
                  처음부터 끝까지 확인한 뒤 구간 탭에서 필요한 부분만
                  수정하세요.
                </Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-separator p-3">
                  <p className="text-sm font-medium">구성</p>
                  <p className="mt-1 text-sm text-muted">
                    인트로 → 서두 TTS → 원본 핵심 발언 → 마무리 TTS
                  </p>
                </div>
                <div className="rounded-xl border border-separator p-3">
                  <p className="text-sm font-medium">수정 상태</p>
                  <p className="mt-1 text-sm text-muted">
                    {project.previewRevision === project.editorialRevision
                      ? "현재 수정본이 미리보기에 반영됨"
                      : "수정 후 미리보기 다시 만들기 필요"}
                  </p>
                </div>
              </Card.Content>
            </Card>
          ) : null}

          {mode !== "preview" && editorTabs.length > 1 ? (
            <SegmentedTabs
              ariaLabel="편집 주제"
              className="sticky top-6 z-20 overflow-x-auto shadow-sm"
              equalWidth={false}
              value={editorTab}
              onChange={(tabId) => {
                setEditorTabByMode((current) => ({
                  ...current,
                  [mode]: tabId,
                }))
                if (tabId === "scenes") {
                  setFrameMode(compositionPane === "intro" ? "title" : "body")
                }
              }}
              items={editorTabs.map((tab) => ({
                id: tab.id,
                label: tab.label,
              }))}
            />
          ) : null}

          {(mode === "script" && editorTab === "script") ||
          (mode === "preview" &&
            (compositionPane === "intro" ||
              compositionPane === "lead" ||
              compositionPane === "outro" ||
              (compositionPane === "body" &&
                project.productionMode !== "buildup2"))) ? (
            <Card>
              <Card.Header className="min-h-16 flex-row items-end justify-between gap-4 border-b border-separator pb-4">
                <div>
                  <Card.Title className={cardTitleClass}>
                    {mode === "preview" && compositionPane === "intro"
                      ? "인트로 제목"
                      : mode === "preview" && compositionPane === "lead"
                        ? "서두 대본"
                        : mode === "preview" && compositionPane === "body"
                          ? "본문 대본"
                          : mode === "preview" && compositionPane === "outro"
                            ? "마무리 대본"
                            : mode === "script"
                              ? "전체 내용 검수"
                              : project.productionMode === "buildup2"
                                ? "제목·빌드업 서두"
                                : "제목·시사 논평 대본"}
                  </Card.Title>
                  <Card.Description className={cardDescriptionClass}>
                    {mode === "preview" && compositionPane === "intro"
                      ? "인트로 카드에 보이는 제목을 수정합니다."
                      : mode === "preview" && compositionPane === "lead"
                        ? "서두 나레이션만 수정합니다. 마무리 멘트는 마무리 탭에서 다룹니다."
                        : mode === "preview" && compositionPane === "body"
                          ? "본문 나레이션만 수정합니다. 마무리 멘트는 마무리 탭에서 다룹니다."
                          : mode === "preview" && compositionPane === "outro"
                            ? "마무리(댓글 유도) 멘트만 수정합니다."
                            : mode === "script"
                              ? "인트로, 서두, 본문, 마무리를 순서대로 확인합니다."
                              : project.productionMode === "buildup2"
                                ? "서두·마무리만 TTS. 본편은 원본 영상·음성이고 자막은 전사를 씁니다."
                                : "논평은 TTS로 읽고, 직접 발언은 원본 음성을 씁니다."}
                  </Card.Description>
                </div>
                {mode !== "preview" ? (
                  <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={buttonBusyDisabled(busy, "reselect")}
                      onPress={() => void onReselect("all")}
                    >
                      <LoadingButtonLabel
                        loading={busyMatches(busy, "reselect")}
                        label="전체 재작성"
                        loadingLabel="재작성 중"
                      />
                    </Button>
                    <Button
                      size="sm"
                      variant={
                        project.supplementalContext ? "secondary" : "outline"
                      }
                      isDisabled={busy !== ""}
                      onPress={() => {
                        setSupplementDraft(project.supplementalContext)
                        setSupplementOpen(true)
                      }}
                    >
                      내용 첨부
                    </Button>
                  </div>
                ) : null}
              </Card.Header>
              <Card.Content className="flex flex-col gap-6">
                {mode !== "preview" || compositionPane === "intro" ? (
                  <div className="flex flex-col gap-3">
                    <div className={sectionHeaderClass}>
                      <span className="flex items-center gap-2">
                        <span className={sectionTitleClass}>인트로 제목</span>
                        {titleDirty ? (
                          <span className="text-xs text-warning">저장 전</span>
                        ) : null}
                      </span>
                      <span className="ml-auto flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          isDisabled={busy !== "" || !titleDirty || !titleValid}
                          onPress={() => finishTitleEdit(titleDraft)}
                        >
                          저장
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          isDisabled={buttonBusyDisabled(busy, "rewrite-title")}
                          onPress={() => void onReselect("title")}
                        >
                          <LoadingButtonLabel
                            loading={busyMatches(busy, "rewrite-title")}
                            label="다시 작성"
                            loadingLabel="작성 중"
                          />
                        </Button>
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex min-w-0 flex-col gap-2">
                        <span className="text-xs font-medium text-muted">
                          1단 제목 · 권장 {firstTitleCharacterLimit}자 이내
                          {titleLine1Draft && !firstTitleFits ? (
                            <span className="ml-2 text-danger">폭 초과</span>
                          ) : null}
                        </span>
                        <input
                          id="news-clip-title-line-1"
                          aria-label="1단 제목"
                          value={titleLine1Draft}
                          onFocus={() => {
                            editingTitleRef.current = true
                          }}
                          onChange={(event) =>
                            setTitleLine1Draft(event.currentTarget.value)
                          }
                          onBlur={() => {
                            editingTitleRef.current = false
                          }}
                          className={`${field} ${
                            titleLine1Draft && !firstTitleFits
                              ? "border-danger"
                              : ""
                          }`}
                        />
                      </label>
                      <label className="flex min-w-0 flex-col gap-2">
                        <span className="text-xs font-medium text-muted">
                          2단 제목 · 권장 {secondTitleCharacterLimit}자 이내
                          {titleLine2Draft && !secondTitleFits ? (
                            <span className="ml-2 text-danger">폭 초과</span>
                          ) : null}
                        </span>
                        <input
                          id="news-clip-title-line-2"
                          aria-label="2단 제목"
                          value={titleLine2Draft}
                          onFocus={() => {
                            editingTitleRef.current = true
                          }}
                          onChange={(event) =>
                            setTitleLine2Draft(event.currentTarget.value)
                          }
                          onBlur={() => {
                            editingTitleRef.current = false
                          }}
                          className={`${field} ${
                            titleLine2Draft && !secondTitleFits
                              ? "border-danger"
                              : ""
                          }`}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
                {mode === "script" ? (
                  <>
                    <section className="flex flex-col gap-3 border-t border-separator pt-5">
                      <div className={sectionHeaderClass}>
                        <label
                          htmlFor="news-clip-lead-script"
                          className={sectionTitleClass}
                        >
                          서두
                        </label>
                        <span className="ml-auto flex items-center justify-end gap-2">
                          {leadScriptDraft !== projectPartScripts.lead ? (
                            <span className="text-xs text-warning">
                              저장 전
                            </span>
                          ) : null}
                          <Button
                            size="sm"
                            isDisabled={
                              busy !== "" ||
                              !leadScriptDraft.trim() ||
                              leadScriptDraft === projectPartScripts.lead
                            }
                            onPress={() => savePartScript("lead")}
                          >
                            저장
                          </Button>
                        </span>
                      </div>
                      <textarea
                        id="news-clip-lead-script"
                        aria-label="서두 대본"
                        rows={1}
                        value={leadScriptDraft}
                        onChange={(event) => {
                          resizeTextareaToContent(event.currentTarget)
                          const next = event.currentTarget.value
                          scriptReviewDirtyRef.current =
                            composePartScripts(
                              project.productionMode,
                              next,
                              bodyScriptDraft,
                              outroScriptDraft
                            ) !== project.reportScript
                          setLeadScriptDraft(next)
                        }}
                        className={`${field} [field-sizing:content] min-h-24 resize-none overflow-hidden`}
                      />
                    </section>

                    <section className="flex flex-col gap-3 border-t border-separator pt-5">
                      <div className={sectionHeaderClass}>
                        <h3 className={sectionTitleClass}>본문</h3>
                        {bodyReviewBounds ? (
                          <span className="text-xs text-muted tabular-nums">
                            {time(bodyReviewBounds.start)} →{" "}
                            {time(bodyReviewBounds.end)}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-col divide-y divide-separator">
                        {bodyReviewSegments.length ? (
                          bodyReviewSegments.map((segment, index) => (
                            <ReviewTranscriptSegment
                              key={`${segment.id}:${segment.start}:${segment.text}`}
                              segment={segment}
                              disabled={busy !== ""}
                              canMergeNext={
                                index < bodyReviewSegments.length - 1
                              }
                              onSave={(text) => {
                                onProject((current) => ({
                                  transcript: current.transcript.map((item) =>
                                    item.id === segment.id
                                      ? {
                                          ...updateTranscriptSegmentText(
                                            item,
                                            text
                                          ),
                                          captionBoundaryAfter: true,
                                          captionBoundarySource: "manual",
                                        }
                                      : item
                                  ),
                                  subtitles: [],
                                  subtitleTimingsLocked: false,
                                }))
                                onNote("본문 원문을 저장했습니다.")
                              }}
                              onMergeNext={() => {
                                const nextSegment =
                                  bodyReviewSegments[index + 1]
                                if (!nextSegment) return
                                onProject((current) => ({
                                  transcript: mergeTranscriptSegmentWithNext(
                                    current.transcript,
                                    segment.id,
                                    nextSegment.id
                                  ),
                                  subtitles: [],
                                  subtitleTimingsLocked: false,
                                  renderSignature: "",
                                }))
                                onNote(
                                  "다음 원문과 시간 구간을 함께 합쳤습니다."
                                )
                              }}
                            />
                          ))
                        ) : (
                          <p className="py-3 text-sm text-muted">
                            표시할 본문 구간이 없습니다.
                          </p>
                        )}
                      </div>
                    </section>

                    <section className="flex flex-col gap-3 border-t border-separator pt-5">
                      <div className={sectionHeaderClass}>
                        <label
                          htmlFor="news-clip-outro-script"
                          className={sectionTitleClass}
                        >
                          마무리
                        </label>
                        <span className="ml-auto flex items-center justify-end gap-2">
                          {outroScriptDraft !== projectPartScripts.outro ? (
                            <span className="text-xs text-warning">
                              저장 전
                            </span>
                          ) : null}
                          <Button
                            size="sm"
                            isDisabled={
                              busy !== "" ||
                              !outroScriptDraft.trim() ||
                              outroScriptDraft === projectPartScripts.outro
                            }
                            onPress={() => savePartScript("outro")}
                          >
                            저장
                          </Button>
                        </span>
                      </div>
                      <textarea
                        id="news-clip-outro-script"
                        aria-label="마무리 멘트"
                        rows={1}
                        value={outroScriptDraft}
                        onChange={(event) => {
                          resizeTextareaToContent(event.currentTarget)
                          const next = event.currentTarget.value
                          scriptReviewDirtyRef.current =
                            composePartScripts(
                              project.productionMode,
                              leadScriptDraft,
                              bodyScriptDraft,
                              next
                            ) !== project.reportScript
                          setOutroScriptDraft(next)
                        }}
                        className={`${field} [field-sizing:content] min-h-20 resize-none overflow-hidden`}
                      />
                    </section>
                  </>
                ) : null}
                {showPaneScriptEditor ? (
                  <div
                    className={`flex flex-col gap-3 ${
                      mode !== "preview" || compositionPane === "intro"
                        ? "border-t border-separator pt-5"
                        : ""
                    }`}
                  >
                    <div className={sectionHeaderClass}>
                      <span className="flex items-center gap-2">
                        <label
                          htmlFor="news-clip-report-script"
                          className={sectionTitleClass}
                        >
                          {mode === "preview" && compositionPane === "lead"
                            ? "서두 나레이션"
                            : mode === "preview" && compositionPane === "outro"
                              ? "마무리 멘트"
                              : mode === "preview" && compositionPane === "body"
                                ? "본문 나레이션"
                                : project.productionMode === "buildup2"
                                  ? "빌드업 서두"
                                  : "시사 논평 대본"}
                        </label>
                        {reportScriptDirty ? (
                          <span className="text-xs text-warning">저장 전</span>
                        ) : null}
                      </span>
                      <span className="ml-auto flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          isDisabled={busy !== "" || !reportScriptDirty}
                          onPress={finishPreviewPartScript}
                        >
                          저장
                        </Button>
                        {mode === "preview" &&
                        compositionPane === "intro" ? null : (
                          <Button
                            size="sm"
                            variant="outline"
                            isDisabled={buttonBusyDisabled(
                              busy,
                              compositionPane === "outro"
                                ? "rewrite-outro"
                                : "rewrite-script"
                            )}
                            onPress={() =>
                              void onReselect(
                                compositionPane === "outro" ? "outro" : "script"
                              )
                            }
                          >
                            <LoadingButtonLabel
                              loading={busyMatches(
                                busy,
                                compositionPane === "outro"
                                  ? "rewrite-outro"
                                  : "rewrite-script"
                              )}
                              label="다시 작성"
                              loadingLabel="작성 중"
                            />
                          </Button>
                        )}
                      </span>
                    </div>
                    <textarea
                      ref={reportScriptTextareaRef}
                      id="news-clip-report-script"
                      aria-label={
                        mode === "preview" && compositionPane === "lead"
                          ? "서두 나레이션"
                          : mode === "preview" && compositionPane === "outro"
                            ? "마무리 멘트"
                            : mode === "preview" && compositionPane === "body"
                              ? "본문 나레이션"
                              : project.productionMode === "buildup2"
                                ? "빌드업 서두"
                                : "시사 논평 대본"
                      }
                      rows={1}
                      value={paneScriptValue}
                      onFocus={() => {
                        editingReportScriptRef.current = true
                      }}
                      onChange={(event) => {
                        resizeTextareaToContent(event.currentTarget)
                        const next = event.currentTarget.value
                        if (mode === "preview" && compositionPane === "lead") {
                          setLeadScriptDraft(next)
                          setReportScriptDraft(
                            composePartScripts(
                              project.productionMode,
                              next,
                              bodyScriptDraft,
                              outroScriptDraft
                            )
                          )
                          return
                        }
                        if (mode === "preview" && compositionPane === "outro") {
                          setOutroScriptDraft(next)
                          setReportScriptDraft(
                            composePartScripts(
                              project.productionMode,
                              leadScriptDraft,
                              bodyScriptDraft,
                              next
                            )
                          )
                          return
                        }
                        if (mode === "preview" && compositionPane === "body") {
                          setBodyScriptDraft(next)
                          setReportScriptDraft(
                            composePartScripts(
                              project.productionMode,
                              leadScriptDraft,
                              next,
                              outroScriptDraft
                            )
                          )
                          return
                        }
                        setReportScriptDraft(next)
                      }}
                      onBlur={() => {
                        editingReportScriptRef.current = false
                      }}
                      className={`${field} [field-sizing:content] min-h-24 resize-none overflow-hidden`}
                    />
                  </div>
                ) : null}
              </Card.Content>
            </Card>
          ) : null}

          {(mode === "direction" && editorTab === "scenes") ||
          (mode === "preview" && compositionPane !== "all") ? (
            <Card>
              <Card.Header>
                <Card.Title className={cardTitleClass}>
                  {compositionPane === "intro"
                    ? "인트로 화면"
                    : compositionPane === "lead"
                      ? "서두 화면"
                      : compositionPane === "outro"
                        ? "마무리 화면"
                        : "본문 화면"}
                </Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-6">
                {mode === "preview" &&
                compositionPane === "intro" &&
                introVideoUrl ? (
                  <div className="flex flex-col gap-5">
                    <div className="flex items-center justify-end gap-2">
                      {introLayoutDirty ? (
                        <span className="mr-auto text-xs text-warning">
                          저장 전
                        </span>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        isDisabled={introLayout.introStillTimeSeconds === null}
                        onPress={restoreAutomaticIntroStill}
                      >
                        <RotateCcw className="size-4" /> 자동 선택
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        isDisabled={!introLayoutDirty}
                        onPress={resetIntroLayout}
                      >
                        초기화
                      </Button>
                      <Button
                        size="sm"
                        isDisabled={!introLayoutDirty}
                        onPress={saveIntroLayout}
                      >
                        저장
                      </Button>
                    </div>
                    <NewsFramePreview
                      mode="title"
                      title={titleDraft}
                      subtitle=""
                      settings={settings}
                      className="mx-auto w-full max-w-[260px] rounded-xl shadow-none"
                      backgroundContent={
                        <video
                          ref={sourceVideoRef}
                          src={introVideoUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className="size-full object-cover transition-transform"
                          style={{
                            transform: `scale(${introLayout.introStillZoom})`,
                            transformOrigin: `${introLayout.introStillX}% ${introLayout.introStillY}%`,
                          }}
                          onLoadedMetadata={(event) => {
                            const duration = Number.isFinite(
                              event.currentTarget.duration
                            )
                              ? event.currentTarget.duration
                              : initialSourceDuration(project)
                            setSourceDuration(duration)
                            event.currentTarget.currentTime = Math.min(
                              Math.max(0, introCursor),
                              Math.max(0, duration - 0.05)
                            )
                          }}
                        />
                      }
                    />
                    <label className="flex flex-col gap-2">
                      <span className="flex items-center justify-between text-sm">
                        <span>
                          {introLayout.introStillTimeSeconds === null
                            ? "자동 선택"
                            : "직접 선택"}
                        </span>
                        <span className="text-muted tabular-nums">
                          {time(introCursor)} / {time(sourceDuration)}
                        </span>
                      </span>
                      <input
                        aria-label="인트로 이미지 위치"
                        type="range"
                        min={0}
                        max={Math.max(0.1, sourceDuration)}
                        step={0.1}
                        value={Math.min(introCursor, sourceDuration)}
                        onChange={(event) =>
                          selectIntroStill(Number(event.currentTarget.value))
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="flex items-center justify-between text-sm">
                        <span>추가 확대</span>
                        <span className="text-muted tabular-nums">
                          {ratioPercent(introLayout.introStillZoom)}
                        </span>
                      </span>
                      <input
                        aria-label="인트로 이미지 추가 확대"
                        type="range"
                        min={1}
                        max={1.8}
                        step={0.01}
                        value={introLayout.introStillZoom}
                        onChange={(event) =>
                          patchIntroLayout({
                            introStillZoom: Number(event.currentTarget.value),
                          })
                        }
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label className="flex flex-col gap-2">
                        <span className="flex items-center justify-between text-sm">
                          <span>좌우 위치</span>
                          <span className="text-muted tabular-nums">
                            {axisPosition(
                              introLayout.introStillX,
                              "왼쪽",
                              "오른쪽"
                            )}
                          </span>
                        </span>
                        <input
                          aria-label="인트로 이미지 좌우 위치"
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={introLayout.introStillX}
                          onChange={(event) =>
                            patchIntroLayout({
                              introStillX: Number(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="flex items-center justify-between text-sm">
                          <span>위아래 위치</span>
                          <span className="text-muted tabular-nums">
                            {axisPosition(
                              introLayout.introStillY,
                              "위",
                              "아래"
                            )}
                          </span>
                        </span>
                        <input
                          aria-label="인트로 이미지 위아래 위치"
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={introLayout.introStillY}
                          onChange={(event) =>
                            patchIntroLayout({
                              introStillY: Number(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
                {mode === "direction" ||
                compositionPane === "lead" ||
                compositionPane === "body" ||
                compositionPane === "outro" ? (
                  <div className="flex flex-col gap-3">
                    {project.reportScenes.length ? (
                      project.reportScenes
                        .filter((scene) => {
                          if (mode !== "preview") return true
                          const parts = splitScenesByClipPart(
                            project.reportScenes,
                            project.productionMode
                          )
                          if (compositionPane === "lead") {
                            return parts.lead.some(
                              (item) => item.id === scene.id
                            )
                          }
                          if (compositionPane === "body") {
                            return parts.body.some(
                              (item) => item.id === scene.id
                            )
                          }
                          if (compositionPane === "outro") {
                            return parts.outro.some(
                              (item) => item.id === scene.id
                            )
                          }
                          return false
                        })
                        .map((scene, index) => {
                          const selected = scene.id === selectedDirectionSceneId
                          const layout = sceneLayoutFor(
                            scene,
                            project,
                            sceneLayoutDrafts
                          )
                          const crop = layout.crop
                          const layoutDirty = sceneLayoutDirty(
                            layout,
                            scene,
                            project.crop
                          )
                          const draftScene = {
                            ...scene,
                            sourceStart: layout.sourceStart,
                            sourceEnd: layout.sourceEnd,
                          }
                          return (
                            <div key={scene.id} className="flex flex-col gap-2">
                              <button
                                type="button"
                                aria-pressed={selected}
                                className={`flex w-full flex-col gap-1 rounded-xl border p-3 text-left ${
                                  selected
                                    ? "border-foreground/35 bg-default"
                                    : "border-separator"
                                }`}
                                onClick={() =>
                                  selectDirectionScene(
                                    scene.id,
                                    layout.sourceStart
                                  )
                                }
                              >
                                <span className="flex items-center gap-2 text-xs text-muted">
                                  <span>구간 {index + 1}</span>
                                  <span className="rounded-md border border-separator px-1.5 py-0.5">
                                    {scene.visual === "quote"
                                      ? "직접발언"
                                      : "자료"}
                                  </span>
                                  {layoutDirty ? (
                                    <span className="text-warning">
                                      저장 전
                                    </span>
                                  ) : null}
                                </span>
                                <span className="line-clamp-2 text-sm leading-6">
                                  {scene.narration}
                                </span>
                              </button>
                              {selected ? (
                                <div className="flex flex-col gap-4 rounded-xl border border-separator p-3">
                                  <div className="flex items-center justify-end gap-2">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      isDisabled={!layoutDirty}
                                      onPress={() => resetSceneLayout(scene.id)}
                                    >
                                      초기화
                                    </Button>
                                    <Button
                                      size="sm"
                                      isDisabled={!layoutDirty}
                                      onPress={() => saveSceneLayout(scene)}
                                    >
                                      저장
                                    </Button>
                                  </div>
                                  {mode === "preview" ? (
                                    <SceneCropPreview
                                      sourceUrl={sourceVideoUrlFor(
                                        scene.sourceId
                                      )}
                                      sourceStart={layout.sourceStart}
                                      sourceEnd={layout.sourceEnd}
                                      crop={crop}
                                      title={titleDraft}
                                      subtitle={
                                        project.subtitles.find(
                                          (cue) => cue.sceneId === scene.id
                                        )?.text || "본문 자막 미리보기"
                                      }
                                      sourceCredit={bodySourceCreditText(
                                        project.source
                                      )}
                                      settings={settings}
                                    />
                                  ) : null}
                                  <div className="grid gap-5 md:grid-cols-3">
                                    <RangeInput
                                      label="화면 확대"
                                      value={crop.zoom}
                                      min={1.02}
                                      max={1.8}
                                      step={0.01}
                                      formatValue={ratioPercent}
                                      onChange={(zoom) =>
                                        patchSceneLayoutDraft(scene, {
                                          crop: { ...crop, zoom },
                                        })
                                      }
                                    />
                                    <RangeInput
                                      label="가로 크롭 중심"
                                      value={crop.x}
                                      min={0}
                                      max={100}
                                      step={1}
                                      formatValue={screenPercent}
                                      onChange={(x) =>
                                        patchSceneLayoutDraft(scene, {
                                          crop: { ...crop, x },
                                        })
                                      }
                                    />
                                    <RangeInput
                                      label="세로 크롭 중심"
                                      value={crop.y}
                                      min={0}
                                      max={100}
                                      step={1}
                                      formatValue={screenPercent}
                                      onChange={(y) =>
                                        patchSceneLayoutDraft(scene, {
                                          crop: { ...crop, y },
                                        })
                                      }
                                    />
                                  </div>
                                  {splitScenesByClipPart(
                                    project.reportScenes,
                                    project.productionMode
                                  ).body.some(
                                    (item) => item.id === scene.id
                                  ) ? (
                                    <p className="text-sm text-muted">
                                      본문은 확정된 영상 구간입니다. 화면 위치만
                                      조절할 수 있습니다.
                                    </p>
                                  ) : (
                                    <SourceRangeTimeline
                                      scene={draftScene}
                                      sourceId={
                                        scene.sourceId ||
                                        project.source?.id ||
                                        ""
                                      }
                                      duration={sceneSourceDuration(
                                        project,
                                        draftScene,
                                        directionSourceMetadata.url ===
                                          sourceVideoUrlFor(
                                            scene.sourceId || project.source?.id
                                          )
                                          ? directionSourceMetadata.duration
                                          : 0
                                      )}
                                      onMove={(sourceStart, sourceEnd) => {
                                        selectDirectionScene(
                                          scene.id,
                                          sourceStart
                                        )
                                        patchSceneLayoutDraft(scene, {
                                          sourceStart,
                                          sourceEnd,
                                        })
                                      }}
                                    />
                                  )}
                                </div>
                              ) : null}
                            </div>
                          )
                        })
                    ) : (
                      <p className="text-sm text-muted">
                        대본을 입력하면 문장별 화면이 생깁니다.
                      </p>
                    )}
                  </div>
                ) : null}
              </Card.Content>
            </Card>
          ) : null}

          {mode === "direction" && editorTab === "media"
            ? audioSettingsCard
            : null}

          {(mode === "preview" &&
            (compositionPane === "lead" ||
              compositionPane === "body" ||
              compositionPane === "outro")) ||
          mode === "final" ? (
            <>
              {mode === "preview" ? (
                <Card>
                  <Card.Header>
                    <Card.Title className={cardTitleClass}>
                      {mode === "preview"
                        ? compositionPane === "lead"
                          ? "서두 자막 구간"
                          : compositionPane === "outro"
                            ? "마무리 자막 구간"
                            : "본문 자막 구간"
                        : "자막 오타 수정"}
                    </Card.Title>
                    <Card.Description className={cardDescriptionClass}>
                      {mode === "preview"
                        ? compositionPane === "lead" ||
                          compositionPane === "outro"
                          ? "자막 문구를 수정하면 위 대본에도 반영됩니다. 수정 후 미리보기를 다시 만드세요."
                          : "초안 영상에서 확정된 시작·끝 시간입니다. 문구·강조만 고치고, 수정 후 미리보기를 다시 만드세요."
                        : "미리보기로 음성 기준 타이밍을 맞춘 뒤, 문구·강조만 고칩니다. 수정 후 미리보기/최종본을 다시 만드세요."}
                    </Card.Description>
                  </Card.Header>
                  <Card.Content className="divide-y divide-separator">
                    {project.previewUrl || project.outputUrl ? (
                      (mode === "preview" ? paneCaptions : project.subtitles)
                        .length ? (
                        (mode === "preview"
                          ? paneCaptions
                          : project.subtitles
                        ).map((caption, index) => (
                          <div
                            key={caption.id}
                            className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium">
                                자막 {index + 1}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted tabular-nums">
                                  {time(caption.start)} → {time(caption.end)}
                                  {project.subtitleTimingsLocked ? (
                                    <span className="ml-2 text-muted">
                                      잠김
                                    </span>
                                  ) : null}
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  isDisabled={
                                    !canMergeSubtitleCueWithNext(
                                      project.subtitles,
                                      caption.id
                                    )
                                  }
                                  onPress={() => {
                                    onProject((current) => {
                                      const subtitles =
                                        mergeSubtitleCueWithNext(
                                          current.subtitles,
                                          caption.id,
                                          settings.bodySubtitleText
                                        )
                                      return syncNarrationFromSubtitleEdit(
                                        current,
                                        subtitles,
                                        caption.id
                                      )
                                    })
                                    onNote(
                                      `자막 ${index + 1}과 다음 자막을 합쳤습니다.`
                                    )
                                  }}
                                >
                                  다음과 합치기
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  isDisabled={!caption.edited}
                                  onPress={() => {
                                    onProject((current) => {
                                      const subtitles = resetEditedSubtitleCue(
                                        current.subtitles,
                                        caption.id
                                      )
                                      return syncNarrationFromSubtitleEdit(
                                        current,
                                        subtitles,
                                        caption.id
                                      )
                                    })
                                    onNote(
                                      "자막을 초기화했습니다. 다시 만들면 자동 자막과 타이밍이 적용됩니다."
                                    )
                                  }}
                                >
                                  초기화
                                </Button>
                              </div>
                            </div>
                            <SubtitleLineFields
                              value={caption.text}
                              emphasis={caption.emphasis}
                              characterLimit={subtitleLineCharacterLimit(
                                settings.bodySubtitleText
                              )}
                              onFocus={() => setSelectedSubtitleId(caption.id)}
                              onCommit={(text, emphasis) => {
                                onProject((current) => {
                                  const withText = updateEditedSubtitleCue(
                                    current.subtitles,
                                    caption.id,
                                    text,
                                    settings.bodySubtitleText
                                  )
                                  const subtitles = withText.map((item) =>
                                    item.id === caption.id
                                      ? {
                                          ...item,
                                          originalEmphasis:
                                            item.originalEmphasis ?? [
                                              ...item.emphasis,
                                            ],
                                          emphasis,
                                          edited: true,
                                        }
                                      : item
                                  )
                                  return syncNarrationFromSubtitleEdit(
                                    current,
                                    subtitles,
                                    caption.id
                                  )
                                })
                                onNote(
                                  `자막 ${index + 1}을 저장했습니다. 다시 만들면 영상에 반영됩니다.`
                                )
                              }}
                            />
                          </div>
                        ))
                      ) : (
                        <p className="py-2 text-sm text-muted">
                          표시할 자막이 없습니다.
                        </p>
                      )
                    ) : (
                      <p className="py-2 text-sm text-muted">
                        초안 영상이 준비되면 확정된 자막 구간이 여기에
                        표시됩니다.
                      </p>
                    )}
                  </Card.Content>
                </Card>
              ) : null}
              {mode === "final" ? (
                <>
                  <Card>
                    <Card.Header className="min-h-16">
                      <Card.Title className={cardTitleClass}>
                        완성 영상
                      </Card.Title>
                      <Card.Description className={cardDescriptionClass}>
                        최종본을 확인하거나 내려받을 수 있습니다.
                      </Card.Description>
                    </Card.Header>
                    <Card.Content className="flex flex-col gap-4">
                      <div className="flex flex-wrap gap-3">
                        {project.outputUrl ? (
                          <a
                            className="text-sm underline"
                            href={project.outputUrl}
                          >
                            영상 받기
                          </a>
                        ) : null}
                        {project.thumbnailUrl ? (
                          <a
                            className="text-sm underline"
                            href={project.thumbnailUrl}
                          >
                            썸네일 받기
                          </a>
                        ) : null}
                      </div>
                    </Card.Content>
                  </Card>
                  <Card>
                    <Card.Header className="min-h-16">
                      <Card.Title className={cardTitleClass}>
                        YouTube 업로드
                      </Card.Title>
                      <Card.Description className={cardDescriptionClass}>
                        비공개로 올린 뒤 선택한 시각에 공개합니다.
                      </Card.Description>
                    </Card.Header>
                    <Card.Content className="flex flex-col gap-4">
                      <label className="flex flex-col gap-1.5 text-sm">
                        <span>공개 시각</span>
                        <input
                          type="datetime-local"
                          value={scheduledAt}
                          onChange={(event) =>
                            setScheduledAt(event.currentTarget.value)
                          }
                          className={field}
                        />
                      </label>
                      <p className="text-sm text-muted">
                        권장 공개는 오전 6–9시(기본 7시)입니다.
                        {scheduleInWindow
                          ? ""
                          : ` 예약에는 ${uploadAt.replace("T", " ")}를 넣습니다.`}
                      </p>
                      <div className="flex flex-wrap items-center justify-end gap-3">
                        <Button
                          isDisabled={
                            youtubeBusy
                              ? false
                              : !finalOutputIsCurrent ||
                                !!project.youtubeUploadUrl
                          }
                          onPress={() => void uploadFinalToYoutube()}
                        >
                          <LoadingButtonLabel
                            loading={youtubeBusy}
                            label="YouTube 올리기"
                            loadingLabel="업로드 중"
                          />
                        </Button>
                        {project.youtubeUploadUrl ? (
                          <a
                            className="text-sm underline"
                            href={project.youtubeUploadUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            YouTube에서 열기
                          </a>
                        ) : null}
                      </div>
                    </Card.Content>
                  </Card>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        {note ? <p className="mr-auto text-sm text-muted">{note}</p> : null}
        <Button variant="outline" onPress={onBack}>
          이전
        </Button>
        {mode === "script" ? (
          <Button
            isDisabled={
              busyMatches(busy, "preview")
                ? false
                : buttonBusyDisabled(busy, "preview") ||
                  !project.title ||
                  !project.reportScript ||
                  !titleValid
            }
            onPress={() => {
              if (busyMatches(busy, "preview")) {
                onCancelPreview()
                return
              }
              void createPreviewAndContinue()
            }}
          >
            {busyMatches(busy, "preview")
              ? previewCancelLabel(previewProgress)
              : "미리보기 만들기"}
          </Button>
        ) : null}
        {mode === "direction" ? (
          <Button
            isDisabled={
              busyMatches(busy, "preview")
                ? false
                : buttonBusyDisabled(busy, "preview") ||
                  project.reportScenes.length === 0
            }
            onPress={() => {
              if (busyMatches(busy, "preview")) {
                onCancelPreview()
                return
              }
              void createPreviewAndContinue()
            }}
          >
            {busyMatches(busy, "preview")
              ? previewCancelLabel(previewProgress)
              : "초안 만들기"}
          </Button>
        ) : null}
        {mode === "preview" ? (
          <>
            <Button
              variant="outline"
              isDisabled={busyMatches(busy, "preview") ? false : busy !== ""}
              onPress={() => {
                if (busyMatches(busy, "preview")) {
                  onCancelPreview()
                  return
                }
                const draft = draftProjectForPreview()
                if (!draft) return
                void onPreview(
                  true,
                  {
                    ...draft,
                    subtitleTimingsLocked: Boolean(
                      draft.subtitleTimingsLocked && draft.subtitles.length
                    ),
                  },
                  compositionPane
                )
              }}
            >
              {busyMatches(busy, "preview")
                ? previewCancelLabel(previewProgress)
                : compositionPane === "all"
                  ? "다시 만들기"
                  : `${partPreviewLabel} 다시 만들기`}
            </Button>
            <Button
              isDisabled={
                busy !== "" ||
                Boolean(previewBlockedReason) ||
                !previewIsCurrent
              }
              onPress={onNext}
            >
              다음
            </Button>
          </>
        ) : null}
        {mode === "final" ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">최종 배속</span>
              <select
                aria-label="최종본 배속"
                value={finalPlaybackRate}
                onChange={(event) =>
                  setFinalPlaybackChoice({
                    projectId: project.id,
                    rate: normalizeFinalPlaybackRate(event.currentTarget.value),
                  })
                }
                className="rounded-xl border border-separator bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
              >
                {FINAL_PLAYBACK_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate.toFixed(1)}배
                  </option>
                ))}
              </select>
            </label>
            <Button
              isDisabled={busy !== "" || !previewIsCurrent}
              onPress={() => void render()}
            >
              <LoadingButtonLabel
                loading={busyMatches(busy, "render")}
                label="최종본 만들기"
                loadingLabel="최종본 만드는 중"
              />
            </Button>
          </>
        ) : null}
      </div>
      <Modal isOpen={supplementOpen} onOpenChange={setSupplementOpen}>
        <Modal.Backdrop isDismissable>
          <Modal.Container placement="center" size="lg">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>내용 첨부</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <textarea
                  autoFocus
                  rows={10}
                  maxLength={5000}
                  value={supplementDraft}
                  onChange={(event) =>
                    setSupplementDraft(event.currentTarget.value)
                  }
                  placeholder="대본에서 강조하거나 원본 내용과 연결할 정보를 입력하세요."
                  className={field}
                />
              </Modal.Body>
              <Modal.Footer className="justify-end">
                <Button
                  variant="outline"
                  onPress={() => setSupplementOpen(false)}
                >
                  취소
                </Button>
                <Button
                  onPress={() => {
                    onProject({
                      supplementalContext: supplementDraft
                        .trim()
                        .slice(0, 5000),
                    })
                    setSupplementOpen(false)
                    onNote("첨부 내용을 저장했습니다.")
                  }}
                >
                  저장
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  )
}

const REVIEW_STEP_COPY = {
  script: {
    title: "내용 검수·확정",
  },
  direction: {
    title: "화면 연출",
  },
  preview: {
    title: "초안 검수·수정",
  },
  final: {
    title: "최종본",
  },
} satisfies Record<
  Exclude<NewsClipStep, "issue" | "source" | "angles">,
  { title: string }
>

function ReviewTranscriptSegment({
  segment,
  disabled,
  canMergeNext,
  onSave,
  onMergeNext,
}: {
  segment: TranscriptSegment
  disabled: boolean
  canMergeNext: boolean
  onSave: (text: string) => void
  onMergeNext: () => void
}) {
  const [draft, setDraft] = useState(segment.text)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const normalized = draft.replace(/\s+/g, " ").trim()
  const changed = Boolean(normalized) && normalized !== segment.text

  useLayoutEffect(() => {
    resizeTextareaToContent(textareaRef.current)
  }, [draft])

  return (
    <div className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[92px_minmax(0,1fr)]">
      <span className="pt-2.5 text-xs text-muted tabular-nums">
        {time(segment.start)}–{time(segment.end)}
      </span>
      <div className="flex min-w-0 flex-col gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          disabled={disabled}
          aria-label={`${time(segment.start)} 본문 원문`}
          onChange={(event) => setDraft(event.currentTarget.value)}
          className={`${field} min-h-11 resize-none overflow-hidden leading-6`}
        />
        <div className="flex justify-end gap-2">
          {canMergeNext ? (
            <Button
              size="sm"
              variant="outline"
              isDisabled={disabled || changed}
              onPress={onMergeNext}
            >
              다음 구간과 합치기
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            isDisabled={disabled || !changed}
            onPress={() => onSave(normalized)}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  )
}

function SubtitleLineFields({
  value,
  emphasis,
  characterLimit,
  onFocus,
  onCommit,
}: {
  value: string
  emphasis: string[]
  characterLimit: number
  onFocus: () => void
  onCommit: (value: string, emphasis: string[]) => void
}) {
  const [draft, setDraft] = useState<[string, string]>(() =>
    splitSubtitleLines(value)
  )
  const [emphasisDraft, setEmphasisDraft] = useState(() => emphasis.join(", "))
  const editingRef = useRef(false)
  const safeLimit = Math.max(1, characterLimit)
  const firstLineLength = [...draft[0]].length
  const secondLineLength = [...draft[1]].length
  const firstLineOver = firstLineLength > safeLimit
  const secondLineOver = secondLineLength > safeLimit
  const committedText = commitSubtitleLines(draft[0], draft[1])
  const savedText = commitSubtitleLines(...splitSubtitleLines(value))
  const committedEmphasis = emphasisDraft
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
  const savedEmphasis = emphasis.map((word) => word.trim()).filter(Boolean)
  const dirty =
    committedText !== savedText ||
    committedEmphasis.join("\n") !== savedEmphasis.join("\n")

  useEffect(() => {
    if (editingRef.current) return
    setDraft(splitSubtitleLines(value))
    setEmphasisDraft(emphasis.join(", "))
  }, [emphasis, value])

  function updateLine(index: 0 | 1, nextValue: string) {
    const next: [string, string] = [draft[0], draft[1]]
    next[index] = nextValue
    setDraft(next)
  }

  function commit() {
    editingRef.current = false
    const nextValue = committedText
    setDraft(splitSubtitleLines(nextValue || value))
    setEmphasisDraft(committedEmphasis.join(", "))
    onCommit(nextValue, committedEmphasis)
  }

  return (
    <div
      className="grid min-w-0 items-start gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
      onFocusCapture={() => {
        editingRef.current = true
        onFocus()
      }}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget as Node | null
        if (event.currentTarget.contains(nextTarget)) return
        editingRef.current = false
      }}
    >
      <div className="grid min-w-0 gap-3">
        <label className="flex min-w-0 flex-col gap-2">
          <span className="text-sm">
            1줄 · 최대 {safeLimit}자
            {firstLineOver ? (
              <span className="ml-2 text-danger">폭 초과</span>
            ) : null}
          </span>
          <div className="relative">
            <input
              aria-label="자막 1줄"
              value={draft[0]}
              maxLength={safeLimit}
              onChange={(event) => updateLine(0, event.currentTarget.value)}
              className={`${field} pr-14 ${firstLineOver ? "border-danger" : ""}`}
            />
            <span
              className={`pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs tabular-nums ${firstLineOver ? "text-danger" : "text-muted"}`}
            >
              {firstLineLength}/{safeLimit}
            </span>
          </div>
        </label>
        <label className="flex min-w-0 flex-col gap-2">
          <span className="text-sm">
            2줄 · 선택 · 최대 {safeLimit}자
            {secondLineOver ? (
              <span className="ml-2 text-danger">폭 초과</span>
            ) : null}
          </span>
          <div className="relative">
            <input
              aria-label="자막 2줄"
              value={draft[1]}
              maxLength={safeLimit}
              onChange={(event) => updateLine(1, event.currentTarget.value)}
              className={`${field} pr-14 ${secondLineOver ? "border-danger" : ""}`}
            />
            <span
              className={`pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs tabular-nums ${secondLineOver ? "text-danger" : "text-muted"}`}
            >
              {secondLineLength}/{safeLimit}
            </span>
          </div>
        </label>
      </div>
      <label className="flex min-w-0 flex-col gap-2">
        <span className="text-sm">강조 단어</span>
        <input
          value={emphasisDraft}
          onChange={(event) => setEmphasisDraft(event.currentTarget.value)}
          className={field}
        />
      </label>
      <div className="flex min-h-8 items-center justify-end gap-2 sm:col-span-2">
        {dirty ? <span className="text-xs text-warning">저장 전</span> : null}
        <Button
          size="sm"
          isDisabled={!dirty || firstLineOver || secondLineOver}
          onPress={commit}
        >
          저장
        </Button>
      </div>
    </div>
  )
}

function SceneCropPreview({
  sourceUrl,
  sourceStart,
  sourceEnd,
  crop,
  title,
  subtitle,
  sourceCredit,
  settings,
}: {
  sourceUrl: string
  sourceStart: number
  sourceEnd: number
  crop: CropPosition
  title: string
  subtitle: string
  sourceCredit: string
  settings: NewsClipSettings
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(sourceStart)
  const safeStart = Math.max(0, sourceStart)
  const safeEnd = Math.max(safeStart + 0.1, sourceEnd)

  useEffect(() => {
    const video = videoRef.current
    if (!video?.readyState) return
    video.currentTime = safeStart
    setCurrentTime(safeStart)
  }, [safeStart, sourceUrl])

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-default p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">실시간 화면 미리보기</span>
        <span className="text-xs text-muted tabular-nums">
          {time(safeStart)} → {time(safeEnd)}
        </span>
      </div>
      <NewsFramePreview
        mode="body"
        title={title}
        subtitle={subtitle}
        sourceCredit={sourceCredit}
        settings={settings}
        zoom={crop.zoom}
        className="mx-auto w-full max-w-[260px] rounded-xl shadow-none"
        videoContent={
          <video
            ref={videoRef}
            src={sourceUrl}
            playsInline
            preload="metadata"
            className="size-full object-cover"
            style={{
              transform: `scale(${Math.max(1.02, crop.zoom)})`,
              transformOrigin: `${crop.x}% ${crop.y}%`,
            }}
            onLoadedMetadata={(event) => {
              event.currentTarget.playbackRate = NEWS_SOURCE_PLAYBACK_RATE
              event.currentTarget.currentTime = safeStart
              setCurrentTime(safeStart)
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime >= safeEnd) {
                event.currentTarget.pause()
                event.currentTarget.currentTime = safeStart
              }
              setCurrentTime(event.currentTarget.currentTime)
            }}
          />
        }
      />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          aria-label={playing ? "미리보기 일시정지" : "미리보기 재생"}
          onPress={() => {
            const video = videoRef.current
            if (!video) return
            if (video.paused) {
              if (
                video.currentTime < safeStart ||
                video.currentTime >= safeEnd
              ) {
                video.currentTime = safeStart
              }
              void video.play().catch(() => undefined)
            } else {
              video.pause()
            }
          }}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <input
          aria-label="실시간 화면 미리보기 재생 위치"
          type="range"
          min={safeStart}
          max={safeEnd}
          step={0.1}
          value={Math.max(safeStart, Math.min(safeEnd, currentTime))}
          onChange={(event) => {
            const value = Number(event.currentTarget.value)
            if (videoRef.current) videoRef.current.currentTime = value
            setCurrentTime(value)
          }}
          className="min-w-0 flex-1"
        />
        <span className="shrink-0 text-xs text-muted tabular-nums">
          {time(currentTime)}
        </span>
      </div>
    </div>
  )
}

function SourceRangeTimeline({
  scene,
  sourceId,
  duration,
  onMove,
}: {
  scene: NewsReportScene
  sourceId: string
  duration: number
  onMove: (sourceStart: number, sourceEnd: number) => void
}) {
  const safeDuration = Math.max(0.1, duration, scene.sourceEnd)
  const windowLength = Math.max(
    0.1,
    Math.min(safeDuration, scene.sourceEnd - scene.sourceStart)
  )
  const maxStart = Math.max(0, safeDuration - windowLength)
  const start = Math.max(0, Math.min(scene.sourceStart, maxStart))
  const end = Math.min(safeDuration, start + windowLength)
  const startPercent = (start / safeDuration) * 100
  const endPercent = (end / safeDuration) * 100
  const stripUrl = sourceId
    ? `/api/news-clips/timeline-strip?sourceId=${encodeURIComponent(sourceId)}&v=3`
    : ""

  return (
    <div className="rounded-xl bg-default px-3 py-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">영상 구간</span>
        <span className="text-muted tabular-nums">
          {time(start)} → {time(end)} · {windowLength.toFixed(1)}초 고정
        </span>
      </div>
      <div
        className="relative mt-3 h-12 overflow-hidden rounded-lg bg-neutral-900"
        style={
          stripUrl
            ? {
                backgroundImage: `url("${stripUrl}")`,
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                backgroundSize: "100% 100%",
              }
            : undefined
        }
      >
        <div
          className="absolute inset-y-0 left-0 bg-black/60"
          style={{ width: `${startPercent}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-black/60"
          style={{ width: `${Math.max(0, 100 - endPercent)}%` }}
        />
        <div
          className="absolute inset-y-0 border-y-2 border-foreground/90 bg-white/5"
          style={{
            left: `${startPercent}%`,
            width: `${Math.max(0, endPercent - startPercent)}%`,
          }}
        />
        <input
          aria-label="영상 구간 위치"
          type="range"
          min={0}
          max={maxStart}
          step={0.1}
          value={start}
          onChange={(event) => {
            const nextStart = Math.max(
              0,
              Math.min(maxStart, Number(event.currentTarget.value))
            )
            onMove(nextStart, nextStart + windowLength)
          }}
          className="source-range-input z-10"
        />
      </div>
      <div className="flex justify-between text-xs text-muted tabular-nums">
        <span>{time(0)}</span>
        <span>{time(safeDuration)}</span>
      </div>
    </div>
  )
}

function RangeInput({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  formatValue: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted tabular-nums">{formatValue(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

function ratioPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function screenPercent(value: number) {
  return `${Math.round(value)}%`
}

function axisPosition(value: number, start: string, end: string) {
  const offset = Math.round((value - 50) * 2)
  if (Math.abs(offset) <= 2) return "가운데"
  return offset < 0 ? `${start} ${Math.abs(offset)}%` : `${end} ${offset}%`
}

function snapshotSceneLayout(
  scene: NewsReportScene,
  fallbackCrop: CropPosition
): SceneLayoutDraft {
  return {
    crop: { ...(scene.crop ?? fallbackCrop) },
    sourceStart: scene.sourceStart,
    sourceEnd: scene.sourceEnd,
  }
}

function sceneLayoutFor(
  scene: NewsReportScene,
  project: NewsClipProject,
  drafts: Record<string, SceneLayoutDraft>
) {
  return drafts[scene.id] ?? snapshotSceneLayout(scene, project.crop)
}

function sceneLayoutDirty(
  draft: SceneLayoutDraft,
  scene: NewsReportScene,
  fallbackCrop: CropPosition
) {
  const saved = snapshotSceneLayout(scene, fallbackCrop)
  return (
    draft.sourceStart !== saved.sourceStart ||
    draft.sourceEnd !== saved.sourceEnd ||
    draft.crop.x !== saved.crop.x ||
    draft.crop.y !== saved.crop.y ||
    draft.crop.zoom !== saved.crop.zoom ||
    draft.crop.faceTracking !== saved.crop.faceTracking
  )
}

function snapshotIntroLayout(project: NewsClipProject): IntroLayoutDraft {
  return {
    introStillTimeSeconds: project.introStillTimeSeconds,
    introStillZoom: project.introStillZoom,
    introStillX: project.introStillX,
    introStillY: project.introStillY,
  }
}

function sameIntroLayout(left: IntroLayoutDraft, right: IntroLayoutDraft) {
  return (
    left.introStillTimeSeconds === right.introStillTimeSeconds &&
    left.introStillZoom === right.introStillZoom &&
    left.introStillX === right.introStillX &&
    left.introStillY === right.introStillY
  )
}

function initialSourceDuration(project: NewsClipProject) {
  return Math.max(
    0.1,
    project.source?.durationSeconds ?? 0,
    ...project.candidates.map((candidate) => candidate.sourceEnd),
    ...project.reportScenes.map((scene) => scene.sourceEnd)
  )
}

function resizeTextareaToContent(element: HTMLTextAreaElement | null) {
  if (!element) return
  element.style.height = "auto"
  element.style.height = `${element.scrollHeight}px`
}

function sceneSourceDuration(
  project: NewsClipProject,
  scene: NewsReportScene,
  loadedDuration: number
) {
  const sourceId = scene.sourceId || project.source?.id
  const source = [project.source, ...project.supportingSources].find(
    (item) => item?.id === sourceId
  )
  return Math.max(
    0.1,
    loadedDuration,
    source?.durationSeconds ?? 0,
    scene.sourceEnd
  )
}

function composeIntroTitle(firstLine: string, secondLine: string) {
  return [firstLine.trim(), secondLine.trim()].filter(Boolean).join("\n")
}

function previewCancelLabel(percent: number | null) {
  return percent === null ? "취소" : `취소 · ${percent}%`
}

function previewButtonBlockedReason({
  busy,
  titleValid,
  titleComplete,
  titleDirty,
  reportScriptDirty,
}: {
  busy: string
  titleValid: boolean
  titleComplete: boolean
  titleDirty: boolean
  reportScriptDirty: boolean
}) {
  if (busy !== "") return "다른 작업이 끝나길 기다려 주세요."
  if (!titleComplete) return "인트로 제목 1단·2단을 모두 입력해 주세요."
  if (!titleValid) return "인트로 제목 폭이 초과됐습니다. 길이를 줄여 주세요."
  if (titleDirty) return "제목 변경을 먼저 저장해 주세요."
  if (reportScriptDirty) return "대본 변경을 먼저 저장해 주세요."
  return ""
}

function fittedTitleLines(
  title: string,
  firstLayout: NewsClipSettings["titleCardText"],
  secondFontSize: number
) {
  const savedLines = title
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
  if (savedLines.length >= 2) {
    return [savedLines[0], savedLines.slice(1).join(" ")] as [string, string]
  }
  const fitted = fitTitleToLineLayouts(title, firstLayout, {
    ...firstLayout,
    fontSize: secondFontSize,
  })
  return splitIntroTitleLines(fitted, firstLayout)
}

function time(seconds: number) {
  const minute = Math.floor(seconds / 60)
  return `${String(minute).padStart(2, "0")}:${(seconds - minute * 60)
    .toFixed(1)
    .padStart(4, "0")}`
}
