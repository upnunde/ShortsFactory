"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { Button, Card, Modal } from "@heroui/react"
import { Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react"
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
  buildBuildupScenes,
  buildupHighlightBounds,
} from "@/lib/news-clips/buildup"
import {
  prepareRenderProject,
  rebuildSubtitlesAfterSceneEdit,
} from "@/lib/news-clips/prepare-render-project"
import {
  NEWS_TOTAL_GAP_SECONDS,
  appendEndCtaScenes,
  buildReportScenes,
  ensureReportEndCta,
  estimateReportScenesDuration,
  isEndCtaScene,
  splitEndCtaFromScript,
} from "@/lib/news-clips/report"
import { bodySourceCreditText } from "@/lib/news-clips/source-credit"
import {
  fitTitleToLineLayouts,
  normalizeSubtitleCues,
  splitIntroTitleLines,
  titleLineCharacterLimit,
  titleLineFits,
  updateEditedSubtitleCue,
} from "@/lib/news-clips/text-layout"
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
  NewsReportScene,
} from "@/lib/news-clips/types"
import { NEWS_TTS_VOICES, newsTtsVoiceById } from "@/lib/news-clips/voices"

const field =
  "w-full rounded-xl border border-separator bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"
const cardTitleClass = "text-base font-semibold leading-6"
const cardDescriptionClass = "mt-1 text-sm leading-5 text-muted"
const sectionHeaderClass = "flex min-h-10 items-center justify-between gap-4"
const sectionTitleClass = "text-base font-semibold leading-6"

type ReviewMode = Exclude<NewsClipStep, "issue" | "source" | "angles">
type EditorTab = "script" | "captions" | "scenes" | "media"
type CompositionPane = "intro" | "body"

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

const EDITOR_TABS: Record<
  ReviewMode,
  Array<{ id: EditorTab; label: string }>
> = {
  script: [
    { id: "script", label: "제목·대본" },
    { id: "captions", label: "자막" },
  ],
  direction: [
    { id: "scenes", label: "화면 구성" },
    { id: "media", label: "음향 설정" },
  ],
  preview: [
    { id: "script", label: "제목·대본" },
    { id: "captions", label: "자막" },
    { id: "scenes", label: "화면 구성" },
    { id: "media", label: "음향 설정" },
  ],
  final: [],
}

