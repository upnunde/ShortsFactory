import assert from "node:assert/strict"
import test from "node:test"

import { confirmCommunityIssues, extractIssues } from "./community.ts"
import type { NewsSource } from "../../news-clips/types.ts"

test("공개 게시글 여러 개에서 반복된 이슈만 보조 신호로 묶는다", () => {
  const html = `
    <a href="/view/10001">부동산 세금 정책 논란</a>
    <a href="/view/10002">세금 정책으로 부동산 부담 증가</a>
    <a href="/view/10003">외교 이슈 하나</a>
  `
  const issues = extractIssues(html)
  assert.ok(issues.some((issue) => issue.label === "세금"))
  assert.ok(issues.every((issue) => issue.distinctPostCount >= 2))
  assert.ok(issues.every((issue) => issue.score <= 80))
})

test("등록 뉴스 채널에서도 다룬 이슈만 커뮤니티 점수에 반영한다", () => {
  const [issue] = extractIssues(`
    <a href="/view/10001">부동산 세금 정책 논란</a>
    <a href="/view/10002">세금 정책으로 부동산 부담 증가</a>
  `)
  const source = {
    id: "search-video",
    kind: "search",
    title: "부동산 세금 정책 발표",
    channel: "등록 뉴스",
    publishedAt: "",
    durationSeconds: 300,
    viewCount: 1000,
    commentCount: 20,
    originalUrl: "https://example.com/video",
    summary: "세금 내용",
    localFile: "",
    approved: false,
    requiresUpload: true,
    searchMetrics: null,
  } satisfies NewsSource
  const [confirmed] = confirmCommunityIssues([issue], [source])
  assert.equal(confirmed.registeredNewsChannelCount, 1)
  assert.equal(confirmed.scoreBreakdown.registeredNewsCoverage, 5)
  assert.equal(confirmed.score, issue.score + 5)
})
