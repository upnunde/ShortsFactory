"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import {
  AlertDialog,
  Avatar,
  Button,
  Card,
  Input,
  Label,
  Modal,
  Separator,
  Switch,
  TextField,
} from "@heroui/react"
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  History,
  Home,
  Plus,
  Settings,
  Trash2,
} from "lucide-react"
import { NewsClipSettingsPanel } from "@/components/news-clips/settings-panel"
import { NewsHistoryPanel } from "@/components/news-clips/history-panel"
import { LoadingButtonLabel } from "@/components/news-clips/loading-button-label"
import { NewsClipSourceStep as SourceStep } from "@/components/news-clips/source-step"
import { NewsClipAnglesStep as AnglesStep } from "@/components/news-clips/angles-step"
import { NewsClipReviewStep as ReviewStep } from "@/components/news-clips/review-step"
import {
  normalizeAngleOptions,
  type NewsAngleOption,
} from "@/lib/news-clips/angles"
import {
  normalizeNewsIssueSearchState,
  type NewsIssueSearchState,
  type RecommendedNewsIssue,
} from "@/lib/news-clips/issues"
import type { NewsHistorySnapshot } from "@/lib/news-clips/history"
import { issueTokens } from "@/lib/news-clips/discovery"
import { newsRenderSettingsKey } from "@/lib/news-clips/render-key"
import { normalizeFinalPlaybackRate } from "@/lib/news-clips/final-playback"
import {
  fitTitleToLineLayouts,
  normalizeSubtitleCues,
  splitIntroTitleLines,
} from "@/lib/news-clips/text-layout"
import {
  buildBuildup2Scenes,
  buildup2HighlightBounds,
  collapseBuildup2HighlightCuts,
} from "@/lib/news-clips/buildup"
import {
  partitionSubtitlesByPart,
  splitScenesByClipPart,
} from "@/lib/news-clips/clip-parts"
import { prepareRenderProject } from "@/lib/news-clips/prepare-render-project"
import {
  NEWS_INTRO_GAP_SECONDS,
  NEWS_TOTAL_GAP_SECONDS,
  appendEndCtaScenes,
  buildReportScenes,
  ensureReportEndCta,
  estimateReportScenesDuration,
  isEndCtaScene,
  reportCaptionPhrases,
  reportHasEndCta,
  reportSubtitles,
  splitEndCtaFromScript,
} from "@/lib/news-clips/report"
import {
  NEWS_CLIP_STEPS,
  defaultNewsClipSettings,
  freshNewsClipProject,
  normalizeNewsSourceSearchState,
  resetNewsClipProjectProgress,
  type NewsChannelProfile,
  type NewsClipCandidate,
  type NewsClipProductionMode,
  type NewsClipProject,
  type NewsClipSettings,
  type NewsClipStep,
  type NewsReportScene,
  type NewsSource,
  type NewsSourceSearchState,
} from "@/lib/news-clips/types"
import { nextKoreaUploadSlot } from "@/lib/youtube-metadata"

export const newsFieldClass =
  "w-full rounded-xl border border-separator bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"

