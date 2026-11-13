"use client"

import {
  type CSSProperties,
  type ChangeEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"

import { Button, Card, Modal } from "@heroui/react"
import {
  ChevronDown,
  FileUp,
  Pause,
  Play,
  RotateCcw,
  Square,
} from "lucide-react"
import { NewsFramePreview } from "@/components/news-clips/frame-preview"
import { SegmentedTabs } from "@/components/news-clips/segmented-tabs"
import { HistorySaveButton } from "@/components/news-clips/history-save-button"
import {
  stepBodyClassName,
  stepHeaderActionButtonClassName,
  stepHeaderActionsClassName,
  stepHeaderClassName,
  type WorkspaceHistorySaveProps,
} from "@/components/news-clips/step-action-bar"
import {
  operationProgressPercent,
  startNewsTaskProgressPolling,
  type NewsOperationProgressMap,
  type UpdateNewsOperationProgress,
} from "@/components/news-clips/task-progress"
import {
  LoadingButtonLabel,
  busyMatches,
  buttonBusyDisabled,
} from "@/components/news-clips/loading-button-label"
import { introStillTime, selectIntroStillRange } from "@/lib/news-clips/intro"
import {
  NEWS_SOURCE_PLAYBACK_RATE,
  scaleQuoteTimelineSeconds,
} from "@/lib/news-clips/playback"
import { newsRenderSettingsKey } from "@/lib/news-clips/render-key"
import {
  NEWS_MEDIA_MOTION_OPTIONS,
  newsMediaMotionAmount,
  normalizeNewsMediaMotion,
} from "@/lib/news-clips/video-fit"
import {
  FINAL_PLAYBACK_RATES,
  normalizeFinalPlaybackRate,
} from "@/lib/news-clips/final-playback"
import {
  buildBuildup2Scenes,
  buildup2HighlightBounds,
} from "@/lib/news-clips/buildup"
import {
  activeManualBodyCuts,
  applyBuildupBodyCuts,
  sourceRangeOverlapsManualCut,
} from "@/lib/news-clips/body-cuts"
import { angleHasLockedRange } from "@/lib/news-clips/angles"
import {
  prepareRenderProject,
  rebuildSubtitlesAfterSceneEdit,
} from "@/lib/news-clips/prepare-render-project"
import { preservePreviewSubtitleEdits } from "@/lib/news-clips/preview-subtitles"
import { sceneAudioTimingChanged } from "@/lib/news-clips/scene-edit"
import { tightenLockedSourceRangeToSpeech } from "@/lib/news-clips/speech-bounds"
import { subtitleCueSourceRange } from "@/lib/news-clips/subtitle-source-range"
import {
  partitionSubtitlesByPart,
  removeTrailingCtaFromLead,
  reportScenePart,
  splitScenesByClipPart,
} from "@/lib/news-clips/clip-parts"
import {
  NEWS_TOTAL_GAP_SECONDS,
  appendEndCtaScenes,
  buildReportScenes,
  ensureReportEndCta,
  estimateReportScenesDuration,
  isEndCtaScene,
  reportSceneAudioMode,
  reportSceneVisualMode,
  shortBreathReviewTranscript,
  splitEndCtaFromScript,
} from "@/lib/news-clips/report"
import {
  projectSourceCreditText,
  sourceCreditInputText,
} from "@/lib/news-clips/source-credit"
import {
  canMergeSubtitleCueWithNext,
  canUndoSubtitleCueMerge,
  fitTitleToLineLayouts,
  mergeSubtitleCueWithNext,
  resetEditedSubtitleCue,
  splitIntroTitleLines,
  subtitleCharacterCount,
  subtitleLineCharacterLimit,
  titleLineCharacterLimit,
  titleLineFits,
  undoSubtitleCueMerge,
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
  NewsMediaMotion,
  NewsPreviewPart,
  NewsReportScene,
  NewsSource,
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
  motion: NewsMediaMotion
}

/** 파일 첨부 전 구간 화면 — 초기화 시 이 상태로 되돌린다. */
type SceneVisualBaseline = {
  sourceId?: string
  visual: NewsReportScene["visual"]
  visualMode?: NewsReportScene["visualMode"]
  sourceStart: number
  sourceEnd: number
  crop?: CropPosition
  motion?: NewsMediaMotion
}

type IntroLayoutDraft = {
  introStillTimeSeconds: number | null
  introStillZoom: number
  introStillX: number
  introStillY: number
  introMotion: NewsMediaMotion
}

/** 파일 첨부 전 인트로 화면 — 초기화 시 이 상태로 되돌린다. */
type IntroVisualBaseline = {
  introSourceId: string
  layout: IntroLayoutDraft
}

type VisualUploadTarget = { type: "intro" } | { type: "scene"; sceneId: string }

/** 위치 슬라이더: 중앙(50)이 기본, 좌·우/위·아래 각 200%. */
const POSITION_SLIDER_MIN = -50
const POSITION_SLIDER_MAX = 150
const POSITION_SLIDER_CENTER = 50

/** 확대 슬라이더: 중앙(1)이 1:1, 축소·확대 각 200%(1/3~3배). */
const ZOOM_SLIDER_MIN = 1 / 3
const ZOOM_SLIDER_MAX = 3
const ZOOM_SLIDER_CENTER = 1

/** 사용자 첨부·공개 자료 화면의 기본 구도(1:1). */
const NEUTRAL_SCENE_CROP: CropPosition = {
  x: POSITION_SLIDER_CENTER,
  y: POSITION_SLIDER_CENTER,
  zoom: ZOOM_SLIDER_CENTER,
  faceTracking: false,
}

/** 원본 푸티지로 되돌릴 때 쓰는 기본 구도(1:1). */
const DEFAULT_SOURCE_SCENE_CROP: CropPosition = {
  x: POSITION_SLIDER_CENTER,
  y: POSITION_SLIDER_CENTER,
  zoom: ZOOM_SLIDER_CENTER,
  faceTracking: false,
}

function sceneUsesCustomVisual(
  scene: NewsReportScene,
  project: Pick<NewsClipProject, "source">
) {
  const mainId = project.source?.id
  if (scene.sourceId && mainId && scene.sourceId !== mainId) return true
  return reportSceneVisualMode(scene) === "supporting"
}

function previewFootageZoom(
  _scene: NewsReportScene | undefined,
  zoom: number
) {
  // 슬라이더 중앙(1:1)을 기준으로 축소·확대를 그대로 반영한다.
  return Math.max(ZOOM_SLIDER_MIN, Math.min(ZOOM_SLIDER_MAX, zoom))
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
  _project: NewsClipProject,
  subtitles: NewsClipProject["subtitles"]
) {
  // 4번은 확정된 음성·영상 타임라인 위의 자막 오버레이 편집 단계다.
  // 서두/마무리 자막을 고쳐도 TTS 대본이나 장면 길이를 다시 만들지 않는다.
  return { subtitles, subtitleTimingsLocked: true }
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
  operationProgress,
  onProject,
  onSettings,
  onBusy,
  onNote,
  onPreview,
  onCancelPreview,
  onReselect,
  onFinalized,
  onNext,
  onPrepareVisualAssets,
  onOperationProgress,
  historySave,
}: {
  mode: ReviewMode
  project: NewsClipProject
  settings: NewsClipSettings
  note: string
  busy: string
  previewProgress: number | null
  operationProgress: NewsOperationProgressMap
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
  onPrepareVisualAssets: (project: NewsClipProject) => Promise<boolean>
  onOperationProgress: UpdateNewsOperationProgress
  historySave: WorkspaceHistorySaveProps
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
  const [deletedBodyCutsOpen, setDeletedBodyCutsOpen] = useState(false)
  const [supplementDraft, setSupplementDraft] = useState(
    project.supplementalContext
  )
  const [sourceCreditChoice, setSourceCreditChoice] = useState(() => {
    const value = project.sourceCredit ?? sourceCreditInputText(project.source)
    return { projectId: project.id, savedValue: value, value }
  })
  const editingTitleRef = useRef(false)
  const editingReportScriptRef = useRef(false)
  const scriptReviewDirtyRef = useRef(false)
  const reportScriptTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [selectedSubtitleId, setSelectedSubtitleId] = useState("")
  const [remakingPreviewPart, setRemakingPreviewPart] =
    useState<NewsPreviewPart | null>(null)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voicePlaying, setVoicePlaying] = useState(false)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false)
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
  const [scheduledAtChoice, setScheduledAtChoice] = useState(() => ({
    projectId: project.id,
    savedAt: project.youtubeScheduledAt,
    value: project.youtubeScheduledAt || nextKoreaUploadSlot(),
  }))
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null)
  const scriptFrameVideoRef = useRef<HTMLVideoElement | null>(null)
  const directionVideoRef = useRef<HTMLVideoElement | null>(null)
  const renderedVideoRef = useRef<HTMLVideoElement | null>(null)
  const visualFileInputRef = useRef<HTMLInputElement | null>(null)
  const visualUploadTargetRef = useRef<VisualUploadTarget | null>(null)
  const [visualUploadBusy, setVisualUploadBusy] = useState("")
  const [selectedDirectionSceneId, setSelectedDirectionSceneId] = useState("")
  const [directionPlaying, setDirectionPlaying] = useState(false)
  const [directionCurrentTime, setDirectionCurrentTime] = useState(0)
  const [sceneLayoutDrafts, setSceneLayoutDrafts] = useState<
    Record<string, SceneLayoutDraft>
  >({})
  const [sceneVisualBaselines, setSceneVisualBaselines] = useState<
    Record<string, SceneVisualBaseline>
  >({})
  const [introLayoutDraft, setIntroLayoutDraft] =
    useState<IntroLayoutDraft | null>(null)
  const [introVisualBaseline, setIntroVisualBaseline] =
    useState<IntroVisualBaseline | null>(null)
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
    initialIntroSourceDuration(project)
  )
  const [directionSourceMetadata, setDirectionSourceMetadata] = useState({
    url: "",
    duration: 0,
  })
  const sourceVideoUrl = project.source?.id
    ? `/api/news-clips/source-file?sourceId=${encodeURIComponent(project.source.id)}`
    : ""
  const sourceForId = (sourceId?: string) =>
    [project.source, ...project.supportingSources].find(
      (source) => source?.id === (sourceId || project.source?.id)
    ) ?? project.source
  const sourceVideoUrlFor = (sourceId?: string) => {
    const resolvedId = sourceForId(sourceId)?.id
    return resolvedId
      ? `/api/news-clips/source-file?sourceId=${encodeURIComponent(resolvedId)}`
      : sourceVideoUrl
  }
  const sourceTitleFor = (sourceId?: string) =>
    sourceForId(sourceId)?.title || "핵심 원본"
  const savedSourceCredit =
    project.sourceCredit ?? sourceCreditInputText(project.source)
  const sourceCreditDraft =
    sourceCreditChoice.projectId === project.id &&
    sourceCreditChoice.savedValue === savedSourceCredit
      ? sourceCreditChoice.value
      : savedSourceCredit
  const setSourceCreditDraft = (value: string) =>
    setSourceCreditChoice({
      projectId: project.id,
      savedValue: savedSourceCredit,
      value,
    })
  const commonSourceCreditText = projectSourceCreditText(
    sourceCreditDraft
  )
  const sourceCreditDirty =
    sourceCreditDraft.trim() !== savedSourceCredit.trim()
  const directionSourceVideoUrl = sourceVideoUrlFor(
    previewDirectionScene?.sourceId
  )
  const scriptBodyVideoUrl = sourceVideoUrl
  const introVideoUrl = sourceVideoUrlFor(
    project.introSourceId || project.source?.id
  )
  const introUsesUploadedVisual = Boolean(
    project.introSourceId &&
      sourceForId(project.introSourceId)?.channel === "사용자 첨부"
  )
  // 이미지 인트로만 전체를 보이고, 영상 인트로는 프레임을 채운다.
  const introMediaIsImage =
    sourceForId(project.introSourceId || project.source?.id)?.mediaType ===
    "image"
  const introMediaFitClass = introMediaIsImage
    ? "size-full object-contain bg-black transition-transform"
    : "size-full object-cover transition-transform"
  const introMediaZoom = Math.max(
    1,
    Math.min(ZOOM_SLIDER_MAX, introLayout.introStillZoom)
  )
  const introMotionPreviewStyle = {
    ...mediaMotionStyle(
      introLayout.introMotion,
      introMediaZoom,
      project.titleCardDurationSeconds || 2.8
    ),
    transformOrigin: `${introLayout.introStillX}% ${introLayout.introStillY}%`,
  }
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
  const selectedAngle = project.angleOptions.find(
    (angle) => angle.id === project.selectedAngleId
  )
  const rawLockedAngleBounds =
    project.productionMode === "buildup2" &&
    selectedAngle &&
    angleHasLockedRange(selectedAngle)
      ? {
          start: Math.min(selectedAngle.sourceStart, selectedAngle.sourceEnd),
          end: Math.max(selectedAngle.sourceStart, selectedAngle.sourceEnd),
        }
      : null
  const lockedAngleBounds = rawLockedAngleBounds
    ? tightenLockedSourceRangeToSpeech(
        rawLockedAngleBounds.start,
        rawLockedAngleBounds.end,
        project.transcript
      )
    : null
  const rawBodyReviewBounds = selectedCandidate
    ? buildup2HighlightBounds(
        project.reportScenes,
        selectedCandidate.sourceStart,
        selectedCandidate.sourceEnd
      )
    : null
  // 2번에서 확정한 전체 내용 범위가 3번 검수의 절대 경계다.
  // 저장된 예전 scene 범위가 엇갈려 있어도 교집합을 뒤집지 않고 이 범위를 쓴다.
  const bodyReviewBounds = lockedAngleBounds
    ? lockedAngleBounds
    : rawBodyReviewBounds &&
        Number.isFinite(rawBodyReviewBounds.start) &&
        Number.isFinite(rawBodyReviewBounds.end) &&
        rawBodyReviewBounds.end > rawBodyReviewBounds.start
      ? tightenLockedSourceRangeToSpeech(
          rawBodyReviewBounds.start,
          rawBodyReviewBounds.end,
          project.transcript
        )
      : null
  const bodyReviewStart = bodyReviewBounds?.start
  const bodyReviewEnd = bodyReviewBounds?.end
  const bodyReviewSegments = bodyReviewBounds
    ? project.transcript.filter((segment) => {
        const speech = transcriptSegmentSpeechBounds(segment)
        return (
          speech.end > bodyReviewBounds.start + 0.01 &&
          speech.start < bodyReviewBounds.end - 0.01
        )
      })
    : []
  const activeBodyCuts = bodyReviewBounds
    ? activeManualBodyCuts(project.removedRanges, bodyReviewBounds)
    : []
  const visibleBodyReviewSegments = bodyReviewSegments.filter((segment) => {
    const speech = transcriptSegmentSpeechBounds(segment)
    return !sourceRangeOverlapsManualCut(
      speech.start,
      speech.end,
      activeBodyCuts
    )
  })
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
  const finalOutputReady = Boolean(project.outputUrl || project.youtubeVideoId)
  const previewSubtitles = project.subtitles
  const savedScheduledAt = project.youtubeScheduledAt || nextKoreaUploadSlot()
  const scheduledAtDraft =
    scheduledAtChoice.projectId === project.id &&
    scheduledAtChoice.savedAt === project.youtubeScheduledAt
      ? scheduledAtChoice.value
      : savedScheduledAt
  const scheduledAtDirty = scheduledAtDraft !== savedScheduledAt
  const busyProgress = operationProgressPercent(operationProgress, busy)
  const voiceProgress = operationProgressPercent(
    operationProgress,
    "voice-preview"
  )
  const renderProgress = operationProgressPercent(operationProgress, "render")
  const youtubeProgress = operationProgressPercent(
    operationProgress,
    "youtube-upload"
  )
  const finalRenderProgress = settings.youtubeAutoUpload
    ? youtubeBusy
      ? 80 + Math.round(((youtubeProgress ?? 0) * 20) / 100)
      : renderProgress === null
        ? null
        : Math.round((renderProgress * 80) / 100)
    : renderProgress
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
      subtitleLineCharacterLimit(settings.bodySubtitleText)
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

  function selectDirectionScene(
    sceneId: string,
    sourceStart: number,
    options?: { toggle?: boolean }
  ) {
    if (options?.toggle && selectedDirectionSceneId === sceneId) {
      setSelectedDirectionSceneId("")
      return
    }
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
          motion: patch.motion ?? baseline.motion,
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
      motion: draft.motion,
    })
    setSceneLayoutDrafts((current) => {
      const next = { ...current }
      delete next[scene.id]
      return next
    })
  }

  /** 현재 구간 화면(확대·크롭)을 같은 파트 다른 구간에도 저장한다. */
  function saveSceneLayoutCropToPart(scene: NewsReportScene) {
    const draft = sceneLayoutFor(scene, project, sceneLayoutDrafts)
    const part = reportScenePart(scene, project.productionMode)
    const targetScenes = project.reportScenes.filter(
      (item) => reportScenePart(item, project.productionMode) === part
    )
    if (targetScenes.length <= 1) {
      saveSceneLayout(scene)
      return
    }
    selectDirectionScene(scene.id, draft.sourceStart)
    const crop = { ...draft.crop }
    const reportScenes = project.reportScenes.map((item) => {
      if (reportScenePart(item, project.productionMode) !== part) return item
      if (item.id === scene.id) {
        return {
          ...item,
          crop,
          sourceStart: draft.sourceStart,
          sourceEnd: draft.sourceEnd,
          motion: draft.motion,
        }
      }
      return { ...item, crop: { ...crop } }
    })
    onProject({
      reportScenes,
      subtitles: project.subtitles,
      subtitleTimingsLocked: project.subtitleTimingsLocked,
      renderSignature: "",
    })
    setSceneLayoutDrafts((current) => {
      const next = { ...current }
      delete next[scene.id]
      for (const target of targetScenes) {
        if (target.id === scene.id) continue
        const existing = next[target.id]
        if (!existing) continue
        const withCrop = { ...target, crop }
        const merged = { ...existing, crop: { ...crop } }
        if (sceneLayoutDirty(merged, withCrop, project.crop)) {
          next[target.id] = merged
        } else {
          delete next[target.id]
        }
      }
      return next
    })
    const partLabel =
      part === "lead" ? "서두" : part === "outro" ? "마무리" : "본문"
    onNote(
      `${partLabel} 구간 ${targetScenes.length}개에 화면 설정을 동일하게 저장했습니다.`
    )
  }

  function resetSceneLayout(sceneId: string) {
    setSceneLayoutDrafts((current) => {
      const next = { ...current }
      delete next[sceneId]
      return next
    })
    const scene = project.reportScenes.find((item) => item.id === sceneId)
    const baseline = sceneVisualBaselines[sceneId]
    const restore = baseline
      ? {
          sourceId: baseline.sourceId,
          visual: baseline.visual,
          visualMode: baseline.visualMode,
          sourceStart: baseline.sourceStart,
          sourceEnd: baseline.sourceEnd,
          crop: baseline.crop ? { ...baseline.crop } : undefined,
          motion: normalizeNewsMediaMotion(baseline.motion),
        }
      : scene && sceneUsesCustomVisual(scene, project)
        ? {
            sourceId: project.source?.id,
            visual: "source" as const,
            visualMode: "source" as const,
            sourceStart: 0,
            sourceEnd: Math.max(
              0.5,
              Math.min(
                Math.max(0.5, scene.sourceEnd - scene.sourceStart),
                project.source?.durationSeconds || 12
              )
            ),
            crop: { ...(project.crop ?? DEFAULT_SOURCE_SCENE_CROP) },
            motion: "none" as const,
          }
        : null
    if (!restore) return
    onProject((current) => ({
      reportScenes: current.reportScenes.map((item) =>
        item.id === sceneId
          ? {
              ...item,
              sourceId: restore.sourceId,
              visual: restore.visual,
              visualMode: restore.visualMode,
              sourceStart: restore.sourceStart,
              sourceEnd: restore.sourceEnd,
              crop: restore.crop ? { ...restore.crop } : item.crop,
              motion: restore.motion,
            }
          : item
      ),
      subtitles: current.subtitles,
      subtitleTimingsLocked: current.subtitleTimingsLocked,
      renderSignature: "",
    }))
    setSceneVisualBaselines((current) => {
      const next = { ...current }
      delete next[sceneId]
      return next
    })
    onNote("첨부 파일을 제거하고 원본 화면으로 되돌렸습니다.")
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
    if (project.introSourceId) {
      onProject((current) => ({
        introSourceId: "",
        introMotion: "zoom-in",
        introStillTimeSeconds: null,
        subtitles: current.subtitles,
        subtitleTimingsLocked: current.subtitleTimingsLocked,
        renderSignature: "",
      }))
      setIntroLayoutDraft(null)
      setSourceDuration(
        initialIntroSourceDuration({ ...project, introSourceId: "" })
      )
      setFrameMode("title")
      return
    }
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
      introMotion: draft.introMotion,
      subtitleTimingsLocked: project.subtitleTimingsLocked,
      renderSignature: "",
    })
    setIntroLayoutDraft(null)
  }

  function resetIntroLayout() {
    const baseline = introVisualBaseline
    if (baseline || project.introSourceId) {
      const restoreSourceId = baseline?.introSourceId ?? ""
      const restoreLayout = baseline?.layout ?? {
        introStillTimeSeconds: null,
        introStillZoom: 1,
        introStillX: 50,
        introStillY: 50,
        introMotion: "zoom-in",
      }
      onProject((current) => ({
        introSourceId: restoreSourceId,
        introStillTimeSeconds: restoreLayout.introStillTimeSeconds,
        introStillZoom: restoreLayout.introStillZoom,
        introStillX: restoreLayout.introStillX,
        introStillY: restoreLayout.introStillY,
        introMotion: restoreLayout.introMotion,
        subtitles: current.subtitles,
        subtitleTimingsLocked: current.subtitleTimingsLocked,
        renderSignature: "",
      }))
      setIntroLayoutDraft(null)
      setIntroVisualBaseline(null)
      setSourceDuration(
        initialIntroSourceDuration({
          ...project,
          introSourceId: restoreSourceId,
        })
      )
      const restoreTime =
        restoreLayout.introStillTimeSeconds ?? automaticIntroTime
      if (sourceVideoRef.current) {
        sourceVideoRef.current.currentTime = restoreTime
      }
      onNote("첨부 파일을 제거하고 원본 인트로로 되돌렸습니다.")
      return
    }
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
    const timelineChanged = base.reportScenes.some((scene) => {
      const draft = sceneLayoutDrafts[scene.id]
      return draft
        ? sceneAudioTimingChanged(base.productionMode, scene, draft)
        : false
    })
    const reportScenes = base.reportScenes.map((scene) => {
      const draft = sceneLayoutDrafts[scene.id]
      if (!draft) return scene
      return {
        ...scene,
        crop: draft.crop,
        sourceStart: draft.sourceStart,
        sourceEnd: draft.sourceEnd,
        motion: draft.motion,
      }
    })
    const next: NewsClipProject = {
      ...base,
      reportScenes,
      introStillTimeSeconds: intro.introStillTimeSeconds,
      introStillZoom: intro.introStillZoom,
      introStillX: intro.introStillX,
      introStillY: intro.introStillY,
      introMotion: intro.introMotion,
      subtitleTimingsLocked: timelineChanged
        ? false
        : base.subtitleTimingsLocked,
      editorialRevision: base.editorialRevision + 1,
      updatedAt: new Date().toISOString(),
      renderSignature: "",
    }
    onProject({
      reportScenes: next.reportScenes,
      introStillTimeSeconds: next.introStillTimeSeconds,
      introStillZoom: next.introStillZoom,
      introStillX: next.introStillX,
      introStillY: next.introStillY,
      introMotion: next.introMotion,
      subtitleTimingsLocked: next.subtitleTimingsLocked,
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

  function saveCommonSourceCredit() {
    const sourceCredit = sourceCreditDraft.replace(/\s+/g, " ").trim()
    setSourceCreditChoice({
      projectId: project.id,
      savedValue: sourceCredit,
      value: sourceCredit,
    })
    onProject({ sourceCredit })
    onNote("공통 출처를 저장했습니다. 다시 만들면 모든 화면에 적용됩니다.")
  }

  function deleteBodySourceRange(input: {
    id: string
    start: number
    end: number
    label: string
    caption?: NewsClipProject["subtitles"][number]
  }) {
    if (!bodyReviewBounds || project.productionMode !== "buildup2") return
    const start = Math.max(bodyReviewBounds.start, input.start)
    const end = Math.min(bodyReviewBounds.end, input.end)
    if (end - start < 0.1) {
      onNote("삭제할 본문 구간이 너무 짧습니다.")
      return
    }
    const reusable = project.removedRanges.find(
      (range) =>
        range.reason === "manual" &&
        range.restored &&
        Math.abs(range.start - start) < 0.02 &&
        Math.abs(range.end - end) < 0.02
    )
    const removedRanges = reusable
      ? project.removedRanges.map((range) =>
          range.id === reusable.id ? { ...range, restored: false } : range
        )
      : [
          ...project.removedRanges,
          {
            id: `manual-body-${input.id}-${Math.round(start * 1000)}-${Math.round(end * 1000)}`,
            start,
            end,
            reason: "manual" as const,
            restored: false,
          },
        ]
    const plan = applyBuildupBodyCuts(
      project.reportScenes,
      bodyReviewBounds,
      removedRanges,
      {
        primarySourceId: project.source?.id ?? "",
        templates: project.reportScenes,
      }
    )
    if (plan.reason) {
      onNote(
        plan.reason === "body-cut-removes-all"
          ? "본문 전체는 삭제할 수 없습니다. 하나 이상의 구간을 남겨 주세요."
          : "본문 삭제 구간을 적용하지 못했습니다."
      )
      return
    }
    const deletedOutputSeconds = scaleQuoteTimelineSeconds(end - start)
    const deletedCaptionEnd = input.caption?.end ?? Number.POSITIVE_INFINITY
    const subtitles = input.caption
      ? project.subtitles.flatMap((cue) => {
          const cueSourceRange = subtitleCueSourceRange(
            cue,
            project.reportScenes,
            project.transcript,
            settings.bodySubtitleText
          )
          if (
            cue.id === input.caption?.id ||
            (cueSourceRange &&
              cueSourceRange.end > start + 0.001 &&
              cueSourceRange.start < end - 0.001)
          ) {
            return []
          }

          let sceneId = cue.sceneId
          if (cueSourceRange) {
            const sourceScene = project.reportScenes.find(
              (scene) => scene.id === cue.sceneId
            )
            const midpoint = (cueSourceRange.start + cueSourceRange.end) / 2
            const nextScene = plan.scenes.find(
              (scene) =>
                reportSceneAudioMode(scene) === "original" &&
                (!sourceScene?.sourceId ||
                  !scene.sourceId ||
                  scene.sourceId === sourceScene.sourceId) &&
                midpoint >= scene.sourceStart - 0.001 &&
                midpoint <= scene.sourceEnd + 0.001
            )
            if (!nextScene) return []
            sceneId = nextScene.id
          }

          const shift =
            (cueSourceRange && cueSourceRange.start >= end - 0.001) ||
            (!cueSourceRange && cue.start >= deletedCaptionEnd - 0.001)
              ? deletedOutputSeconds
              : 0
          return [
            {
              ...cue,
              sceneId,
              start: Math.max(0, cue.start - shift),
              end: Math.max(0.04, cue.end - shift),
            },
          ]
        })
      : []
    onProject({
      removedRanges,
      keepRanges: plan.keepRanges,
      reportScenes: plan.scenes,
      subtitles,
      subtitleTimingsLocked: false,
      renderSignature: "",
    })
    onNote(
      `${input.label} ${time(start)}–${time(end)} 구간을 삭제했습니다. 미리보기를 다시 만들면 영상·음성·자막에 함께 반영됩니다.`
    )
  }

  function deleteBodyTranscriptRange(segment: TranscriptSegment) {
    const speech = transcriptSegmentSpeechBounds(segment)
    deleteBodySourceRange({
      id: segment.id,
      start: speech.start,
      end: speech.end,
      label: "본문",
    })
  }

  function deleteBodySubtitleRange(
    caption: NewsClipProject["subtitles"][number]
  ) {
    const sourceRange = subtitleCueSourceRange(
      caption,
      project.reportScenes,
      project.transcript,
      settings.bodySubtitleText
    )
    if (!sourceRange) {
      onNote("이 자막의 원본 영상 구간을 찾지 못했습니다.")
      return
    }
    deleteBodySourceRange({
      id: caption.id,
      start: sourceRange.start,
      end: sourceRange.end,
      label: "선택한",
      caption,
    })
  }

  function canDeleteBodySubtitleRange(
    caption: NewsClipProject["subtitles"][number]
  ) {
    if (
      mode !== "preview" ||
      compositionPane !== "body" ||
      project.productionMode !== "buildup2" ||
      !caption.sceneId
    ) {
      return false
    }
    const scene = project.reportScenes.find(
      (item) => item.id === caption.sceneId
    )
    return Boolean(scene && reportSceneAudioMode(scene) === "original")
  }

  function restoreBodyTranscriptRange(rangeId: string) {
    if (!bodyReviewBounds || project.productionMode !== "buildup2") return
    const removedRanges = project.removedRanges.map((range) =>
      range.id === rangeId ? { ...range, restored: true } : range
    )
    const plan = applyBuildupBodyCuts(
      project.reportScenes,
      bodyReviewBounds,
      removedRanges,
      {
        primarySourceId: project.source?.id ?? "",
        templates: project.reportScenes,
      }
    )
    if (plan.reason) {
      onNote("삭제 구간을 복원하지 못했습니다.")
      return
    }
    onProject({
      removedRanges,
      keepRanges: plan.keepRanges,
      reportScenes: plan.scenes,
      subtitles: [],
      subtitleTimingsLocked: false,
      renderSignature: "",
    })
    onNote("삭제한 본문 구간을 복원했습니다.")
  }

  function updateReportScene(
    sceneId: string,
    patch: Partial<NewsClipProject["reportScenes"][number]>
  ) {
    const currentScene = project.reportScenes.find(
      (scene) => scene.id === sceneId
    )
    const reportScenes = project.reportScenes.map((scene) =>
      scene.id === sceneId ? { ...scene, ...patch } : scene
    )
    const changesAudioTimeline = currentScene
      ? sceneAudioTimingChanged(project.productionMode, currentScene, patch)
      : false
    if (!changesAudioTimeline) {
      onProject({
        reportScenes,
        subtitles: project.subtitles,
        subtitleTimingsLocked: project.subtitleTimingsLocked,
        renderSignature: "",
      })
      return
    }
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

  function chooseVisualFile(target: VisualUploadTarget) {
    if (visualUploadBusy) return
    visualUploadTargetRef.current = target
    if (visualFileInputRef.current) {
      visualFileInputRef.current.value = ""
      visualFileInputRef.current.click()
    }
  }

  async function uploadVisualFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    const target = visualUploadTargetRef.current
    event.currentTarget.value = ""
    visualUploadTargetRef.current = null
    if (!file || !target) return

    const targetKey = target.type === "intro" ? "intro" : target.sceneId
    setVisualUploadBusy(targetKey)
    onNote("")
    try {
      const durationPromise = uploadedVisualDuration(file)
      const form = new FormData()
      form.set("file", file)
      form.set("title", file.name.replace(/\.[^.]+$/, ""))
      form.set("channel", "사용자 첨부")
      const response = await fetch("/api/news-clips/source", {
        method: "POST",
        body: form,
      })
      const body = (await response.json().catch(() => null)) as
        (Partial<NewsSource> & { message?: string }) | null
      if (!response.ok || !body?.id || !body.localFile) {
        throw new Error(body?.message || "파일을 첨부하지 못했습니다.")
      }
      const detectedDuration = await durationPromise
      const source = {
        ...(body as NewsSource),
        durationSeconds:
          body.durationSeconds && body.durationSeconds > 0
            ? body.durationSeconds
            : detectedDuration,
      }

      if (target.type === "intro") {
        setIntroVisualBaseline((current) =>
          current ?? {
            introSourceId: project.introSourceId,
            layout: snapshotIntroLayout(project),
          }
        )
        onProject((current) => ({
          supportingSources: appendSupportingSource(
            current.supportingSources,
            source
          ),
          introSourceId: source.id,
          introStillTimeSeconds: null,
          // 첨부는 확대 없이 원본 구도로 넣고, 확대·위치는 사용자가 따로 맞춘다.
          introStillZoom: 1,
          introStillX: 50,
          introStillY: 50,
          introMotion: "none",
          subtitles: current.subtitles,
          subtitleTimingsLocked: current.subtitleTimingsLocked,
          renderSignature: "",
        }))
        setIntroLayoutDraft(null)
        setSourceDuration(Math.max(0.1, source.durationSeconds || 12))
        onNote("인트로 화면을 첨부 파일로 교체했습니다.")
        return
      }

      const scene = project.reportScenes.find(
        (item) => item.id === target.sceneId
      )
      if (!scene) {
        throw new Error("화면 구간을 다시 선택해 주세요.")
      }
      const part = reportScenePart(scene, project.productionMode)
      const sourceEnd = Math.max(0.5, source.durationSeconds || 12)
      setSceneVisualBaselines((current) => {
        if (current[target.sceneId]) return current
        return {
          ...current,
          [target.sceneId]: {
            sourceId: scene.sourceId,
            visual: scene.visual,
            visualMode: scene.visualMode,
            sourceStart: scene.sourceStart,
            sourceEnd: scene.sourceEnd,
            crop: scene.crop ? { ...scene.crop } : undefined,
            motion: scene.motion,
          },
        }
      })
      onProject((current) => ({
        supportingSources: appendSupportingSource(
          current.supportingSources,
          source
        ),
        reportScenes: current.reportScenes.map((item) =>
          item.id === target.sceneId
            ? {
                ...item,
                sourceId: source.id,
                visual: "source",
                visualMode: "supporting",
                sourceStart: 0,
                sourceEnd,
                // 첨부는 확대 없이 원본 구도로 넣고, 확대·위치는 사용자가 따로 맞춘다.
                crop: { ...NEUTRAL_SCENE_CROP },
                motion: "none",
              }
            : item
        ),
        subtitles: current.subtitles,
        subtitleTimingsLocked: current.subtitleTimingsLocked,
        renderSignature: "",
      }))
      setSceneLayoutDrafts((current) => {
        const next = { ...current }
        delete next[target.sceneId]
        return next
      })
      const partLabel =
        part === "lead" ? "서두" : part === "outro" ? "마무리" : "본문"
      onNote(`${partLabel} 화면을 첨부 파일로 교체했습니다.`)
    } catch (error) {
      onNote(
        error instanceof Error ? error.message : "파일을 첨부하지 못했습니다."
      )
    } finally {
      setVisualUploadBusy("")
    }
  }

  async function previewVoice() {
    stopVoicePreview()
    const progressKey = "voice-preview"
    const runId = crypto.randomUUID()
    onOperationProgress(progressKey, runId, 1)
    const stopProgressPolling = startNewsTaskProgressPolling(runId, (percent) =>
      onOperationProgress(progressKey, runId, percent)
    )
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
          jobId: runId,
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
      onOperationProgress(progressKey, runId, 100)
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
      stopProgressPolling()
      onOperationProgress(progressKey, runId, null)
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
    const progressKey = "render"
    const runId = crypto.randomUUID()
    onOperationProgress(progressKey, runId, 1)
    const stopProgressPolling = startNewsTaskProgressPolling(runId, (percent) =>
      onOperationProgress(progressKey, runId, percent)
    )
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
          jobId: runId,
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
      onOperationProgress(progressKey, runId, 100)
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
        subtitles: preservePreviewSubtitleEdits(
          project.subtitles,
          body.subtitles,
          project.subtitleTimingsLocked
        ),
        subtitleTimingsLocked: true,
        reportScenes: body.reportScenes ?? project.reportScenes,
        finalRevision: project.editorialRevision,
        youtubeVideoId: "",
        youtubeUploadUrl: "",
      }
      let finalizedProject = { ...project, ...patch }
      let youtubeThumbnailApplied: boolean | null = null
      if (settings.youtubeAutoUpload) {
        const uploaded = await uploadYoutube(
          finalizedProject,
          scheduleForUpload(finalizedProject.youtubeScheduledAt)
        )
        if (uploaded) {
          youtubeThumbnailApplied = uploaded.thumbnailApplied
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
            ? youtubeThumbnailApplied === false
              ? "최종본은 업로드했지만 첫 화면 썸네일은 적용하지 못했습니다."
              : "첫 화면을 썸네일로 적용해 YouTube에 예약 업로드했습니다."
            : body.message || "최종본을 만들었습니다."
          : "영상은 완성했지만 저장하지 못했습니다."
      )
      return true
    } catch {
      onNote("최종 렌더링을 시작하지 못했습니다.")
      return false
    } finally {
      onBusy("")
      stopProgressPolling()
      onOperationProgress(progressKey, runId, null)
    }
  }

  async function uploadYoutube(
    target = project,
    publishAt = scheduleForUpload(
      target.youtubeScheduledAt || nextKoreaUploadSlot()
    )
  ) {
    const progressKey = "youtube-upload"
    const runId = crypto.randomUUID()
    onOperationProgress(progressKey, runId, 1)
    const stopProgressPolling = startNewsTaskProgressPolling(runId, (percent) =>
      onOperationProgress(progressKey, runId, percent)
    )
    setYoutubeBusy(true)
    try {
      const response = await fetch("/api/news-clips/upload/youtube", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project: target,
          scheduledAt: publishAt,
          jobId: runId,
        }),
      })
      const body = (await response.json()) as {
        message?: string
        videoId?: string
        url?: string
        thumbnailApplied?: boolean
      }
      if (!response.ok || !body.videoId || !body.url) {
        onNote(body.message || "YouTube에 업로드하지 못했습니다.")
        return null
      }
      onOperationProgress(progressKey, runId, 100)
      return {
        videoId: body.videoId,
        url: body.url,
        thumbnailApplied: body.thumbnailApplied === true,
      }
    } catch {
      onNote("YouTube에 업로드하지 못했습니다.")
      return null
    } finally {
      setYoutubeBusy(false)
      stopProgressPolling()
      onOperationProgress(progressKey, runId, null)
    }
  }

  async function uploadFinalToYoutube() {
    const reuploading = Boolean(project.youtubeUploadUrl)
    const youtubeScheduledAt = scheduledAtDraft.trim() || savedScheduledAt
    const targetProject = { ...project, youtubeScheduledAt }
    if (youtubeScheduledAt !== project.youtubeScheduledAt) {
      onProject({ youtubeScheduledAt })
    }
    const uploaded = await uploadYoutube(
      targetProject,
      scheduleForUpload(youtubeScheduledAt)
    )
    if (!uploaded) return
    const patch = {
      youtubeScheduledAt,
      youtubeVideoId: uploaded.videoId,
      youtubeUploadUrl: uploaded.url,
    }
    const uploadedProject = { ...targetProject, ...patch }
    onProject(patch)
    await Promise.resolve(onFinalized(uploadedProject)).catch(() => false)
    onNote(
      uploaded.thumbnailApplied
        ? reuploading
          ? "첫 화면을 썸네일로 적용해 YouTube에 새 영상으로 다시 업로드했습니다."
          : "첫 화면을 썸네일로 적용해 YouTube에 예약 업로드했습니다."
        : reuploading
          ? "새 영상으로 다시 업로드했지만 첫 화면 썸네일은 적용하지 못했습니다."
          : "YouTube 업로드는 완료했지만 첫 화면 썸네일은 적용하지 못했습니다."
    )
  }

  function saveYoutubeSchedule() {
    if (!scheduledAtDraft.trim()) return
    onProject({ youtubeScheduledAt: scheduledAtDraft })
    onNote("YouTube 공개 시각을 저장했습니다.")
  }

  function updateYoutubeScheduleDraft(value: string) {
    setScheduledAtChoice({
      projectId: project.id,
      savedAt: project.youtubeScheduledAt,
      value,
    })
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
  const uploadAt = scheduleForUpload(scheduledAtDraft)
  const scheduleInWindow =
    inKoreaUploadWindow(scheduledAtDraft) && uploadAt === scheduledAtDraft

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

  async function remakePreview(part: NewsPreviewPart) {
    if (busyMatches(busy, "preview")) {
      if (remakingPreviewPart === part) onCancelPreview()
      return
    }
    const draft = draftProjectForPreview()
    if (!draft) return
    setRemakingPreviewPart(part)
    try {
      await onPreview(
        true,
        {
          ...draft,
          subtitleTimingsLocked: Boolean(
            draft.subtitleTimingsLocked && draft.subtitles.length
          ),
        },
        part
      )
    } finally {
      setRemakingPreviewPart(null)
    }
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

  async function confirmScriptAndContinue() {
    const prepared = draftProjectForPreview()
    if (!prepared) return
    const changed = titleDirty || reportScriptDirty
    const draft = changed
      ? {
          ...prepared,
          editorialRevision: project.editorialRevision + 1,
          updatedAt: new Date().toISOString(),
        }
      : prepared
    if (changed) onProject(draft)
    const ready = await onPrepareVisualAssets(draft)
    if (ready) onNext()
  }

  const audioSettingsCard = (
    <Card>
      <Card.Header className="min-h-16 border-b border-separator pb-4">
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
                  progress={voiceProgress}
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
  const commonSourceCreditField = (
    <div className="flex min-w-0 flex-col gap-2">
      <label
        htmlFor="news-clip-common-source-credit"
        className="text-sm font-medium"
      >
        공통 출처
      </label>
      <div className="flex min-w-0 items-center gap-2">
        <input
          id="news-clip-common-source-credit"
          value={sourceCreditDraft}
          maxLength={120}
          placeholder="예: 전원책TV망명방송"
          onChange={(event) => setSourceCreditDraft(event.currentTarget.value)}
          className={field}
        />
        <Button
          className="shrink-0"
          size="sm"
          isDisabled={!sourceCreditDirty || busy !== ""}
          onPress={saveCommonSourceCredit}
        >
          저장
        </Button>
      </div>
    </div>
  )

  return (
    <>
      <input
        ref={visualFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,.gif,video/*,.mkv,.m4v"
        className="sr-only"
        aria-label="화면 파일 첨부"
        onChange={(event) => void uploadVisualFile(event)}
      />
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          <header className={stepHeaderClassName}>
            <h2 className="truncate text-xl leading-7 font-semibold">
              {heading.title}
            </h2>
            <div className={stepHeaderActionsClassName}>
              <HistorySaveButton
                {...historySave}
                className={stepHeaderActionButtonClassName}
              />
              {mode === "script" ? (
                <Button
                  className={stepHeaderActionButtonClassName}
                  isDisabled={
                    project.productionMode === "buildup2" &&
                    busyMatches(busy, "preview")
                      ? false
                      : busy !== "" ||
                        !project.title ||
                        !project.reportScript ||
                        !titleValid
                  }
                  onPress={() => {
                    if (
                      project.productionMode === "buildup2" &&
                      busyMatches(busy, "preview")
                    ) {
                      onCancelPreview()
                      return
                    }
                    if (project.productionMode === "report") {
                      void confirmScriptAndContinue()
                    } else {
                      void createPreviewAndContinue()
                    }
                  }}
                >
                  {project.productionMode === "buildup2" &&
                  busyMatches(busy, "preview") ? (
                    previewCancelLabel(previewProgress)
                  ) : project.productionMode === "report" ? (
                    <LoadingButtonLabel
                      loading={busyMatches(busy, "visual-assets")}
                      label="화면 구성"
                      loadingLabel="자료 찾는 중"
                      progress={busyProgress}
                    />
                  ) : (
                    "미리보기 만들기"
                  )}
                </Button>
              ) : null}
              {mode === "direction" ? (
                <Button
                  className={stepHeaderActionButtonClassName}
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
                  <select
                    aria-label="배속"
                    value={finalPlaybackRate}
                    onChange={(event) =>
                      setFinalPlaybackChoice({
                        projectId: project.id,
                        rate: normalizeFinalPlaybackRate(
                          event.currentTarget.value
                        ),
                      })
                    }
                    className={`${stepHeaderActionButtonClassName} rounded-xl border border-separator bg-background px-3 text-sm outline-none focus:border-foreground/40`}
                  >
                    {FINAL_PLAYBACK_RATES.map((rate) => (
                      <option key={rate} value={rate}>
                        {`배속 ${rate.toFixed(1)}배`}
                      </option>
                    ))}
                  </select>
                  <Button
                    className={stepHeaderActionButtonClassName}
                    isDisabled={
                      busy !== "" ||
                      Boolean(previewBlockedReason) ||
                      !previewIsCurrent ||
                      (settings.youtubeAutoUpload && scheduledAtDirty)
                    }
                    onPress={() => {
                      void render().then((ok) => {
                        if (ok) onNext()
                      })
                    }}
                  >
                    <LoadingButtonLabel
                      loading={busyMatches(busy, "render")}
                      label={
                        project.outputUrl ? "다시 만들기" : "최종본 만들기"
                      }
                      loadingLabel={
                        project.outputUrl
                          ? "다시 만드는 중"
                          : "최종본 만드는 중"
                      }
                      progress={finalRenderProgress}
                    />
                  </Button>
                </>
              ) : null}
              {mode === "final" ? (
                <Button
                  className={stepHeaderActionButtonClassName}
                  isDisabled={youtubeBusy || !finalOutputReady}
                  onPress={() => void uploadFinalToYoutube()}
                >
                  <LoadingButtonLabel
                    loading={youtubeBusy}
                    label={
                      project.youtubeUploadUrl
                        ? "다시 올리기"
                        : "유튜브 올리기"
                    }
                    loadingLabel="업로드 중"
                    progress={youtubeProgress}
                  />
                </Button>
              ) : null}
            </div>
          </header>
          <div className={`${stepBodyClassName} lg:overflow-hidden`}>
            <div className="mx-auto flex h-full w-full max-w-[1200px] flex-col gap-4 px-6">
              {mode === "preview" ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant={sourcePanelOpen ? "secondary" : "outline"}
                      onPress={() => setSourcePanelOpen((open) => !open)}
                    >
                      출처
                    </Button>
                    <Button
                      size="sm"
                      variant={audioPanelOpen ? "secondary" : "outline"}
                      onPress={() => setAudioPanelOpen((open) => !open)}
                    >
                      음향 설정
                    </Button>
                    {project.productionMode === "report" ? (
                      <>
                        <Button
                          size="sm"
                          variant={
                            project.supplementalContext
                              ? "secondary"
                              : "outline"
                          }
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
                            progress={busyProgress}
                          />
                        </Button>
                      </>
                    ) : null}
                  </div>
                  {sourcePanelOpen ? commonSourceCreditField : null}
                  {audioPanelOpen ? audioSettingsCard : null}
                </div>
              ) : null}
              {mode === "preview" ? (
                <SegmentedTabs
                  ariaLabel="미리보기 구간"
                  className="shrink-0"
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
                <SegmentedTabs
                  ariaLabel="프레임 미리보기"
                  className="shrink-0"
                  value={frameMode}
                  onChange={setFrameMode}
                  items={[
                    { id: "title", label: "제목 프레임" },
                    { id: "body", label: "자막 프레임" },
                  ]}
                />
              ) : null}
              <div className="grid min-h-0 w-full flex-1 gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
              <div className="flex w-full min-h-0 flex-col gap-4 lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
                {mode === "script" ? (
                  <NewsFramePreview
                    mode={frameMode}
                    title={titleDraft}
                    subtitle={
                      selectedSubtitle?.text ||
                      "아나운서 음성에 맞춰 자막이 표시됩니다"
                    }
                    sourceCredit={
                      frameMode === "body" ? commonSourceCreditText : ""
                    }
                    settings={settings}
                    zoom={bodyPreviewCrop.zoom}
                    className="w-full"
                    backgroundContent={
                      frameMode === "title" && introVideoUrl ? (
                        <video
                          ref={scriptFrameVideoRef}
                          src={introVideoUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className={introMediaFitClass}
                          style={introMotionPreviewStyle}
                          onLoadedMetadata={(event) => {
                            event.currentTarget.currentTime = introCursor
                          }}
                        />
                      ) : undefined
                    }
                    videoContent={
                      frameMode === "body" && scriptBodyVideoUrl ? (
                        <BodySourceVideo
                          videoRef={scriptFrameVideoRef}
                          src={scriptBodyVideoUrl}
                          zoom={previewFootageZoom(
                            previewDirectionScene,
                            bodyPreviewCrop.zoom
                          )}
                          cropX={bodyPreviewCrop.x}
                          cropY={bodyPreviewCrop.y}
                          currentTime={Math.max(
                            0,
                            previewSceneLayout?.sourceStart ??
                              previewDirectionScene?.sourceStart ??
                              0
                          )}
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
                      sourceCredit={commonSourceCreditText}
                      settings={settings}
                      zoom={bodyPreviewCrop.zoom}
                      className="w-full"
                      videoContent={
                        <DirectionBodySourceVideo
                          key={`${directionSourceVideoUrl}-${previewDirectionScene?.id ?? "scene"}`}
                          videoRef={directionVideoRef}
                          src={directionSourceVideoUrl}
                          zoom={previewFootageZoom(
                            previewDirectionScene,
                            bodyPreviewCrop.zoom
                          )}
                          cropX={bodyPreviewCrop.x}
                          cropY={bodyPreviewCrop.y}
                          sourceStart={Math.max(
                            0,
                            previewSceneLayout?.sourceStart ??
                              previewDirectionScene?.sourceStart ??
                              0
                          )}
                          sourceEnd={
                            previewSceneLayout?.sourceEnd ??
                            previewDirectionScene?.sourceEnd
                          }
                          onDuration={(duration) =>
                            setDirectionSourceMetadata({
                              url: directionSourceVideoUrl,
                              duration,
                            })
                          }
                          onPlayingChange={setDirectionPlaying}
                          onTimeChange={setDirectionCurrentTime}
                        />
                      }
                    />
                    <div className="flex items-center gap-3 rounded-xl border border-separator bg-default p-3">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={
                          directionPlaying
                            ? "미리보기 일시정지"
                            : "미리보기 재생"
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
                      sourceCredit={
                        compositionPane === "intro"
                          ? ""
                          : commonSourceCreditText
                      }
                      settings={settings}
                      zoom={bodyPreviewCrop.zoom}
                      className="w-full"
                      backgroundContent={
                        compositionPane === "intro" && introVideoUrl ? (
                          <video
                            ref={sourceVideoRef}
                            src={introVideoUrl}
                            muted
                            playsInline
                            preload="metadata"
                            className={introMediaFitClass}
                            style={introMotionPreviewStyle}
                            onLoadedMetadata={(event) => {
                              event.currentTarget.currentTime = introCursor
                            }}
                          />
                        ) : undefined
                      }
                      videoContent={
                        compositionPane !== "intro" ? (
                          <BodySourceVideo
                            videoRef={scriptFrameVideoRef}
                            src={sourceVideoUrl}
                            zoom={previewFootageZoom(
                              previewDirectionScene,
                              bodyPreviewCrop.zoom
                            )}
                            cropX={bodyPreviewCrop.x}
                            cropY={bodyPreviewCrop.y}
                            currentTime={Math.max(
                              0,
                              previewSceneLayout?.sourceStart ??
                                previewDirectionScene?.sourceStart ??
                                0
                            )}
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
                    sourceCredit={
                      frameMode === "body" ? commonSourceCreditText : ""
                    }
                    settings={settings}
                    zoom={bodyPreviewCrop.zoom}
                    className="w-full"
                      backgroundContent={
                      frameMode === "title" && introVideoUrl ? (
                        <video
                          ref={sourceVideoRef}
                          src={introVideoUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className={introMediaFitClass}
                          style={introMotionPreviewStyle}
                          onLoadedMetadata={(event) => {
                            event.currentTarget.currentTime = introCursor
                          }}
                        />
                      ) : undefined
                    }
                    videoContent={
                      frameMode === "body" && scriptBodyVideoUrl ? (
                        <BodySourceVideo
                          videoRef={scriptFrameVideoRef}
                          src={scriptBodyVideoUrl}
                          zoom={previewFootageZoom(
                            previewDirectionScene,
                            bodyPreviewCrop.zoom
                          )}
                          cropX={bodyPreviewCrop.x}
                          cropY={bodyPreviewCrop.y}
                          currentTime={Math.max(
                            0,
                            previewSceneLayout?.sourceStart ??
                              previewDirectionScene?.sourceStart ??
                              0
                          )}
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

              <div className="flex min-h-0 min-w-0 flex-col gap-4 pb-20 lg:overflow-y-auto lg:overscroll-contain lg:pl-1">
                {mode !== "preview" && editorTabs.length > 1 ? (
                  <SegmentedTabs
                    ariaLabel="편집 주제"
                    className="sticky top-0 z-20 overflow-x-auto shadow-sm"
                    equalWidth={false}
                    value={editorTab}
                    onChange={(tabId) => {
                      setEditorTabByMode((current) => ({
                        ...current,
                        [mode]: tabId,
                      }))
                      if (tabId === "scenes") {
                        setFrameMode(
                          compositionPane === "intro" ? "title" : "body"
                        )
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
                    {mode !== "preview" &&
                    project.productionMode === "report" ? (
                      <Card.Header className="flex-row flex-wrap items-center justify-end gap-2 border-b border-separator pb-4">
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
                            progress={busyProgress}
                          />
                        </Button>
                        <Button
                          size="sm"
                          variant={
                            project.supplementalContext
                              ? "secondary"
                              : "outline"
                          }
                          isDisabled={busy !== ""}
                          onPress={() => {
                            setSupplementDraft(project.supplementalContext)
                            setSupplementOpen(true)
                          }}
                        >
                          내용 첨부
                        </Button>
                      </Card.Header>
                    ) : null}
                    <Card.Content className="flex flex-col gap-6">
                      {mode === "script" ? commonSourceCreditField : null}
                      {mode !== "preview" || compositionPane === "intro" ? (
                        <div className="flex flex-col gap-3">
                          <div className={sectionHeaderClass}>
                            <span className="flex items-center gap-2">
                              <span className={sectionTitleClass}>
                                인트로 제목
                              </span>
                              {titleDirty ? (
                                <span className="text-xs text-warning">
                                  저장 전
                                </span>
                              ) : null}
                            </span>
                            <span className="ml-auto flex items-center justify-end gap-2">
                              <Button
                                size="sm"
                                isDisabled={
                                  busy !== "" || !titleDirty || !titleValid
                                }
                                onPress={() => finishTitleEdit(titleDraft)}
                              >
                                저장
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                isDisabled={buttonBusyDisabled(
                                  busy,
                                  "rewrite-title"
                                )}
                                onPress={() => void onReselect("title")}
                              >
                                <LoadingButtonLabel
                                  loading={busyMatches(busy, "rewrite-title")}
                                  label="다시 작성"
                                  loadingLabel="작성 중"
                                  progress={busyProgress}
                                />
                              </Button>
                            </span>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="flex min-w-0 flex-col gap-2">
                              <span className="text-xs font-medium text-muted">
                                1단 제목 · 권장 {firstTitleCharacterLimit}자
                                이내
                                {titleLine1Draft && !firstTitleFits ? (
                                  <span className="ml-2 text-danger">
                                    폭 초과
                                  </span>
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
                                2단 제목 · 권장 {secondTitleCharacterLimit}자
                                이내
                                {titleLine2Draft && !secondTitleFits ? (
                                  <span className="ml-2 text-danger">
                                    폭 초과
                                  </span>
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
                              {visibleBodyReviewSegments.length ? (
                                visibleBodyReviewSegments.map(
                                  (segment, index) => (
                                    <ReviewTranscriptSegment
                                      key={`${segment.id}:${segment.start}:${segment.text}`}
                                      segment={segment}
                                      disabled={busy !== ""}
                                      canDelete={
                                        visibleBodyReviewSegments.length > 1
                                      }
                                      canMergeNext={
                                        index <
                                          visibleBodyReviewSegments.length -
                                            1 &&
                                        !sourceRangeOverlapsManualCut(
                                          transcriptSegmentSpeechBounds(segment)
                                            .end,
                                          transcriptSegmentSpeechBounds(
                                            visibleBodyReviewSegments[
                                              index + 1
                                            ]!
                                          ).start,
                                          activeBodyCuts
                                        )
                                      }
                                      onDelete={() =>
                                        deleteBodyTranscriptRange(segment)
                                      }
                                      onSave={(text) => {
                                        onProject((current) => ({
                                          transcript: current.transcript.map(
                                            (item) =>
                                              item.id === segment.id
                                                ? {
                                                    ...updateTranscriptSegmentText(
                                                      item,
                                                      text
                                                    ),
                                                    captionBoundaryAfter: true,
                                                    captionBoundarySource:
                                                      "manual",
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
                                          visibleBodyReviewSegments[index + 1]
                                        if (!nextSegment) return
                                        onProject((current) => ({
                                          transcript:
                                            mergeTranscriptSegmentWithNext(
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
                                  )
                                )
                              ) : (
                                <p className="py-3 text-sm text-muted">
                                  표시할 본문 구간이 없습니다.
                                </p>
                              )}
                            </div>
                            {activeBodyCuts.length ? (
                              <div className="flex flex-col gap-2 border-t border-separator pt-4">
                                <button
                                  type="button"
                                  aria-expanded={deletedBodyCutsOpen}
                                  className="flex items-center gap-1.5 text-left text-sm font-medium"
                                  onClick={() =>
                                    setDeletedBodyCutsOpen((open) => !open)
                                  }
                                >
                                  <ChevronDown
                                    className={`size-4 shrink-0 text-muted transition-transform ${
                                      deletedBodyCutsOpen ? "" : "-rotate-90"
                                    }`}
                                  />
                                  <span>삭제된 구간</span>
                                  <span className="font-normal text-muted tabular-nums">
                                    {activeBodyCuts.length}
                                  </span>
                                </button>
                                {deletedBodyCutsOpen
                                  ? activeBodyCuts.map((range) => (
                                      <div
                                        key={range.id}
                                        className="flex items-center justify-between gap-4 rounded-xl bg-default/50 px-3 py-2"
                                      >
                                        <div className="min-w-0">
                                          <p className="text-xs text-muted tabular-nums">
                                            {time(range.start)}–
                                            {time(range.end)}
                                          </p>
                                          <p className="truncate text-sm text-muted">
                                            {transcriptTextInsideRange(
                                              project.transcript,
                                              range
                                            ) || "삭제한 본문 구간"}
                                          </p>
                                        </div>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          isDisabled={busy !== ""}
                                          onPress={() =>
                                            restoreBodyTranscriptRange(range.id)
                                          }
                                        >
                                          복원
                                        </Button>
                                      </div>
                                    ))
                                  : null}
                              </div>
                            ) : null}
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
                                {outroScriptDraft !==
                                projectPartScripts.outro ? (
                                  <span className="text-xs text-warning">
                                    저장 전
                                  </span>
                                ) : null}
                                <Button
                                  size="sm"
                                  isDisabled={
                                    busy !== "" ||
                                    !outroScriptDraft.trim() ||
                                    outroScriptDraft ===
                                      projectPartScripts.outro
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
                                {mode === "preview" &&
                                compositionPane === "lead"
                                  ? "서두 나레이션"
                                  : mode === "preview" &&
                                      compositionPane === "outro"
                                    ? "마무리 멘트"
                                    : mode === "preview" &&
                                        compositionPane === "body"
                                      ? "본문 나레이션"
                                      : project.productionMode === "buildup2"
                                        ? "서두"
                                        : "시사 논평 대본"}
                              </label>
                              {reportScriptDirty ? (
                                <span className="text-xs text-warning">
                                  저장 전
                                </span>
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
                                      compositionPane === "outro"
                                        ? "outro"
                                        : "script"
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
                                    progress={busyProgress}
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
                                : mode === "preview" &&
                                    compositionPane === "outro"
                                  ? "마무리 멘트"
                                  : mode === "preview" &&
                                      compositionPane === "body"
                                    ? "본문 나레이션"
                                    : project.productionMode === "buildup2"
                                      ? "서두"
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
                              if (
                                mode === "preview" &&
                                compositionPane === "lead"
                              ) {
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
                              if (
                                mode === "preview" &&
                                compositionPane === "outro"
                              ) {
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
                              if (
                                mode === "preview" &&
                                compositionPane === "body"
                              ) {
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
                    <Card.Content className="flex flex-col gap-6">
                      {mode === "preview" &&
                      compositionPane === "intro" &&
                      introVideoUrl ? (
                        <div className="flex flex-col gap-5">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              isDisabled={Boolean(visualUploadBusy)}
                              onPress={() =>
                                chooseVisualFile({ type: "intro" })
                              }
                            >
                              <FileUp className="size-4" />
                              {visualUploadBusy === "intro"
                                ? "첨부 중"
                                : "파일 첨부"}
                            </Button>
                            {introLayoutDirty ? (
                              <span className="text-xs text-warning">
                                저장 전
                              </span>
                            ) : null}
                            <Button
                              className="ml-auto"
                              size="sm"
                              variant="outline"
                              isDisabled={
                                !project.introSourceId &&
                                introLayout.introStillTimeSeconds === null
                              }
                              onPress={restoreAutomaticIntroStill}
                            >
                              <RotateCcw className="size-4" /> 자동 선택
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              isDisabled={
                                !introLayoutDirty &&
                                !introVisualBaseline &&
                                !project.introSourceId
                              }
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
                                className={introMediaFitClass}
                                style={introMotionPreviewStyle}
                                onLoadedMetadata={(event) => {
                                  const duration = Number.isFinite(
                                    event.currentTarget.duration
                                  )
                                    ? event.currentTarget.duration
                                    : initialIntroSourceDuration(project)
                                  setSourceDuration(duration)
                                  event.currentTarget.currentTime = Math.min(
                                    Math.max(0, introCursor),
                                    Math.max(0, duration - 0.05)
                                  )
                                }}
                              />
                            }
                          />
                          {introUsesUploadedVisual ? (
                            <div className="flex flex-col gap-2 text-sm">
                              <span>화면 움직임</span>
                              <div
                                className="flex flex-wrap gap-2"
                                role="group"
                                aria-label="인트로 첨부 화면 움직임"
                              >
                                {NEWS_MEDIA_MOTION_OPTIONS.map((option) => (
                                  <Button
                                    key={option.value}
                                    size="sm"
                                    className="h-8 rounded-full px-3"
                                    variant={
                                      introLayout.introMotion === option.value
                                        ? "secondary"
                                        : "outline"
                                    }
                                    aria-pressed={
                                      introLayout.introMotion === option.value
                                    }
                                    onPress={() =>
                                      patchIntroLayout({
                                        introMotion: option.value,
                                      })
                                    }
                                  >
                                    {option.label}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          ) : null}
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
                                selectIntroStill(
                                  Number(event.currentTarget.value)
                                )
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
                              max={ZOOM_SLIDER_MAX}
                              step={0.01}
                              value={introLayout.introStillZoom}
                              onChange={(event) =>
                                patchIntroLayout({
                                  introStillZoom: Number(
                                    event.currentTarget.value
                                  ),
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
                                min={POSITION_SLIDER_MIN}
                                max={POSITION_SLIDER_MAX}
                                step={1}
                                value={introLayout.introStillX}
                                onChange={(event) =>
                                  patchIntroLayout({
                                    introStillX: Number(
                                      event.currentTarget.value
                                    ),
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
                                min={POSITION_SLIDER_MIN}
                                max={POSITION_SLIDER_MAX}
                                step={1}
                                value={introLayout.introStillY}
                                onChange={(event) =>
                                  patchIntroLayout({
                                    introStillY: Number(
                                      event.currentTarget.value
                                    ),
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
                                const selected =
                                  scene.id === selectedDirectionSceneId
                                const layout = sceneLayoutFor(
                                  scene,
                                  project,
                                  sceneLayoutDrafts
                                )
                                const crop = layout.crop
                                const sceneSource = sourceForId(scene.sourceId)
                                const sceneUsesUploadedVisual =
                                  sceneSource?.channel === "사용자 첨부"
                                const layoutDirty = sceneLayoutDirty(
                                  layout,
                                  scene,
                                  project.crop
                                )
                                const scenePart = reportScenePart(
                                  scene,
                                  project.productionMode
                                )
                                const canAttachVisual = mode === "preview"
                                const partSiblingScenes =
                                  project.reportScenes.filter(
                                    (item) =>
                                      item.id !== scene.id &&
                                      reportScenePart(
                                        item,
                                        project.productionMode
                                      ) === scenePart
                                  )
                                const siblingsNeedCrop = partSiblingScenes.some(
                                  (item) => {
                                    const siblingCrop = sceneLayoutFor(
                                      item,
                                      project,
                                      sceneLayoutDrafts
                                    ).crop
                                    return (
                                      siblingCrop.x !== crop.x ||
                                      siblingCrop.y !== crop.y ||
                                      siblingCrop.zoom !== crop.zoom ||
                                      siblingCrop.faceTracking !==
                                        crop.faceTracking
                                    )
                                  }
                                )
                                const canBatchSaveCrop =
                                  partSiblingScenes.length > 0 &&
                                  (layoutDirty || siblingsNeedCrop)
                                const canResetLayout =
                                  layoutDirty ||
                                  Boolean(sceneVisualBaselines[scene.id]) ||
                                  sceneUsesCustomVisual(scene, project)
                                const draftScene = {
                                  ...scene,
                                  sourceStart: layout.sourceStart,
                                  sourceEnd: layout.sourceEnd,
                                }
                                const sourceTitle = sourceTitleFor(
                                  scene.sourceId
                                )
                                const visualLabel =
                                  project.productionMode === "report"
                                    ? "자료화면 · TTS"
                                    : scene.visual === "quote"
                                      ? "직접발언"
                                      : "자료화면 · TTS"
                                return (
                                  <div
                                    key={scene.id}
                                    className="flex flex-col gap-2"
                                  >
                                    <button
                                      type="button"
                                      aria-pressed={selected}
                                      className={`grid w-full grid-cols-[88px_minmax(0,1fr)] items-center gap-3 rounded-xl border p-3 text-left ${
                                        selected
                                          ? "border-foreground/35 bg-default"
                                          : "border-separator"
                                      }`}
                                      onClick={() =>
                                        selectDirectionScene(
                                          scene.id,
                                          layout.sourceStart,
                                          { toggle: true }
                                        )
                                      }
                                    >
                                      <video
                                        key={`${scene.sourceId || project.source?.id || "source"}-${layout.sourceStart}`}
                                        src={sourceVideoUrlFor(scene.sourceId)}
                                        poster={sceneSource?.thumbnailUrl}
                                        muted
                                        playsInline
                                        preload="metadata"
                                        tabIndex={-1}
                                        aria-hidden="true"
                                        className="h-[52px] w-[88px] rounded-lg bg-black object-cover"
                                        onLoadedMetadata={(event) => {
                                          const duration = Number.isFinite(
                                            event.currentTarget.duration
                                          )
                                            ? event.currentTarget.duration
                                            : 0
                                          event.currentTarget.currentTime =
                                            Math.min(
                                              Math.max(0, layout.sourceStart),
                                              Math.max(0, duration - 0.05)
                                            )
                                        }}
                                      />
                                      <span className="flex min-w-0 flex-col gap-1">
                                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                                          <span>구간 {index + 1}</span>
                                          <span>{visualLabel}</span>
                                          {layoutDirty ? (
                                            <span className="text-warning">
                                              저장 전
                                            </span>
                                          ) : null}
                                        </span>
                                        {sourceTitle ? (
                                          <span className="truncate text-xs text-muted">
                                            {sourceTitle}
                                          </span>
                                        ) : null}
                                        <span className="line-clamp-2 text-sm leading-6">
                                          {scene.narration}
                                        </span>
                                      </span>
                                    </button>
                                    {selected ? (
                                      <div className="flex flex-col gap-4 rounded-xl bg-default/60 p-4">
                                        <div className="flex items-center justify-end gap-2">
                                          {canAttachVisual ? (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              isDisabled={Boolean(
                                                visualUploadBusy
                                              )}
                                              onPress={() =>
                                                chooseVisualFile({
                                                  type: "scene",
                                                  sceneId: scene.id,
                                                })
                                              }
                                            >
                                              <FileUp className="size-4" />
                                              {visualUploadBusy === scene.id
                                                ? "첨부 중"
                                                : "파일 첨부"}
                                            </Button>
                                          ) : null}
                                          <Button
                                            className={
                                              canAttachVisual
                                                ? "ml-auto"
                                                : undefined
                                            }
                                            size="sm"
                                            variant="outline"
                                            isDisabled={!canResetLayout}
                                            onPress={() =>
                                              resetSceneLayout(scene.id)
                                            }
                                          >
                                            초기화
                                          </Button>
                                          {partSiblingScenes.length > 0 ? (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              isDisabled={!canBatchSaveCrop}
                                              onPress={() =>
                                                saveSceneLayoutCropToPart(scene)
                                              }
                                            >
                                              일괄저장
                                            </Button>
                                          ) : null}
                                          <Button
                                            size="sm"
                                            isDisabled={!layoutDirty}
                                            onPress={() =>
                                              saveSceneLayout(scene)
                                            }
                                          >
                                            저장
                                          </Button>
                                        </div>
                                        {project.productionMode === "report" ? (
                                          <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                                            <label className="flex flex-col gap-2 text-sm">
                                              <span>장면 자료</span>
                                              <select
                                                aria-label={`구간 ${index + 1} 장면 자료`}
                                                value={
                                                  scene.sourceId ||
                                                  project.source?.id ||
                                                  ""
                                                }
                                                onChange={(event) => {
                                                  const sourceId =
                                                    event.currentTarget.value
                                                  const nextSource =
                                                    sourceForId(sourceId)
                                                  updateReportScene(scene.id, {
                                                    sourceId,
                                                    visual: "source",
                                                    visualMode:
                                                      sourceId ===
                                                      project.source?.id
                                                        ? "source"
                                                        : "supporting",
                                                    sourceStart: 0,
                                                    sourceEnd: Math.max(
                                                      0.5,
                                                      nextSource?.durationSeconds ||
                                                        12
                                                    ),
                                                  })
                                                }}
                                                className={field}
                                              >
                                                {[
                                                  project.source,
                                                  ...project.supportingSources,
                                                ]
                                                  .filter(
                                                    (
                                                      source
                                                    ): source is NewsSource =>
                                                      Boolean(source)
                                                  )
                                                  .map((source) => (
                                                    <option
                                                      key={source.id}
                                                      value={source.id}
                                                    >
                                                      {source.mediaType ===
                                                      "image"
                                                        ? "이미지"
                                                        : "영상"}
                                                      {" · "}
                                                      {source.title}
                                                    </option>
                                                  ))}
                                              </select>
                                            </label>
                                            {sceneSource?.pageUrl ||
                                            sceneSource?.originalUrl ? (
                                              <a
                                                className="pb-2 text-sm underline"
                                                href={
                                                  sceneSource.pageUrl ||
                                                  sceneSource.originalUrl
                                                }
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                출처 확인
                                              </a>
                                            ) : null}
                                            {sceneSource?.licenseName ? (
                                              <div className="flex flex-wrap gap-1 text-xs text-muted sm:col-span-2">
                                                <span>
                                                  {sceneSource.channel ||
                                                    "공개 자료"}
                                                  {sceneSource.creator
                                                    ? ` · ${sceneSource.creator}`
                                                    : ""}
                                                  {" · "}
                                                </span>
                                                {sceneSource.licenseUrl ? (
                                                  <a
                                                    href={
                                                      sceneSource.licenseUrl
                                                    }
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="underline"
                                                  >
                                                    {sceneSource.licenseName}
                                                  </a>
                                                ) : (
                                                  <span>
                                                    {sceneSource.licenseName}
                                                  </span>
                                                )}
                                              </div>
                                            ) : null}
                                          </div>
                                        ) : null}
                                        {mode === "preview" ||
                                        mode === "direction" ? (
                                          <SceneCropPreview
                                            sourceUrl={sourceVideoUrlFor(
                                              scene.sourceId
                                            )}
                                            sourceStart={layout.sourceStart}
                                            sourceEnd={layout.sourceEnd}
                                            crop={crop}
                                            motion={layout.motion}
                                            title={titleDraft}
                                            subtitle={
                                              project.subtitles.find(
                                                (cue) =>
                                                  cue.sceneId === scene.id
                                              )?.text || "본문 자막 미리보기"
                                            }
                                            sourceCredit={commonSourceCreditText}
                                            muted={
                                              project.productionMode ===
                                              "report"
                                            }
                                            fit={
                                              sceneSource?.mediaType === "image"
                                                ? "contain"
                                                : "cover"
                                            }
                                            settings={settings}
                                          />
                                        ) : null}
                                        {sceneUsesUploadedVisual ? (
                                          <div className="flex flex-col gap-2 text-sm">
                                            <span>화면 움직임</span>
                                            <div
                                              className="flex flex-wrap gap-2"
                                              role="group"
                                              aria-label={`구간 ${index + 1} 첨부 화면 움직임`}
                                            >
                                              {NEWS_MEDIA_MOTION_OPTIONS.map(
                                                (option) => (
                                                  <Button
                                                    key={option.value}
                                                    size="sm"
                                                    className="h-8 rounded-full px-3"
                                                    variant={
                                                      layout.motion ===
                                                      option.value
                                                        ? "secondary"
                                                        : "outline"
                                                    }
                                                    aria-pressed={
                                                      layout.motion ===
                                                      option.value
                                                    }
                                                    onPress={() =>
                                                      patchSceneLayoutDraft(
                                                        scene,
                                                        {
                                                          motion: option.value,
                                                        }
                                                      )
                                                    }
                                                  >
                                                    {option.label}
                                                  </Button>
                                                )
                                              )}
                                            </div>
                                          </div>
                                        ) : null}
                                        <div className="grid gap-5 md:grid-cols-3">
                                          <RangeInput
                                            label="화면 확대"
                                            value={crop.zoom}
                                            min={ZOOM_SLIDER_MIN}
                                            max={ZOOM_SLIDER_MAX}
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
                                            min={POSITION_SLIDER_MIN}
                                            max={POSITION_SLIDER_MAX}
                                            step={1}
                                            formatValue={(x) =>
                                              axisPosition(x, "왼쪽", "오른쪽")
                                            }
                                            onChange={(x) =>
                                              patchSceneLayoutDraft(scene, {
                                                crop: { ...crop, x },
                                              })
                                            }
                                          />
                                          <RangeInput
                                            label="세로 크롭 중심"
                                            value={crop.y}
                                            min={POSITION_SLIDER_MIN}
                                            max={POSITION_SLIDER_MAX}
                                            step={1}
                                            formatValue={(y) =>
                                              axisPosition(y, "위", "아래")
                                            }
                                            onChange={(y) =>
                                              patchSceneLayoutDraft(scene, {
                                                crop: { ...crop, y },
                                              })
                                            }
                                          />
                                        </div>
                                        {sceneSource?.mediaType === "image" ? (
                                          <p className="text-sm text-muted">
                                            공개 이미지는 장면 길이에 맞춰
                                            자동으로 확대됩니다. 확대와 위치만
                                            조절하세요.
                                          </p>
                                        ) : project.productionMode ===
                                            "buildup2" &&
                                          splitScenesByClipPart(
                                            project.reportScenes,
                                            project.productionMode
                                          ).body.some(
                                            (item) => item.id === scene.id
                                          ) ? (
                                          <p className="text-sm text-muted">
                                            본문은 확정된 영상 구간입니다. 화면
                                            위치만 조절할 수 있습니다.
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
                                                  scene.sourceId ||
                                                    project.source?.id
                                                )
                                                ? directionSourceMetadata.duration
                                                : 0
                                            )}
                                            onMove={(
                                              sourceStart,
                                              sourceEnd
                                            ) => {
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
                        <Card.Content className="gap-0">
                          {project.previewUrl || project.outputUrl ? (
                            (mode === "preview"
                              ? paneCaptions
                              : project.subtitles
                            ).length ? (
                              (mode === "preview"
                                ? paneCaptions
                                : project.subtitles
                              ).map((caption, index) => (
                                <div
                                  key={caption.id}
                                  className="-mx-4 flex flex-col gap-3 border-b border-separator-secondary px-4 py-4 first:pt-0 last:border-b-0 last:pb-0"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex min-w-0 flex-col gap-1">
                                      <span className="text-sm font-medium">
                                        자막 {index + 1}
                                      </span>
                                      <span className="text-xs text-muted tabular-nums">
                                        {time(caption.start)} →{" "}
                                        {time(caption.end)}
                                        {project.subtitleTimingsLocked ? (
                                          <span className="ml-2 text-muted">
                                            잠김
                                          </span>
                                        ) : null}
                                      </span>
                                    </div>
                                    <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                                      {canDeleteBodySubtitleRange(caption) ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          isDisabled={Boolean(busy)}
                                          onPress={() =>
                                            deleteBodySubtitleRange(caption)
                                          }
                                        >
                                          구간 삭제
                                        </Button>
                                      ) : null}
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
                                              subtitles
                                            )
                                          })
                                          onNote(
                                            `자막 ${index + 1}과 다음 자막을 합쳤습니다.`
                                          )
                                        }}
                                      >
                                        다음과 합치기
                                      </Button>
                                      {canUndoSubtitleCueMerge(caption) ? (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          isDisabled={Boolean(busy)}
                                          onPress={() => {
                                            onProject((current) => {
                                              const subtitles =
                                                undoSubtitleCueMerge(
                                                  current.subtitles,
                                                  caption.id
                                                )
                                              return syncNarrationFromSubtitleEdit(
                                                current,
                                                subtitles
                                              )
                                            })
                                            onNote(
                                              "합치기 전 두 자막으로 되돌렸습니다."
                                            )
                                          }}
                                        >
                                          합치기 취소
                                        </Button>
                                      ) : null}
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        isDisabled={!caption.edited}
                                        onPress={() => {
                                          onProject((current) => {
                                            const subtitles =
                                              resetEditedSubtitleCue(
                                                current.subtitles,
                                                caption.id
                                              )
                                            return syncNarrationFromSubtitleEdit(
                                              current,
                                              subtitles
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
                                  <div
                                    aria-hidden
                                    className="border-b border-separator"
                                  />
                                  <SubtitleLineFields
                                    value={caption.text}
                                    emphasis={caption.emphasis}
                                    characterLimit={subtitleLineCharacterLimit(
                                      settings.bodySubtitleText
                                    )}
                                    onFocus={() =>
                                      setSelectedSubtitleId(caption.id)
                                    }
                                    onCommit={(text, emphasis) => {
                                      onProject((current) => {
                                        const withText =
                                          updateEditedSubtitleCue(
                                            current.subtitles,
                                            caption.id,
                                            text,
                                            settings.bodySubtitleText
                                          )
                                        const subtitles = withText.map(
                                          (item) =>
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
                                          subtitles
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
                          <Card.Header className="min-h-16 border-b border-separator pb-4">
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
                          <Card.Header className="min-h-16 border-b border-separator pb-4">
                            <Card.Title className={cardTitleClass}>
                              YouTube 업로드
                            </Card.Title>
                            <Card.Description className={cardDescriptionClass}>
                              비공개로 올린 뒤 선택한 시각에 공개합니다.
                            </Card.Description>
                          </Card.Header>
                          <Card.Content className="flex flex-col gap-4">
                            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                              <label className="flex flex-col gap-1.5 text-sm">
                                <span>공개 시각</span>
                                <input
                                  type="datetime-local"
                                  value={scheduledAtDraft}
                                  onChange={(event) =>
                                    updateYoutubeScheduleDraft(
                                      event.currentTarget.value
                                    )
                                  }
                                  className={field}
                                />
                              </label>
                              <Button
                                variant="outline"
                                isDisabled={
                                  !scheduledAtDirty || !scheduledAtDraft.trim()
                                }
                                onPress={saveYoutubeSchedule}
                              >
                                저장
                              </Button>
                            </div>
                            <p className="text-sm text-muted">
                              권장 공개는 오전 6–9시(기본 7시)입니다.
                              {scheduleInWindow
                                ? ""
                                : uploadAt === scheduledAtDraft
                                  ? " 권장 시간 밖이어도 선택한 시각 그대로 예약합니다."
                                  : ` 선택한 시각이 지났으므로 예약에는 ${uploadAt.replace("T", " ")}를 넣습니다.`}
                            </p>
                            {project.youtubeUploadUrl ? (
                              <div className="flex flex-wrap items-center justify-end gap-3">
                                <a
                                  className="text-sm underline"
                                  href={project.youtubeUploadUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  YouTube에서 열기
                                </a>
                              </div>
                            ) : null}
                          </Card.Content>
                        </Card>
                      </>
                    ) : null}
                  </>
                ) : null}

                {mode === "preview" && compositionPane !== "all" ? (
                  <div className="flex items-center justify-end gap-3 pt-2 pb-1">
                    <Button
                      variant="outline"
                      isDisabled={
                        busyMatches(busy, "preview")
                          ? remakingPreviewPart !== "all"
                          : busy !== ""
                      }
                      onPress={() => void remakePreview("all")}
                    >
                      <LoadingButtonLabel
                        loading={
                          busyMatches(busy, "preview") &&
                          remakingPreviewPart === "all"
                        }
                        label="전체 다시 만들기"
                        loadingLabel="취소"
                        progress={previewProgress}
                      />
                    </Button>
                    <Button
                      variant="outline"
                      isDisabled={
                        busyMatches(busy, "preview")
                          ? remakingPreviewPart !== compositionPane
                          : busy !== ""
                      }
                      onPress={() => void remakePreview(compositionPane)}
                    >
                      <LoadingButtonLabel
                        loading={
                          busyMatches(busy, "preview") &&
                          remakingPreviewPart === compositionPane
                        }
                        label={`${partPreviewLabel} 다시 만들기`}
                        loadingLabel="취소"
                        progress={previewProgress}
                      />
                    </Button>
                  </div>
                ) : null}
              </div>
              </div>
            </div>
          </div>

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

function transcriptSegmentSpeechBounds(segment: TranscriptSegment) {
  const words = segment.words.filter(
    (word) =>
      word.text.trim() &&
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start
  )
  if (!words.length) return { start: segment.start, end: segment.end }
  return {
    start: Math.min(...words.map((word) => word.start)),
    end: Math.max(...words.map((word) => word.end)),
  }
}

function transcriptTextInsideRange(
  transcript: TranscriptSegment[],
  range: { start: number; end: number }
) {
  return transcript
    .filter((segment) => {
      const speech = transcriptSegmentSpeechBounds(segment)
      return speech.end > range.start && speech.start < range.end
    })
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
}

function ReviewTranscriptSegment({
  segment,
  disabled,
  canDelete,
  canMergeNext,
  onDelete,
  onSave,
  onMergeNext,
}: {
  segment: TranscriptSegment
  disabled: boolean
  canDelete: boolean
  canMergeNext: boolean
  onDelete: () => void
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
          <Button
            size="sm"
            variant="outline"
            isDisabled={disabled || changed || !canDelete}
            onPress={onDelete}
          >
            구간 삭제
          </Button>
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
  const firstLineLength = subtitleCharacterCount(draft[0])
  const secondLineLength = subtitleCharacterCount(draft[1])
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
        // 저장 전 초안이 있으면 외부 value 동기화로 덮어쓰지 않는다.
        if (!dirty) editingRef.current = false
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

function bodySourceTransform(zoom: number) {
  return Math.max(1, Math.min(ZOOM_SLIDER_MAX, zoom))
}

function mediaMotionStyle(
  motion: NewsMediaMotion,
  baseScale: number,
  durationSeconds: number
): CSSProperties {
  const safeScale = Math.max(1, Math.min(ZOOM_SLIDER_MAX, baseScale))
  if (motion === "none") {
    return { transform: `scale(${safeScale})` }
  }
  const amount = newsMediaMotionAmount(durationSeconds)
  const motionScale = safeScale * (1 + amount)
  const panOffset = `${(amount * 50).toFixed(2)}%`
  const [from, to] =
    motion === "zoom-in"
      ? [`scale(${safeScale})`, `scale(${motionScale})`]
      : motion === "zoom-out"
        ? [`scale(${motionScale})`, `scale(${safeScale})`]
        : motion === "pan-left"
          ? [
              `scale(${motionScale}) translateX(${panOffset})`,
              `scale(${motionScale}) translateX(-${panOffset})`,
            ]
          : [
              `scale(${motionScale}) translateX(-${panOffset})`,
              `scale(${motionScale}) translateX(${panOffset})`,
            ]
  return {
    "--news-motion-from": from,
    "--news-motion-to": to,
    animationName: `news-media-${motion}`,
    animationDuration: `${Math.max(0.8, durationSeconds)}s`,
    animationTimingFunction: "linear",
    animationFillMode: "forwards",
    backfaceVisibility: "hidden",
    willChange: "transform",
  } as CSSProperties
}

function BodySourceVideo({
  videoRef,
  src,
  zoom,
  cropX,
  cropY,
  currentTime,
  onDuration,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  src: string
  zoom: number
  cropX: number
  cropY: number
  currentTime: number
  onDuration?: (duration: number) => void
}) {
  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      preload="metadata"
      className="size-full object-cover"
      style={{
        transform: `scale(${bodySourceTransform(zoom)})`,
        transformOrigin: `${cropX}% ${cropY}%`,
      }}
      onLoadedMetadata={(event) => {
        event.currentTarget.playbackRate = NEWS_SOURCE_PLAYBACK_RATE
        event.currentTarget.currentTime = Math.max(0, currentTime)
        if (
          onDuration &&
          Number.isFinite(event.currentTarget.duration) &&
          event.currentTarget.duration > 0
        ) {
          onDuration(event.currentTarget.duration)
        }
      }}
    />
  )
}

function DirectionBodySourceVideo({
  videoRef,
  src,
  zoom,
  cropX,
  cropY,
  sourceStart,
  sourceEnd,
  onDuration,
  onPlayingChange,
  onTimeChange,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  src: string
  zoom: number
  cropX: number
  cropY: number
  sourceStart: number
  sourceEnd?: number
  onDuration: (duration: number) => void
  onPlayingChange: (playing: boolean) => void
  onTimeChange: (time: number) => void
}) {
  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      preload="metadata"
      className="size-full object-cover"
      style={{
        transform: `scale(${bodySourceTransform(zoom)})`,
        transformOrigin: `${cropX}% ${cropY}%`,
      }}
      onLoadedMetadata={(event) => {
        event.currentTarget.playbackRate = NEWS_SOURCE_PLAYBACK_RATE
        if (Number.isFinite(event.currentTarget.duration)) {
          onDuration(event.currentTarget.duration)
        }
        event.currentTarget.currentTime = sourceStart
        onTimeChange(sourceStart)
      }}
      onPlay={() => onPlayingChange(true)}
      onPause={() => onPlayingChange(false)}
      onEnded={() => onPlayingChange(false)}
      onTimeUpdate={(event) => {
        const end = sourceEnd ?? event.currentTarget.duration
        if (event.currentTarget.currentTime >= end) {
          event.currentTarget.pause()
          event.currentTarget.currentTime = sourceStart
        }
        onTimeChange(event.currentTarget.currentTime)
      }}
    />
  )
}

function SceneCropPreview({
  sourceUrl,
  sourceStart,
  sourceEnd,
  crop,
  motion,
  title,
  subtitle,
  sourceCredit,
  muted = false,
  fit = "cover",
  settings,
}: {
  sourceUrl: string
  sourceStart: number
  sourceEnd: number
  crop: CropPosition
  motion: NewsMediaMotion
  title: string
  subtitle: string
  sourceCredit: string
  muted?: boolean
  fit?: "cover" | "contain"
  settings: NewsClipSettings
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(sourceStart)
  const safeStart = Math.max(0, sourceStart)
  const safeEnd = Math.max(safeStart + 0.1, sourceEnd)
  const resolvedFit = fit
  const previewScale =
    resolvedFit === "contain"
      ? crop.zoom <= 1.0001
        ? 1
        : crop.zoom
      : Math.max(1, Math.min(ZOOM_SLIDER_MAX, crop.zoom))

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
            muted={muted}
            playsInline
            preload="metadata"
            className={
              resolvedFit === "contain"
                ? "size-full object-contain bg-black"
                : "size-full object-cover"
            }
            style={{
              ...mediaMotionStyle(
                motion,
                previewScale,
                safeEnd - safeStart
              ),
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
  const minimumLength = Math.min(0.5, safeDuration)
  const start = Math.max(
    0,
    Math.min(scene.sourceStart, Math.max(0, safeDuration - minimumLength))
  )
  const end = Math.max(
    start + minimumLength,
    Math.min(safeDuration, scene.sourceEnd)
  )
  const segmentLength = Math.max(minimumLength, end - start)
  const maxMoveStart = Math.max(0, safeDuration - segmentLength)
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
          {time(start)} → {time(end)} · {segmentLength.toFixed(1)}초
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
          aria-label="영상 구간 이동"
          type="range"
          min={0}
          max={maxMoveStart}
          step={0.1}
          value={Math.min(start, maxMoveStart)}
          onChange={(event) => {
            const nextStart = Math.max(
              0,
              Math.min(maxMoveStart, Number(event.currentTarget.value))
            )
            onMove(nextStart, nextStart + segmentLength)
          }}
          className="source-range-input z-10"
        />
      </div>
      <div className="flex justify-between text-xs text-muted tabular-nums">
        <span>{time(0)}</span>
        <span>{time(safeDuration)}</span>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="flex items-center justify-between text-xs">
            <span>시작</span>
            <span className="text-muted tabular-nums">{time(start)}</span>
          </span>
          <input
            aria-label="영상 시작 지점"
            type="range"
            min={0}
            max={Math.max(0, end - minimumLength)}
            step={0.1}
            value={start}
            onChange={(event) => {
              const nextStart = Math.max(
                0,
                Math.min(end - minimumLength, Number(event.currentTarget.value))
              )
              onMove(nextStart, end)
            }}
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="flex items-center justify-between text-xs">
            <span>종료</span>
            <span className="text-muted tabular-nums">{time(end)}</span>
          </span>
          <input
            aria-label="영상 종료 지점"
            type="range"
            min={Math.min(safeDuration, start + minimumLength)}
            max={safeDuration}
            step={0.1}
            value={end}
            onChange={(event) => {
              const nextEnd = Math.min(
                safeDuration,
                Math.max(
                  start + minimumLength,
                  Number(event.currentTarget.value)
                )
              )
              onMove(start, nextEnd)
            }}
          />
        </label>
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

function axisPosition(value: number, start: string, end: string) {
  // 중앙(50) = 0%. 슬라이더 끝(-50 / 150) = 각 방향 200%.
  const offset = Math.round((value - POSITION_SLIDER_CENTER) * 2)
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
    motion: normalizeNewsMediaMotion(scene.motion),
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
    draft.crop.faceTracking !== saved.crop.faceTracking ||
    draft.motion !== saved.motion
  )
}

function snapshotIntroLayout(project: NewsClipProject): IntroLayoutDraft {
  return {
    introStillTimeSeconds: project.introStillTimeSeconds,
    introStillZoom: project.introStillZoom,
    introStillX: project.introStillX,
    introStillY: project.introStillY,
    introMotion: normalizeNewsMediaMotion(project.introMotion, "zoom-in"),
  }
}

function sameIntroLayout(left: IntroLayoutDraft, right: IntroLayoutDraft) {
  return (
    left.introStillTimeSeconds === right.introStillTimeSeconds &&
    left.introStillZoom === right.introStillZoom &&
    left.introStillX === right.introStillX &&
    left.introStillY === right.introStillY &&
    left.introMotion === right.introMotion
  )
}

function initialIntroSourceDuration(project: NewsClipProject) {
  if (project.introSourceId) {
    const source = [project.source, ...project.supportingSources].find(
      (item) => item?.id === project.introSourceId
    )
    if (source) return Math.max(0.1, source.durationSeconds || 12)
  }
  return Math.max(
    0.1,
    project.source?.durationSeconds ?? 0,
    ...project.candidates.map((candidate) => candidate.sourceEnd),
    ...project.reportScenes.map((scene) => scene.sourceEnd)
  )
}

function appendSupportingSource(sources: NewsSource[], source: NewsSource) {
  return sources.some((item) => item.id === source.id)
    ? sources
    : [...sources, source]
}

function uploadedVisualDuration(file: File) {
  if (
    file.type.startsWith("image/") ||
    /\.(?:jpe?g|png|webp|gif)$/i.test(file.name)
  ) {
    return Promise.resolve(12)
  }
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement("video")
    let settled = false
    const finish = (duration: number) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      video.removeAttribute("src")
      video.load()
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(duration) && duration > 0 ? duration : 12)
    }
    const timeout = window.setTimeout(() => finish(12), 8_000)
    video.preload = "metadata"
    video.onloadedmetadata = () => finish(video.duration)
    video.onerror = () => finish(12)
    video.src = url
  })
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
