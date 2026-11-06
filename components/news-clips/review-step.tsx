"use client"

import { useEffect, useRef, useState } from "react"

import { Button, Card, Modal } from "@heroui/react"
import { Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react"
import { NewsFramePreview } from "@/components/news-clips/frame-preview"
import { LoadingButtonLabel } from "@/components/news-clips/loading-button-label"
import { introStillTime, selectIntroStillRange } from "@/lib/news-clips/intro"
import { newsRenderSettingsKey } from "@/lib/news-clips/render-key"
import {
  bodyDurationWithEndCta,
  buildReportScenes,
  contextualEndCtaText,
  estimateReportScenesDuration,
  reportCaptionPhrases,
  reportSubtitles,
  withEndCta,
} from "@/lib/news-clips/report"
import {
  fitTitleToLineLayouts,
  normalizeSubtitleCues,
  retimeSubtitleCues,
  splitIntroTitleLines,
  titleLineCharacterLimit,
  titleLineFits,
  updateEditedSubtitleCue,
} from "@/lib/news-clips/text-layout"
import type {
  NewsClipProject,
  NewsClipSettings,
  NewsClipStep,
} from "@/lib/news-clips/types"
import { NEWS_TTS_VOICES, newsTtsVoiceById } from "@/lib/news-clips/voices"

const field =
  "w-full rounded-xl border border-separator bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"

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
  mode: Exclude<NewsClipStep, "issue" | "source">
  project: NewsClipProject
  settings: NewsClipSettings
  note: string
  busy: string
  onBack: () => void
  onProject: (patch: Partial<NewsClipProject>) => void
  onSettings: (patch: Partial<NewsClipSettings>) => void
  onBusy: (value: string) => void
  onNote: (value: string) => void
  onPreview: (force?: boolean) => boolean | Promise<boolean>
  onReselect: (target?: "all" | "title" | "script") => void | Promise<void>
  onFinalized: (project: NewsClipProject) => boolean | Promise<boolean>
  onNext: () => void
}) {
  const [frameMode, setFrameMode] = useState<"title" | "body">("body")
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
  const [selectedSubtitleId, setSelectedSubtitleId] = useState("")
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voicePlaying, setVoicePlaying] = useState(false)
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null)
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null)
  const scriptFrameVideoRef = useRef<HTMLVideoElement | null>(null)
  const directionVideoRef = useRef<HTMLVideoElement | null>(null)
  const [selectedDirectionSceneId, setSelectedDirectionSceneId] = useState(
    project.reportScenes[0]?.id ?? ""
  )
  const selectedDirectionScene =
    project.reportScenes.find(
      (scene) => scene.id === selectedDirectionSceneId
    ) ?? project.reportScenes[0]
  const automaticIntroRange = selectIntroStillRange({
    ...project,
    introStillTimeSeconds: null,
  })
  const automaticIntroTime = introStillTime(automaticIntroRange)
  const introCursor = project.introStillTimeSeconds ?? automaticIntroTime
  const [sourceDuration, setSourceDuration] = useState(() =>
    initialSourceDuration(project)
  )
  const sourceVideoUrl = project.source?.id
    ? `/api/news-clips/source-file?sourceId=${encodeURIComponent(project.source.id)}`
    : ""
  const sourceVideoUrlFor = (sourceId?: string) =>
    sourceId
      ? `/api/news-clips/source-file?sourceId=${encodeURIComponent(sourceId)}`
      : sourceVideoUrl
  const directionSourceVideoUrl = sourceVideoUrlFor(
    selectedDirectionScene?.sourceId || project.source?.id
  )
  const scriptBodyVideoUrl = sourceVideoUrlFor(
    project.reportScenes[0]?.sourceId || project.source?.id
  )
  const introVideoUrl = sourceVideoUrlFor(
    project.introStillTimeSeconds === null
      ? automaticIntroRange.sourceId || project.source?.id
      : project.source?.id
  )
  const minimum = settings.targetMinSeconds
  const maximum = settings.targetMaxSeconds
  const durationRecommended =
    project.outputDurationSeconds >= minimum &&
    project.outputDurationSeconds <= maximum
  const durationRenderable =
    project.outputDurationSeconds > 0 &&
    project.outputDurationSeconds < settings.hardMaxSeconds
  const titleDraft = composeIntroTitle(titleLine1Draft, titleLine2Draft)
  const titleDirty = titleDraft !== project.title
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

  useEffect(() => {
    const video = sourceVideoRef.current
    if (video?.readyState) video.currentTime = introCursor
  }, [introCursor, introVideoUrl])

  useEffect(() => {
    const video = scriptFrameVideoRef.current
    if (mode !== "script" || !video?.readyState) return
    video.currentTime =
      frameMode === "title"
        ? introCursor
        : Math.max(0, project.reportScenes[0]?.sourceStart ?? 0)
  }, [
    frameMode,
    introCursor,
    introVideoUrl,
    mode,
    project.reportScenes,
    scriptBodyVideoUrl,
  ])

  useEffect(() => {
    const video = directionVideoRef.current
    if (mode === "direction" && video?.readyState) {
      video.currentTime = Math.max(0, selectedDirectionScene?.sourceStart ?? 0)
    }
  }, [
    mode,
    selectedDirectionScene?.id,
    selectedDirectionScene?.sourceStart,
    selectedDirectionScene?.visual,
    directionSourceVideoUrl,
  ])

  function selectDirectionScene(sceneId: string, sourceStart: number) {
    setSelectedDirectionSceneId(sceneId)
    if (directionVideoRef.current?.readyState) {
      directionVideoRef.current.currentTime = Math.max(0, sourceStart)
    }
  }

  function selectIntroStill(value: number) {
    const max = Math.max(0, sourceDuration - 0.05)
    const introStillTimeSeconds = Math.max(0, Math.min(max, value))
    if (sourceVideoRef.current) {
      sourceVideoRef.current.currentTime = introStillTimeSeconds
    }
    setFrameMode("title")
    onProject({ introStillTimeSeconds })
  }

  function restoreAutomaticIntroStill() {
    if (sourceVideoRef.current) {
      sourceVideoRef.current.currentTime = automaticIntroTime
    }
    setFrameMode("title")
    onProject({ introStillTimeSeconds: null })
  }

  function finishReportScript(reportScript: string) {
    const candidate = project.candidates.find(
      (item) => item.id === project.selectedCandidateId
    )
    if (!candidate) {
      onProject({ reportScript })
      return
    }
    const reportScenes = buildReportScenes(
      reportScript,
      project.transcript,
      candidate.sourceStart,
      candidate.sourceEnd,
      project.reportScenes,
      project.source?.id ?? ""
    )
    const bodyDuration = estimateReportScenesDuration(
      reportScenes,
      settings.titleVoiceRate
    )
    const outputBodyDuration = bodyDurationWithEndCta(bodyDuration)
    onProject({
      reportScript,
      reportScenes,
      subtitles: withEndCta(
        normalizeSubtitleCues(
          reportSubtitles(
            reportScenes,
            undefined,
            reportCaptionPhrases(reportScript)
          ),
          settings.bodySubtitleText
        ),
        outputBodyDuration,
        contextualEndCtaText(
          project.title,
          project.selectedIssue?.keywords,
          reportScript
        ),
        bodyDuration
      ),
      outputDurationSeconds: settings.titleCardSeconds + outputBodyDuration,
      titleCardDurationSeconds: 0,
    })
  }

  function finishTitleEdit(title: string) {
    onProject({
      title,
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
    const bodyDuration = estimateReportScenesDuration(
      reportScenes,
      settings.titleVoiceRate
    )
    onProject({
      reportScenes,
      subtitles: retimeSubtitleCues(project.subtitles, bodyDuration),
      outputDurationSeconds: settings.titleCardSeconds + bodyDuration,
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
          project.outputDurationSeconds - settings.titleCardSeconds
        ),
        text: "",
        emphasis: [],
        emphasisColor: "yellow",
      })
    }

    onProject({ subtitles })
    setSelectedSubtitleId(id)
    setFrameMode("body")
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

  async function render() {
    onBusy("render")
    onNote("")
    try {
      const response = await fetch("/api/news-clips/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project, settings }),
      })
      const body = (await response.json()) as {
        message?: string
        outputUrl?: string
        thumbnailUrl?: string
        signature?: string
        titleCardDurationSeconds?: number
        outputDurationSeconds?: number
        subtitles?: NewsClipProject["subtitles"]
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
      }
      const finalizedProject = { ...project, ...patch }
      onProject(patch)
      const saved = await Promise.resolve(onFinalized(finalizedProject)).catch(
        () => false
      )
      onNote(
        saved
          ? body.message || "최종 결과물을 만들었습니다."
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

  const heading = REVIEW_STEP_COPY[mode]
  const renderedVideoUrl =
    mode === "final"
      ? project.outputUrl || project.previewUrl
      : mode === "preview"
        ? project.previewUrl
        : ""

  async function createPreviewAndContinue() {
    const created = await onPreview()
    if (created) onNext()
  }

  async function renderAndContinue() {
    const rendered = await render()
    if (rendered) onNext()
  }

  return (
    <>
      <header>
        <p className="text-sm font-medium text-muted">{heading.eyebrow}</p>
        <h2 className="mt-1 text-xl font-semibold">{heading.title}</h2>
        <p className="mt-1 text-sm text-muted">{heading.description}</p>
        <div className="mt-3 rounded-xl border border-separator bg-default px-4 py-3 text-sm">
          <span className="font-medium">완료 기준</span>
          <span className="ml-2 text-muted">{heading.completion}</span>
        </div>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className="sticky top-6 flex flex-col gap-3">
          {mode === "script" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={frameMode === "title" ? "secondary" : "outline"}
                onPress={() => setFrameMode("title")}
              >
                제목 프레임
              </Button>
              <Button
                size="sm"
                variant={frameMode === "body" ? "secondary" : "outline"}
                onPress={() => setFrameMode("body")}
              >
                자막 프레임
              </Button>
            </div>
          ) : null}
          {mode === "script" ? (
            <NewsFramePreview
              mode={frameMode}
              title={titleDraft}
              subtitle={
                selectedSubtitle?.text ||
                "아나운서 음성에 맞춰 자막이 표시됩니다"
              }
              settings={settings}
              zoom={project.crop.zoom}
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
                      transform: `scale(${project.introStillZoom})`,
                      transformOrigin: `${project.introStillX}% ${project.introStillY}%`,
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
                      transform: `scale(${Math.max(1.22, project.crop.zoom)})`,
                      transformOrigin: `${project.crop.x}% ${project.crop.y}%`,
                    }}
                    onLoadedMetadata={(event) => {
                      event.currentTarget.currentTime = Math.max(
                        0,
                        project.reportScenes[0]?.sourceStart ?? 0
                      )
                    }}
                  />
                ) : undefined
              }
            />
          ) : mode === "direction" && directionSourceVideoUrl ? (
            <video
              ref={directionVideoRef}
              key={`${directionSourceVideoUrl}-${selectedDirectionScene?.id ?? "scene"}`}
              src={directionSourceVideoUrl}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-2xl bg-black shadow-xl"
              onLoadedMetadata={(event) => {
                event.currentTarget.currentTime = Math.max(
                  0,
                  selectedDirectionScene?.sourceStart ?? 0
                )
              }}
            />
          ) : renderedVideoUrl ? (
            <video
              key={renderedVideoUrl}
              src={renderedVideoUrl}
              controls
              playsInline
              className="aspect-[9/16] w-full rounded-2xl bg-black shadow-xl"
            />
          ) : (
            <NewsFramePreview
              mode="body"
              title={titleDraft}
              subtitle={
                selectedSubtitle?.text ||
                "아나운서 음성에 맞춰 자막이 표시됩니다"
              }
              settings={settings}
              zoom={project.crop.zoom}
            />
          )}
          {mode === "preview" ? (
            <div className="grid gap-2">
              <Button
                size="sm"
                variant="outline"
                isDisabled={
                  busy !== "" || !titleValid || titleDirty || reportScriptDirty
                }
                onPress={() => void onPreview(true)}
              >
                <LoadingButtonLabel
                  loading={busy === "preview"}
                  label="영상 다시 만들기"
                  loadingLabel="만드는 중"
                />
              </Button>
            </div>
          ) : null}
          {mode === "preview" && !project.previewSignature ? (
            <p className="text-xs text-warning">
              수정 내용은 초안을 갱신한 뒤 영상에 반영됩니다.
            </p>
          ) : null}
          <div
            className={`rounded-xl p-3 text-sm ${
              durationRecommended
                ? "bg-success/10 text-success"
                : durationRenderable
                  ? "bg-warning/10 text-warning"
                  : "bg-danger/10 text-danger"
            }`}
          >
            예상 길이 {project.outputDurationSeconds.toFixed(1)}초 · 기준{" "}
            {minimum}~{maximum}초
            {project.titleCardDurationSeconds > 0
              ? ` · 제목 TTS ${project.titleCardDurationSeconds.toFixed(1)}초`
              : ""}
            {project.outputDurationSeconds >= settings.idealMinSeconds &&
            project.outputDurationSeconds <= settings.idealMaxSeconds
              ? " · 목표 범위"
              : durationRecommended
                ? " · 권장 범위"
                : durationRenderable
                  ? " · 권장 범위 밖 · 제작 가능"
                  : " · 59초 미만으로 조정 필요"}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {mode === "direction" ? (
            <Card>
              <Card.Header>
                <Card.Title>대본 공통 TTS</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
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
                    isDisabled={voiceBusy}
                    onPress={() => {
                      if (voicePlaying) {
                        stopVoicePreview()
                        onNote("TTS 미리듣기를 멈췄습니다.")
                      } else {
                        void previewVoice()
                      }
                    }}
                  >
                    {voicePlaying ? (
                      <Square className="size-4 fill-current" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    {voiceBusy
                      ? "음성 생성 중"
                      : voicePlaying
                        ? "미리듣기 멈추기"
                        : "음성 미리듣기"}
                  </Button>
                </div>
              </Card.Content>
            </Card>
          ) : null}

          {mode === "script" || mode === "preview" ? (
            <Card>
              <Card.Header className="flex-row items-start justify-between gap-4">
                <div>
                  <Card.Title>제목·시사 논평 대본</Card.Title>
                  <Card.Description>
                    논평은 TTS로 읽고, 직접 발언은 원본 음성을 씁니다.
                  </Card.Description>
                </div>
                {mode === "script" ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      isDisabled={busy !== ""}
                      onPress={() => void onReselect("all")}
                    >
                      <LoadingButtonLabel
                        loading={busy === "reselect"}
                        label="대본 재작성"
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
              <Card.Content className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="flex min-h-8 items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <span>인트로 제목</span>
                      {titleDirty ? (
                        <span className="text-xs text-warning">저장 전</span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <Button
                        size="sm"
                        isDisabled={busy !== "" || !titleDirty || !titleValid}
                        onPress={() => finishTitleEdit(titleDraft)}
                      >
                        저장
                      </Button>
                      {mode === "script" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          isDisabled={busy !== ""}
                          onPress={() => void onReselect("title")}
                        >
                          <LoadingButtonLabel
                            loading={busy === "rewrite-title"}
                            label="다시 작성"
                            loadingLabel="작성 중"
                          />
                        </Button>
                      ) : null}
                    </span>
                  </span>
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
                <div className="flex flex-col gap-2">
                  <span className="flex min-h-8 items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      <label htmlFor="news-clip-report-script">
                        시사 논평 대본
                      </label>
                      {reportScriptDirty ? (
                        <span className="text-xs text-warning">저장 전</span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <Button
                        size="sm"
                        isDisabled={busy !== "" || !reportScriptDirty}
                        onPress={() => finishReportScript(reportScriptDraft)}
                      >
                        저장
                      </Button>
                      {mode === "script" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          isDisabled={busy !== ""}
                          onPress={() => void onReselect("script")}
                        >
                          <LoadingButtonLabel
                            loading={busy === "rewrite-script"}
                            label="다시 작성"
                            loadingLabel="작성 중"
                          />
                        </Button>
                      ) : null}
                    </span>
                  </span>
                  <textarea
                    id="news-clip-report-script"
                    aria-label="시사 논평 대본"
                    rows={9}
                    value={reportScriptDraft}
                    onFocus={() => {
                      editingReportScriptRef.current = true
                    }}
                    onChange={(event) =>
                      setReportScriptDraft(event.currentTarget.value)
                    }
                    onBlur={() => {
                      editingReportScriptRef.current = false
                    }}
                    className={field}
                  />
                </div>
              </Card.Content>
            </Card>
          ) : null}

          {mode === "preview" && introVideoUrl ? (
            <Card>
              <Card.Header className="flex-row items-center justify-between gap-4">
                <div>
                  <Card.Title>인트로 이미지</Card.Title>
                  <Card.Description>
                    인트로에 쓸 장면을 고릅니다.
                  </Card.Description>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  isDisabled={project.introStillTimeSeconds === null}
                  onPress={restoreAutomaticIntroStill}
                >
                  <RotateCcw className="size-4" /> 자동 선택
                </Button>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
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
                        transform: `scale(${project.introStillZoom})`,
                        transformOrigin: `${project.introStillX}% ${project.introStillY}%`,
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
                      {project.introStillTimeSeconds === null
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
                      {ratioPercent(project.introStillZoom)}
                    </span>
                  </span>
                  <input
                    aria-label="인트로 이미지 추가 확대"
                    type="range"
                    min={1}
                    max={1.8}
                    step={0.01}
                    value={project.introStillZoom}
                    onChange={(event) =>
                      onProject({
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
                        {axisPosition(project.introStillX, "왼쪽", "오른쪽")}
                      </span>
                    </span>
                    <input
                      aria-label="인트로 이미지 좌우 위치"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={project.introStillX}
                      onChange={(event) =>
                        onProject({
                          introStillX: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-2">
                    <span className="flex items-center justify-between text-sm">
                      <span>위아래 위치</span>
                      <span className="text-muted tabular-nums">
                        {axisPosition(project.introStillY, "위", "아래")}
                      </span>
                    </span>
                    <input
                      aria-label="인트로 이미지 위아래 위치"
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={project.introStillY}
                      onChange={(event) =>
                        onProject({
                          introStillY: Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                </div>
              </Card.Content>
            </Card>
          ) : null}

          {mode === "script" ? (
            <Card>
              <Card.Header className="flex-row items-start justify-between gap-4">
                <div>
                  <Card.Title>문장별 자막 편집</Card.Title>
                  <Card.Description>
                    문구·구간을 수정하며 최대 2줄로 맞춥니다.
                  </Card.Description>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
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
                            setFrameMode("body")
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

          {mode === "direction" || mode === "preview" ? (
            <Card>
              <Card.Header>
                <Card.Title>
                  문장별 화면 구성 · 핵심 {project.source ? 1 : 0}개 + 보조{" "}
                  {project.supportingSources.length}개
                </Card.Title>
                <Card.Description>
                  자료는 TTS 유지, 직접 발언만 원본 음성입니다.
                </Card.Description>
              </Card.Header>
              <Card.Content className="flex flex-col gap-3">
                {project.reportScenes.length ? (
                  project.reportScenes.map((scene, index) => (
                    <div
                      key={scene.id}
                      className={`grid gap-3 rounded-xl border p-3 md:grid-cols-[76px_1fr] ${
                        mode === "direction" &&
                        scene.id === selectedDirectionScene?.id
                          ? "border-foreground/35 bg-default"
                          : "border-separator"
                      }`}
                    >
                      {mode === "direction" ? (
                        <Button
                          size="sm"
                          variant={
                            scene.id === selectedDirectionScene?.id
                              ? "secondary"
                              : "ghost"
                          }
                          className="justify-start"
                          onPress={() =>
                            selectDirectionScene(scene.id, scene.sourceStart)
                          }
                        >
                          문장 {index + 1}
                        </Button>
                      ) : (
                        <span className="pt-2 text-xs text-muted">
                          문장 {index + 1}
                        </span>
                      )}
                      <div className="flex min-w-0 flex-col gap-3">
                        <p className="text-sm leading-6">{scene.narration}</p>
                        <div className="flex flex-col gap-3">
                          <label className="flex w-full flex-col gap-2">
                            <span className="text-sm">사용 자료</span>
                            <select
                              aria-label={`문장 ${index + 1} 사용 자료`}
                              value={scene.sourceId || project.source?.id || ""}
                              onChange={(event) =>
                                updateReportScene(scene.id, {
                                  sourceId: event.currentTarget.value,
                                })
                              }
                              className={field}
                            >
                              {project.source ? (
                                <option value={project.source.id}>
                                  핵심 · {project.source.title}
                                </option>
                              ) : null}
                              {project.supportingSources.map((source) => (
                                <option key={source.id} value={source.id}>
                                  보조 · {source.title}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="flex w-full flex-col gap-2">
                            <span className="text-sm">화면 종류</span>
                            <select
                              aria-label={`문장 ${index + 1} 화면 종류`}
                              value={scene.visual}
                              onChange={(event) =>
                                updateReportScene(scene.id, {
                                  visual: event.currentTarget.value as
                                    "source" | "quote",
                                })
                              }
                              className={field}
                            >
                              <option value="source">
                                자료 화면 · TTS 계속
                              </option>
                              <option value="quote">
                                직접 발언 · 원본 음성
                              </option>
                            </select>
                          </label>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <NumberInput
                              label="자료 시작(초)"
                              value={scene.sourceStart}
                              onChange={(sourceStart) =>
                                updateReportScene(scene.id, { sourceStart })
                              }
                            />
                            <NumberInput
                              label="자료 종료(초)"
                              value={scene.sourceEnd}
                              onChange={(sourceEnd) =>
                                updateReportScene(scene.id, { sourceEnd })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted">
                    대본을 입력하면 문장별 화면이 생깁니다.
                  </p>
                )}
              </Card.Content>
            </Card>
          ) : null}

          {mode === "preview" ? (
            <Card>
              <Card.Header>
                <Card.Title>자막·강조 단어</Card.Title>
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
                      <span className="text-xs text-muted tabular-nums">
                        {time(caption.start)} → {time(caption.end)}
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
                            setFrameMode("body")
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
                            setFrameMode("body")
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

          {mode === "preview" ? (
            <Card>
              <Card.Header>
                <Card.Title>화면·오디오</Card.Title>
                <Card.Description>
                  확대·음량·크롭 중심을 조정합니다.
                </Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-5 md:grid-cols-2">
                <RangeInput
                  label="화면 확대"
                  value={project.crop.zoom}
                  min={1.02}
                  max={1.8}
                  step={0.01}
                  formatValue={ratioPercent}
                  onChange={(zoom) =>
                    onProject({ crop: { ...project.crop, zoom } })
                  }
                />
                <RangeInput
                  label="가로 크롭 중심"
                  value={project.crop.x}
                  min={0}
                  max={100}
                  step={1}
                  formatValue={screenPercent}
                  onChange={(x) => onProject({ crop: { ...project.crop, x } })}
                />
                <RangeInput
                  label="세로 크롭 중심"
                  value={project.crop.y}
                  min={0}
                  max={100}
                  step={1}
                  formatValue={screenPercent}
                  onChange={(y) => onProject({ crop: { ...project.crop, y } })}
                />
                <RangeInput
                  label="BGM 음량"
                  value={project.bgmVolume}
                  min={0}
                  max={0.4}
                  step={0.01}
                  formatValue={ratioPercent}
                  onChange={(bgmVolume) => onProject({ bgmVolume })}
                />
                <RangeInput
                  label="제목 TTS 음량"
                  value={project.titleVolume}
                  min={0}
                  max={2}
                  step={0.05}
                  formatValue={ratioPercent}
                  onChange={(titleVolume) => onProject({ titleVolume })}
                />
                <RangeInput
                  label="아나운서 TTS 음량"
                  value={project.sourceVolume}
                  min={0}
                  max={2}
                  step={0.05}
                  formatValue={ratioPercent}
                  onChange={(sourceVolume) => onProject({ sourceVolume })}
                />
                <RangeInput
                  label="원본 직접 발언 음량"
                  value={project.quoteVolume}
                  min={0}
                  max={2}
                  step={0.05}
                  formatValue={ratioPercent}
                  onChange={(quoteVolume) => onProject({ quoteVolume })}
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={project.bgmEnabled}
                    onChange={(event) =>
                      onProject({ bgmEnabled: event.currentTarget.checked })
                    }
                  />
                  이 영상에 BGM 적용
                </label>
              </Card.Content>
            </Card>
          ) : null}

          {mode === "final" ? (
            <Card>
              <Card.Header>
                <Card.Title>고해상도 최종 결과물</Card.Title>
                <Card.Description>
                  최종 영상·썸네일을 확인하고 받습니다.
                </Card.Description>
              </Card.Header>
              <Card.Content className="flex flex-wrap gap-3">
                {project.outputUrl ? (
                  <a className="text-sm underline" href={project.outputUrl}>
                    영상 받기
                  </a>
                ) : (
                  <p className="text-sm text-warning">
                    최종 결과물이 없습니다. 이전 단계에서 최종 제작을
                    실행하세요.
                  </p>
                )}
                {project.thumbnailUrl ? (
                  <a className="text-sm underline" href={project.thumbnailUrl}>
                    썸네일 받기
                  </a>
                ) : null}
              </Card.Content>
            </Card>
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
              busy !== "" ||
              !project.title ||
              !project.reportScript ||
              !titleValid ||
              titleDirty ||
              reportScriptDirty
            }
            onPress={() => void createPreviewAndContinue()}
          >
            <LoadingButtonLabel
              loading={busy === "preview"}
              label="다음"
              loadingLabel="초안 만드는 중"
            />
          </Button>
        ) : null}
        {mode === "direction" ? (
          <Button
            isDisabled={busy !== "" || project.reportScenes.length === 0}
            onPress={() => void createPreviewAndContinue()}
          >
            <LoadingButtonLabel
              loading={busy === "preview"}
              label="초안 만들기"
              loadingLabel="만드는 중"
            />
          </Button>
        ) : null}
        {mode === "preview" ? (
          <Button
            isDisabled={
              busy !== "" ||
              !durationRenderable ||
              !project.previewUrl ||
              !titleValid ||
              titleDirty ||
              reportScriptDirty
            }
            onPress={() => void renderAndContinue()}
          >
            <LoadingButtonLabel
              loading={busy === "render"}
              label="최종 만들기"
              loadingLabel="만드는 중"
            />
          </Button>
        ) : null}
        {mode === "final" ? (
          <Button
            variant="outline"
            isDisabled={busy !== "" || !durationRenderable}
            onPress={() => void render()}
          >
            <LoadingButtonLabel
              loading={busy === "render"}
              label="영상 다시 만들기"
              loadingLabel="만드는 중"
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
    eyebrow: "3단계 · 편집 책임: 대본",
    title: "시사 논평 대본 검수·완성",
    description: "제목·논평·자막을 검수해 확정합니다.",
    completion: "제목·낭독 문장·자막이 확정된 상태",
  },
  direction: {
    eyebrow: "자동 처리 · 화면 연출",
    title: "화면 연출·직접 발언 구성",
    description: "문장별 화면·음성 방식을 확정합니다.",
    completion: "문장별 화면과 원본 구간이 확정된 상태",
  },
  preview: {
    eyebrow: "4단계 · 편집 책임: 초안",
    title: "저해상도 초안 검수·수정",
    description: "초안을 보며 컷·자막·화면·음량을 조정합니다.",
    completion: "초안 검수가 끝난 상태",
  },
  final: {
    eyebrow: "5단계 · 편집 책임: 납품",
    title: "최종 제작·결과 확인",
    description: "최종 영상과 썸네일을 확인합니다.",
    completion: "최종 결과물을 받을 수 있는 상태",
  },
} satisfies Record<
  Exclude<NewsClipStep, "issue" | "source">,
  { eyebrow: string; title: string; description: string; completion: string }
>

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm">{label}</span>
      <input
        type="number"
        min={0}
        step={0.1}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className={field}
      />
    </label>
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

function initialSourceDuration(project: NewsClipProject) {
  return Math.max(
    0.1,
    project.source?.durationSeconds ?? 0,
    ...project.candidates.map((candidate) => candidate.sourceEnd),
    ...project.reportScenes.map((scene) => scene.sourceEnd)
  )
}

function composeIntroTitle(firstLine: string, secondLine: string) {
  return [firstLine.trim(), secondLine.trim()].filter(Boolean).join("\n")
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