export function NewsClipsApp({
  profiles: initialProfiles,
}: {
  profiles: NewsChannelProfile[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [profiles, setProfiles] = useState(initialProfiles)
  const profile = profiles.find(
    (item) => item.id === searchParams.get("channel")
  )
  const showSettings = searchParams.get("view") === "settings"
  const showHistory = searchParams.get("view") === "history"
  const settingsTab = newsSettingsTab(searchParams.get("tab"))
  const connectedPlatform = searchParams.get("connected")
  const accountErrorPlatform = searchParams.get("platform")
  const accountNotice = connectedPlatform
    ? { kind: "connected" as const, platform: connectedPlatform }
    : searchParams.get("error") && accountErrorPlatform
      ? { kind: "error" as const, platform: accountErrorPlatform }
      : null
  const [step, setStep] = useState<NewsClipStep>("issue")
  const [furthestStep, setFurthestStep] = useState<NewsClipStep>("issue")
  const [project, setProject] = useState<NewsClipProject>(() =>
    freshNewsClipProject("default")
  )
  const [settings, setSettings] = useState<NewsClipSettings>(
    defaultNewsClipSettings
  )
  const [transcriptDraft, setTranscriptDraft] = useState("")
  const [issueSearch, setIssueSearch] = useState<NewsIssueSearchState>(() =>
    normalizeNewsIssueSearchState(null)
  )
  const [sourceSearch, setSourceSearch] = useState<NewsSourceSearchState>(() =>
    normalizeNewsSourceSearchState(null)
  )
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState("")
  const [previewProgress, setPreviewProgress] = useState<number | null>(null)
  const [note, setNote] = useState("")
  const [autoMode, setAutoMode] = useState(false)
  const autoAbortRef = useRef<AbortController | null>(null)
  const angleAbortRef = useRef<AbortController | null>(null)
  const previewAbortRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      angleAbortRef.current?.abort()
      previewAbortRef.current?.abort()
    },
    []
  )

  useEffect(() => {
    if (!profile) return
    let savedProject: NewsClipProject | null = null
    let savedStep: NewsClipStep = "issue"
    let savedFurthestStep: NewsClipStep = "issue"
    let savedTranscript = ""
    let savedIssueSearch = normalizeNewsIssueSearchState(null)
    let savedSourceSearch = normalizeNewsSourceSearchState(null)
    try {
      const raw = window.localStorage.getItem(storageKey(profile.id))
      if (raw) {
        const saved = JSON.parse(raw) as {
          step?: string
          furthestStep?: string
          project?: NewsClipProject
          transcriptDraft?: string
          issueSearch?: NewsIssueSearchState
          sourceSearch?: NewsSourceSearchState
        }
        if (saved.project?.type === "news_clip") {
          const migratedProject = normalizeSavedNewsProject(
            saved.project,
            profile.id
          )
          savedIssueSearch = normalizeNewsIssueSearchState(saved.issueSearch)
          savedSourceSearch = normalizeNewsSourceSearchState(saved.sourceSearch)
          const sourceMatchesIssue =
            !migratedProject.source ||
            migratedProject.sourceIssueId === migratedProject.selectedIssue?.id
          savedProject =
            migratedProject.selectedIssue && sourceMatchesIssue
              ? migratedProject
              : resetNewsClipProjectProgress(
                  migratedProject,
                  migratedProject.selectedIssue
                )
          const storedStep: NewsClipStep =
            saved.step === "review"
              ? saved.project.outputUrl
                ? "final"
                : "preview"
              : NEWS_CLIP_STEPS.some((item) => item.id === saved.step)
                ? (saved.step as NewsClipStep)
                : "issue"
          const migratedStep = visibleWorkflowStep(storedStep)
          if (migratedProject.selectedIssue && sourceMatchesIssue) {
            savedStep = migratedStep
            const storedFurthest = NEWS_CLIP_STEPS.some(
              (item) => item.id === saved.furthestStep
            )
              ? (saved.furthestStep as NewsClipStep)
              : migratedStep
            savedFurthestStep = visibleWorkflowStep(storedFurthest)
            savedTranscript = saved.transcriptDraft ?? ""
          } else if (migratedProject.selectedIssue) {
            savedStep = "source"
            savedFurthestStep = "source"
          }
        }
      }
    } catch {
      savedProject = null
    }
    void Promise.resolve().then(() => {
      setProject(savedProject ?? freshNewsClipProject(profile.id))
      setStep(savedStep)
      setFurthestStep(savedFurthestStep)
      setTranscriptDraft(savedTranscript)
      setIssueSearch(savedIssueSearch)
      setSourceSearch(
        savedProject?.selectedIssue?.id === savedSourceSearch.issueId
          ? savedSourceSearch
          : normalizeNewsSourceSearchState(null)
      )
    })
    void fetch(
      `/api/news-clips/settings?profileId=${encodeURIComponent(profile.id)}`
    )
      .then(async (response) => {
        if (response.ok) {
          const loadedSettings = (await response.json()) as NewsClipSettings
          setSettings(loadedSettings)
          setProject((current) =>
            balanceProjectSubtitles(current, loadedSettings)
          )
        }
      })
      .catch(() => undefined)
      .finally(() => setReady(true))
  }, [profile])

  useEffect(() => {
    if (!profile || !ready) return
    window.localStorage.setItem(
      storageKey(profile.id),
      JSON.stringify({
        step,
        furthestStep,
        project,
        transcriptDraft,
        issueSearch,
        sourceSearch,
      })
    )
  }, [
    furthestStep,
    issueSearch,
    profile,
    project,
    ready,
    step,
    sourceSearch,
    transcriptDraft,
  ])

  useEffect(() => {
    if (
      !profile ||
      !ready ||
      project.previewUrl ||
      !project.selectedAngleId ||
      project.reportScenes.length === 0
    ) {
      return
    }
    const controller = new AbortController()
    const base = `/news-clips/output/${project.id}`
    const files = [
      "preview.mp4",
      "preview-intro.mp4",
      "preview-lead.mp4",
      "preview-body.mp4",
      "preview-outro.mp4",
    ] as const
    void Promise.all(
      files.map(async (file) => {
        const response = await fetch(`${base}/${file}`, {
          method: "HEAD",
          cache: "no-store",
          signal: controller.signal,
        }).catch(() => null)
        return response?.ok ? `${base}/${file}?recovered=${Date.now()}` : ""
      })
    ).then(([previewUrl, intro, lead, body, outro]) => {
      if (!previewUrl || controller.signal.aborted) return
      setProject((current) =>
        current.id === project.id && !current.previewUrl
          ? {
              ...current,
              previewUrl,
              previewIntroUrl: intro,
              previewLeadUrl: lead,
              previewBodyUrl: body,
              previewOutroUrl: outro,
            }
          : current
      )
    })
    return () => controller.abort()
  }, [
    profile,
    project.id,
    project.previewUrl,
    project.reportScenes.length,
    project.selectedAngleId,
    ready,
  ])

  async function persistHistory(
    draft: NewsClipProject,
    savedStep: NewsClipStep,
    savedFurthestStep: NewsClipStep,
    finalized: boolean
  ) {
    const snapshot: NewsHistorySnapshot = {
      step: savedStep,
      furthestStep: savedFurthestStep,
      project: draft,
      transcriptDraft,
      issueSearch,
      sourceSearch,
      finalized,
      savedAt: new Date().toISOString(),
    }
    const response = await fetch("/api/news-clips/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    })
    return response.ok
  }

  async function saveCurrentHistory() {
    setBusy("history-save")
    setNote("")
    try {
      const saved = await persistHistory(
        project,
        step,
        furthestStep,
        step === "final" && Boolean(project.outputUrl)
      )
      setNote(saved ? "저장했습니다." : "저장하지 못했습니다.")
    } catch {
      setNote("저장하지 못했습니다.")
    } finally {
      setBusy("")
    }
  }

  async function openHistory(id: string) {
    const response = await fetch(
      `/api/news-clips/history/${encodeURIComponent(id)}?profileId=${encodeURIComponent(profile!.id)}`
    )
    const body = (await response.json()) as {
      snapshot?: NewsHistorySnapshot
    }
    if (!response.ok || !body.snapshot) {
      throw new Error("history-load-failed")
    }
    const snapshot = body.snapshot
    const restored = normalizeSavedNewsProject(snapshot.project, profile!.id)
    setProject(restored)
    const restoredStep = visibleWorkflowStep(snapshot.step)
    setStep(restoredStep)
    setFurthestStep(visibleWorkflowStep(snapshot.furthestStep))
    setTranscriptDraft(snapshot.transcriptDraft ?? "")
    setIssueSearch(normalizeNewsIssueSearchState(snapshot.issueSearch))
    setSourceSearch(normalizeNewsSourceSearchState(snapshot.sourceSearch))
    setNote("불러왔습니다.")
    router.push(`/studio/news-clips?channel=${encodeURIComponent(profile!.id)}`)
  }

  if (!profile)
    return (
      <NewsChannelPicker
        profiles={profiles}
        onOpen={(profileId) =>
          router.push(
            `/studio/news-clips?channel=${encodeURIComponent(profileId)}`
          )
        }
        onCreated={(created) => {
          setProfiles((current) => [...current, created])
          router.push(
            `/studio/news-clips?channel=${encodeURIComponent(created.id)}`
          )
        }}
        onDeleted={(profileId) =>
          setProfiles((current) =>
            current.filter((item) => item.id !== profileId)
          )
        }
        onBack={() => router.push("/")}
      />
    )

  const activeProfileId = profile.id

  function updateProject(
    patch:
      | Partial<NewsClipProject>
      | ((current: NewsClipProject) => Partial<NewsClipProject>)
  ) {
    setProject((current) => {
      const resolved = typeof patch === "function" ? patch(current) : patch
      const keys = Object.keys(resolved)
      const subtitleOnly =
        keys.length > 0 &&
        keys.every(
          (key) => key === "subtitles" || key === "subtitleTimingsLocked"
        )
      // 초안 미디어는 2번 재생성·다시 만들기(setProject)로만 교체한다.
      const replacesPreviewMedia =
        "previewUrl" in resolved ||
        "previewIntroUrl" in resolved ||
        "previewLeadUrl" in resolved ||
        "previewBodyUrl" in resolved ||
        "previewOutroUrl" in resolved
      const appliesRenderedArtifact =
        replacesPreviewMedia || "outputUrl" in resolved
      const artifactOnly =
        appliesRenderedArtifact ||
        keys.every((key) =>
          [
            "previewUrl",
            "previewIntroUrl",
            "previewLeadUrl",
            "previewBodyUrl",
            "previewOutroUrl",
            "previewSignature",
            "previewRevision",
            "outputUrl",
            "renderSignature",
            "renderSettingsKey",
            "thumbnailUrl",
            "finalRevision",
            "youtubeVideoId",
            "youtubeUploadUrl",
            "titleCardDurationSeconds",
            "outputDurationSeconds",
          ].includes(key)
        )
      const editorialRevision = artifactOnly
        ? current.editorialRevision
        : current.editorialRevision + 1
      const next = {
        ...current,
        editorialRevision,
        updatedAt: new Date().toISOString(),
        ...(subtitleOnly
          ? {
              renderSignature: "",
              outputUrl: "",
              thumbnailUrl: "",
              youtubeVideoId: "",
              youtubeUploadUrl: "",
            }
          : {
              renderSignature: "",
              outputUrl: "",
              renderSettingsKey: "",
              thumbnailUrl: "",
              youtubeVideoId: "",
              youtubeUploadUrl: "",
              subtitleTimingsLocked: false,
            }),
        ...resolved,
      }
      if (replacesPreviewMedia) return next
      return {
        ...next,
        // 편집 중에는 이전 미리보기를 계속 재생한다.
        // revision이 달라지므로 최종본으로는 쓸 수 없고, 새 미리보기를 만들면 교체된다.
        previewUrl: current.previewUrl,
        previewIntroUrl: current.previewIntroUrl,
        previewLeadUrl: current.previewLeadUrl,
        previewBodyUrl: current.previewBodyUrl,
        previewOutroUrl: current.previewOutroUrl,
        previewSignature: current.previewSignature,
        previewRevision: current.previewRevision,
        finalRevision: artifactOnly ? current.finalRevision : 0,
      }
    })
  }

  function applySettingsPreview(next: NewsClipSettings) {
    const changed = JSON.stringify(next) !== JSON.stringify(settings)
    const subtitleLayoutChanged =
      JSON.stringify(next.bodySubtitleText) !==
      JSON.stringify(settings.bodySubtitleText)
    setSettings(next)
    if (!changed) return
    setProject((current) => ({
      ...current,
      bgmEnabled: next.bgmEnabled,
      bgmVolume: next.bgmVolume,
      titleVolume: next.titleVolume,
      sourceVolume: next.sourceVolume,
      quoteVolume: next.quoteVolume,
      subtitles: subtitleLayoutChanged
        ? normalizeSubtitleCues(current.subtitles, next.bodySubtitleText)
        : current.subtitles,
      updatedAt: new Date().toISOString(),
      editorialRevision: current.editorialRevision + 1,
      finalRevision: 0,
      renderSignature: "",
      outputUrl: "",
      thumbnailUrl: "",
      youtubeVideoId: "",
      youtubeUploadUrl: "",
      subtitleTimingsLocked: false,
    }))
  }

  async function updateTtsSettings(patch: Partial<NewsClipSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    setProject((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      editorialRevision: current.editorialRevision + 1,
      finalRevision: 0,
      renderSignature: "",
      outputUrl: "",
      thumbnailUrl: "",
      youtubeVideoId: "",
      youtubeUploadUrl: "",
      subtitleTimingsLocked: false,
    }))
    setNote("대본 공통 TTS를 저장하는 중입니다.")
    try {
      const response = await fetch(
        `/api/news-clips/settings?profileId=${encodeURIComponent(activeProfileId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        }
      )
      const body = (await response.json()) as NewsClipSettings & {
        message?: string
      }
      if (!response.ok) {
        setNote(body.message || "TTS 선택을 저장하지 못했습니다.")
        return
      }
      setSettings(body)
      setNote("선택한 TTS를 제목과 전체 아나운서 대본에 적용했습니다.")
    } catch {
      setNote("TTS 선택을 저장하지 못했습니다.")
    }
  }

  function prepareAutomaticDraft(
    base: NewsClipProject,
    source: NewsSource,
    transcript: NewsClipProject["transcript"],
    candidates: NewsClipCandidate[],
    candidate: NewsClipCandidate,
    detectedSilences: NewsClipProject["detectedSilences"],
    reportScript: string,
    reportScenes: NewsReportScene[],
    removedRanges: NewsClipProject["removedRanges"] = [],
    keepRanges: NewsClipProject["keepRanges"] = [],
    sourceMeta: { channel?: string; title?: string } = {}
  ) {
    const resolvedSource: NewsSource = {
      ...source,
      channel: sourceMeta.channel?.trim() || source.channel,
      title: sourceMeta.title?.trim() || source.title,
    }
    const selectedAngle = base.angleOptions.find(
      (angle) => angle.id === base.selectedAngleId
    )
    // 주제고르기에서 고른 각도 제목을 우선한다. 분석 후 임의로 바꾸지 않는다.
    const rawTitle =
      selectedAngle?.title ||
      candidate.titleOptions[0] ||
      resolvedSource.searchMetrics?.expectedShortTitle ||
      resolvedSource.title
    const title = ensureTwoLineIntroTitle(
      fitTitleToLineLayouts(rawTitle, settings.titleCardText, {
        ...settings.titleCardText,
        fontSize: settings.titleCardSecondFontSize,
      }),
      settings.titleCardText,
      settings.titleCardSecondFontSize
    )
    const isBuildup2 = base.productionMode === "buildup2"
    const completeReportScript = ensureReportEndCta(
      reportScript,
      title,
      base.selectedIssue?.keywords
    )
    const { body: bodyScript, cta: endCtaText } =
      splitEndCtaFromScript(completeReportScript)
    const highlightBounds = buildup2HighlightBounds(
      reportScenes,
      candidate.sourceStart,
      candidate.sourceEnd
    )
    const bodyScenes = isBuildup2
      ? buildBuildup2Scenes(
          bodyScript || completeReportScript,
          highlightBounds.start,
          highlightBounds.end,
          transcript,
          resolvedSource.id,
          reportScenes
        )
      : buildReportScenes(
          bodyScript || completeReportScript,
          transcript,
          candidate.sourceStart,
          candidate.sourceEnd,
          reportScenes,
          resolvedSource.id
        )
    const baseScenes = appendEndCtaScenes(
      bodyScenes,
      endCtaText,
      resolvedSource.id
    )
    const prepared = prepareRenderProject(
      {
        ...base,
        source: resolvedSource,
        transcript,
        candidates,
        detectedSilences,
        selectedCandidateId: candidate.id,
        title,
        titleOptions: candidate.titleOptions,
        reportScript: completeReportScript,
        reportScenes: baseScenes,
        subtitles: [],
      },
      settings,
      { rebuildSubtitles: true }
    )
    const normalizedReportScenes = prepared.reason
      ? baseScenes.map((scene) => ({
          ...scene,
          sourceId: resolvedSource.id,
        }))
      : prepared.project.reportScenes
    const outputBodySeconds = prepared.reason
      ? estimateReportScenesDuration(
          normalizedReportScenes,
          settings.titleVoiceRate
        )
      : prepared.project.outputDurationSeconds -
        settings.titleCardSeconds -
        NEWS_TOTAL_GAP_SECONDS
    return {
      ...base,
      source: resolvedSource,
      transcript,
      candidates,
      detectedSilences,
      selectedCandidateId: candidate.id,
      title,
      titleOptions: candidate.titleOptions,
      reportScript: completeReportScript,
      reportScenes: normalizedReportScenes,
      removedRanges,
      keepRanges:
        keepRanges.length > 0
          ? keepRanges
          : [
              {
                sourceStart: candidate.sourceStart,
                sourceEnd: candidate.sourceEnd,
                outputStart: 0,
                outputEnd: candidate.sourceEnd - candidate.sourceStart,
              },
            ],
      subtitles: prepared.reason
        ? normalizeSubtitleCues(
            reportSubtitles(
              normalizedReportScenes,
              undefined,
              reportCaptionPhrases(bodyScript || completeReportScript),
              transcript
            ),
            settings.bodySubtitleText
          )
        : prepared.project.subtitles,
      outputDurationSeconds: prepared.reason
        ? settings.titleCardSeconds + outputBodySeconds + NEWS_TOTAL_GAP_SECONDS
        : prepared.project.outputDurationSeconds,
      bgmEnabled: settings.bgmEnabled,
      bgmVolume: settings.bgmVolume,
      titleVolume: settings.titleVolume,
      sourceVolume: settings.sourceVolume,
      quoteVolume: settings.quoteVolume,
      introStillTimeSeconds: null,
      titleCardDurationSeconds:
        settings.titleCardSeconds + NEWS_INTRO_GAP_SECONDS,
      metadata: {
        youtubeTitle: title.replace(/\s*\n\s*/g, " "),
        description: sourceDescription(source, candidate),
        tags: ["뉴스", "시사", "쇼츠", "NewsStory"],
      },
      updatedAt: new Date().toISOString(),
      editorialRevision: base.editorialRevision + 1,
      previewRevision: 0,
      finalRevision: 0,
      previewUrl: "",
      previewIntroUrl: "",
      previewLeadUrl: "",
      previewBodyUrl: "",
      previewOutroUrl: "",
      previewSignature: "",
      renderSettingsKey: "",
      outputUrl: "",
      renderSignature: "",
      youtubeVideoId: "",
      youtubeUploadUrl: "",
    } satisfies NewsClipProject
  }

  function setProductionMode(mode: NewsClipProductionMode) {
    if (project.productionMode === mode) return
    if (
      hasSavableProgress(project) &&
      !window.confirm(
        "제작 방식을 바꾸면 현재 진행 중인 대본·연출이 초기화됩니다. 계속할까요?"
      )
    ) {
      return
    }
    const next = resetNewsClipProjectProgress(
      { ...project, productionMode: mode },
      null
    )
    setProject(next)
    setStep("issue")
    setFurthestStep("issue")
    setNote("")
  }

  async function runSelectedIssue(selectedIssue: RecommendedNewsIssue) {
    setTranscriptDraft("")
    const issueProject = resetNewsClipProjectProgress(project, selectedIssue)
    setProject(issueProject)
    setStep("issue")
    const busyBase = `select-issue:${selectedIssue.id}`
    setBusy(`${busyBase}:video`)
    setNote("")
    try {
      const isDirect = selectedIssue.directSource === true
      const directUrl =
        selectedIssue.directSourceUrl?.trim() ||
        selectedIssue.articles[0]?.url?.trim() ||
        ""
      let stored: NewsSource
      if (isDirect && directUrl) {
        const existing =
          project.source?.originalUrl === directUrl && project.source.localFile
            ? project.source
            : null
        stored =
          existing ??
          (await storeAutomaticSource(
            {
              id: `direct-${Date.now()}`,
              kind: "youtube",
              title: selectedIssue.title,
              channel: selectedIssue.articles[0]?.source || "",
              publishedAt: selectedIssue.articles[0]?.publishedAt || "",
              durationSeconds: 0,
              viewCount: 0,
              commentCount: 0,
              originalUrl: directUrl,
              summary: selectedIssue.recommendationReason,
              localFile: "",
              approved: false,
              requiresUpload: true,
              searchMetrics: null,
            },
            new AbortController().signal
          ))
        if (!stored.localFile || stored.requiresUpload) {
          throw new Error(
            "원본 영상을 받지 못했습니다. URL이나 파일로 직접 넣어 주세요."
          )
        }
        setSourceSearch({
          issueId: selectedIssue.id,
          results: [stored],
          message: `입력한 원본 ‘${stored.title}’으로 제작합니다.`,
          youtubeDataMissing: false,
          status: "complete",
        })
      } else {
        setSourceSearch(normalizeNewsSourceSearchState(null))
        const sourceResponse = await fetch(
          `/api/news-clips/source?profileId=${encodeURIComponent(activeProfileId)}&query=${encodeURIComponent(selectedIssue.searchQuery)}&topic=${encodeURIComponent(selectedIssue.title)}&keywords=${encodeURIComponent(selectedIssue.keywords.join(","))}`
        )
        const sourceBody = (await sourceResponse.json()) as {
          results?: NewsSource[]
          configured?: boolean
          message?: string
        }
        if (!sourceResponse.ok || !sourceBody.results?.length) {
          throw new Error(sourceBody.message || "관련 원본을 찾지 못했습니다.")
        }
        const preferredSource = sourceBody.results[0]!
        setSourceSearch({
          issueId: selectedIssue.id,
          results: sourceBody.results,
          message: `원본으로 ‘${preferredSource.title}’을(를) 사용합니다.`,
          youtubeDataMissing: sourceBody.configured === false,
          status: "complete",
        })
        stored = await storeAutomaticSource(
          preferredSource,
          new AbortController().signal
        )
        if (!stored.localFile || stored.requiresUpload) {
          throw new Error(
            "원본 영상을 받지 못했습니다. URL이나 파일로 직접 넣어 주세요."
          )
        }
      }
      const sourceProject: NewsClipProject = {
        ...issueProject,
        source: stored,
        supportingSources: [],
        sourceIssueId: selectedIssue.id,
      }
      setProject(sourceProject)
      setBusy(`${busyBase}:script`)
      await loadAnglesForSource(sourceProject, stored, selectedIssue, isDirect)
    } catch (error) {
      setNote(
        error instanceof Error
          ? error.message
          : "이슈 원본을 준비하지 못했습니다."
      )
      setStep("issue")
    } finally {
      setBusy("")
    }
  }

  async function generatePreview(
    draft: NewsClipProject,
    _force?: boolean,
    options: {
      busyKey?: string
      note?: string
      clearBusy?: boolean
      silent?: boolean
      signal?: AbortSignal
    } = {}
  ) {
    previewAbortRef.current?.abort()
    const controller = new AbortController()
    previewAbortRef.current = controller
    const abortFromCaller = () => controller.abort()
    options.signal?.addEventListener("abort", abortFromCaller, { once: true })
    if (options.signal?.aborted) controller.abort()
    const busyKey = options.busyKey ?? "preview"
    const clearBusy = options.clearBusy !== false
    const silent = options.silent === true
    const jobId = crypto.randomUUID()
    let polling = true
    setPreviewProgress(1)
    setBusy(busyKey)
    if (!silent) {
      setNote(options.note ?? "저해상도 쇼츠 초안을 만드는 중입니다.")
    }
    const pollProgress = async () => {
      try {
        const response = await fetch(
          `/api/news-clips/render-progress?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" }
        )
        const progress = (await response.json()) as { percent?: number }
        if (!polling || !Number.isFinite(progress.percent)) return
        setPreviewProgress((current) =>
          Math.max(current ?? 0, Math.min(100, Math.round(progress.percent!)))
        )
      } catch {
        // 진행률 조회 실패가 렌더 작업 자체를 중단시키지는 않는다.
      }
    }
    const progressTimer = window.setInterval(() => {
      void pollProgress()
    }, 500)
    try {
      const response = await fetch("/api/news-clips/preview", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        // 검수 수정 후에는 이전 산출물·캐시를 지우고 다시 렌더한다.
        body: JSON.stringify({
          project: draft,
          settings,
          force: true,
          jobId,
        }),
        signal: controller.signal,
      })
      const body = (await response.json()) as {
        message?: string
        previewUrl?: string
        previewIntroUrl?: string
        previewLeadUrl?: string
        previewBodyUrl?: string
        previewOutroUrl?: string
        signature?: string
        titleCardDurationSeconds?: number
        outputDurationSeconds?: number
        subtitles?: NewsClipProject["subtitles"]
        reportScenes?: NewsClipProject["reportScenes"]
      }
      if (!response.ok || !body.previewUrl) {
        setNote(body.message || "저해상도 초안을 만들지 못했습니다.")
        return false
      }
      setPreviewProgress(100)
      setProject((current) => {
        if (current.id !== draft.id) return current
        // updatedAt은 저장·UI 동기화 과정에서도 바뀔 수 있다. 실제 편집본의
        // 동일성은 editorialRevision으로 확인해야 새 렌더의 자막을 버리지 않는다.
        const isLatestRevision =
          current.editorialRevision === draft.editorialRevision
        const previewUrl = refreshMediaUrl(body.previewUrl ?? "")
        const previewIntroUrl = refreshMediaUrl(body.previewIntroUrl ?? "")
        const previewLeadUrl = refreshMediaUrl(body.previewLeadUrl ?? "")
        const previewBodyUrl = refreshMediaUrl(body.previewBodyUrl ?? "")
        const previewOutroUrl = refreshMediaUrl(body.previewOutroUrl ?? "")
        if (!isLatestRevision) {
          return current
        }
        return {
          ...current,
          previewUrl,
          previewIntroUrl,
          previewLeadUrl,
          previewBodyUrl,
          previewOutroUrl,
          previewSignature: body.signature ?? "",
          previewRevision: draft.editorialRevision,
          finalRevision: 0,
          renderSettingsKey: newsRenderSettingsKey(settings),
          titleCardDurationSeconds:
            body.titleCardDurationSeconds ?? current.titleCardDurationSeconds,
          outputDurationSeconds:
            body.outputDurationSeconds ?? current.outputDurationSeconds,
          // 미리보기와 함께 렌더 서버가 실측한 최신 자막 구간으로 교체한다.
          subtitles: Array.isArray(body.subtitles) ? body.subtitles : [],
          subtitleTimingsLocked: true,
          reportScenes: body.reportScenes ?? current.reportScenes,
        }
      })
      if (!silent) {
        setNote(body.message || "저해상도 초안을 만들었습니다.")
      } else {
        setNote("")
      }
      return true
    } catch {
      if (controller.signal.aborted) return false
      setNote("저해상도 초안을 만들지 못했습니다.")
      return false
    } finally {
      options.signal?.removeEventListener("abort", abortFromCaller)
      polling = false
      window.clearInterval(progressTimer)
      void fetch(
        `/api/news-clips/render-progress?jobId=${encodeURIComponent(jobId)}`,
        { method: "DELETE" }
      ).catch(() => undefined)
      if (previewAbortRef.current === controller) {
        previewAbortRef.current = null
        setPreviewProgress(null)
        if (clearBusy) setBusy("")
      }
    }
  }

  function cancelPreview() {
    const controller = previewAbortRef.current
    if (!controller) return
    controller.abort()
    previewAbortRef.current = null
    setPreviewProgress(null)
    setBusy("")
    setNote("미리보기 만들기를 취소했습니다.")
  }

  async function reselectCandidate(
    target: "all" | "title" | "script" | "outro" = "all"
  ) {
    if (!project.source) return
    const selectedAngle = project.angleOptions.find(
      (item) => item.id === project.selectedAngleId
    )
    const busyKey =
      target === "title"
        ? "rewrite-title"
        : target === "outro"
          ? "rewrite-outro"
          : target === "script"
            ? "rewrite-script"
            : "reselect"
    setBusy(busyKey)
    setNote(
      target === "title"
        ? "제목만 다시 작성하는 중입니다."
        : target === "outro"
          ? "마무리 멘트만 다시 작성하는 중입니다."
          : target === "script"
            ? "본문만 다시 작성하는 중입니다."
            : "전체 자료를 근거로 제목과 본문을 다시 작성하는 중입니다."
    )
    try {
      const response = await fetch("/api/news-clips/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: project.source.id,
          profileId: project.profileId,
          issueTitle: project.selectedIssue?.title ?? "",
          issueKeywords: project.selectedIssue?.keywords ?? [],
          issueReason: project.selectedIssue?.recommendationReason ?? "",
          issueArticleTitles:
            project.selectedIssue?.articles.map((article) => article.title) ??
            [],
          supplementalContext: project.supplementalContext,
          supportingSourceIds: project.supportingSources.map(
            (source) => source.id
          ),
          productionMode: project.productionMode,
          directSource: project.selectedIssue?.directSource === true,
          reselect: true,
          previousTitle: project.title,
          previousTitles: project.titleOptions,
          previousScript: project.reportScript,
          ...(selectedAngle
            ? {
                angleTitle: selectedAngle.title,
                angleSummary: selectedAngle.summary,
                angleKeywords: selectedAngle.keywords,
                angleSourceStart: selectedAngle.sourceStart,
                angleSourceEnd: selectedAngle.sourceEnd,
              }
            : {}),
        }),
      })
      const body = (await response.json()) as {
        transcript?: NewsClipProject["transcript"]
        candidates?: NewsClipCandidate[]
        selectedCandidate?: NewsClipCandidate
        detectedSilences?: NewsClipProject["detectedSilences"]
        removedRanges?: NewsClipProject["removedRanges"]
        keepRanges?: NewsClipProject["keepRanges"]
        reportScript?: string
        reportScenes?: NewsReportScene[]
        sourceChannel?: string
        sourceTitle?: string
        message?: string
      }
      if (
        !response.ok ||
        !body.transcript ||
        !body.candidates ||
        !body.selectedCandidate
      ) {
        setNote(body.message || "보도 대본을 다시 작성하지 못했습니다.")
        return
      }
      const draft = prepareAutomaticDraft(
        project,
        project.source,
        body.transcript,
        body.candidates,
        body.selectedCandidate,
        body.detectedSilences ?? project.detectedSilences,
        body.reportScript ?? "",
        body.reportScenes ?? [],
        body.removedRanges ?? [],
        body.keepRanges ?? [],
        {
          channel: body.sourceChannel,
          title: body.sourceTitle,
        }
      )
      if (target === "title") {
        const fittedTitles = draft.titleOptions.map((option) =>
          fitTitleToLineLayouts(option, settings.titleCardText, {
            ...settings.titleCardText,
            fontSize: settings.titleCardSecondFontSize,
          })
        )
        const currentCompact = project.title.replace(/\s+/g, "")
        const title =
          fittedTitles.find(
            (option) => option.replace(/\s+/g, "") !== currentCompact
          ) ??
          fittedTitles[0] ??
          draft.title
        updateProject({
          title,
          titleOptions: draft.titleOptions,
          titleCardDurationSeconds: 0,
          metadata: {
            ...project.metadata,
            youtubeTitle: title.replace(/\s*\n\s*/g, " "),
          },
        })
        setNote("제목만 다시 작성했습니다.")
      } else if (target === "outro") {
        const currentScript = splitEndCtaFromScript(project.reportScript)
        const rewrittenCta =
          splitEndCtaFromScript(draft.reportScript).cta || currentScript.cta
        if (!rewrittenCta) {
          setNote("마무리 멘트를 다시 작성하지 못했습니다.")
          return
        }
        const reportScript = currentScript.body
          ? `${currentScript.body}\n${rewrittenCta}`
          : rewrittenCta
        const reportScenes = appendEndCtaScenes(
          project.reportScenes.filter((scene) => !isEndCtaScene(scene)),
          rewrittenCta,
          project.source.id
        )
        const prepared = prepareRenderProject(
          {
            ...project,
            reportScript,
            reportScenes,
            subtitles: [],
          },
          settings,
          { rebuildSubtitles: true }
        )
        if (prepared.reason) {
          setNote("마무리 멘트를 다시 작성하지 못했습니다.")
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
        updateProject({
          reportScript,
          reportScenes: prepared.project.reportScenes,
          subtitles: [
            ...currentSubtitleParts.lead,
            ...currentSubtitleParts.body,
            ...freshSubtitleParts.outro,
          ],
          subtitleTimingsLocked: false,
          outputDurationSeconds: prepared.project.outputDurationSeconds,
          titleCardDurationSeconds: 0,
        })
        setNote("마무리 멘트만 다시 작성했습니다.")
      } else if (target === "script") {
        const keepCta = splitEndCtaFromScript(project.reportScript).cta
        const newLeadOrBody = splitEndCtaFromScript(draft.reportScript).body
        const reportScript =
          keepCta && newLeadOrBody
            ? `${newLeadOrBody}\n${keepCta}`
            : draft.reportScript
        const endCta = keepCta || splitEndCtaFromScript(draft.reportScript).cta
        const reportScenes = appendEndCtaScenes(
          draft.reportScenes.filter((scene) => !isEndCtaScene(scene)),
          endCta,
          project.source?.id ?? ""
        )
        setProject({
          ...draft,
          title: project.title,
          titleOptions: project.titleOptions,
          reportScript,
          reportScenes,
          introStillTimeSeconds: project.introStillTimeSeconds,
          metadata: {
            ...draft.metadata,
            youtubeTitle: project.metadata.youtubeTitle,
          },
          previewUrl: project.previewUrl,
          previewIntroUrl: project.previewIntroUrl,
          previewLeadUrl: project.previewLeadUrl,
          previewBodyUrl: project.previewBodyUrl,
          previewOutroUrl: project.previewOutroUrl,
          previewSignature: project.previewSignature,
        })
        setNote("대본과 문장별 화면 연출만 다시 작성했습니다.")
      } else {
        setProject({
          ...draft,
          previewUrl: project.previewUrl,
          previewIntroUrl: project.previewIntroUrl,
          previewLeadUrl: project.previewLeadUrl,
          previewBodyUrl: project.previewBodyUrl,
          previewOutroUrl: project.previewOutroUrl,
          previewSignature: project.previewSignature,
        })
        setNote("제목, 본문과 화면 연출을 다시 작성했습니다.")
      }
    } catch {
      setNote("보도 대본을 다시 작성하지 못했습니다.")
    } finally {
      setBusy("")
    }
  }

  function leaveSideView() {
    if (!showSettings && !showHistory) return
    router.push(
      `/studio/news-clips?channel=${encodeURIComponent(activeProfileId)}`
    )
  }

  function newProject() {
    setProject(freshNewsClipProject(project.profileId))
    setTranscriptDraft("")
    setIssueSearch(normalizeNewsIssueSearchState(null))
    setSourceSearch(normalizeNewsSourceSearchState(null))
    setStep("issue")
    setFurthestStep("issue")
    setNote("")
    leaveSideView()
  }

  function openStep(nextStep: NewsClipStep) {
    if (nextStep === "preview") {
      setProject((current) => balanceProjectSubtitles(current, settings))
    }
    setStep(nextStep)
    leaveSideView()
  }

  function advanceStep(nextStep: NewsClipStep) {
    setStep(nextStep)
    setFurthestStep((current) =>
      stepIndex(nextStep) > stepIndex(current) ? nextStep : current
    )
  }

  function toggleAutoMode() {
    if (autoMode) {
      autoAbortRef.current?.abort()
      autoAbortRef.current = null
      setAutoMode(false)
      if (busy.startsWith("auto:")) setBusy("")
      setNote("자동생성 모드를 껐습니다.")
      return
    }
    setAutoMode(true)
    setNote(
      "자동생성 모드를 켰습니다. 이슈 자동 검색을 누르면 최종 영상까지 제작합니다."
    )
  }

  async function runYoutubeUrl(url: string) {
    setBusy("url-source:video")
    setNote("")
    try {
      const sourceResponse = await fetch("/api/news-clips/source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, kind: "youtube" }),
      })
      const source = (await sourceResponse.json()) as NewsSource & {
        message?: string
      }
      if (!sourceResponse.ok || !source.localFile || source.requiresUpload) {
        throw new Error(source.message || "YouTube 영상을 가져오지 못했습니다.")
      }

      await finishDirectSource(source, url, "URL")
    } catch (error) {
      setNote(
        error instanceof Error
          ? error.message
          : "YouTube 영상으로 시작하지 못했습니다."
      )
    } finally {
      setBusy("")
    }
  }

  async function runVideoFile(file: File) {
    setBusy("file-source:video")
    setNote("")
    try {
      const form = new FormData()
      form.set("file", file)
      form.set("title", file.name.replace(/\.[^.]+$/, ""))
      const response = await fetch("/api/news-clips/source", {
        method: "POST",
        body: form,
      })
      const source = (await response.json()) as NewsSource & {
        message?: string
      }
      if (!response.ok || !source.localFile) {
        throw new Error(source.message || "영상 파일을 업로드하지 못했습니다.")
      }
      await finishDirectSource(source, file.name, "파일")
    } catch (error) {
      setNote(
        error instanceof Error
          ? error.message
          : "영상 파일로 시작하지 못했습니다."
      )
    } finally {
      setBusy("")
    }
  }

  async function finishDirectSource(
    source: NewsSource,
    query: string,
    sourceLabel: "URL" | "파일"
  ) {
    const selectedIssue = directSourceIssue(source)
    const sourceProject: NewsClipProject = {
      ...resetNewsClipProjectProgress(project, selectedIssue),
      source,
      supportingSources: [],
      sourceIssueId: selectedIssue.id,
    }
    setIssueSearch({
      query,
      issues: [selectedIssue],
      dismissedIssueKeys: [],
    })
    setSourceSearch({
      issueId: selectedIssue.id,
      results: [source],
      message: `입력한 ${sourceLabel} 영상을 핵심 원본으로 사용합니다.`,
      youtubeDataMissing: false,
      status: "complete",
    })
    setProject(sourceProject)
    setBusy(sourceLabel === "파일" ? "file-source:script" : "url-source:script")
    await loadAnglesForSource(sourceProject, source, selectedIssue, true)
  }

  async function loadAnglesForSource(
    sourceProject: NewsClipProject,
    source: NewsSource,
    selectedIssue: RecommendedNewsIssue | null,
    directSource: boolean
  ) {
    const response = await fetch("/api/news-clips/angles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceId: source.id,
        profileId: activeProfileId,
        productionMode: sourceProject.productionMode,
        issueTitle: selectedIssue?.title ?? "",
        directSource,
      }),
    })
    const body = (await response.json()) as {
      transcript?: NewsClipProject["transcript"]
      angles?: NewsAngleOption[]
      detectedSilences?: NewsClipProject["detectedSilences"]
      sourceChannel?: string
      sourceTitle?: string
      message?: string
    }
    if (!response.ok || !body.angles?.length) {
      throw new Error(body.message || "핵심 각도를 만들지 못했습니다.")
    }
    const nextSource: NewsSource = {
      ...source,
      channel: body.sourceChannel?.trim() || source.channel,
      title: body.sourceTitle?.trim() || source.title,
    }
    setProject({
      ...sourceProject,
      source: nextSource,
      transcript: body.transcript ?? [],
      detectedSilences: body.detectedSilences ?? [],
      angleOptions: normalizeAngleOptions(body.angles),
      selectedAngleId: "",
    })
    setTranscriptDraft("")
    advanceStep("angles")
    setNote("")
  }

  async function runSelectedAngle(angle: NewsAngleOption) {
    if (!project.source) return
    angleAbortRef.current?.abort()
    const controller = new AbortController()
    angleAbortRef.current = controller
    const signal = controller.signal
    const selectedIssue = project.selectedIssue
    const directSource = selectedIssue?.directSource === true
    setProject((current) => ({ ...current, selectedAngleId: angle.id }))
    setBusy(`select-angle:${angle.id}:script`)
    setNote("")
    try {
      const analyzeResponse = await fetch("/api/news-clips/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: project.source.id,
          profileId: activeProfileId,
          issueTitle: selectedIssue?.title ?? "",
          issueKeywords: selectedIssue?.keywords ?? [],
          issueReason: selectedIssue?.recommendationReason ?? "",
          issueArticleTitles:
            selectedIssue?.articles.map((article) => article.title) ?? [],
          supportingSourceIds: [],
          productionMode: project.productionMode,
          directSource,
          angleTitle: angle.title,
          angleSummary: angle.summary,
          angleKeywords: angle.keywords,
          angleSourceStart: angle.sourceStart,
          angleSourceEnd: angle.sourceEnd,
        }),
        signal,
      })
      const analysis = (await analyzeResponse.json()) as {
        transcript?: NewsClipProject["transcript"]
        candidates?: NewsClipCandidate[]
        selectedCandidate?: NewsClipCandidate
        detectedSilences?: NewsClipProject["detectedSilences"]
        removedRanges?: NewsClipProject["removedRanges"]
        keepRanges?: NewsClipProject["keepRanges"]
        reportScript?: string
        reportScenes?: NewsReportScene[]
        sourceChannel?: string
        sourceTitle?: string
        message?: string
      }
      if (signal.aborted) return
      if (
        !analyzeResponse.ok ||
        !analysis.transcript ||
        !analysis.candidates ||
        !analysis.selectedCandidate
      ) {
        throw new Error(analysis.message || "대본을 만들지 못했습니다.")
      }
      const draft = prepareAutomaticDraft(
        {
          ...project,
          selectedAngleId: angle.id,
          angleOptions: project.angleOptions,
        },
        project.source,
        analysis.transcript,
        analysis.candidates,
        analysis.selectedCandidate,
        analysis.detectedSilences ?? project.detectedSilences,
        analysis.reportScript ?? "",
        analysis.reportScenes ?? [],
        analysis.removedRanges ?? [],
        analysis.keepRanges ?? [],
        {
          channel: analysis.sourceChannel,
          title: analysis.sourceTitle,
        }
      )
      const nextProject: NewsClipProject = {
        ...draft,
        angleOptions: project.angleOptions,
        selectedAngleId: angle.id,
        // 초안 렌더에서 실측 자막을 다시 잡는다. 기존 미리보기는 새 영상이 올 때까지 유지.
        subtitles: [],
        subtitleTimingsLocked: false,
      }
      setProject(nextProject)
      setBusy(`select-angle:${angle.id}:preview`)
      const created = await generatePreview(nextProject, true, {
        busyKey: `select-angle:${angle.id}:preview`,
        clearBusy: false,
        silent: true,
        signal,
      })
      if (signal.aborted) return
      advanceStep("preview")
      if (!created) {
        setNote("초안 영상을 만들지 못했습니다.")
      }
    } catch (error) {
      if (signal.aborted) return
      setNote(
        error instanceof Error ? error.message : "대본을 만들지 못했습니다."
      )
    } finally {
      if (angleAbortRef.current === controller) {
        angleAbortRef.current = null
        setBusy("")
      }
    }
  }

  function cancelSelectedAngle() {
    angleAbortRef.current?.abort()
    angleAbortRef.current = null
    setProject((current) => resetAngleSelection(current))
    setBusy("")
    setNote("핵심 내용 선택을 취소했습니다.")
    setStep("angles")
    setFurthestStep("angles")
  }

  async function runAutomaticGeneration(query = "") {
    const controller = new AbortController()
    autoAbortRef.current?.abort()
    autoAbortRef.current = controller
    const signal = controller.signal
    const ensureRunning = () => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError")
    }
    try {
      if (showSettings) {
        router.push(
          `/studio/news-clips?channel=${encodeURIComponent(activeProfileId)}`
        )
      }
      setBusy("auto:issues")
      setNote("자동생성 · 채널 방향과 화제성을 함께 비교하고 있습니다.")
      const issueResponse = await fetch(
        `/api/news-clips/issues?profileId=${encodeURIComponent(activeProfileId)}&query=${encodeURIComponent(query)}&limit=12`,
        { signal }
      )
      const issueBody = (await issueResponse.json()) as {
        issues?: RecommendedNewsIssue[]
        message?: string
      }
      if (!issueResponse.ok || !issueBody.issues?.length) {
        throw new Error(issueBody.message || "추천 이슈를 찾지 못했습니다.")
      }
      ensureRunning()
      const selectedIssue = [...issueBody.issues].sort(
        (left, right) =>
          automaticIssueScore(right) - automaticIssueScore(left) ||
          right.score - left.score ||
          right.trendScore - left.trendScore
      )[0]
      const issueProject = resetNewsClipProjectProgress(project, selectedIssue)
      setIssueSearch({
        query,
        issues: issueBody.issues,
        dismissedIssueKeys: [],
      })
      setProject(issueProject)
      setBusy("auto:sources")
      setNote(`자동생성 · ‘${selectedIssue.title}’ 관련 원본을 찾고 있습니다.`)

      const sourceResponse = await fetch(
        `/api/news-clips/source?profileId=${encodeURIComponent(activeProfileId)}&query=${encodeURIComponent(selectedIssue.searchQuery)}&topic=${encodeURIComponent(selectedIssue.title)}&keywords=${encodeURIComponent(selectedIssue.keywords.join(","))}`,
        { signal }
      )
      const sourceBody = (await sourceResponse.json()) as {
        results?: NewsSource[]
        configured?: boolean
        message?: string
      }
      if (!sourceResponse.ok || !sourceBody.results?.length) {
        throw new Error(sourceBody.message || "관련 원본을 찾지 못했습니다.")
      }
      setSourceSearch({
        issueId: selectedIssue.id,
        results: sourceBody.results,
        message: "자동생성 모드가 원본을 선택했습니다.",
        youtubeDataMissing: sourceBody.configured === false,
        status: "complete",
      })

      let primarySource: NewsSource | null = null
      for (const candidate of sourceBody.results) {
        ensureRunning()
        try {
          const stored = await storeAutomaticSource(candidate, signal)
          if (stored.localFile && !stored.requiresUpload) {
            primarySource = stored
            break
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError")
            throw error
        }
      }
      if (!primarySource) {
        throw new Error(
          "자동으로 저장 가능한 원본이 없습니다. 다른 이슈를 선택하거나 원본 파일을 추가해 주세요."
        )
      }
      const sourceProject: NewsClipProject = {
        ...issueProject,
        source: primarySource,
        supportingSources: [],
        sourceIssueId: selectedIssue.id,
      }
      setProject(sourceProject)
      setBusy("auto:script")
      setNote("자동생성 · 원본 핵심 각도를 고르고 대본을 만들고 있습니다.")
      const anglesResponse = await fetch("/api/news-clips/angles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: primarySource.id,
          profileId: activeProfileId,
          productionMode: sourceProject.productionMode,
          issueTitle: selectedIssue.title,
          directSource: false,
        }),
        signal,
      })
      const anglesBody = (await anglesResponse.json()) as {
        transcript?: NewsClipProject["transcript"]
        angles?: NewsAngleOption[]
        detectedSilences?: NewsClipProject["detectedSilences"]
        sourceChannel?: string
        sourceTitle?: string
        message?: string
      }
      if (!anglesResponse.ok || !anglesBody.angles?.length) {
        throw new Error(anglesBody.message || "핵심 각도를 만들지 못했습니다.")
      }
      ensureRunning()
      const autoAngles = normalizeAngleOptions(anglesBody.angles)
      const autoAngle = autoAngles[0]!
      const angledSource: NewsSource = {
        ...primarySource,
        channel: anglesBody.sourceChannel?.trim() || primarySource.channel,
        title: anglesBody.sourceTitle?.trim() || primarySource.title,
      }
      const analyzeResponse = await fetch("/api/news-clips/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: angledSource.id,
          profileId: activeProfileId,
          issueTitle: selectedIssue.title,
          issueKeywords: selectedIssue.keywords,
          issueReason: selectedIssue.recommendationReason,
          issueArticleTitles: selectedIssue.articles.map(
            (article) => article.title
          ),
          supportingSourceIds: [],
          productionMode: sourceProject.productionMode,
          angleTitle: autoAngle.title,
          angleSummary: autoAngle.summary,
          angleKeywords: autoAngle.keywords,
          angleSourceStart: autoAngle.sourceStart,
          angleSourceEnd: autoAngle.sourceEnd,
        }),
        signal,
      })
      const analysis = (await analyzeResponse.json()) as {
        transcript?: NewsClipProject["transcript"]
        candidates?: NewsClipCandidate[]
        selectedCandidate?: NewsClipCandidate
        detectedSilences?: NewsClipProject["detectedSilences"]
        removedRanges?: NewsClipProject["removedRanges"]
        keepRanges?: NewsClipProject["keepRanges"]
        reportScript?: string
        reportScenes?: NewsReportScene[]
        sourceChannel?: string
        sourceTitle?: string
        message?: string
      }
      if (
        !analyzeResponse.ok ||
        !analysis.transcript ||
        !analysis.candidates ||
        !analysis.selectedCandidate
      ) {
        throw new Error(analysis.message || "자동 대본을 만들지 못했습니다.")
      }
      ensureRunning()
      const draft = prepareAutomaticDraft(
        {
          ...sourceProject,
          source: angledSource,
          angleOptions: autoAngles,
          selectedAngleId: autoAngle.id,
          transcript: anglesBody.transcript ?? [],
          detectedSilences: anglesBody.detectedSilences ?? [],
        },
        angledSource,
        analysis.transcript,
        analysis.candidates,
        analysis.selectedCandidate,
        analysis.detectedSilences ?? anglesBody.detectedSilences ?? [],
        analysis.reportScript ?? "",
        analysis.reportScenes ?? [],
        analysis.removedRanges ?? [],
        analysis.keepRanges ?? [],
        {
          channel: analysis.sourceChannel,
          title: analysis.sourceTitle,
        }
      )
      setProject({
        ...draft,
        angleOptions: autoAngles,
        selectedAngleId: autoAngle.id,
      })
      setBusy("auto:preview")
      setNote("자동생성 · 360×640 저해상도 초안을 렌더링하고 있습니다.")
      const previewProject = await renderAutomaticProject(
        "/api/news-clips/preview",
        draft,
        settings,
        signal
      )
      ensureRunning()
      setProject(previewProject)
      setBusy("auto:final")
      setNote("자동생성 · 720×1280 최종 영상을 렌더링하고 있습니다.")
      let finalProject = await renderAutomaticProject(
        "/api/news-clips/render",
        previewProject,
        settings,
        signal
      )
      ensureRunning()
      if (settings.youtubeAutoUpload) {
        setNote("자동생성 · YouTube에 예약 업로드하고 있습니다.")
        finalProject = await uploadAutomaticNewsClip(finalProject, signal)
        ensureRunning()
      }
      setProject(finalProject)
      setStep("final")
      setFurthestStep("final")
      const saved = await persistHistory(finalProject, "final", "final", true)
      setNote(
        saved
          ? `자동생성 완료 · 적합도 ${selectedIssue.score}점 · 화제성 ${selectedIssue.trendScore}점`
          : "영상은 완성했지만 저장하지 못했습니다."
      )
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      setNote(
        error instanceof Error
          ? `자동생성 중단 · ${error.message}`
          : "자동생성을 완료하지 못했습니다."
      )
    } finally {
      if (autoAbortRef.current === controller) {
        autoAbortRef.current = null
        setBusy("")
      }
    }
  }

  return (
    <div className="flex h-svh bg-background text-foreground">
      <aside className="sticky top-0 flex h-svh w-60 shrink-0 flex-col border-r border-separator bg-surface">
        <div className="flex flex-col gap-1 p-3">
          <Button
            variant="ghost"
            fullWidth
            className="justify-start"
            isDisabled={busy.startsWith("auto:")}
            onPress={() => router.push("/")}
          >
            <span className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 text-left text-sm font-normal">
              <Home className="size-4 justify-self-center" />
              <span className="truncate">홈</span>
            </span>
          </Button>
          <div className="flex items-center gap-2 py-2 pr-0 pl-3">
            <Avatar className="size-10 shrink-0">
              {profile.avatarUrl ? (
                <Avatar.Image
                  src={profile.avatarUrl}
                  alt={`${profile.name} 채널 프로필`}
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <Avatar.Fallback className="text-sm font-semibold">
                {profile.name.trim().slice(0, 1) || "N"}
              </Avatar.Fallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-xs tracking-wide text-muted">채널명</p>
              <h1 className="mt-1 truncate text-sm font-medium">
                {profile.name}
              </h1>
            </div>
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label="뉴스 채널 변경"
              className="shrink-0"
              onPress={() => router.push("/studio/news-clips")}
            >
              <ArrowLeftRight className="size-4" />
            </Button>
          </div>
        </div>
        <Separator />
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {VISIBLE_NEWS_CLIP_STEPS.map((item, index) => {
            const completed = stepIndex(item.id) < stepIndex(furthestStep)
            const activeStep = visibleWorkflowStep(step)
            return (
              <Button
                key={item.id}
                variant={
                  item.id === activeStep && !showSettings && !showHistory
                    ? "secondary"
                    : "ghost"
                }
                fullWidth
                className="justify-start px-4"
                isDisabled={busy.startsWith("auto:")}
                onPress={() => openStep(item.id)}
              >
                <span className="grid w-full grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 text-left text-[14px] font-medium">
                  <span className="justify-self-center text-center leading-none text-muted tabular-nums">
                    {index + 1}
                  </span>
                  <span className="truncate">{item.label}</span>
                  {completed ? (
                    <Check className="size-3.5 text-muted" />
                  ) : (
                    <span className="size-3.5" aria-hidden="true" />
                  )}
                </span>
              </Button>
            )
          })}
        </nav>
        <div className="flex flex-col gap-1 p-3">
          <Button
            variant="ghost"
            fullWidth
            className="justify-start"
            isDisabled={busy.startsWith("auto:")}
            onPress={newProject}
          >
            <span className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 text-left text-sm font-normal">
              <Plus className="size-4 justify-self-center" />
              <span className="truncate">새 영상 만들기</span>
            </span>
          </Button>
          <Button
            variant={showHistory ? "secondary" : "ghost"}
            fullWidth
            className="justify-start"
            isDisabled={busy.startsWith("auto:")}
            onPress={() =>
              router.push(
                `/studio/news-clips?channel=${encodeURIComponent(profile.id)}&view=history`
              )
            }
          >
            <span className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 text-left text-sm font-normal">
              <History className="size-4 justify-self-center" />
              <span className="truncate">히스토리</span>
            </span>
          </Button>
          <Button
            variant={showSettings ? "secondary" : "ghost"}
            fullWidth
            className="justify-start"
            isDisabled={busy.startsWith("auto:")}
            onPress={() =>
              router.push(
                `/studio/news-clips?channel=${encodeURIComponent(profile.id)}&view=settings`
              )
            }
          >
            <span className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 text-left text-sm font-normal">
              <Settings className="size-4 justify-self-center" />
              <span className="truncate">설정</span>
            </span>
          </Button>
        </div>
      </aside>

      <div className="h-svh min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
          <div className="sticky top-0 z-30 -mx-6 -mt-6 flex min-h-14 items-center justify-end gap-3 border-b border-separator bg-background/95 px-6 py-3 backdrop-blur">
            {busy.startsWith("auto:") ? (
              <span className="text-xs text-muted">
                {automaticModeStatus(busy)} · OFF로 중지
              </span>
            ) : null}
            {project.productionMode === "report" ? (
              <Switch
                isSelected={autoMode}
                isDisabled={busy !== "" && !busy.startsWith("auto:")}
                onChange={toggleAutoMode}
                aria-label="자동생성 모드"
              >
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  자동생성
                </Switch.Content>
              </Switch>
            ) : (
              <span className="rounded-full bg-default px-3 py-1.5 text-xs font-medium">
                빌드업형
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              isDisabled={
                busy === "history-save"
                  ? false
                  : busy !== "" || !hasSavableProgress(project)
              }
              onPress={() => void saveCurrentHistory()}
            >
              <LoadingButtonLabel
                loading={busy === "history-save"}
                label="저장"
                loadingLabel="저장 중"
              />
            </Button>
          </div>
          {showHistory ? (
            <NewsHistoryPanel
              profileId={profile.id}
              currentId={project.id}
              onOpen={openHistory}
            />
          ) : showSettings ? (
            <NewsClipSettingsPanel
              key={profile.id}
              profileId={profile.id}
              previewTitle={project.title}
              previewSubtitle={project.subtitles[0]?.text ?? ""}
              initialTab={settingsTab}
              accountNotice={accountNotice}
              youtubeChannelId={profile.youtubeChannelId}
              onPreviewChange={applySettingsPreview}
              onClose={() =>
                router.push(
                  `/studio/news-clips?channel=${encodeURIComponent(profile.id)}`
                )
              }
              onSaved={applySettingsPreview}
            />
          ) : step === "angles" ? (
            <AnglesStep
              angles={project.angleOptions}
              selectedAngleId={project.selectedAngleId}
              sourceTitle={project.source?.title}
              busy={busy}
              note={note}
              onBack={() => openStep("issue")}
              onSelect={(angle) => void runSelectedAngle(angle)}
              onCancelSelection={cancelSelectedAngle}
            />
          ) : step === "issue" || step === "source" ? (
            <SourceStep
              mode="issue"
              profileId={profile.id}
              productionMode={project.productionMode}
              selectedIssue={project.selectedIssue}
              source={project.source}
              transcript={transcriptDraft}
              issueSearch={issueSearch}
              sourceSearch={sourceSearch}
              note={note}
              busy={busy}
              autoMode={autoMode}
              onProductionMode={setProductionMode}
              onAutomaticGeneration={(query) =>
                void runAutomaticGeneration(query)
              }
              onYoutubeUrl={(url) => void runYoutubeUrl(url)}
              onVideoFile={(file) => void runVideoFile(file)}
              onTranscript={setTranscriptDraft}
              onIssueSearch={(patch) =>
                setIssueSearch((current) => ({ ...current, ...patch }))
              }
              onSourceSearch={(patch) =>
                setSourceSearch((current) => ({ ...current, ...patch }))
              }
              onSource={(source) =>
                updateProject({
                  source,
                  sourceIssueId: project.selectedIssue?.id ?? "",
                  supportingSources: [],
                })
              }
              onIssueSelected={(selectedIssue) => {
                void runSelectedIssue(selectedIssue)
              }}
              onIssueStepRequested={() => openStep("issue")}
              onNote={setNote}
              onBusy={setBusy}
              onAnalyzed={async (source) => {
                const sourceProject: NewsClipProject = {
                  ...project,
                  source,
                  supportingSources: [],
                  sourceIssueId: project.selectedIssue?.id ?? "",
                }
                setProject(sourceProject)
                setBusy("analyze")
                try {
                  await loadAnglesForSource(
                    sourceProject,
                    source,
                    project.selectedIssue,
                    project.selectedIssue?.directSource === true
                  )
                } catch (error) {
                  setNote(
                    error instanceof Error
                      ? error.message
                      : "핵심 각도를 만들지 못했습니다."
                  )
                } finally {
                  setBusy("")
                }
              }}
            />
          ) : (
            <ReviewStep
              mode={
                step as Exclude<NewsClipStep, "issue" | "source" | "angles">
              }
              project={project}
              settings={settings}
              note={note}
              busy={busy}
              previewProgress={previewProgress}
              onBack={() => openStep(previousReviewStep(step))}
              onNext={() => advanceStep(nextReviewStep(step))}
              onProject={updateProject}
              onSettings={(patch) => void updateTtsSettings(patch)}
              onBusy={setBusy}
              onNote={setNote}
              onPreview={(force, draft) =>
                generatePreview(draft ?? project, force)
              }
              onCancelPreview={cancelPreview}
              onReselect={(target) => reselectCandidate(target)}
              onFinalized={(finalizedProject) =>
                persistHistory(finalizedProject, "final", "final", true)
              }
            />
          )}
        </main>
      </div>
    </div>
  )
}

function newsSettingsTab(value: string | null) {
  return value === "assets" ||
    value === "text" ||
    value === "audio" ||
    value === "accounts"
    ? value
    : "search"
}

function automaticIssueScore(issue: RecommendedNewsIssue) {
  return issue.score + (issue.trendScore ?? 0)
}

function directSourceIssue(source: NewsSource): RecommendedNewsIssue {
  const title = source.title.trim() || "YouTube 원본 영상"
  const keywords = issueTokens(title).slice(0, 8)
  return {
    id: `youtube-${source.id}`,
    title,
    searchQuery: keywords.join(" ") || title,
    keywords,
    score: 100,
    trendScore: 0,
    articleCount: source.originalUrl ? 1 : 0,
    sourceCount: 1,
    communityMentionCount: 0,
    recommendationReason: "사용자가 지정한 YouTube 원본",
    articles: source.originalUrl
      ? [
          {
            title,
            url: source.originalUrl,
            source: source.channel,
            publishedAt: source.publishedAt || new Date().toISOString(),
          },
        ]
      : [],
    directSource: true,
    directSourceUrl: source.originalUrl || undefined,
  }
}

function automaticModeStatus(busy: string) {
  if (busy === "auto:sources") return "원본 자료 선택 중"
  if (busy === "auto:script") return "대본·연출 생성 중"
  if (busy === "auto:preview") return "저해상도 초안 생성 중"
  if (busy === "auto:final") return "최종 영상 생성 중"
  return "이슈 자동 검색 중"
}

async function storeAutomaticSource(source: NewsSource, signal: AbortSignal) {
  const response = await fetch("/api/news-clips/source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: source.originalUrl,
      title: source.title,
      channel: source.channel,
      summary: source.summary,
      kind: "search",
      publishedAt: source.publishedAt,
      durationSeconds: source.durationSeconds,
      viewCount: source.viewCount,
      commentCount: source.commentCount,
      searchMetrics: source.searchMetrics,
    }),
    signal,
  })
  const body = (await response.json()) as NewsSource & { message?: string }
  if (!response.ok) {
    throw new Error(body.message || "원본 자료를 저장하지 못했습니다.")
  }
  return body
}

