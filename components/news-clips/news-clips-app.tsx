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
  ScrollShadow,
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
  Settings,
  Trash2,
} from "lucide-react"
import { NewsClipSettingsPanel } from "@/components/news-clips/settings-panel"
import { NewsHistoryPanel } from "@/components/news-clips/history-panel"
import { NewsClipSourceStep as SourceStep } from "@/components/news-clips/source-step"
import { NewsClipReviewStep as ReviewStep } from "@/components/news-clips/review-step"
import {
  normalizeNewsIssueSearchState,
  type NewsIssueSearchState,
  type RecommendedNewsIssue,
} from "@/lib/news-clips/issues"
import type { NewsHistorySnapshot } from "@/lib/news-clips/history"
import { issueTokens } from "@/lib/news-clips/discovery"
import { newsRenderSettingsKey } from "@/lib/news-clips/render-key"
import {
  fitTitleToLineLayouts,
  normalizeSubtitleCues,
} from "@/lib/news-clips/text-layout"
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
  NEWS_CLIP_STEPS,
  defaultNewsClipSettings,
  freshNewsClipProject,
  normalizeNewsSourceSearchState,
  resetNewsClipProjectProgress,
  type NewsChannelProfile,
  type NewsClipCandidate,
  type NewsClipProject,
  type NewsClipSettings,
  type NewsClipStep,
  type NewsReportScene,
  type NewsSource,
  type NewsSourceSearchState,
} from "@/lib/news-clips/types"

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
  const [note, setNote] = useState("")
  const [autoMode, setAutoMode] = useState(false)
  const autoAbortRef = useRef<AbortController | null>(null)

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
                : saved.project.previewUrl
                  ? "preview"
                  : "script"
              : NEWS_CLIP_STEPS.some((item) => item.id === saved.step)
                ? (saved.step as NewsClipStep)
                : "issue"
          const migratedStep: NewsClipStep =
            storedStep === "direction"
              ? migratedProject.previewUrl
                ? "preview"
                : "script"
              : storedStep
          if (migratedProject.selectedIssue && sourceMatchesIssue) {
            savedStep = migratedStep
            const storedFurthest = NEWS_CLIP_STEPS.some(
              (item) => item.id === saved.furthestStep
            )
              ? (saved.furthestStep as NewsClipStep)
              : migratedStep
            savedFurthestStep = visibleWorkflowStep(
              storedFurthest,
              migratedProject
            )
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
    const restoredStep = visibleWorkflowStep(snapshot.step, restored)
    setStep(restoredStep)
    setFurthestStep(visibleWorkflowStep(snapshot.furthestStep, restored))
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

  function updateProject(patch: Partial<NewsClipProject>) {
    setProject((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      renderSignature: "",
      outputUrl: "",
      previewSignature: "",
      previewUrl: "",
      renderSettingsKey: "",
      thumbnailUrl: "",
      ...patch,
    }))
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
      subtitles: subtitleLayoutChanged
        ? normalizeSubtitleCues(current.subtitles, next.bodySubtitleText)
        : current.subtitles,
      updatedAt: new Date().toISOString(),
      titleCardDurationSeconds: 0,
      renderSignature: "",
      outputUrl: "",
      previewSignature: "",
      previewUrl: "",
      renderSettingsKey: "",
      thumbnailUrl: "",
    }))
  }

  async function updateTtsSettings(patch: Partial<NewsClipSettings>) {
    const next = { ...settings, ...patch }
    setSettings(next)
    setProject((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      titleCardDurationSeconds: 0,
      renderSignature: "",
      outputUrl: "",
      previewSignature: "",
      previewUrl: "",
      renderSettingsKey: "",
      thumbnailUrl: "",
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
    reportScenes: NewsReportScene[]
  ) {
    const title = fitTitleToLineLayouts(
      candidate.titleOptions[0] ||
        source.searchMetrics?.expectedShortTitle ||
        source.title,
      settings.titleCardText,
      {
        ...settings.titleCardText,
        fontSize: settings.titleCardSecondFontSize,
      }
    )
    const normalizedReportScenes = buildReportScenes(
      reportScript,
      transcript,
      candidate.sourceStart,
      candidate.sourceEnd,
      reportScenes,
      source.id
    )
    const estimatedBodySeconds = estimateReportScenesDuration(
      normalizedReportScenes,
      settings.titleVoiceRate
    )
    const outputBodySeconds = bodyDurationWithEndCta(estimatedBodySeconds)
    return {
      ...base,
      source,
      transcript,
      candidates,
      detectedSilences,
      selectedCandidateId: candidate.id,
      title,
      titleOptions: candidate.titleOptions,
      reportScript,
      reportScenes: normalizedReportScenes,
      removedRanges: [],
      keepRanges: [
        {
          sourceStart: candidate.sourceStart,
          sourceEnd: candidate.sourceEnd,
          outputStart: 0,
          outputEnd: candidate.sourceEnd - candidate.sourceStart,
        },
      ],
      subtitles: withEndCta(
        normalizeSubtitleCues(
          reportSubtitles(
            normalizedReportScenes,
            undefined,
            reportCaptionPhrases(reportScript)
          ),
          settings.bodySubtitleText
        ),
        outputBodySeconds,
        contextualEndCtaText(title, base.selectedIssue?.keywords, reportScript),
        estimatedBodySeconds
      ),
      outputDurationSeconds: settings.titleCardSeconds + outputBodySeconds,
      bgmEnabled: settings.bgmEnabled,
      bgmVolume: settings.bgmVolume,
      titleVolume: settings.titleVolume,
      sourceVolume: settings.sourceVolume,
      quoteVolume: settings.quoteVolume,
      introStillTimeSeconds: null,
      titleCardDurationSeconds: settings.titleCardSeconds,
      metadata: {
        youtubeTitle: title.replace(/\s*\n\s*/g, " "),
        description: sourceDescription(source, candidate),
        tags: ["뉴스", "시사", "쇼츠", "NewsStory"],
      },
      updatedAt: new Date().toISOString(),
      previewUrl: "",
      previewSignature: "",
      renderSettingsKey: "",
      outputUrl: "",
      renderSignature: "",
    } satisfies NewsClipProject
  }

  async function generatePreview(draft: NewsClipProject, force = false) {
    setBusy("preview")
    setNote("저해상도 쇼츠 초안을 만드는 중입니다.")
    try {
      const response = await fetch("/api/news-clips/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project: draft, settings, force }),
      })
      const body = (await response.json()) as {
        message?: string
        previewUrl?: string
        signature?: string
        titleCardDurationSeconds?: number
        outputDurationSeconds?: number
        subtitles?: NewsClipProject["subtitles"]
      }
      if (!response.ok || !body.previewUrl) {
        setNote(body.message || "저해상도 초안을 만들지 못했습니다.")
        return false
      }
      setProject((current) =>
        current.id === draft.id && current.updatedAt === draft.updatedAt
          ? {
              ...current,
              previewUrl: body.previewUrl ?? "",
              previewSignature: body.signature ?? "",
              renderSettingsKey: newsRenderSettingsKey(settings),
              titleCardDurationSeconds:
                body.titleCardDurationSeconds ??
                current.titleCardDurationSeconds,
              outputDurationSeconds:
                body.outputDurationSeconds ?? current.outputDurationSeconds,
              subtitles: body.subtitles ?? current.subtitles,
            }
          : current
      )
      setNote(body.message || "저해상도 초안을 만들었습니다.")
      return true
    } catch {
      setNote("저해상도 초안을 만들지 못했습니다.")
      return false
    } finally {
      setBusy("")
    }
  }

  async function reselectCandidate(target: "all" | "title" | "script" = "all") {
    if (!project.source) return
    const busyKey =
      target === "title"
        ? "rewrite-title"
        : target === "script"
          ? "rewrite-script"
          : "reselect"
    setBusy(busyKey)
    setNote(
      target === "title"
        ? "제목만 다시 작성하는 중입니다."
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
          issueTitle: project.selectedIssue?.directSource
            ? ""
            : (project.selectedIssue?.title ?? ""),
          issueKeywords: project.selectedIssue?.directSource
            ? []
            : (project.selectedIssue?.keywords ?? []),
          issueReason: project.selectedIssue?.directSource
            ? ""
            : (project.selectedIssue?.recommendationReason ?? ""),
          issueArticleTitles: project.selectedIssue?.directSource
            ? []
            : (project.selectedIssue?.articles.map(
                (article) => article.title
              ) ?? []),
          supplementalContext: project.supplementalContext,
          supportingSourceIds: project.supportingSources.map(
            (source) => source.id
          ),
          reselect: true,
        }),
      })
      const body = (await response.json()) as {
        transcript?: NewsClipProject["transcript"]
        candidates?: NewsClipCandidate[]
        selectedCandidate?: NewsClipCandidate
        detectedSilences?: NewsClipProject["detectedSilences"]
        reportScript?: string
        reportScenes?: NewsReportScene[]
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
        body.reportScenes ?? []
      )
      if (target === "title") {
        const title =
          draft.titleOptions
            .map((option) =>
              fitTitleToLineLayouts(option, settings.titleCardText, {
                ...settings.titleCardText,
                fontSize: settings.titleCardSecondFontSize,
              })
            )
            .find((option) => option !== project.title) ?? draft.title
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
      } else if (target === "script") {
        setProject({
          ...draft,
          title: project.title,
          titleOptions: project.titleOptions,
          introStillTimeSeconds: project.introStillTimeSeconds,
          metadata: {
            ...draft.metadata,
            youtubeTitle: project.metadata.youtubeTitle,
          },
        })
        setNote("본문과 문장별 화면 연출만 다시 작성했습니다.")
      } else {
        setProject(draft)
        setNote("제목, 본문과 화면 연출을 다시 작성했습니다.")
      }
    } catch {
      setNote("보도 대본을 다시 작성하지 못했습니다.")
    } finally {
      setBusy("")
    }
  }

  function newProject() {
    setProject(freshNewsClipProject(project.profileId))
    setTranscriptDraft("")
    setIssueSearch(normalizeNewsIssueSearchState(null))
    setSourceSearch(normalizeNewsSourceSearchState(null))
    setStep("issue")
    setFurthestStep("issue")
    setNote("")
  }

  function openStep(nextStep: NewsClipStep) {
    if (nextStep === "script") {
      setProject((current) => balanceProjectSubtitles(current, settings))
    }
    setStep(nextStep)
    if (showSettings) {
      router.push(
        `/studio/news-clips?channel=${encodeURIComponent(activeProfileId)}`
      )
    }
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
    setBusy("url-source")
    setNote("YouTube 영상을 가져와 대본을 만들고 있습니다.")
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
    setBusy("file-source")
    setNote("영상 파일을 업로드해 대본을 만들고 있습니다.")
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

    const analyzeResponse = await fetch("/api/news-clips/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceId: source.id,
        profileId: activeProfileId,
        issueTitle: "",
        issueKeywords: [],
        issueReason: "",
        issueArticleTitles: [],
        supportingSourceIds: [],
      }),
    })
    const analysis = (await analyzeResponse.json()) as {
      transcript?: NewsClipProject["transcript"]
      candidates?: NewsClipCandidate[]
      selectedCandidate?: NewsClipCandidate
      detectedSilences?: NewsClipProject["detectedSilences"]
      reportScript?: string
      reportScenes?: NewsReportScene[]
      message?: string
    }
    if (
      !analyzeResponse.ok ||
      !analysis.transcript ||
      !analysis.candidates ||
      !analysis.selectedCandidate
    ) {
      throw new Error(analysis.message || "영상 대본을 만들지 못했습니다.")
    }

    const draft = prepareAutomaticDraft(
      sourceProject,
      source,
      analysis.transcript,
      analysis.candidates,
      analysis.selectedCandidate,
      analysis.detectedSilences ?? [],
      analysis.reportScript ?? "",
      analysis.reportScenes ?? []
    )
    setProject(draft)
    setTranscriptDraft("")
    setStep("script")
    setFurthestStep((current) =>
      stepIndex("script") > stepIndex(current) ? "script" : current
    )
    setNote(`${sourceLabel} 영상을 분석해 대본을 만들었습니다.`)
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
      setNote(
        `자동생성 · ‘${selectedIssue.title}’ 관련 핵심 원본과 보조 자료를 찾고 있습니다.`
      )

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
        message: "자동생성 모드가 핵심 원본과 보조 자료를 선택했습니다.",
        youtubeDataMissing: sourceBody.configured === false,
        status: "complete",
      })

      const storedSources: NewsSource[] = []
      for (const candidate of sourceBody.results) {
        ensureRunning()
        try {
          const stored = await storeAutomaticSource(candidate, signal)
          if (stored.localFile && !stored.requiresUpload)
            storedSources.push(stored)
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError")
            throw error
        }
        if (storedSources.length >= 3) break
      }
      const primarySource = storedSources[0]
      if (!primarySource) {
        throw new Error(
          "자동으로 저장 가능한 원본이 없습니다. 다른 이슈를 선택하거나 원본 파일을 추가해 주세요."
        )
      }
      const supportingSources = storedSources.slice(1, 3)
      const sourceProject: NewsClipProject = {
        ...issueProject,
        source: primarySource,
        supportingSources,
        sourceIssueId: selectedIssue.id,
      }
      setProject(sourceProject)
      setBusy("auto:script")
      setNote(
        "자동생성 · 전체 자료를 분석해 시사 논평과 화면 연출을 만들고 있습니다."
      )

      const analyzeResponse = await fetch("/api/news-clips/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: primarySource.id,
          profileId: activeProfileId,
          issueTitle: selectedIssue.title,
          issueKeywords: selectedIssue.keywords,
          issueReason: selectedIssue.recommendationReason,
          issueArticleTitles: selectedIssue.articles.map(
            (article) => article.title
          ),
          supportingSourceIds: supportingSources.map((source) => source.id),
        }),
        signal,
      })
      const analysis = (await analyzeResponse.json()) as {
        transcript?: NewsClipProject["transcript"]
        candidates?: NewsClipCandidate[]
        selectedCandidate?: NewsClipCandidate
        detectedSilences?: NewsClipProject["detectedSilences"]
        reportScript?: string
        reportScenes?: NewsReportScene[]
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
        sourceProject,
        primarySource,
        analysis.transcript,
        analysis.candidates,
        analysis.selectedCandidate,
        analysis.detectedSilences ?? [],
        analysis.reportScript ?? "",
        analysis.reportScenes ?? []
      )
      setProject(draft)
      setBusy("auto:preview")
      setNote("자동생성 · 540×960 저해상도 초안을 렌더링하고 있습니다.")
      const previewProject = await renderAutomaticProject(
        "/api/news-clips/preview",
        draft,
        settings,
        signal
      )
      ensureRunning()
      setProject(previewProject)
      setBusy("auto:final")
      setNote("자동생성 · 1080×1920 최종 영상을 렌더링하고 있습니다.")
      const finalProject = await renderAutomaticProject(
        "/api/news-clips/render",
        previewProject,
        settings,
        signal
      )
      ensureRunning()
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
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs tracking-wide text-muted">채널명</p>
            <h1 className="mt-1 truncate text-base font-medium">
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
        <Separator />
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {VISIBLE_NEWS_CLIP_STEPS.map((item, index) => {
            const completed = stepIndex(item.id) < stepIndex(furthestStep)
            return (
              <Button
                key={item.id}
                variant={
                  item.id === step && !showSettings && !showHistory
                    ? "secondary"
                    : "ghost"
                }
                fullWidth
                isDisabled={busy.startsWith("auto:")}
                onPress={() => openStep(item.id)}
              >
                <span className="flex w-full items-center gap-2 text-left text-sm font-normal">
                  <span className="w-4 shrink-0 text-sm text-muted tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-normal">
                    {item.label}
                  </span>
                  {completed ? (
                    <Check className="size-3.5 shrink-0 text-muted" />
                  ) : null}
                </span>
              </Button>
            )
          })}
        </nav>
        <div className="flex flex-col gap-2 p-3">
          <Button
            variant="ghost"
            fullWidth
            isDisabled={busy.startsWith("auto:")}
            onPress={newProject}
          >
            <span className="w-full text-left">새 프로젝트</span>
          </Button>
          <Button
            variant={showHistory ? "secondary" : "ghost"}
            fullWidth
            isDisabled={busy.startsWith("auto:")}
            onPress={() =>
              router.push(
                `/studio/news-clips?channel=${encodeURIComponent(profile.id)}&view=history`
              )
            }
          >
            <span className="flex w-full items-center gap-2 text-left">
              <History className="size-4" /> 히스토리
            </span>
          </Button>
          <Button
            variant={showSettings ? "secondary" : "ghost"}
            fullWidth
            isDisabled={busy.startsWith("auto:")}
            onPress={() =>
              router.push(
                `/studio/news-clips?channel=${encodeURIComponent(profile.id)}&view=settings`
              )
            }
          >
            <span className="flex w-full items-center gap-2 text-left">
              <Settings className="size-4" /> 설정
            </span>
          </Button>
          <Button
            variant="ghost"
            fullWidth
            isDisabled={busy.startsWith("auto:")}
            onPress={() => router.push("/")}
          >
            <span className="flex w-full items-center gap-2 text-left">
              <Home className="size-4" /> 홈
            </span>
          </Button>
        </div>
      </aside>

      <ScrollShadow className="h-svh min-h-0 flex-1 overflow-y-auto">
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
          <div className="sticky top-0 z-30 -mx-6 -mt-6 flex min-h-14 items-center justify-end gap-3 border-b border-separator bg-background/95 px-6 py-3 backdrop-blur">
            {busy.startsWith("auto:") ? (
              <span className="text-xs text-muted">
                {automaticModeStatus(busy)} · OFF로 중지
              </span>
            ) : null}
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
            <Button
              size="sm"
              variant="outline"
              isDisabled={busy !== "" || !hasSavableProgress(project)}
              onPress={() => void saveCurrentHistory()}
            >
              {busy === "history-save" ? "저장 중" : "저장"}
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
              onPreviewChange={applySettingsPreview}
              onClose={() =>
                router.push(
                  `/studio/news-clips?channel=${encodeURIComponent(profile.id)}`
                )
              }
              onSaved={applySettingsPreview}
            />
          ) : step === "issue" || step === "source" ? (
            <SourceStep
              mode={step}
              profileId={profile.id}
              selectedIssue={project.selectedIssue}
              source={project.source}
              supportingSources={project.supportingSources}
              transcript={transcriptDraft}
              issueSearch={issueSearch}
              sourceSearch={sourceSearch}
              note={note}
              busy={busy}
              autoMode={autoMode}
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
                })
              }
              onSupportingSources={(supportingSources) =>
                updateProject({ supportingSources })
              }
              onIssueSelected={(selectedIssue) => {
                setSourceSearch(normalizeNewsSourceSearchState(null))
                setProject((current) =>
                  resetNewsClipProjectProgress(current, selectedIssue)
                )
                setTranscriptDraft("")
                advanceStep("source")
              }}
              onIssueStepRequested={() => openStep("issue")}
              onNote={setNote}
              onBusy={setBusy}
              onAnalyzed={async (
                source,
                transcript,
                candidates,
                selectedCandidate,
                mode,
                detectedSilences,
                reportScript,
                reportScenes
              ) => {
                const draft = prepareAutomaticDraft(
                  {
                    ...project,
                    source,
                    sourceIssueId: project.selectedIssue?.id ?? "",
                  },
                  source,
                  transcript,
                  candidates,
                  selectedCandidate,
                  detectedSilences,
                  reportScript,
                  reportScenes
                )
                setProject(draft)
                advanceStep("script")
                setNote(
                  mode === "claude"
                    ? "Claude가 채널 방향과 근거를 반영한 시사 논평과 화면 구성을 만들었습니다."
                    : "로컬 분석으로 논평 초안을 만들었습니다."
                )
              }}
            />
          ) : (
            <ReviewStep
              mode={step}
              project={project}
              settings={settings}
              note={note}
              busy={busy}
              onBack={() => openStep(previousReviewStep(step))}
              onNext={() => advanceStep(nextReviewStep(step))}
              onProject={updateProject}
              onSettings={(patch) => void updateTtsSettings(patch)}
              onBusy={setBusy}
              onNote={setNote}
              onPreview={(force) => generatePreview(project, force)}
              onReselect={(target) => reselectCandidate(target)}
              onFinalized={(finalizedProject) =>
                persistHistory(finalizedProject, "final", "final", true)
              }
            />
          )}
        </main>
      </ScrollShadow>
    </div>
  )
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
    body: JSON.stringify({ project, settings }),
    signal,
  })
  const body = (await response.json()) as {
    message?: string
    previewUrl?: string
    outputUrl?: string
    thumbnailUrl?: string
    signature?: string
    titleCardDurationSeconds?: number
    outputDurationSeconds?: number
    subtitles?: NewsClipProject["subtitles"]
  }
  if (!response.ok) {
    throw new Error(
      body.message ||
        (endpoint.endsWith("preview")
          ? "저해상도 초안을 만들지 못했습니다."
          : "최종 영상을 만들지 못했습니다.")
    )
  }
  const common = {
    ...project,
    renderSettingsKey: newsRenderSettingsKey(settings),
    titleCardDurationSeconds:
      body.titleCardDurationSeconds ?? project.titleCardDurationSeconds,
    outputDurationSeconds:
      body.outputDurationSeconds ?? project.outputDurationSeconds,
    subtitles: body.subtitles ?? project.subtitles,
  }
  return endpoint.endsWith("preview")
    ? {
        ...common,
        previewUrl: body.previewUrl ?? "",
        previewSignature: body.signature ?? "",
      }
    : {
        ...common,
        outputUrl: body.outputUrl ?? "",
        thumbnailUrl: body.thumbnailUrl ?? "",
        renderSignature: body.signature ?? "",
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
    previewSignature: "",
    previewUrl: "",
    renderSettingsKey: "",
    thumbnailUrl: "",
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
  return `shorts-factory.news-clips.${profileId}`
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

function normalizeSavedNewsProject(
  saved: NewsClipProject,
  profileId: string
): NewsClipProject {
  const fallback = freshNewsClipProject(profileId)
  const reportScenes = Array.isArray(saved.reportScenes)
    ? saved.reportScenes.map((scene): NewsReportScene => ({
        ...scene,
        visual: scene.visual === "quote" ? "quote" : "source",
        sourceId:
          typeof scene.sourceId === "string"
            ? scene.sourceId
            : saved.source?.id || undefined,
      }))
    : []

  return {
    ...fallback,
    ...saved,
    profileId,
    supportingSources: Array.isArray(saved.supportingSources)
      ? saved.supportingSources
      : [],
    reportScript:
      typeof saved.reportScript === "string" ? saved.reportScript : "",
    supplementalContext:
      typeof saved.supplementalContext === "string"
        ? saved.supplementalContext.slice(0, 5000)
        : "",
    reportScenes,
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
    renderSettingsKey:
      typeof saved.renderSettingsKey === "string"
        ? saved.renderSettingsKey
        : "",
  }
}

function stepIndex(step: NewsClipStep) {
  return NEWS_CLIP_STEPS.findIndex((item) => item.id === step)
}

function previousReviewStep(step: NewsClipStep): NewsClipStep {
  if (step === "final") return "preview"
  if (step === "preview") return "script"
  if (step === "direction") return "script"
  return "source"
}

function nextReviewStep(step: NewsClipStep): NewsClipStep {
  if (step === "script") return "preview"
  if (step === "direction") return "preview"
  if (step === "preview") return "final"
  return "final"
}

const VISIBLE_NEWS_CLIP_STEPS = NEWS_CLIP_STEPS.filter(
  (item) => item.id !== "direction"
)

function visibleWorkflowStep(
  step: NewsClipStep,
  project: NewsClipProject
): NewsClipStep {
  if (step !== "direction") return step
  return project.previewUrl ? "preview" : "script"
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