export function NewsClipReviewStep({
  mode,
  project,
  settings,
  note,
  busy,
  onBack,
  onProject,
  onSettings,
  onBusy,
  onNote,
  onPreview,
  onReselect,
  onFinalized,
  onNext,
}: {
  mode: ReviewMode
  project: NewsClipProject
  settings: NewsClipSettings
  note: string
  busy: string
  onBack: () => void
  onProject: (patch: Partial<NewsClipProject>) => void
  onSettings: (patch: Partial<NewsClipSettings>) => void
  onBusy: (value: string) => void
  onNote: (value: string) => void
  onPreview: (
    force?: boolean,
    draft?: NewsClipProject
  ) => boolean | Promise<boolean>
  onReselect: (target?: "all" | "title" | "script") => void | Promise<void>
  onFinalized: (project: NewsClipProject) => boolean | Promise<boolean>
  onNext: () => void
}) {
  const [frameMode, setFrameMode] = useState<"title" | "body">("title")
  const [compositionPane, setCompositionPaneState] =
    useState<CompositionPane>("intro")

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
  const [supplementOpen, setSupplementOpen] = useState(false)
  const [supplementDraft, setSupplementDraft] = useState(
    project.supplementalContext
  )
  const editingTitleRef = useRef(false)
  const editingReportScriptRef = useRef(false)
  const reportScriptTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [selectedSubtitleId, setSelectedSubtitleId] = useState("")
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voicePlaying, setVoicePlaying] = useState(false)
  const [youtubeBusy, setYoutubeBusy] = useState(false)
  const [scheduledAt, setScheduledAt] = useState(() => nextKoreaUploadSlot())
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null)
  const scriptFrameVideoRef = useRef<HTMLVideoElement | null>(null)
  const directionVideoRef = useRef<HTMLVideoElement | null>(null)
  const renderedVideoRef = useRef<HTMLVideoElement | null>(null)
  const [selectedDirectionSceneId, setSelectedDirectionSceneId] = useState("")
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
    previewSceneLayout?.crop ??
    selectedDirectionScene?.crop ??
    project.crop
  const automaticIntroRange = selectIntroStillRange({
    ...project,
    introStillTimeSeconds: null,
  })
  const automaticIntroTime = introStillTime(automaticIntroRange)
  const introLayout = introLayoutDraft ?? snapshotIntroLayout(project)
  const introCursor =
    introLayout.introStillTimeSeconds ?? automaticIntroTime
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
  const reportScriptDirty = reportScriptDraft !== project.reportScript
  const previewBlockedReason = previewButtonBlockedReason({
    busy,
    titleValid,
    titleComplete,
    titleDirty,
    reportScriptDirty,
  })
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
    if (!editingReportScriptRef.current) {
      setReportScriptDraft(project.reportScript)
    }
  }, [project.reportScript])

  useLayoutEffect(() => {
    resizeTextareaToContent(reportScriptTextareaRef.current)
  }, [editorTab, reportScriptDraft])

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
    video.currentTime =
      frameMode === "title"
        ? 0
        : Math.min(
            Math.max(0, project.titleCardDurationSeconds),
            Math.max(0, video.duration - 0.05)
          )
  }, [
    frameMode,
    mode,
    project.outputUrl,
    project.previewUrl,
    project.titleCardDurationSeconds,
  ])

  function selectDirectionScene(sceneId: string, sourceStart: number) {
    setSelectedDirectionSceneId(sceneId)
    if (directionVideoRef.current?.readyState) {
      directionVideoRef.current.currentTime = Math.max(0, sourceStart)
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
      previewSignature: "",
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

  function finishReportScript(reportScript: string) {
    const isBuildup = project.productionMode === "buildup"
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
    const highlightBounds = buildupHighlightBounds(
      project.reportScenes,
      candidate.sourceStart,
      candidate.sourceEnd
    )
    const bodyScenes = isBuildup
      ? buildBuildupScenes(
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
      outputDurationSeconds: prepared.project.outputDurationSeconds,
      titleCardDurationSeconds: 0,
      previewSignature: "",
      renderSignature: "",
    })
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
      outputDurationSeconds: prepared.project.outputDurationSeconds,
      previewSignature: "",
      renderSignature: "",
    })
  }

  function updateSubtitleText(captionId: string, text: string) {
    onProject({
      subtitles: previewSubtitles.map((caption) =>
        caption.id === captionId ? { ...caption, text } : caption
      ),
    })
  }

  function finishSubtitleEdit(captionId: string, text: string) {
    const subtitles = updateEditedSubtitleCue(
      previewSubtitles,
      captionId,
      text,
      settings.bodySubtitleText
    )
    onProject({ subtitles })
    setSelectedSubtitleId(
      subtitles.find((caption) => caption.id === captionId)?.id ??
        subtitles[0]?.id ??
        ""
    )
  }

  function addSubtitle(afterId = selectedSubtitle?.id ?? "") {
    const subtitles = [...previewSubtitles]
    const selectedIndex = subtitles.findIndex(
      (caption) => caption.id === afterId
    )
    const insertIndex =
      selectedIndex >= 0 ? selectedIndex + 1 : subtitles.length
    const reference = subtitles[selectedIndex] ?? subtitles.at(-1)
    const id = `manual-caption-${crypto.randomUUID()}`

    if (reference) {
      const referenceIndex = subtitles.findIndex(
        (caption) => caption.id === reference.id
      )
      const middle = reference.start + (reference.end - reference.start) / 2
      subtitles[referenceIndex] = { ...reference, end: middle }
      subtitles.splice(insertIndex, 0, {
        id,
        start: middle,
        end: reference.end,
        text: "",
        emphasis: [],
        emphasisColor: "yellow",
      })
    } else {
      subtitles.push({
        id,
        start: 0,
        end: Math.max(
          0.5,
          project.outputDurationSeconds -
            settings.titleCardSeconds -
            NEWS_TOTAL_GAP_SECONDS
        ),
        text: "",
        emphasis: [],
        emphasisColor: "yellow",
      })
    }

    onProject({ subtitles })
    setSelectedSubtitleId(id)
    setCompositionPane("body")
  }

  function removeSubtitle(captionId: string) {
    const index = previewSubtitles.findIndex(
      (caption) => caption.id === captionId
    )
    if (index < 0) return
    const removed = previewSubtitles[index]
    const subtitles = previewSubtitles.filter(
      (caption) => caption.id !== captionId
    )
    if (subtitles[index]) {
      subtitles[index] = { ...subtitles[index], start: removed.start }
    } else if (subtitles[index - 1]) {
      subtitles[index - 1] = { ...subtitles[index - 1], end: removed.end }
    }
    onProject({ subtitles })
    setSelectedSubtitleId(
      subtitles[Math.min(index, subtitles.length - 1)]?.id ?? ""
    )
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

  async function render(force = false) {
    onBusy("render")
    onNote("")
    try {
      const response = await fetch("/api/news-clips/render", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project, settings, force }),
      })
      const body = (await response.json()) as {
        message?: string
        outputUrl?: string
        thumbnailUrl?: string
        signature?: string
        titleCardDurationSeconds?: number
        outputDurationSeconds?: number
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
        subtitles: body.subtitles ?? project.subtitles,
        reportScenes: body.reportScenes ?? project.reportScenes,
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
  // 3번(preview)은 편집용 프레임만. 렌더된 초안/최종 시청은 4번(final).
  const renderedVideoUrl =
    mode === "final" ? project.outputUrl || project.previewUrl : ""
  const finalStageLabel = project.outputUrl
    ? "최종본"
    : project.previewUrl
      ? "미리보기"
      : "대기"
  const uploadAt = scheduleForUpload(scheduledAt)
  const scheduleInWindow =
    inKoreaUploadWindow(scheduledAt) && uploadAt === scheduledAt

  function draftProjectForPreview(): NewsClipProject | null {
    let draft = project
    if (titleDirty) {
      if (!titleValid) {
        onNote(
          titleComplete
            ? "인트로 제목 폭이 초과됐습니다. 길이를 줄여 주세요."
            : "인트로 제목 1단·2단을 모두 입력해 주세요."
        )
        return null
      }
      finishTitleEdit(titleDraft)
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
      const isBuildup = draft.productionMode === "buildup"
      const completeReportScript = ensureReportEndCta(
        reportScriptDraft,
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
      const highlightBounds = buildupHighlightBounds(
        draft.reportScenes,
        candidate.sourceStart,
        candidate.sourceEnd
      )
      const bodyScenes = isBuildup
        ? buildBuildupScenes(
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
      finishReportScript(reportScriptDraft)
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
      }
    }
    const preparedDraft = prepareRenderProject(draft, settings)
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
    const draft = draftProjectForPreview()
    if (!draft) return
    const created = await onPreview(Boolean(draft.previewUrl), draft)
    if (created) onNext()
  }

  return (
    <>
      <header>
        <h2 className="text-xl font-semibold">{heading.title}</h2>
      </header>
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
              ariaLabel="미리보기 화면"
              value={compositionPane}
              onChange={setCompositionPane}
              items={[
                { id: "intro", label: "인트로" },
                { id: "body", label: "본문" },
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
            <video
              ref={directionVideoRef}
              key={`${directionSourceVideoUrl}-${previewDirectionScene?.id ?? "scene"}`}
              src={directionSourceVideoUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-2xl bg-black shadow-xl"
              onLoadedMetadata={(event) => {
                event.currentTarget.playbackRate = NEWS_SOURCE_PLAYBACK_RATE
                if (Number.isFinite(event.currentTarget.duration)) {
                  setDirectionSourceMetadata({
                    url: directionSourceVideoUrl,
                    duration: event.currentTarget.duration,
                  })
                }
                event.currentTarget.currentTime = Math.max(
                  0,
                  previewSceneLayout?.sourceStart ??
                    previewDirectionScene?.sourceStart ??
                    0
                )
              }}
            />
          ) : mode === "final" ? (
            renderedVideoUrl ? (
              <video
                ref={renderedVideoRef}
                key={`${renderedVideoUrl}-${project.previewSignature}-${project.renderSignature}`}
                src={renderedVideoUrl}
                controls
                playsInline
                className="aspect-[9/16] w-full rounded-2xl bg-black shadow-xl"
              />
            ) : (
              <div className="flex aspect-[9/16] w-full items-center justify-center rounded-2xl border border-dashed border-separator bg-default px-6 text-center text-sm text-muted">
                미리보기를 만들면 여기에 재생됩니다.
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
            ) : (
              <span>
                예상 길이 {project.outputDurationSeconds.toFixed(1)}초
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {editorTabs.length > 1 ? (
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
                if (tabId === "captions") setCompositionPane("body")
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

          {(mode === "script" || mode === "preview") &&
          editorTab === "script" ? (
            <Card>
              <Card.Header className="min-h-16 flex-row items-end justify-between gap-4 border-b border-separator pb-4">
                <div>
                  <Card.Title className={cardTitleClass}>
                    {project.productionMode === "buildup"
                      ? "제목·빌드업 서두"
                      : "제목·시사 논평 대본"}
                  </Card.Title>
                  <Card.Description className={cardDescriptionClass}>
                    {project.productionMode === "buildup"
                      ? "서두·마무리만 TTS. 본편은 원본 영상·음성이고 자막은 전사를 씁니다."
                      : "논평은 TTS로 읽고, 직접 발언은 원본 음성을 씁니다."}
                  </Card.Description>
                </div>
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
              </Card.Header>
              <Card.Content className="flex flex-col gap-6">
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
                <div className="flex flex-col gap-3 border-t border-separator pt-5">
                  <div className={sectionHeaderClass}>
                    <span className="flex items-center gap-2">
                      <label
                        htmlFor="news-clip-report-script"
                        className={sectionTitleClass}
                      >
                        {project.productionMode === "buildup"
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
                        onPress={() => finishReportScript(reportScriptDraft)}
                      >
                        저장
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        isDisabled={buttonBusyDisabled(busy, "rewrite-script")}
                        onPress={() => void onReselect("script")}
                      >
                        <LoadingButtonLabel
                          loading={busyMatches(busy, "rewrite-script")}
                          label="다시 작성"
                          loadingLabel="작성 중"
                        />
                      </Button>
                    </span>
                  </div>
                  <textarea
                    ref={reportScriptTextareaRef}
                    id="news-clip-report-script"
                    aria-label={
                      project.productionMode === "buildup"
                        ? "빌드업 서두"
                        : "시사 논평 대본"
                    }
                    rows={1}
                    value={reportScriptDraft}
                    onFocus={() => {
                      editingReportScriptRef.current = true
                    }}
                    onChange={(event) => {
                      resizeTextareaToContent(event.currentTarget)
                      setReportScriptDraft(event.currentTarget.value)
                    }}
                    onBlur={() => {
                      editingReportScriptRef.current = false
                    }}
                    className={`${field} [field-sizing:content] min-h-24 resize-none overflow-hidden`}
                  />
                </div>
              </Card.Content>
            </Card>
          ) : null}

          {mode === "script" && editorTab === "captions" ? (
            <Card>
              <Card.Header className="flex-row items-start justify-between gap-4">
                <div>
                  <Card.Title className={cardTitleClass}>
                    문장별 자막 편집
                  </Card.Title>
                  <Card.Description className={cardDescriptionClass}>
                    문구·구간을 수정하며 최대 2줄로 맞춥니다.
                  </Card.Description>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto shrink-0"
                  onPress={() => addSubtitle()}
                >
                  <Plus className="size-4" /> 자막 추가
                </Button>
              </Card.Header>
              <Card.Content className="flex flex-col gap-3">
                {previewSubtitles.length ? (
                  previewSubtitles.map((caption, index) => {
                    const selected = caption.id === selectedSubtitle?.id
                    return (
                      <div
                        key={caption.id}
                        className={`flex w-full flex-col gap-3 rounded-xl border p-3 transition ${
                          selected
                            ? "border-foreground/35 bg-default"
                            : "border-separator"
                        }`}
                      >
                        <div className="flex min-h-8 items-center justify-between gap-3">
                          <span className="text-xs text-muted">
                            자막 {index + 1}
                            <span className="ml-2 tabular-nums">
                              {time(caption.start)}–{time(caption.end)}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span className="text-xs text-muted">
                              {caption.text.split("\n").length}/2줄
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              isIconOnly
                              aria-label={`자막 ${index + 1} 삭제`}
                              onPress={() => removeSubtitle(caption.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </span>
                        </div>
                        <textarea
                          rows={2}
                          value={caption.text}
                          aria-label={`자막 ${index + 1} 내용`}
                          placeholder="자막 내용을 입력하세요."
                          className={field}
                          onFocus={() => {
                            setSelectedSubtitleId(caption.id)
                            setCompositionPane("body")
                          }}
                          onChange={(event) =>
                            updateSubtitleText(
                              caption.id,
                              event.currentTarget.value
                            )
                          }
                          onBlur={(event) =>
                            finishSubtitleEdit(
                              caption.id,
                              event.currentTarget.value
                            )
                          }
                        />
                      </div>
                    )
                  })
                ) : (
                  <p className="text-sm text-muted">
                    대본을 입력하면 자막이 생깁니다.
                  </p>
                )}
              </Card.Content>
            </Card>
          ) : null}

          {(mode === "direction" || mode === "preview") &&
          editorTab === "scenes" ? (
            <Card>
              <Card.Header>
                <Card.Title className={cardTitleClass}>화면 구성</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-6">
                {mode === "preview" ? (
                  <SegmentedTabs
                    ariaLabel="화면 구성"
                    value={compositionPane}
                    onChange={setCompositionPane}
                    items={[
                      { id: "intro", label: "인트로" },
                      { id: "body", label: "본문" },
                    ]}
                  />
                ) : null}
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
                            {axisPosition(introLayout.introStillY, "위", "아래")}
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
                {mode === "direction" || compositionPane === "body" ? (
                  <div className="flex flex-col gap-3">
                    {project.reportScenes.length ? (
                      project.reportScenes.map((scene, index) => {
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
                                  <span className="text-warning">저장 전</span>
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
                                <SourceRangeTimeline
                                  scene={draftScene}
                                  sourceId={
                                    scene.sourceId || project.source?.id || ""
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
                                  onStartChange={(sourceStart) => {
                                    selectDirectionScene(scene.id, sourceStart)
                                    patchSceneLayoutDraft(scene, {
                                      sourceStart,
                                    })
                                  }}
                                  onEndChange={(sourceEnd) => {
                                    selectDirectionScene(
                                      scene.id,
                                      Math.max(
                                        layout.sourceStart,
                                        sourceEnd - 0.1
                                      )
                                    )
                                    patchSceneLayoutDraft(scene, { sourceEnd })
                                  }}
                                />
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

          {mode === "preview" && editorTab === "captions" ? (
            <Card>
              <Card.Header className="flex-row items-center justify-between gap-4">
                <Card.Title className={cardTitleClass}>
                  자막·강조 단어
                </Card.Title>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto shrink-0"
                  onPress={() => addSubtitle()}
                >
                  <Plus className="size-4" /> 자막 추가
                </Button>
              </Card.Header>
              <Card.Content className="divide-y divide-separator">
                {project.subtitles.map((caption, index) => (
                  <div
                    key={caption.id}
                    className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">
                        자막 {index + 1}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted tabular-nums">
                          {time(caption.start)} → {time(caption.end)}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          isIconOnly
                          aria-label={`자막 ${index + 1} 삭제`}
                          onPress={() => removeSubtitle(caption.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </span>
                    </div>
                    <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                      <label className="flex min-w-0 flex-col gap-2">
                        <span className="text-sm">자막</span>
                        <textarea
                          rows={2}
                          value={caption.text}
                          onFocus={() => {
                            setSelectedSubtitleId(caption.id)
                            setCompositionPane("body")
                          }}
                          onChange={(event) =>
                            onProject({
                              subtitles: project.subtitles.map((item) =>
                                item.id === caption.id
                                  ? {
                                      ...item,
                                      text: event.currentTarget.value,
                                    }
                                  : item
                              ),
                            })
                          }
                          onBlur={(event) =>
                            onProject({
                              subtitles: updateEditedSubtitleCue(
                                project.subtitles,
                                caption.id,
                                event.currentTarget.value,
                                settings.bodySubtitleText
                              ),
                            })
                          }
                          className={field}
                        />
                      </label>
                      <label className="flex min-w-0 flex-col gap-2">
                        <span className="text-sm">강조 단어</span>
                        <input
                          value={caption.emphasis.join(", ")}
                          onFocus={() => {
                            setSelectedSubtitleId(caption.id)
                            setCompositionPane("body")
                          }}
                          onChange={(event) =>
                            onProject({
                              subtitles: project.subtitles.map((item) =>
                                item.id === caption.id
                                  ? {
                                      ...item,
                                      emphasis: event.currentTarget.value
                                        .split(",")
                                        .map((word) => word.trim())
                                        .filter(Boolean),
                                    }
                                  : item
                              ),
                            })
                          }
                          className={field}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </Card.Content>
            </Card>
          ) : null}

          {(mode === "direction" || mode === "preview") &&
          editorTab === "media" ? (
            <Card>
              <Card.Header className="min-h-16">
                <Card.Title className={cardTitleClass}>음향 설정</Card.Title>
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
                      onChange={(event) =>
                        selectProvider(event.currentTarget.value)
                      }
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
                        <span className="text-sm font-medium">
                          Typecast 목소리
                        </span>
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
          ) : null}

          {mode === "final" ? (
            <>
              <Card>
                <Card.Header className="min-h-16">
                  <Card.Title className={cardTitleClass}>
                    {finalStageLabel}
                  </Card.Title>
                  <Card.Description className={cardDescriptionClass}>
                    초안을 확인한 뒤 최종본으로 변환합니다.
                  </Card.Description>
                </Card.Header>
                <Card.Content className="flex flex-col gap-4">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      isDisabled={
                        busyMatches(busy, "preview")
                          ? false
                          : Boolean(previewBlockedReason)
                      }
                      onPress={() => void onPreview(true)}
                    >
                      <LoadingButtonLabel
                        loading={busyMatches(busy, "preview")}
                        label="미리보기 다시 만들기"
                        loadingLabel="미리보기 만드는 중"
                      />
                    </Button>
                    <Button
                      isDisabled={
                        busyMatches(busy, "render")
                          ? false
                          : Boolean(previewBlockedReason) || !project.previewUrl
                      }
                      onPress={() => void render(Boolean(project.outputUrl))}
                    >
                      <LoadingButtonLabel
                        loading={busyMatches(busy, "render")}
                        label={
                          project.outputUrl
                            ? "최종본 다시 만들기"
                            : "최종본으로 변환"
                        }
                        loadingLabel="최종본 만드는 중"
                      />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {project.outputUrl ? (
                      <a className="text-sm underline" href={project.outputUrl}>
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
                    YouTube 예약 업로드
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
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      isDisabled={
                        youtubeBusy
                          ? false
                          : !project.outputUrl || !!project.youtubeUploadUrl
                      }
                      onPress={() => void uploadFinalToYoutube()}
                    >
                      <LoadingButtonLabel
                        loading={youtubeBusy}
                        label="예약 업로드"
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
              buttonBusyDisabled(busy, "preview") ||
              !project.title ||
              !project.reportScript ||
              !titleValid ||
              titleDirty ||
              reportScriptDirty
            }
            onPress={() => void createPreviewAndContinue()}
          >
            <LoadingButtonLabel
              loading={busyMatches(busy, "preview")}
              label="다음"
              loadingLabel="초안 만드는 중"
            />
          </Button>
        ) : null}
        {mode === "direction" ? (
          <Button
            isDisabled={
              buttonBusyDisabled(busy, "preview") ||
              project.reportScenes.length === 0
            }
            onPress={() => void createPreviewAndContinue()}
          >
            <LoadingButtonLabel
              loading={busyMatches(busy, "preview")}
              label="초안 만들기"
              loadingLabel="만드는 중"
            />
          </Button>
        ) : null}
        {mode === "preview" ? (
          <Button
            isDisabled={busyMatches(busy, "preview") ? false : busy !== ""}
            onPress={() => void createPreviewAndContinue()}
          >
            <LoadingButtonLabel
              loading={busyMatches(busy, "preview")}
              label={
                project.previewUrl
                  ? "미리보기 다시 만들기"
                  : "미리보기 만들기"
              }
              loadingLabel="미리보기 만드는 중"
            />
          </Button>
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
    title: "대본 검수",
  },
  direction: {
    title: "화면 연출",
  },
  preview: {
    title: "검수·수정",
  },
  final: {
    title: "미리보기·업로드",
  },
} satisfies Record<
  Exclude<NewsClipStep, "issue" | "source" | "angles">,
  { title: string }
>

function SourceRangeTimeline({
  scene,
  sourceId,
  duration,
  onStartChange,
  onEndChange,
}: {
  scene: NewsReportScene
  sourceId: string
  duration: number
  onStartChange: (value: number) => void
  onEndChange: (value: number) => void
}) {
  const safeDuration = Math.max(0.1, duration, scene.sourceEnd)
  const start = Math.max(0, Math.min(scene.sourceStart, safeDuration - 0.1))
  const end = Math.max(start + 0.1, Math.min(scene.sourceEnd, safeDuration))
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
          {time(start)} → {time(end)} · {(end - start).toFixed(1)}초
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
          aria-label="영상 구간 시작"
          type="range"
          min={0}
          max={safeDuration}
          step={0.1}
          value={start}
          onChange={(event) =>
            onStartChange(
              Math.min(Number(event.currentTarget.value), end - 0.1)
            )
          }
          className="source-range-input z-10"
        />
        <input
          aria-label="영상 구간 종료"
          type="range"
          min={0}
          max={safeDuration}
          step={0.1}
          value={end}
          onChange={(event) =>
            onEndChange(
              Math.max(Number(event.currentTarget.value), start + 0.1)
            )
          }
          className="source-range-input z-20"
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