async function renderAutomaticProject(
  endpoint: "/api/news-clips/preview" | "/api/news-clips/render",
  project: NewsClipProject,
  settings: NewsClipSettings,
  signal: AbortSignal
) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project, settings, force: true }),
    signal,
  })
  const body = (await response.json()) as {
    message?: string
    previewUrl?: string
    previewIntroUrl?: string
    previewLeadUrl?: string
    previewBodyUrl?: string
    previewOutroUrl?: string
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
    throw new Error(
      body.message ||
        (endpoint.endsWith("preview")
          ? "저해상도 초안을 만들지 못했습니다."
          : "최종 영상을 만들지 못했습니다.")
    )
  }
  const partUrls = {
    previewIntroUrl: body.previewIntroUrl ?? "",
    previewLeadUrl: body.previewLeadUrl ?? "",
    previewBodyUrl: body.previewBodyUrl ?? "",
    previewOutroUrl: body.previewOutroUrl ?? "",
  }
  const common = {
    ...project,
    ...partUrls,
    renderSettingsKey: newsRenderSettingsKey(settings),
    titleCardDurationSeconds:
      body.titleCardDurationSeconds ?? project.titleCardDurationSeconds,
    outputDurationSeconds:
      body.outputDurationSeconds ?? project.outputDurationSeconds,
    finalPlaybackRate: endpoint.endsWith("render")
      ? normalizeFinalPlaybackRate(body.finalPlaybackRate)
      : project.finalPlaybackRate,
    subtitles: body.subtitles ?? project.subtitles,
    reportScenes: body.reportScenes ?? project.reportScenes,
  }
  return endpoint.endsWith("preview")
    ? {
        ...common,
        previewUrl: body.previewUrl ?? "",
        previewSignature: body.signature ?? "",
        previewRevision: project.editorialRevision,
        finalRevision: 0,
        subtitleTimingsLocked: true,
      }
    : {
        ...common,
        outputUrl: body.outputUrl ?? "",
        thumbnailUrl: body.thumbnailUrl ?? "",
        renderSignature: body.signature ?? "",
        finalRevision: project.editorialRevision,
        subtitleTimingsLocked: true,
      }
}

