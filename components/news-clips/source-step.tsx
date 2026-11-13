"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"

import { Button, Card, Chip } from "@heroui/react"
import {
  LoadingButtonLabel,
  busyMatches,
  buttonBusyDisabled,
} from "@/components/news-clips/loading-button-label"
import { HistorySaveButton } from "@/components/news-clips/history-save-button"
import { SegmentedTabs } from "@/components/news-clips/segmented-tabs"
import {
  stepBodyClassName,
  stepHeaderActionButtonClassName,
  stepHeaderActionsClassName,
  stepHeaderClassName,
  stepHeaderContentClassName,
  workspacePageContentClassName,
  type WorkspaceHistorySaveProps,
} from "@/components/news-clips/step-action-bar"
import { extractYouTubeUrl } from "@/lib/news-clips/youtube-url"
import type {
  NewsIssueSearchState,
  RecommendedNewsIssue,
} from "@/lib/news-clips/issues"
import type {
  KeepRange,
  NewsClipCandidate,
  NewsReportScene,
  RemovedRange,
  NewsSource,
  NewsSourceSelectionMode,
  NewsSourceSearchState,
  TranscriptSegment,
} from "@/lib/news-clips/types"

const field =
  "w-full rounded-xl border border-separator bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"

export function NewsClipSourceStep({
  mode,
  profileId,
  productionMode = "buildup2",
  sourceSelectionMode = "single-range",
  selectedIssue,
  source,
  transcript,
  issueSearch,
  sourceSearch,
  note,
  busy,
  progress,
  historySave,
  onNewProject,
  onTranscript,
  onIssueSearch,
  onSourceSearch,
  onSource,
  onIssueSelected,
  onIssueStepRequested,
  onNote,
  onBusy,
  onYoutubeUrl,
  onVideoFile,
  onAnalyzed,
}: {
  mode: "issue" | "source"
  profileId: string
  productionMode?: "report" | "buildup2"
  sourceSelectionMode?: NewsSourceSelectionMode
  selectedIssue: RecommendedNewsIssue | null
  source: NewsSource | null
  transcript: string
  issueSearch: NewsIssueSearchState
  sourceSearch: NewsSourceSearchState
  note: string
  busy: string
  progress: number | null
  historySave: WorkspaceHistorySaveProps
  onNewProject: () => void
  onTranscript: (value: string) => void
  onIssueSearch: (patch: Partial<NewsIssueSearchState>) => void
  onSourceSearch: (patch: Partial<NewsSourceSearchState>) => void
  onSource: (source: NewsSource) => void
  onIssueSelected: (issue: RecommendedNewsIssue) => void
  onIssueStepRequested: () => void
  onNote: (value: string) => void
  onBusy: (value: string) => void
  onYoutubeUrl: (url: string) => void
  onVideoFile: (file: File) => void
  onAnalyzed: (
    source: NewsSource,
    transcript: TranscriptSegment[],
    candidates: NewsClipCandidate[],
    selectedCandidate: NewsClipCandidate,
    mode: "claude" | "local",
    detectedSilences: RemovedRange[],
    reportScript: string,
    reportScenes: NewsReportScene[],
    removedRanges?: RemovedRange[],
    keepRanges?: KeepRange[],
    sourceMeta?: { channel?: string; title?: string }
  ) => void | Promise<void>
}) {
  const { query, issues, dismissedIssueKeys } = issueSearch
  const [issueMessage, setIssueMessage] = useState("")
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [channel, setChannel] = useState("")
  const [manualMode, setManualMode] = useState<"none" | "url" | "file">("none")
  const [pendingSourceId, setPendingSourceId] = useState("")
  const [video, setVideo] = useState<File | null>(null)
  const [subtitle, setSubtitle] = useState<File | null>(null)
  const [directVideoFile, setDirectVideoFile] = useState<File | null>(null)
  const directVideoInputRef = useRef<HTMLInputElement>(null)
  const directYoutubeUrl = extractYouTubeUrl(query)
  const isBuildup2 = productionMode === "buildup2"
  const isVideoSummary = isBuildup2 && sourceSelectionMode === "video-summary"
  const canAnalyze =
    Boolean(directYoutubeUrl) ||
    Boolean(directVideoFile) ||
    (isBuildup2 && Boolean(query.trim()))
  const canAutoSearch =
    !isBuildup2 && Boolean(query.trim()) && !directYoutubeUrl
  const analyzeBusyKeys = ["url-source", "file-source"] as const

  function runIssueAction() {
    if (busy) return
    if (directYoutubeUrl) {
      onYoutubeUrl(directYoutubeUrl)
      return
    }
    if (directVideoFile) {
      const file = directVideoFile
      setDirectVideoFile(null)
      onVideoFile(file)
      return
    }
    if (isBuildup2) {
      setIssueMessage("YouTube URL을 입력하거나 영상 파일을 추가해 주세요.")
    } else {
      setIssueMessage("키워드로 자동검색하거나 URL·영상 파일을 추가해 주세요.")
    }
  }

  async function discoverIssues() {
    onBusy("issues")
    onNote("")
    setIssueMessage("")
    onIssueSearch({ dismissedIssueKeys: [] })
    try {
      const response = await fetch(
        `/api/news-clips/issues?profileId=${encodeURIComponent(profileId)}&query=${encodeURIComponent(query)}`
      )
      const body = (await response.json()) as {
        issues?: RecommendedNewsIssue[]
        message?: string
      }
      if (!response.ok) {
        setIssueMessage(body.message || "최근 이슈를 찾지 못했습니다.")
      } else {
        onIssueSearch({ issues: body.issues ?? [] })
        setIssueMessage(
          (body.issues ?? []).length
            ? query.trim()
              ? `‘${query.trim()}’ 관련 웹 이슈를 추천순으로 정리했습니다.`
              : "웹 뉴스와 공개 커뮤니티 신호에서 최근 이슈를 추천했습니다."
            : "조건에 맞는 최근 이슈가 없습니다."
        )
      }
    } catch {
      setIssueMessage("최근 이슈를 찾지 못했습니다.")
    } finally {
      onBusy("")
    }
  }

  async function replaceIssue(issue: RecommendedNewsIssue) {
    onBusy(`replace-issue:${issue.id}`)
    onNote("")
    setIssueMessage("")
    try {
      const response = await fetch(
        `/api/news-clips/issues?profileId=${encodeURIComponent(profileId)}&query=${encodeURIComponent(query)}&limit=12`
      )
      const body = (await response.json()) as {
        issues?: RecommendedNewsIssue[]
        message?: string
      }
      if (!response.ok) {
        setIssueMessage(body.message || "다른 이슈를 찾지 못했습니다.")
        return
      }
      const unavailable = new Set([
        ...issues.map(issueKey),
        ...dismissedIssueKeys,
        issueKey(issue),
      ])
      const replacement = (body.issues ?? []).find(
        (candidate) => !unavailable.has(issueKey(candidate))
      )
      if (!replacement) {
        setIssueMessage("현재 조건에서 대체할 다른 이슈가 없습니다.")
        return
      }
      onIssueSearch({
        dismissedIssueKeys: [...dismissedIssueKeys, issueKey(issue)],
        issues: issues.map((item) =>
          item.id === issue.id ? replacement : item
        ),
      })
      setIssueMessage("해당 위치를 새로운 추천 이슈로 교체했습니다.")
    } catch {
      setIssueMessage("다른 이슈를 찾지 못했습니다.")
    } finally {
      onBusy("")
    }
  }

  const searchSources = useCallback(
    async (issue: RecommendedNewsIssue) => {
      onSourceSearch({
        issueId: issue.id,
        results: [],
        message:
          "선택한 이슈와 가장 관련성이 높은 원본 자료를 자동으로 찾고 있습니다.",
        youtubeDataMissing: false,
        status: "searching",
      })
      onBusy("search")
      onNote("")
      try {
        const response = await fetch(
          `/api/news-clips/source?profileId=${encodeURIComponent(profileId)}&query=${encodeURIComponent(issue.searchQuery)}&topic=${encodeURIComponent(issue.title)}&keywords=${encodeURIComponent(issue.keywords.join(","))}`
        )
        const body = (await response.json()) as {
          results?: NewsSource[]
          configured?: boolean
          preferredChannelCount?: number
          message?: string
        }
        if (!response.ok) {
          onSourceSearch({
            message: body.message || "관련 원본을 찾지 못했습니다.",
            status: "error",
          })
          return
        }
        const results = body.results ?? []
        const youtubeDataMissing =
          body.configured === false && results.length === 0
        onSourceSearch({
          results,
          youtubeDataMissing,
          status: "complete",
          message: youtubeDataMissing
            ? "관련 원본 영상을 자동으로 찾으려면 YouTube API 연결이 필요합니다."
            : body.configured === false
              ? "YouTube API 없이 공개 검색으로 후보를 찾았습니다. 게시일·댓글 지표는 제한될 수 있습니다."
              : results.length === 0
                ? "이 이슈와 관련된 원본 영상 후보가 없습니다."
                : `‘${issue.title}’에 가장 적합한 원본 후보를 추천순으로 정리했습니다.`,
        })
      } catch {
        onSourceSearch({
          message: "관련 원본을 찾지 못했습니다.",
          status: "error",
        })
      } finally {
        onBusy("")
      }
    },
    [onBusy, onNote, onSourceSearch, profileId]
  )

  function chooseIssue(issue: RecommendedNewsIssue) {
    onIssueSelected(issue)
  }

  useEffect(() => {
    const hasLegacyResults = sourceSearch.results.some(
      (result) =>
        typeof result.searchMetrics?.relevanceScore !== "number" ||
        !result.searchMetrics.recommendationReason.includes("선택 논점 기준 v2")
    )
    if (
      mode !== "source" ||
      !selectedIssue ||
      selectedIssue.directSource === true ||
      busy !== "" ||
      (sourceSearch.issueId === selectedIssue.id &&
        sourceSearch.status !== "idle" &&
        !hasLegacyResults)
    )
      return
    void searchSources(selectedIssue)
  }, [
    busy,
    mode,
    searchSources,
    selectedIssue,
    sourceSearch.issueId,
    sourceSearch.results,
    sourceSearch.status,
  ])

  async function approveRemote(item?: NewsSource) {
    const selectedUrl = item?.originalUrl || url
    if (!selectedUrl.trim()) return
    onBusy("source")
    setPendingSourceId(`primary:${item?.id ?? "manual"}`)
    onNote("")
    try {
      const response = await fetch("/api/news-clips/source", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: selectedUrl,
          title: item?.title || title,
          channel: item?.channel || channel,
          summary: item?.summary || "",
          kind: item ? "search" : "youtube",
          publishedAt: item?.publishedAt || "",
          durationSeconds: item?.durationSeconds || 0,
          viewCount: item?.viewCount || 0,
          commentCount: item?.commentCount || 0,
          searchMetrics: item?.searchMetrics || null,
        }),
      })
      const body = (await response.json()) as NewsSource & { message?: string }
      if (!response.ok) {
        onNote(body.message || "원본을 승인하지 못했습니다.")
        return
      }
      onSource(body)
      onNote("원본을 선택했습니다. 대본을 만들 수 있습니다.")
    } catch {
      onNote("원본을 승인하지 못했습니다.")
    } finally {
      setPendingSourceId("")
      onBusy("")
    }
  }

  async function upload() {
    if (!video) return
    onBusy("upload")
    onNote("")
    const form = new FormData()
    form.set("file", video)
    if (subtitle) form.set("subtitle", subtitle)
    form.set("title", title)
    form.set("channel", channel)
    form.set("originalUrl", url)
    try {
      const response = await fetch("/api/news-clips/source", {
        method: "POST",
        body: form,
      })
      const body = (await response.json()) as NewsSource & { message?: string }
      if (!response.ok) {
        onNote(body.message || "업로드하지 못했습니다.")
        return
      }
      onSource(body)
      onNote("원본을 추가했습니다. 대본을 만들 수 있습니다.")
    } catch {
      onNote("업로드하지 못했습니다.")
    } finally {
      onBusy("")
    }
  }

  async function analyze(approvedSource = source) {
    if (!approvedSource) return
    onBusy("analyze")
    onNote("")
    try {
      const response = await fetch("/api/news-clips/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: approvedSource.id,
          profileId,
          transcript,
          issueTitle: selectedIssue?.title ?? "",
          issueKeywords: selectedIssue?.keywords ?? [],
          issueReason: selectedIssue?.recommendationReason ?? "",
          issueArticleTitles:
            selectedIssue?.articles.map((article) => article.title) ?? [],
          supportingSourceIds: [],
          productionMode,
        }),
      })
      const body = (await response.json()) as {
        transcript?: TranscriptSegment[]
        candidates?: NewsClipCandidate[]
        selectedCandidate?: NewsClipCandidate
        analysisMode?: "claude" | "local"
        detectedSilences?: RemovedRange[]
        removedRanges?: RemovedRange[]
        keepRanges?: KeepRange[]
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
        onNote(body.message || "전체 발언을 분석하지 못했습니다.")
        return
      }
      await onAnalyzed(
        approvedSource,
        body.transcript,
        body.candidates,
        body.selectedCandidate,
        body.analysisMode ?? "local",
        body.detectedSilences ?? [],
        body.reportScript ?? "",
        body.reportScenes ?? [],
        body.removedRanges ?? [],
        body.keepRanges ?? [],
        {
          channel: body.sourceChannel,
          title: body.sourceTitle,
        }
      )
    } catch {
      onNote("전체 발언을 분석하지 못했습니다.")
    } finally {
      onBusy("")
    }
  }

  const headerTitle =
    mode === "issue"
      ? isBuildup2
        ? "원본 추가"
        : "원문 내용 파악"
      : "원본 고르기"

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <header className={stepHeaderClassName}>
        <div className={stepHeaderContentClassName}>
        <h2 className="truncate text-xl leading-7 font-semibold">
          {headerTitle}
        </h2>
        <div className={stepHeaderActionsClassName}>
          {note ? (
            <p className="max-w-3xl text-sm text-muted">{note}</p>
          ) : null}
          <HistorySaveButton
            {...historySave}
            className={stepHeaderActionButtonClassName}
          />
          {mode === "source" ? (
            <>
              <Button
                className={stepHeaderActionButtonClassName}
                variant="outline"
                onPress={onIssueStepRequested}
              >
                이전
              </Button>
              <Button
                className={stepHeaderActionButtonClassName}
                isDisabled={
                  !source?.approved || buttonBusyDisabled(busy, "analyze")
                }
                onPress={() => void analyze(source)}
              >
                <LoadingButtonLabel
                  loading={busyMatches(busy, "analyze")}
                  label="대본 만들기"
                  loadingLabel="만드는 중"
                />
              </Button>
            </>
          ) : null}
        </div>
        </div>
      </header>
      <div className={stepBodyClassName}>
        <div className={`${workspacePageContentClassName} flex flex-col gap-5`}>
        {mode === "issue" ? (
          <>
            <Card>
              <Card.Content className="flex flex-col gap-4 border-b border-separator pb-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Card.Title>
                      {isBuildup2 ? "분석할 원본" : "추천 이슈"}
                    </Card.Title>
                    <p className="mt-1 text-sm text-muted">
                      {isVideoSummary
                        ? "원본 전체 분석 · 핵심 구간 요약"
                        : isBuildup2
                          ? "서두 TTS · 원본 핵심 발언"
                          : "전체 TTS · 관련 자료 자동 배치"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    isDisabled={busy.startsWith("auto:")}
                    onPress={onNewProject}
                  >
                    새로 만들기
                  </Button>
                </div>
              </Card.Content>
              <Card.Content className="flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={query}
                    onChange={(event) =>
                      onIssueSearch({ query: event.currentTarget.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || busy !== "") return
                      if (canAutoSearch) {
                        void discoverIssues()
                        return
                      }
                      runIssueAction()
                    }}
                    className={`${field} min-w-0 flex-1`}
                    placeholder={
                      isBuildup2
                        ? "YouTube URL 입력"
                        : "주제 또는 YouTube URL 입력"
                    }
                  />
                  <input
                    ref={directVideoInputRef}
                    type="file"
                    accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/x-m4v"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0]
                      event.currentTarget.value = ""
                      if (file) setDirectVideoFile(file)
                    }}
                  />
                  <Button
                    className="shrink-0"
                    variant={directVideoFile ? "secondary" : "outline"}
                    isDisabled={buttonBusyDisabled(busy, "file-source")}
                    onPress={() => directVideoInputRef.current?.click()}
                  >
                    <LoadingButtonLabel
                      loading={busyMatches(busy, "file-source")}
                      label={
                        directVideoFile ? directVideoFile.name : "영상첨부"
                      }
                      loadingLabel={
                        busy === "file-source:script"
                          ? "핵심 정리 중"
                          : "영상 확인 중"
                      }
                    />
                  </Button>
                  {!isBuildup2 ? (
                    <Button
                      className="shrink-0"
                      variant="outline"
                      isDisabled={
                        (busy === "" && !canAutoSearch) ||
                        buttonBusyDisabled(busy, "issues")
                      }
                      onPress={() => void discoverIssues()}
                    >
                      <LoadingButtonLabel
                        loading={busyMatches(busy, "issues")}
                        label="자동검색"
                        loadingLabel="이슈 검색 중"
                        progress={busyMatches(busy, "issues") ? progress : null}
                      />
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <Button
                    isDisabled={
                      (busy === "" && !canAnalyze) ||
                      buttonBusyDisabled(busy, [...analyzeBusyKeys])
                    }
                    onPress={runIssueAction}
                  >
                    <LoadingButtonLabel
                      loading={busyMatches(busy, [...analyzeBusyKeys])}
                      label={
                        directYoutubeUrl && !isBuildup2
                          ? "URL로 시작"
                          : "원본 분석"
                      }
                      loadingLabel={
                        busy === "url-source:script" ||
                        busy === "file-source:script"
                          ? "핵심 정리 중"
                          : "영상 확인 중"
                      }
                      progress={
                        busy.startsWith("url-source") ||
                        busy.startsWith("file-source")
                          ? progress
                          : null
                      }
                    />
                  </Button>
                </div>
                {issueMessage ? (
                  <div className="rounded-xl border border-separator bg-default p-3 text-sm">
                    <p>{issueMessage}</p>
                  </div>
                ) : null}
                {note && busy === "" ? (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
                    {note}
                  </div>
                ) : null}
              </Card.Content>
              {!isBuildup2 && issues.length ? (
                <Card.Content className="grid gap-3 border-t border-separator pt-4 md:grid-cols-2">
                  {issues.map((issue) => {
                    const selecting = busy.startsWith(
                      `select-issue:${issue.id}`
                    )
                    return (
                      <div
                        key={issue.id}
                        className={`rounded-xl border p-4 ${
                          selectedIssue?.id === issue.id
                            ? "border-foreground bg-default"
                            : "border-separator"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="leading-6 font-medium">{issue.title}</p>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                            <Chip size="sm" variant="soft" color="success">
                              적합도 {issue.score}점
                            </Chip>
                            <Chip size="sm" variant="soft" color="warning">
                              화제성 {issue.trendScore ?? 0}점
                            </Chip>
                          </div>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted">
                          {issue.recommendationReason}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                          <span>기사 {issue.articleCount}건</span>
                          <span>·</span>
                          <span>매체 {issue.sourceCount}곳</span>
                          {issue.communityMentionCount > 0 ? (
                            <>
                              <span>·</span>
                              <span>
                                커뮤니티 {issue.communityMentionCount}건
                              </span>
                            </>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-col gap-1 text-xs text-muted">
                          {issue.articles.map((article) => (
                            <a
                              key={article.url}
                              href={article.url}
                              target="_blank"
                              rel="noreferrer"
                              className="line-clamp-1 underline"
                            >
                              {article.source || "웹 뉴스"} · {article.title}
                            </a>
                          ))}
                        </div>
                        <div className="mt-4 flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            isDisabled={buttonBusyDisabled(
                              busy,
                              `replace-issue:${issue.id}`
                            )}
                            onPress={() => void replaceIssue(issue)}
                          >
                            <LoadingButtonLabel
                              loading={busyMatches(
                                busy,
                                `replace-issue:${issue.id}`
                              )}
                              label="다른 이슈"
                              loadingLabel="검색 중"
                            />
                          </Button>
                          <Button
                            size="sm"
                            isDisabled={
                              selecting
                                ? false
                                : buttonBusyDisabled(
                                    busy,
                                    `select-issue:${issue.id}`
                                  )
                            }
                            onPress={() => chooseIssue(issue)}
                          >
                            <LoadingButtonLabel
                              loading={selecting}
                              label="선택"
                              loadingLabel={
                                busy === `select-issue:${issue.id}:script`
                                  ? "핵심 정리 중"
                                  : "영상 확인 중"
                              }
                            />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </Card.Content>
              ) : null}
            </Card>
          </>
        ) : null}

        {mode === "source" && selectedIssue ? (
          <Card>
            <Card.Header className="border-b border-separator pb-4">
              <Card.Title>원본 찾기</Card.Title>
            </Card.Header>
            {selectedIssue ? (
              <Card.Content>
                <div className="flex flex-col gap-3 rounded-xl border border-separator bg-default p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs text-muted">승인한 이슈</p>
                    <p className="mt-1 font-medium">{selectedIssue.title}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    isDisabled={buttonBusyDisabled(busy, "search")}
                    onPress={() => void searchSources(selectedIssue)}
                  >
                    <LoadingButtonLabel
                      loading={busyMatches(busy, "search")}
                      label="자료 다시 찾기"
                      loadingLabel="자료 찾는 중"
                    />
                  </Button>
                </div>
              </Card.Content>
            ) : null}
            {sourceSearch.message ? (
              <Card.Content>
                <div
                  className={`rounded-xl border p-3 text-sm ${
                    sourceSearch.youtubeDataMissing
                      ? "border-warning/30 bg-warning/10"
                      : "border-separator bg-default"
                  }`}
                >
                  <p>{sourceSearch.message}</p>
                  {sourceSearch.youtubeDataMissing ? (
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Link
                        href="/settings"
                        className="rounded-lg border border-separator bg-background px-3 py-2 text-xs font-medium hover:bg-default"
                      >
                        YouTube API 연결
                      </Link>
                    </div>
                  ) : null}
                </div>
              </Card.Content>
            ) : null}
            {note ? (
              <Card.Content>
                <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">
                  {note}
                </div>
              </Card.Content>
            ) : null}
            {sourceSearch.results.length ? (
              <Card.Content className="grid gap-3 border-t border-separator pt-4 md:grid-cols-2">
                {sourceSearch.results.map((item, index) => {
                  const isPrimary = source?.originalUrl === item.originalUrl
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-separator p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">{item.title}</p>
                        {index === 0 ? (
                          <Chip
                            size="sm"
                            variant="soft"
                            color="success"
                            className="shrink-0"
                          >
                            AI 1순위
                          </Chip>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {item.channel} · {dateLabel(item.publishedAt)} ·{" "}
                        {secondsLabel(item.durationSeconds)} ·{" "}
                        {item.viewCount.toLocaleString("ko-KR")}회
                      </p>
                      <p className="mt-3 line-clamp-3 text-sm text-muted">
                        {item.summary || "요약 없음"}
                      </p>
                      {item.searchMetrics ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <Metric
                            label="주제 연관도"
                            value={`${item.searchMetrics.relevanceScore ?? 0}점`}
                          />
                          <Metric
                            label="화제성 점수"
                            value={`${item.searchMetrics.recommendationScore}점`}
                          />
                          <Metric
                            label="시간당 조회수"
                            value={`${Math.round(item.searchMetrics.viewsPerHour).toLocaleString("ko-KR")}회`}
                          />
                          <Metric
                            label="댓글 반응률"
                            value={`${item.searchMetrics.commentRate.toFixed(2)}%`}
                          />
                          <Metric
                            label="평소 대비"
                            value={`${item.searchMetrics.responseMultiple.toFixed(2)}배`}
                          />
                          <Metric
                            label="동일 이슈 채널"
                            value={`${item.searchMetrics.sameIssueChannelCount}개`}
                          />
                          <Metric
                            label="예상 제목"
                            value={item.searchMetrics.expectedShortTitle}
                          />
                        </div>
                      ) : null}
                      {item.searchMetrics ? (
                        <div className="mt-3 text-xs leading-5 text-muted">
                          <p>
                            추천 이유: {item.searchMetrics.recommendationReason}
                          </p>
                          <p>
                            위험·감점:{" "}
                            {item.searchMetrics.riskFactors.join(" · ") ||
                              "없음"}
                          </p>
                          <a
                            href={item.originalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all underline"
                          >
                            {item.originalUrl}
                          </a>
                        </div>
                      ) : null}
                      <div className="mt-4 flex justify-end">
                        <Button
                          size="sm"
                          isDisabled={
                            isPrimary &&
                            pendingSourceId === `primary:${item.id}` &&
                            busyMatches(busy, ["source", "analyze"])
                              ? false
                              : busy !== "" || isPrimary
                          }
                          onPress={() => void approveRemote(item)}
                        >
                          <LoadingButtonLabel
                            loading={
                              pendingSourceId === `primary:${item.id}` &&
                              busyMatches(busy, ["source", "analyze"])
                            }
                            label={isPrimary ? "원본 선택됨" : "원본 선택"}
                            loadingLabel="저장 중"
                          />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </Card.Content>
            ) : null}
          </Card>
        ) : mode === "source" ? (
          <Card>
            <Card.Header className="border-b border-separator pb-4">
              <Card.Title>원본 찾기</Card.Title>
            </Card.Header>
            <Card.Footer className="justify-end">
              <Button onPress={onIssueStepRequested}>이슈 선택</Button>
            </Card.Footer>
          </Card>
        ) : null}

        {mode === "source" ? (
          <>
            {source && selectedIssue ? <SourceSummary source={source} /> : null}

            <Card>
              <Card.Header className="border-b border-separator pb-4">
                <Card.Title>직접 추가</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-col gap-4">
                <SegmentedTabs
                  ariaLabel="직접 추가 방식"
                  equalWidth={false}
                  className="w-fit"
                  value={manualMode === "none" ? null : manualMode}
                  onChange={(modeId) =>
                    setManualMode((current) =>
                      current === modeId ? "none" : modeId
                    )
                  }
                  items={[
                    { id: "url", label: "URL 추가" },
                    { id: "file", label: "파일 추가" },
                  ]}
                />

                {manualMode === "url" ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-separator bg-default p-4">
                    <input
                      value={url}
                      onChange={(event) => setUrl(event.currentTarget.value)}
                      className={field}
                      placeholder="https://www.youtube.com/watch?v=..."
                    />
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={title}
                        onChange={(event) =>
                          setTitle(event.currentTarget.value)
                        }
                        className={field}
                        placeholder="영상 제목 · 선택"
                      />
                      <input
                        value={channel}
                        onChange={(event) =>
                          setChannel(event.currentTarget.value)
                        }
                        className={field}
                        placeholder="원본 채널 · 선택"
                      />
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        isDisabled={
                          !url.trim() ||
                          (pendingSourceId === "primary:manual" &&
                          busyMatches(busy, ["source", "analyze"])
                            ? false
                            : busy !== "")
                        }
                        onPress={() => void approveRemote()}
                      >
                        <LoadingButtonLabel
                          loading={
                            pendingSourceId === "primary:manual" &&
                            busyMatches(busy, ["source", "analyze"])
                          }
                          label="원본 선택"
                          loadingLabel="원본 저장 중"
                        />
                      </Button>
                    </div>
                  </div>
                ) : null}

                {manualMode === "file" ? (
                  <div className="flex flex-col gap-4 rounded-xl border border-separator bg-default p-4 text-sm">
                    <label className="flex flex-col gap-2">
                      <span>영상 파일</span>
                      <input
                        type="file"
                        accept="video/*,.mkv"
                        onChange={(event) =>
                          setVideo(event.currentTarget.files?.[0] ?? null)
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span>자막 파일 · 선택</span>
                      <input
                        type="file"
                        accept=".srt,.vtt,.txt"
                        onChange={(event) =>
                          setSubtitle(event.currentTarget.files?.[0] ?? null)
                        }
                      />
                    </label>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        isDisabled={
                          !video || buttonBusyDisabled(busy, "upload")
                        }
                        onPress={() => void upload()}
                      >
                        <LoadingButtonLabel
                          loading={busyMatches(busy, "upload")}
                          label="파일 추가"
                          loadingLabel="업로드 중"
                        />
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card.Content>
            </Card>

            <Card>
              <Card.Header className="border-b border-separator pb-4">
                <Card.Title>자막</Card.Title>
              </Card.Header>
              <Card.Content>
                <textarea
                  value={transcript}
                  onChange={(event) => onTranscript(event.currentTarget.value)}
                  rows={9}
                  className={field}
                  placeholder="SRT / VTT / 녹취"
                />
              </Card.Content>
            </Card>
          </>
        ) : null}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-default p-2">
      <p className="text-muted">{label}</p>
      <p className="mt-0.5 font-medium text-foreground">{value}</p>
    </div>
  )
}

function SourceSummary({ source }: { source: NewsSource }) {
  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-3 border-b border-separator pb-4">
        <div>
          <p className="mb-1 text-xs text-muted">현재 선택된 원본</p>
          <Card.Title>{source.title}</Card.Title>
          <Card.Description>
            {source.channel || "채널 정보 없음"}
          </Card.Description>
        </div>
        <Chip color="success" variant="soft">
          원본 승인됨
        </Chip>
      </Card.Header>
      <Card.Content>
        <p className="text-sm break-all text-muted">
          {source.originalUrl || source.localFile}
        </p>
        {source.requiresUpload ? (
          <p className="mt-3 text-sm text-warning">원본 파일을 올려 주세요.</p>
        ) : null}
      </Card.Content>
    </Card>
  )
}

function dateLabel(value: string) {
  return value
    ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(
        new Date(value)
      )
    : "게시일 없음"
}

function secondsLabel(value: number) {
  return `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}`
}

function issueKey(issue: RecommendedNewsIssue) {
  return issue.articles[0]?.url || issue.title
}
