import assert from "node:assert/strict"
import test from "node:test"

import {
  freshNewsClipProject,
  normalizeNewsSourceSearchState,
  resetNewsClipProjectProgress,
} from "./types.ts"

test("원본 자동 검색 상태는 완료 결과를 복원하고 중단된 검색은 다시 실행 가능하게 만든다", () => {
  const source = {
    id: "source-1",
    title: "검색 결과",
    originalUrl: "https://www.youtube.com/watch?v=test",
  }
  const restored = normalizeNewsSourceSearchState({
    issueId: "issue-1",
    results: [source, null, { title: "잘못된 결과" }],
    message: "검색 완료",
    youtubeDataMissing: false,
    status: "complete",
  })
  const interrupted = normalizeNewsSourceSearchState({
    issueId: "issue-1",
    status: "searching",
  })
  const previouslyBlocked = normalizeNewsSourceSearchState({
    issueId: "issue-1",
    status: "complete",
    youtubeDataMissing: true,
    results: [],
  })

  assert.equal(restored.results.length, 1)
  assert.equal(restored.status, "complete")
  assert.equal(interrupted.status, "idle")
  assert.equal(previouslyBlocked.status, "idle")
})

test("새 이슈를 선택하면 이전 원본과 후속 제작 데이터를 초기화한다", () => {
  const project = {
    ...freshNewsClipProject("news-channel-test"),
    source: {
      id: "old-source",
      kind: "youtube" as const,
      title: "이전 원본",
      channel: "이전 채널",
      publishedAt: "",
      durationSeconds: 100,
      viewCount: 0,
      originalUrl: "https://www.youtube.com/watch?v=old",
      summary: "",
      localFile: "",
      approved: true,
      requiresUpload: false,
      commentCount: 0,
      searchMetrics: null,
    },
    reportScript: "이전 대본",
    supplementalContext: "이전 첨부 내용",
    outputUrl: "/old.mp4",
    youtubeScheduledAt: "2026-11-15T07:30",
  }
  const issue = {
    id: "new-issue",
    title: "새 이슈",
    searchQuery: "새 이슈",
    keywords: ["새", "이슈"],
    score: 80,
    trendScore: 70,
    articleCount: 2,
    sourceCount: 2,
    communityMentionCount: 0,
    recommendationReason: "최근 기사",
    articles: [],
  }

  const reset = resetNewsClipProjectProgress(project, issue)

  assert.equal(reset.id, project.id)
  assert.equal(reset.selectedIssue?.id, "new-issue")
  assert.equal(reset.source, null)
  assert.deepEqual(reset.supportingSources, [])
  assert.equal(reset.sourceIssueId, "")
  assert.equal(reset.reportScript, "")
  assert.equal(reset.supplementalContext, "")
  assert.equal(reset.outputUrl, "")
  assert.equal(reset.youtubeScheduledAt, "2026-11-15T07:30")
})

test("새 프로젝트는 저장 가능한 유튜브 공개 시각을 기본값으로 가진다", () => {
  const project = freshNewsClipProject("news-channel-test")

  assert.match(project.youtubeScheduledAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
})

test("원본 선택 방식은 같은 렌더 모드를 공유하고 진행 초기화 뒤에도 유지한다", () => {
  const project = {
    ...freshNewsClipProject("news-channel-test"),
    productionMode: "buildup2" as const,
    sourceSelectionMode: "video-summary" as const,
    sourceOverview: "영상 전체 핵심 요약",
  }

  const reset = resetNewsClipProjectProgress(project, null)

  assert.equal(reset.productionMode, "buildup2")
  assert.equal(reset.sourceSelectionMode, "video-summary")
  assert.equal(reset.sourceOverview, "")
})