function balanceProjectSubtitles(
  project: NewsClipProject,
  settings: NewsClipSettings
) {
  const subtitles = normalizeSubtitleCues(
    project.subtitles,
    settings.bodySubtitleText
  )
  const settingsKey = newsRenderSettingsKey(settings)
  const settingsChanged = project.renderSettingsKey !== settingsKey
  if (
    !settingsChanged &&
    JSON.stringify(subtitles) === JSON.stringify(project.subtitles)
  ) {
    return project
  }
  return {
    ...project,
    subtitles,
    updatedAt: new Date().toISOString(),
    renderSignature: "",
    outputUrl: "",
    renderSettingsKey: settingsChanged ? "" : project.renderSettingsKey,
    thumbnailUrl: "",
    youtubeVideoId: "",
    youtubeUploadUrl: "",
    previewUrl: project.previewUrl,
    previewIntroUrl: project.previewIntroUrl,
    previewLeadUrl: project.previewLeadUrl,
    previewBodyUrl: project.previewBodyUrl,
    previewOutroUrl: project.previewOutroUrl,
    previewSignature: project.previewSignature,
  }
}

function resetAngleSelection(project: NewsClipProject): NewsClipProject {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    editorialRevision: project.editorialRevision + 1,
    previewRevision: 0,
    finalRevision: 0,
    selectedAngleId: "",
    candidates: [],
    selectedCandidateId: "",
    title: "",
    titleOptions: [],
    reportScript: "",
    reportScenes: [],
    removedRanges: [],
    keepRanges: [],
    subtitles: [],
    subtitleTimingsLocked: false,
    introStillTimeSeconds: null,
    titleCardDurationSeconds: 0,
    outputDurationSeconds: 0,
    renderSignature: "",
    outputUrl: "",
    previewUrl: "",
    previewIntroUrl: "",
    previewLeadUrl: "",
    previewBodyUrl: "",
    previewOutroUrl: "",
    previewSignature: "",
    renderSettingsKey: "",
    thumbnailUrl: "",
    youtubeVideoId: "",
    youtubeUploadUrl: "",
    metadata: { youtubeTitle: "", description: "", tags: [] },
  }
}

