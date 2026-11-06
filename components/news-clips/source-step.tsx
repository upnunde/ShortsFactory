"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { X } from "lucide-react"

import { Button, Card, Chip } from "@heroui/react"
import { LoadingButtonLabel } from "@/components/news-clips/loading-button-label"
import { isYouTubeUrl } from "@/lib/news-clips/youtube-url"
import type {
  NewsIssueSearchState,
  RecommendedNewsIssue,
} from "@/lib/news-clips/issues"
import type {
  NewsClipCandidate,
  NewsReportScene,
  RemovedRange,
  NewsSource,
  NewsSourceSearchState,
  TranscriptSegment,
} from "@/lib/news-clips/types"

const field =
  "w-full rounded-xl border border-separator bg-background px-3 py-2.5 text-sm outline-none focus:border-foreground/40"

export function NewsClipSourceStep({
  mode,
  profileId,
  selectedIssue,
  source,
  supportingSources,
  transcript,
  issueSearch,
  sourceSearch,
  note,
  busy,
  autoMode,
  onTranscript,
  onIssueSearch,
  onSourceSearch,
  onSource,
  onSupportingSources,
  onIssueSelected,
  onIssueStepRequested,
  onNote,
  onBusy,
  onAutomaticGeneration,
  onYoutubeUrl,
  onVideoFile,
  onAnalyzed,
}: {
  mode: "issue" | "source"
  profileId: string
  selectedIssue: RecommendedNewsIssue | null
  source: NewsSource | null
  supportingSources: NewsSource[]
  transcript: string
  issueSearch: NewsIssueSearchState
  sourceSearch: NewsSourceSearchState
  note: string
  busy: string
  autoMode: boolean
  onTranscript: (value: string) => void
  onIssueSearch: (patch: Partial<NewsIssueSearchState>) => void
  onSourceSearch: (patch: Partial<NewsSourceSearchState>) => void
  onSource: (source: NewsSource) => void
  onSupportingSources: (sources: NewsSource[]) => void
  onIssueSelected: (issue: RecommendedNewsIssue) => void
  onIssueStepRequested: () => void
  onNote: (value: string) => void
  onBusy: (value: string) => void
  onAutomaticGeneration: (query: string) => void
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
    reportScenes: NewsReportScene[]
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
  const directVideoInputRef = useRef<HTMLInputElement>(null)
  const directYoutubeUrl = isYouTubeUrl(query)

  function runIssueAction() {
    if (directYoutubeUrl) {
      onYoutubeUrl(query.trim())
    } else if (autoMode) {
      onAutomaticGeneration(query)
    } else {
      void discoverIssues()
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

  async function approveRemote(
    item?: NewsSource,
    target: "primary" | "supporting" = "primary"
  ) {
    const selectedUrl = item?.originalUrl || url
    if (!selectedUrl.trim()) return
    onBusy("source")
    setPendingSourceId(`${target}:${item?.id ?? "manual"}`)
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
      if (target === "supporting") {
        const next = [
          ...supportingSources.filter(
            (candidate) => candidate.originalUrl !== body.originalUrl
          ),
          body,
        ]
        onSupportingSources(next)
        onNote(
          "보조 자료를 추가했습니다. 대본 생성 시 문장별로 자동 배치합니다."
        )
      } else {
        onSupportingSources(
          supportingSources.filter(
            (candidate) => candidate.originalUrl !== body.originalUrl
          )
        )
        onSource(body)
        onNote(
          "핵심 원본을 선택했습니다. 보조 자료를 추가한 뒤 대본을 생성하세요."
        )
      }
    } catch {
      onNote("원본을 승인하지 못했습니다.")
    } finally {
      setPendingSourceId("")
      onBusy("")
    }
  }

  async function upload(target: "primary" | "supporting" = "primary") {
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
      if (target === "supporting") {
        onSupportingSources([
          ...supportingSources.filter(
            (candidate) => candidate.originalUrl !== body.originalUrl
          ),
          body,
        ])
        onNote(
          "보조 자료를 추가했습니다. 대본 생성 시 문장별로 자동 배치합니다."
        )
      } else {
        onSupportingSources(
          supportingSources.filter(
            (candidate) => candidate.originalUrl !== body.originalUrl
          )
        )
        onSource(body)
        onNote(
          "핵심 원본을 선택했습니다. 보조 자료를 추가한 뒤 대본을 생성하세요."
        )
      }
    } catch {
      onNote("업로드하지 못했습니다.")
    } finally {
      onBusy("")
    }
  }

  async function analyze(
    approvedSource = source,
    approvedSupportingSources = supportingSources
  ) {
    if (!approvedSource) return
    onBusy("analyze")
    onNote("")
    try {
      const enrichedSupportingSources = await enrichSupportingSources(
        approvedSource,
        approvedSupportingSources
      )
      if (
        enrichedSupportingSources.map((item) => item.id).join(":") !==
        approvedSupportingSources.map((item) => item.id).join(":")
      ) {
        onSupportingSources(enrichedSupportingSources)
      }
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
          supportingSourceIds: enrichedSupportingSources.map((item) => item.id),
        }),
      })
      const body = (await response.json()) as {
        transcript?: TranscriptSegment[]
        candidates?: NewsClipCandidate[]
        selectedCandidate?: NewsClipCandidate
        analysisMode?: "claude" | "local"
        detectedSilences?: RemovedRange[]
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
        body.reportScenes ?? []
      )
    } catch {
      onNote("전체 발언을 분석하지 못했습니다.")
    } finally {
      onBusy("")
    }
  }

  async function enrichSupportingSources(
    primarySource: NewsSource,
    currentSources: NewsSource[]
  ) {
    const next = currentSources.filter(
      (item) => item.originalUrl !== primarySource.originalUrl
    )
    const selectedUrls = new Set([
      primarySource.originalUrl,
      ...next.map((item) => item.originalUrl),
    ])
    for (const candidate of sourceSearch.results) {
      if (next.length >= 2) break
      if (!candidate.originalUrl || selectedUrls.has(candidate.originalUrl))
        continue
      try {
        const response = await fetch("/api/news-clips/source", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: candidate.originalUrl,
            title: candidate.title,
            channel: candidate.channel,
            summary: candidate.summary,
            kind: "search",
            publishedAt: candidate.publishedAt,
            durationSeconds: candidate.durationSeconds,
            viewCount: candidate.viewCount,
            commentCount: candidate.commentCount,
            searchMetrics: candidate.searchMetrics,
          }),
        })
        const stored = (await response.json()) as NewsSource
        if (
          response.ok &&
          stored.localFile &&
          !stored.requiresUpload &&
          !selectedUrls.has(stored.originalUrl)
        ) {
          next.push(stored)
          selectedUrls.add(stored.originalUrl)
        }
      } catch {
        // 접근할 수 없는 후보는 건너뛰고 다음 관련 영상을 시도합니다.
      }
    }
    return next.slice(0, 2)
  }

  return (
    <>
      {mode === "issue" ? (
        <>
          <Heading
            title="1. 이슈 탐색·승인"
            description="제작할 이슈를 먼저 고릅니다."
          />
          <Card>
            <Card.Header>
              <div>
                <Card.Title>추천 이슈 찾기</Card.Title>
                <Card.Description>
                  비워두면 우선 탐색 주제 기준으로 추천합니다.
                </Card.Description>
              </div>
            </Card.Header>
            <Card.Content className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input
                  value={query}
                  onChange={(event) =>
                    onIssueSearch({ query: event.currentTarget.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && busy === "") {
                      runIssueAction()
                    }
                  }}
                  className={`${field} min-w-0 flex-1`}
                  placeholder="주제 또는 YouTube URL 입력"
                />
                <input
                  ref={directVideoInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-matroska,video/webm,video/x-m4v"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ""
                    if (file) onVideoFile(file)
                  }}
                />
                <Button
                  variant="outline"
                  isDisabled={busy !== ""}
                  onPress={() => directVideoInputRef.current?.click()}
                >
                  <LoadingButtonLabel
                    loading={busy === "file-source"}
                    label="영상 파일"
                    loadingLabel="업로드 중"
                  />
                </Button>
              </div>
              <div className="flex justify-end">
                <Button isDisabled={busy !== ""} onPress={runIssueAction}>
                  <LoadingButtonLabel
                    loading={
                      busy === "issues" ||
                      busy === "url-source" ||
                      busy.startsWith("auto:")
                    }
                    label={
                      directYoutubeUrl
                        ? "URL로 시작"
                        : autoMode
                          ? "이슈 자동 검색"
                          : query.trim()
                            ? "이슈 검색"
                            : "이슈 자동 검색"
                    }
                    loadingLabel={
                      busy === "url-source"
                        ? "영상 분석 중"
                        : busy.startsWith("auto:")
                          ? automaticProgressLabel(busy)
                          : query.trim()
                            ? "이슈 검색 중"
                            : "이슈 자동 검색 중"
                    }
                  />
                </Button>
              </div>
              {autoMode && !directYoutubeUrl ? (
                <p className="text-xs leading-5 text-muted">
                  ON 상태에서는 이슈 자동 검색 후 원본 선택부터 최종 렌더링까지
                  이어서 진행합니다.
                </p>
              ) : null}
              {note ? (
                <div className="rounded-xl border border-separator bg-default p-3 text-sm">
                  {note}
                </div>
              ) : null}
              {issueMessage ? (
                <div className="rounded-xl border border-separator bg-default p-3 text-sm">
                  <p>{issueMessage}</p>
                </div>
              ) : null}
            </Card.Content>
            {issues.length ? (
              <Card.Content className="grid gap-3 border-t border-separator pt-4 md:grid-cols-2">
                {issues.map((issue) => (
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
                          <span>커뮤니티 {issue.communityMentionCount}건</span>
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
                        isDisabled={busy !== ""}
                        onPress={() => void replaceIssue(issue)}
                      >
                        <LoadingButtonLabel
                          loading={busy === `replace-issue:${issue.id}`}
                          label="다른 이슈"
                          loadingLabel="검색 중"
                        />
                      </Button>
                      <Button
                        size="sm"
                        isDisabled={busy !== ""}
                        onPress={() => chooseIssue(issue)}
                      >
                        선택
                      </Button>
                    </div>
                  </div>
                ))}
              </Card.Content>
            ) : null}
          </Card>
        </>
      ) : (
        <Heading
          title="2. 원본 영상 선택·승인"
          description="이슈에 맞는 원본·보조 자료를 고릅니다."
        />
      )}

      {mode === "source" && selectedIssue ? (
        <Card>
          <Card.Header>
            <Card.Title>AI 자동 자료 탐색</Card.Title>
            <Card.Description>
              핵심 원본 1개와 필요한 보조 자료를 고릅니다.
            </Card.Description>
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
                  isDisabled={busy !== ""}
                  onPress={() => void searchSources(selectedIssue)}
                >
                  <LoadingButtonLabel
                    loading={busy === "search"}
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
                const isSupporting = supportingSources.some(
                  (candidate) => candidate.originalUrl === item.originalUrl
                )
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
                          {item.searchMetrics.riskFactors.join(" · ") || "없음"}
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
                        variant="outline"
                        isDisabled={busy !== "" || isSupporting || isPrimary}
                        onPress={() => void approveRemote(item, "supporting")}
                      >
                        <LoadingButtonLabel
                          loading={
                            pendingSourceId === `supporting:${item.id}` &&
                            busy === "source"
                          }
                          label={
                            isSupporting ? "보조 자료 추가됨" : "보조 자료 추가"
                          }
                          loadingLabel="저장 중"
                        />
                      </Button>
                      <Button
                        size="sm"
                        className="ml-2"
                        isDisabled={busy !== "" || isPrimary}
                        onPress={() => void approveRemote(item, "primary")}
                      >
                        <LoadingButtonLabel
                          loading={
                            pendingSourceId === `primary:${item.id}` &&
                            (busy === "source" || busy === "analyze")
                          }
                          label={
                            isPrimary ? "핵심 원본 선택됨" : "핵심 원본 선택"
                          }
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
          <Card.Header>
            <Card.Title>AI 자동 자료 탐색</Card.Title>
            <Card.Description>
              이슈를 먼저 선택하면 관련 원본을 찾습니다.
            </Card.Description>
          </Card.Header>
          <Card.Footer className="justify-end">
            <Button onPress={onIssueStepRequested}>이슈 선택</Button>
          </Card.Footer>
        </Card>
      ) : null}

      {mode === "source" ? (
        <>
          {source && selectedIssue ? <SourceSummary source={source} /> : null}
          {supportingSources.length ? (
            <SupportingSourceSummary
              sources={supportingSources}
              onRemove={(sourceId) =>
                onSupportingSources(
                  supportingSources.filter((item) => item.id !== sourceId)
                )
              }
            />
          ) : null}

          <Card>
            <Card.Header>
              <Card.Title>원본 직접 추가 · 선택 사항</Card.Title>
              <Card.Description>
                URL·파일로 직접 넣을 때만 사용합니다.
              </Card.Description>
            </Card.Header>
            <Card.Content className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={manualMode === "url" ? "secondary" : "outline"}
                  onPress={() =>
                    setManualMode((current) =>
                      current === "url" ? "none" : "url"
                    )
                  }
                >
                  URL 추가
                </Button>
                <Button
                  variant={manualMode === "file" ? "secondary" : "outline"}
                  onPress={() =>
                    setManualMode((current) =>
                      current === "file" ? "none" : "file"
                    )
                  }
                >
                  파일 추가
                </Button>
              </div>

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
                      onChange={(event) => setTitle(event.currentTarget.value)}
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
                      variant="outline"
                      isDisabled={!url.trim() || busy !== ""}
                      onPress={() =>
                        void approveRemote(undefined, "supporting")
                      }
                    >
                      자료 추가
                    </Button>
                    <Button
                      isDisabled={!url.trim() || busy !== ""}
                      onPress={() => void approveRemote(undefined, "primary")}
                    >
                      <LoadingButtonLabel
                        loading={
                          pendingSourceId === "primary:manual" &&
                          (busy === "source" || busy === "analyze")
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
                      variant="outline"
                      isDisabled={!video || busy !== ""}
                      onPress={() => void upload("supporting")}
                    >
                      자료 추가
                    </Button>
                    <Button
                      isDisabled={!video || busy !== ""}
                      onPress={() => void upload("primary")}
                    >
                      <LoadingButtonLabel
                        loading={busy === "upload"}
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
            <Card.Header>
              <Card.Title>전체 자막 또는 음성 분석</Card.Title>
              <Card.Description>
                붙여넣기가 업로드 자막보다 우선합니다.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              <textarea
                value={transcript}
                onChange={(event) => onTranscript(event.currentTarget.value)}
                rows={9}
                className={field}
                placeholder="SRT/VTT 자막이나 전체 녹취를 붙여넣으세요."
              />
            </Card.Content>
          </Card>
          <div className="flex items-center justify-end gap-3">
            {note ? (
              <p className="mr-auto max-w-3xl text-sm text-muted">{note}</p>
            ) : null}
            <Button variant="outline" onPress={onIssueStepRequested}>
              이전
            </Button>
            <Button
              isDisabled={!source?.approved || busy !== ""}
              onPress={() => void analyze(source, supportingSources)}
            >
              <LoadingButtonLabel
                loading={busy === "analyze"}
                label="대본 만들기"
                loadingLabel="만드는 중"
              />
            </Button>
          </div>
        </>
      ) : null}
    </>
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
      <Card.Header className="flex-row items-center justify-between gap-3">
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
          <p className="mt-3 text-sm text-warning">
            URL 자동 저장에 실패했습니다. 영상 접근 권한을 확인하거나 합법적으로
            보유한 원본을 올려 주세요.
          </p>
        ) : null}
      </Card.Content>
    </Card>
  )
}

function SupportingSourceSummary({
  sources,
  onRemove,
}: {
  sources: NewsSource[]
  onRemove: (sourceId: string) => void
}) {
  return (
    <Card>
      <Card.Header>
        <Card.Title>보조 자료 {sources.length}개</Card.Title>
        <Card.Description>
          자료 화면은 음소거하고 TTS를 유지합니다.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">
        {sources.map((source) => (
          <div
            key={source.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-separator p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{source.title}</p>
              <p className="truncate text-xs text-muted">
                {source.channel || "채널 정보 없음"}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label={`${source.title} 보조 자료에서 제거`}
              onPress={() => onRemove(source.id)}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </Card.Content>
    </Card>
  )
}

function Heading({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <header>
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
    </header>
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

function automaticProgressLabel(busy: string) {
  if (busy === "auto:sources") return "원본 자료 선택 중"
  if (busy === "auto:script") return "대본·연출 생성 중"
  if (busy === "auto:preview") return "저해상도 초안 생성 중"
  if (busy === "auto:final") return "최종 영상 생성 중"
  return "이슈 자동 검색 중"
}

function issueKey(issue: RecommendedNewsIssue) {
  return issue.articles[0]?.url || issue.title
}
