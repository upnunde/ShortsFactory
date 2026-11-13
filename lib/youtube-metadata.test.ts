import assert from "node:assert/strict"
import test from "node:test"

import {
  applyYoutubeCopy,
  koreaPublishAt,
  scheduleForUpload,
  youtubeVideoResource,
} from "./youtube-metadata.ts"

test("유튜브 설명에 질문과 해시태그를 강제로 남기지 않는다", () => {
  const copy = applyYoutubeCopy({
    title: " Test ",
    description:
      "A short summary.\n\nWhich fact surprised you the most? Comment below!\n\n#Shorts #facts",
    tags: "space",
  })

  assert.equal(copy.title, "Test")
  assert.equal(copy.description, "A short summary.")
  assert.match(copy.tags, /space/)
})

test("권장 시간 밖이어도 사용자가 고른 미래 공개 시각을 유지한다", () => {
  const scheduledAt = "2026-11-12T22:35"
  const now = new Date("2026-11-11T00:00:00.000Z")

  assert.equal(scheduleForUpload(scheduledAt, now), scheduledAt)
})

test("한국 공개 시각을 같은 순간의 UTC ISO 문자열로 변환한다", () => {
  assert.equal(
    koreaPublishAt("2026-11-12T22:35"),
    "2026-11-12T13:35:00.000Z"
  )
})

test("유튜브 업로드 메타데이터에 지정한 공개 시각을 그대로 넣는다", () => {
  const resource = youtubeVideoResource({
    title: "예약 업로드 테스트",
    description: "설명",
    tags: "뉴스",
    scheduledAt: "2099-11-12T22:35",
  })

  assert.equal(resource.status.publishAt, "2099-11-12T13:35:00.000Z")
})