async function uploadAutomaticNewsClip(
  project: NewsClipProject,
  signal: AbortSignal
) {
  const response = await fetch("/api/news-clips/upload/youtube", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      project,
      scheduledAt: nextKoreaUploadSlot(),
    }),
    signal,
  })
  const body = (await response.json()) as {
    message?: string
    videoId?: string
    url?: string
  }
  if (!response.ok || !body.videoId || !body.url) {
    throw new Error(body.message || "YouTube에 업로드하지 못했습니다.")
  }
  return {
    ...project,
    youtubeVideoId: body.videoId,
    youtubeUploadUrl: body.url,
  }
}

function NewsChannelPicker({
  profiles,
  onOpen,
  onCreated,
  onDeleted,
  onBack,
}: {
  profiles: NewsChannelProfile[]
  onOpen: (profileId: string) => void
  onCreated: (profile: NewsChannelProfile) => void
  onDeleted: (profileId: string) => void
  onBack: () => void
}) {
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [deleting, setDeleting] = useState("")
  const [confirmDelete, setConfirmDelete] = useState<NewsChannelProfile | null>(
    null
  )
  const [createOpen, setCreateOpen] = useState(false)
  const [note, setNote] = useState("")

  async function create() {
    setPending(true)
    setNote("")
    try {
      const response = await fetch("/api/news-clips/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const body = (await response.json()) as NewsChannelProfile & {
        message?: string
      }
      if (!response.ok) {
        setNote(body.message || "뉴스 채널을 만들지 못했습니다.")
        return
      }
      setName("")
      setCreateOpen(false)
      onCreated(body)
    } catch {
      setNote("뉴스 채널을 만들지 못했습니다.")
    } finally {
      setPending(false)
    }
  }

  async function remove(profile: NewsChannelProfile) {
    setDeleting(profile.id)
    setNote("")
    try {
      const response = await fetch("/api/news-clips/channels", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: profile.id }),
      })
      const body = (await response.json()) as {
        archived?: boolean
        message?: string
      }
      if (!response.ok || !body.archived) {
        setNote(body.message || "뉴스 채널을 삭제하지 못했습니다.")
        return
      }
      window.localStorage.removeItem(storageKey(profile.id))
      onDeleted(profile.id)
      setConfirmDelete(null)
    } catch {
      setNote("뉴스 채널을 삭제하지 못했습니다.")
    } finally {
      setDeleting("")
    }
  }

  return (
    <main className="min-h-svh bg-background px-6 py-12 text-foreground">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <nav className="flex items-center gap-2 text-sm text-muted">
          <Button size="sm" variant="ghost" onPress={onBack}>
            <ArrowLeft className="size-4" /> 제작 모드
          </Button>
          <span aria-hidden="true">/</span>
          <span>뉴스 리포트 제작</span>
        </nav>
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">채널 선택</h1>
            <p className="mt-2 text-sm text-muted">
              작업할 뉴스 채널을 고르거나 추가합니다.
            </p>
          </div>
          <Button
            className="shrink-0"
            onPress={() => {
              setNote("")
              setCreateOpen(true)
            }}
          >
            채널 추가
          </Button>
        </header>
        {profiles.length ? (
          <section className="grid gap-4 md:grid-cols-2">
            {profiles.map((profile) => (
              <Card key={profile.id} className="gap-4 p-4">
                <Card.Header className="flex-row items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-10 shrink-0">
                      {profile.avatarUrl ? (
                        <Avatar.Image
                          src={profile.avatarUrl}
                          alt={`${profile.name} 채널 프로필`}
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      <Avatar.Fallback className="text-sm font-semibold">
                        {profile.name.trim().slice(0, 1) || "N"}
                      </Avatar.Fallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-[16px] leading-snug font-semibold">
                        {profile.name}
                      </p>
                      <p className="mt-1 text-[13px] leading-4 text-muted">
                        뉴스 리포트 채널
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label={`${profile.name} 채널 삭제`}
                    className="shrink-0 text-muted hover:text-danger"
                    isDisabled={deleting !== ""}
                    onPress={() => {
                      setNote("")
                      setConfirmDelete(profile)
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </Card.Header>
                <Card.Footer className="justify-end">
                  <Button
                    size="sm"
                    isDisabled={deleting !== ""}
                    onPress={() => onOpen(profile.id)}
                  >
                    열기
                  </Button>
                </Card.Footer>
              </Card>
            ))}
          </section>
        ) : null}
        {note && !createOpen ? (
          <p className="text-sm text-warning">{note}</p>
        ) : null}
        <AlertDialog
          isOpen={confirmDelete !== null}
          onOpenChange={(open) => {
            if (!open && !deleting) setConfirmDelete(null)
          }}
        >
          <AlertDialog.Backdrop>
            <AlertDialog.Container placement="center">
              <AlertDialog.Dialog>
                <AlertDialog.Header>
                  <AlertDialog.Icon status="danger" />
                  <AlertDialog.Heading>
                    이 뉴스 채널을 삭제할까요?
                  </AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  <p>
                    {confirmDelete
                      ? `"${confirmDelete.name}" 채널이 목록에서 삭제됩니다.`
                      : "선택한 채널이 목록에서 삭제됩니다."}
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    채널 설정은 필요할 때 복구할 수 있도록 보관됩니다.
                  </p>
                  {note ? (
                    <p className="mt-2 text-sm text-warning">{note}</p>
                  ) : null}
                </AlertDialog.Body>
                <AlertDialog.Footer className="justify-end">
                  <Button
                    variant="outline"
                    isDisabled={deleting !== ""}
                    onPress={() => setConfirmDelete(null)}
                  >
                    취소
                  </Button>
                  <Button
                    variant="danger"
                    isDisabled={!confirmDelete || deleting !== ""}
                    onPress={() => {
                      if (confirmDelete) void remove(confirmDelete)
                    }}
                  >
                    {deleting ? "삭제 중" : "삭제"}
                  </Button>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </AlertDialog>
        <Modal
          isOpen={createOpen}
          onOpenChange={(open) => {
            if (!pending) setCreateOpen(open)
          }}
        >
          <Modal.Backdrop isDismissable={!pending}>
            <Modal.Container placement="center" size="md">
              <Modal.Dialog>
                <Modal.Header>
                  <Modal.Heading>새 뉴스 채널</Modal.Heading>
                </Modal.Header>
                <Modal.Body className="flex flex-col gap-4">
                  <TextField
                    value={name}
                    onChange={setName}
                    fullWidth
                    autoFocus
                  >
                    <Label>채널 이름</Label>
                    <Input placeholder="채널 이름" />
                  </TextField>
                  {note ? <p className="text-sm text-warning">{note}</p> : null}
                </Modal.Body>
                <Modal.Footer className="justify-end">
                  <Button
                    variant="outline"
                    isDisabled={pending}
                    onPress={() => setCreateOpen(false)}
                  >
                    취소
                  </Button>
                  <Button
                    isDisabled={pending || !name.trim()}
                    onPress={() => void create()}
                  >
                    {pending ? "만드는 중" : "추가"}
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </div>
    </main>
  )
}

function storageKey(profileId: string) {
  return `shorts-factory.news-clips.buildup2.${profileId}`
}

function refreshMediaUrl(url: string) {
  if (!url) return ""
  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}client=${Date.now().toString(36)}`
}

function hasSavableProgress(project: NewsClipProject) {
  return Boolean(
    project.selectedIssue ||
    project.source ||
    project.title.trim() ||
    project.reportScript.trim() ||
    project.previewUrl ||
    project.outputUrl
  )
}

function migrateLegacyBuildupScenes(scenes: NewsReportScene[]) {
  return scenes.map((scene) => {
    if (scene.id === "buildup-teaser") {
      return { ...scene, id: "buildup2-lead" }
    }
    if (scene.id === "buildup-highlight") {
      return {
        ...scene,
        id: "buildup2-quote",
        narration: "",
        visual: "quote" as const,
      }
    }
    if (scene.id.startsWith("buildup-highlight-cut-")) {
      return {
        ...scene,
        id: scene.id.replace("buildup-highlight-cut-", "buildup2-quote-cut-"),
        narration: "",
        visual: "quote" as const,
      }
    }
    return scene
  })
}

function normalizeSavedNewsProject(
  saved: NewsClipProject,
  profileId: string
): NewsClipProject {
  const fallback = freshNewsClipProject(profileId)
  const savedReportScript =
    typeof saved.reportScript === "string" ? saved.reportScript : ""
  const legacyEndCtaCues = Array.isArray(saved.subtitles)
    ? saved.subtitles.filter((cue) => cue.id.startsWith("end-cta"))
    : []
  const legacyEndCtaText = legacyEndCtaCues
    .map((cue) => cue.text.trim())
    .filter(Boolean)
    .join("\n")
  let reportScript = ensureReportEndCta(
    savedReportScript,
    saved.title,
    saved.selectedIssue?.keywords,
    legacyEndCtaText
  )
  const isBuildup2 =
    saved.productionMode === "buildup2" ||
    (saved.productionMode as string) === "buildup"
  const savedReportScenes = Array.isArray(saved.reportScenes)
    ? saved.reportScenes.map((scene): NewsReportScene => {
        const isHighlight =
          scene.id === "buildup2-quote" ||
          scene.id === "buildup-highlight" ||
          scene.id.startsWith("buildup2-quote") ||
          scene.id.startsWith("buildup-highlight")
        return {
          ...scene,
          // 빌드업 하이라이트는 항상 원본 음성. 잘못 TTS로 남은 대본은 비운다.
          visual:
            isBuildup2 && isHighlight
              ? "quote"
              : scene.visual === "quote"
                ? "quote"
                : "source",
          narration: isBuildup2 && isHighlight ? "" : scene.narration,
          sourceId:
            typeof scene.sourceId === "string"
              ? scene.sourceId
              : saved.source?.id || undefined,
        }
      })
    : []
  const selectedCandidate = saved.candidates?.find(
    (candidate) => candidate.id === saved.selectedCandidateId
  )
  let reportScenes =
    reportScript !== savedReportScript && selectedCandidate
      ? isBuildup2
        ? buildBuildup2Scenes(
            splitEndCtaFromScript(reportScript).body || reportScript,
            selectedCandidate.sourceStart,
            selectedCandidate.sourceEnd,
            saved.transcript ?? [],
            saved.source?.id ?? "",
            savedReportScenes
          )
        : buildReportScenes(
            reportScript,
            saved.transcript ?? [],
            selectedCandidate.sourceStart,
            selectedCandidate.sourceEnd,
            savedReportScenes,
            saved.source?.id ?? ""
          )
      : savedReportScenes
  if (
    reportScenes.length &&
    reportHasEndCta(reportScript) &&
    !reportScenes.some((scene) => isEndCtaScene(scene))
  ) {
    const { cta } = splitEndCtaFromScript(reportScript)
    if (cta) {
      reportScenes = appendEndCtaScenes(
        reportScenes.map((scene) => {
          if (scene.visual === "quote" || !reportHasEndCta(scene.narration)) {
            return scene
          }
          const { body } = splitEndCtaFromScript(scene.narration)
          return { ...scene, narration: body || scene.narration }
        }),
        cta,
        saved.source?.id ?? ""
      )
    }
  }
  if (isBuildup2 && reportScenes.length) {
    reportScenes = collapseBuildup2HighlightCuts(
      migrateLegacyBuildupScenes(reportScenes)
    )
    const highlight = reportScenes.find(
      (scene) => scene.id === "buildup2-quote"
    )
    if (highlight) {
      // 기존 기준: 티저 B-roll = 하이라이트 시작 ~3초
      reportScenes = reportScenes.map((scene) =>
        scene.id === "buildup2-lead"
          ? {
              ...scene,
              sourceStart: highlight.sourceStart,
              sourceEnd: Math.min(
                highlight.sourceStart + 3,
                highlight.sourceEnd
              ),
            }
          : scene
      )
    }
  }
  const { body: bodyScriptForCaptions } = splitEndCtaFromScript(reportScript)
  const draftForPrepare = {
    ...fallback,
    ...saved,
    profileId,
    productionMode: isBuildup2 ? ("buildup2" as const) : ("report" as const),
    reportScript,
    reportScenes,
    transcript: Array.isArray(saved.transcript) ? saved.transcript : [],
  }
  const prepared = reportScenes.length
    ? prepareRenderProject(draftForPrepare, {
        titleVoiceRate: defaultNewsClipSettings.titleVoiceRate,
        bodySubtitleText: defaultNewsClipSettings.bodySubtitleText,
        titleCardSeconds: defaultNewsClipSettings.titleCardSeconds,
      })
    : { project: draftForPrepare, reason: "report-scenes-required" }
  if (!prepared.reason) {
    reportScenes = prepared.project.reportScenes
    reportScript = prepared.project.reportScript
  }
  const rebuiltSubtitles = prepared.reason
    ? reportScenes.length
      ? reportSubtitles(
          reportScenes,
          undefined,
          reportCaptionPhrases(bodyScriptForCaptions || reportScript),
          saved.transcript ?? []
        )
      : saved.subtitles
    : prepared.project.subtitles
  const subtitles = isBuildup2
    ? rebuiltSubtitles
    : reportScript !== savedReportScript && legacyEndCtaCues.length
      ? migrateLegacyEndCtaCues(saved.subtitles, reportScenes)
      : reportScript !== savedReportScript && reportScenes.length
        ? rebuiltSubtitles
        : reportScenes.some((scene) => isEndCtaScene(scene)) &&
            Array.isArray(saved.subtitles) &&
            !saved.subtitles.some(
              (cue) => cue.sceneId === "end-cta" || cue.id.startsWith("end-cta")
            )
          ? rebuiltSubtitles
          : saved.subtitles

  return {
    ...fallback,
    ...saved,
    profileId,
    productionMode: isBuildup2 ? "buildup2" : "report",
    editorialRevision: Number.isFinite(saved.editorialRevision)
      ? Math.max(1, Math.floor(saved.editorialRevision))
      : 1,
    previewRevision: Number.isFinite(saved.previewRevision)
      ? Math.max(0, Math.floor(saved.previewRevision))
      : 0,
    finalRevision: Number.isFinite(saved.finalRevision)
      ? Math.max(0, Math.floor(saved.finalRevision))
      : 0,
    supportingSources: Array.isArray(saved.supportingSources)
      ? saved.supportingSources
      : [],
    angleOptions: normalizeAngleOptions(saved.angleOptions),
    selectedAngleId:
      typeof saved.selectedAngleId === "string" ? saved.selectedAngleId : "",
    reportScript,
    supplementalContext:
      typeof saved.supplementalContext === "string"
        ? saved.supplementalContext.slice(0, 5000)
        : "",
    reportScenes,
    subtitles: Array.isArray(subtitles) ? subtitles : [],
    subtitleTimingsLocked:
      saved.subtitleTimingsLocked === true ||
      (Array.isArray(subtitles) &&
        subtitles.length > 0 &&
        Boolean(saved.previewUrl || saved.outputUrl)),
    detectedSilences: Array.isArray(saved.detectedSilences)
      ? saved.detectedSilences
      : [],
    quoteVolume: Number.isFinite(saved.quoteVolume) ? saved.quoteVolume : 1,
    introStillTimeSeconds:
      saved.introStillTimeSeconds === null ||
      Number.isFinite(saved.introStillTimeSeconds)
        ? saved.introStillTimeSeconds
        : null,
    introStillZoom: Number.isFinite(saved.introStillZoom)
      ? saved.introStillZoom
      : 1,
    introStillX: Number.isFinite(saved.introStillX) ? saved.introStillX : 50,
    introStillY: Number.isFinite(saved.introStillY) ? saved.introStillY : 50,
    titleCardDurationSeconds: Number.isFinite(saved.titleCardDurationSeconds)
      ? saved.titleCardDurationSeconds
      : 0,
    finalPlaybackRate: normalizeFinalPlaybackRate(saved.finalPlaybackRate),
    previewIntroUrl:
      typeof saved.previewIntroUrl === "string" ? saved.previewIntroUrl : "",
    previewLeadUrl:
      typeof saved.previewLeadUrl === "string" ? saved.previewLeadUrl : "",
    previewBodyUrl:
      typeof saved.previewBodyUrl === "string" ? saved.previewBodyUrl : "",
    previewOutroUrl:
      typeof saved.previewOutroUrl === "string" ? saved.previewOutroUrl : "",
    renderSettingsKey:
      typeof saved.renderSettingsKey === "string"
        ? saved.renderSettingsKey
        : "",
  }
}

function migrateLegacyEndCtaCues(
  subtitles: NewsClipProject["subtitles"],
  reportScenes: NewsReportScene[]
) {
  const legacyCues = subtitles.filter((cue) => cue.id.startsWith("end-cta"))
  const ctaScenes = reportScenes.slice(-legacyCues.length)
  let ctaIndex = 0
  return subtitles.map((cue) => {
    if (!cue.id.startsWith("end-cta")) return cue
    const scene = ctaScenes[Math.min(ctaIndex, ctaScenes.length - 1)]
    ctaIndex += 1
    return {
      ...cue,
      id: `report-cta-${ctaIndex}`,
      sceneId: scene?.id,
    }
  })
}

function ensureTwoLineIntroTitle(
  title: string,
  firstLayout: NewsClipSettings["titleCardText"],
  secondFontSize: number
) {
  const lines = title
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length >= 2) return `${lines[0]}\n${lines.slice(1).join(" ")}`
  const [first, second] = splitIntroTitleLines(title, firstLayout)
  if (first && second) {
    return fitTitleToLineLayouts(title, firstLayout, {
      ...firstLayout,
      fontSize: secondFontSize,
    })
  }
  if (first) return `${first}\n핵심 포인트`
  return "오늘 이슈\n핵심 포인트"
}

function stepIndex(step: NewsClipStep) {
  return NEWS_CLIP_STEPS.findIndex((item) => item.id === step)
}

function previousReviewStep(step: NewsClipStep): NewsClipStep {
  if (step === "final") return "preview"
  if (step === "preview" || step === "script" || step === "direction")
    return "angles"
  if (step === "angles") return "issue"
  return "issue"
}

function nextReviewStep(step: NewsClipStep): NewsClipStep {
  if (step === "script") return "preview"
  if (step === "direction") return "preview"
  if (step === "preview") return "final"
  return "final"
}

const VISIBLE_NEWS_CLIP_STEPS = NEWS_CLIP_STEPS.filter(
  (item) =>
    item.id !== "script" && item.id !== "direction" && item.id !== "source"
)

function visibleWorkflowStep(step: NewsClipStep): NewsClipStep {
  if (step === "script" || step === "direction") return "preview"
  // 원본 선택은 이슈 단계 안의 내부 과정으로만 두고 사이드바에는 노출하지 않는다.
  if (step === "source") return "issue"
  return step
}

function sourceDescription(
  source: NewsSource | null,
  candidate: NewsClipCandidate
) {
  return [
    `원본: ${source?.originalUrl || "사용자 업로드"}`,
    `사용 구간: ${timeLabel(candidate.sourceStart)}~${timeLabel(candidate.sourceEnd)}`,
    candidate.reason,
  ].join("\n")
}

export function timeLabel(seconds: number) {
  const safe = Math.max(0, seconds || 0)
  const minutes = Math.floor(safe / 60)
  const rest = safe - minutes * 60
  return `${String(minutes).padStart(2, "0")}:${rest
    .toFixed(rest % 1 ? 1 : 0)
    .padStart(2, "0")}`
}
