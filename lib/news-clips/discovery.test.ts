import assert from "node:assert/strict"
import test from "node:test"

import {
  scoreLightweightCandidates,
  type LightweightVideo,
} from "./discovery.ts"

const now = new Date("2026-11-04T00:00:00Z").getTime()

function video(
  id: string,
  channelId: string,
  views: number,
  comments: number,
  ageHours: number,
  title = "세금 인상 직접 발언 논란"
): LightweightVideo {
  return {
    id,
    title,
    channelId,
    channel: channelId,
    publishedAt: new Date(now - ageHours * 3_600_000).toISOString(),
    durationSeconds: 600,
    viewCount: views,
    commentCount: comments,
    description: "인터뷰에서 직접 밝힌 내용",
    transcriptExcerpt: "정부 세금 정책에 대해 말했습니다.",
  }
}

test("채널 규모보다 평소 대비 반응 배수를 우선한다", () => {
  const results = scoreLightweightCandidates(
    [
      video("large-normal", "large", 1_000_000, 4_000, 10),
      video("large-base", "large", 900_000, 3_500, 10, "일반 뉴스 정리"),
      video("small-spike", "small", 90_000, 3_000, 2),
      video("small-base", "small", 10_000, 100, 2, "일반 뉴스 정리"),
    ],
    now
  )
  assert.equal(results[0].id, "small-spike")
  assert.ok(results[0].metrics.responseMultiple > 1)
})

test("추천 점수는 100점을 넘지 않고 지표를 모두 제공한다", () => {
  const [result] = scoreLightweightCandidates(
    [video("one", "channel", 50_000, 1_500, 1)],
    now
  )
  assert.ok(result.metrics.recommendationScore <= 100)
  assert.ok(result.metrics.viewsPerHour > 0)
  assert.ok(result.metrics.commentRate > 0)
  assert.ok(result.metrics.expectedShortTitle.length > 0)
})
