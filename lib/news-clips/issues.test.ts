import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeNewsIssueSearchState,
  rankRecommendedIssues,
} from "./issues.ts"

const now = new Date("2026-11-05T05:00:00Z").getTime()

test("여러 매체가 반복 보도한 최근 이슈를 우선 추천한다", () => {
  const issues = rankRecommendedIssues(
    [
      article(
        "정부 세금 개편안 국회 논의 시작 - 매체A",
        "매체A",
        "2026-11-05T04:30:00Z"
      ),
      article(
        "정부 세금 개편안 놓고 국회 공방 - 매체B",
        "매체B",
        "2026-11-05T04:00:00Z"
      ),
      article(
        "정부 세금 개편안 처리 일정 발표 - 매체C",
        "매체C",
        "2026-11-05T03:00:00Z"
      ),
      article("지역 축제 주말 개막 - 매체A", "매체A", "2026-11-05T04:50:00Z"),
    ],
    [],
    now
  )
  assert.match(issues[0].title, /세금 개편안/)
  assert.equal(issues[0].articleCount, 3)
  assert.equal(issues[0].sourceCount, 3)
  assert.ok(issues[0].trendScore > issues[1].trendScore)
})

test("커뮤니티 신호는 추천 점수에만 보조적으로 반영한다", () => {
  const [issue] = rankRecommendedIssues(
    [
      article(
        "외교 안보 회담 결과 발표 - 매체A",
        "매체A",
        "2026-11-05T04:00:00Z"
      ),
    ],
    [{ label: "안보", neutralTerms: ["안보"], mentionCount: 4 }],
    now
  )
  assert.equal(issue.communityMentionCount, 4)
  assert.match(issue.recommendationReason, /공개 커뮤니티/)
  assert.equal(issue.articles[0].source, "매체A")
})

test("다른 이슈 검색용으로 기본 5개보다 많은 후보를 요청할 수 있다", () => {
  const titles = [
    "반도체 투자 확대",
    "원전 수출 협약",
    "부동산 공급 계획",
    "청년 고용 대책",
    "국방 예산 조정",
    "외교 회담 개최",
    "연금 개편 논의",
    "교육 과정 변경",
  ]
  const articles = titles.map((title, index) =>
    article(title, `매체${index + 1}`, `2026-11-05T0${index}:00:00Z`)
  )
  assert.equal(rankRecommendedIssues(articles, [], now).length, 5)
  assert.equal(rankRecommendedIssues(articles, [], now, 8).length, 8)
})

test("우선 탐색 주제는 필수 포함 조건 없이 관련 이슈의 추천 점수를 높인다", () => {
  const issues = rankRecommendedIssues(
    [
      article("지역 축제 예산 발표", "매체A", "2026-11-05T04:00:00Z"),
      article("민주당 세금 정책 논란 확산", "매체B", "2026-11-05T04:00:00Z"),
    ],
    [],
    now,
    5,
    "민주당 관련 논란과 세금 정책 영향"
  )

  assert.match(issues[0].title, /민주당/)
  assert.match(issues[0].recommendationReason, /채널 방향/)
  assert.equal(issues.length, 2)
})

test("단순 관련 기사보다 채널 방향에 맞는 비판 근거가 있는 이슈에 높은 점수를 준다", () => {
  const issues = rankRecommendedIssues(
    [
      article(
        "민주당 정부 정책 성과 적극 홍보",
        "매체A",
        "2026-11-05T04:00:00Z"
      ),
      article(
        "민주당 세금 공약 말 바꾸기 논란, 가계 부담 20% 증가",
        "매체B",
        "2026-11-05T04:00:00Z"
      ),
    ],
    [],
    now,
    5,
    "현 정부와 민주당의 정책 모순, 말 바꾸기, 세금 부담 비판"
  )

  assert.match(issues[0].title, /말 바꾸기/)
  assert.ok(issues[0].score > issues[1].score)
  assert.ok(issues[0].trendScore >= 0)
  assert.match(issues[0].recommendationReason, /비판 포인트/)
  assert.match(issues[0].recommendationReason, /국민 생활 영향/)
})

test("이슈 검색어와 추천 목록을 다시 열 수 있도록 복원한다", () => {
  const issue = rankRecommendedIssues(
    [article("정부 세금 개편 논의", "매체A", "2026-11-05T04:00:00Z")],
    [],
    now
  )[0]
  const restored = normalizeNewsIssueSearchState({
    query: "세금 정책",
    issues: [issue],
    dismissedIssueKeys: ["old-issue"],
  })

  assert.equal(restored.query, "세금 정책")
  assert.equal(restored.issues[0].id, issue.id)
  assert.deepEqual(restored.dismissedIssueKeys, ["old-issue"])
})

test("영어 기사는 이슈 추천에서 제외한다", () => {
  const issues = rankRecommendedIssues(
    [
      article(
        "Government announces a new tax policy",
        "Global News",
        "2026-11-05T04:30:00Z"
      ),
      article("정부 세금 개편안 발표", "매체A", "2026-11-05T04:00:00Z"),
    ],
    [],
    now
  )

  assert.equal(issues.length, 1)
  assert.match(issues[0].title, /세금 개편/)
})

test("원본 검색어는 그룹 첫 기사가 아니라 표시된 대표 이슈에서 만든다", () => {
  const [issue] = rankRecommendedIssues(
    [
      article("홍콩 부동산 매수 의향 조사", "매체A", "2026-11-05T03:00:00Z"),
      article(
        "정부 부동산 매수 규제 말 바꾸기 논란",
        "매체B",
        "2026-11-05T04:00:00Z"
      ),
    ],
    [],
    now
  )

  assert.match(issue.title, /정부 부동산/)
  assert.doesNotMatch(issue.searchQuery, /홍콩|의향/)
  assert.ok(issue.keywords.includes("규제"))
})

test("2일을 넘긴 기사는 키워드·자동 추천에서 제외한다", () => {
  const issues = rankRecommendedIssues(
    [
      article(
        "정부 세금 개편안 국회 논의 - 매체A",
        "매체A",
        "2026-11-05T04:00:00Z"
      ),
      article(
        "정부 세금 개편안 후속 보도 - 매체B",
        "매체B",
        "2026-11-02T04:00:00Z"
      ),
      article(
        "외교 안보 회담 결과 발표 - 매체C",
        "매체C",
        "2026-10-20T04:00:00Z"
      ),
    ],
    [],
    now
  )
  assert.equal(issues.length, 1)
  assert.match(issues[0].title, /세금 개편안/)
  assert.equal(issues[0].articleCount, 1)
  assert.equal(issues[0].articles[0].source, "매체A")
})

function article(title: string, source: string, publishedAt: string) {
  return {
    title,
    source,
    publishedAt,
    url: `https://example.com/${encodeURIComponent(title)}`,
  }
}
