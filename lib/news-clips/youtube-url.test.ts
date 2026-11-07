import assert from "node:assert/strict"
import test from "node:test"

import { extractYouTubeUrl, isYouTubeUrl } from "./youtube-url.ts"

test("일반 영상·단축·쇼츠 YouTube URL을 인식한다", () => {
  assert.equal(isYouTubeUrl("https://www.youtube.com/watch?v=abc123"), true)
  assert.equal(isYouTubeUrl("https://youtu.be/abc123"), true)
  assert.equal(isYouTubeUrl("https://youtube.com/shorts/abc123"), true)
})

test("검색어와 다른 사이트 URL은 YouTube 원본으로 처리하지 않는다", () => {
  assert.equal(isYouTubeUrl("농어촌 기본소득"), false)
  assert.equal(isYouTubeUrl("https://example.com/watch?v=abc123"), false)
})

test("앞뒤 문구가 있어도 YouTube URL을 뽑아낸다", () => {
  assert.equal(
    extractYouTubeUrl("김계리 https://youtu.be/uH6QxpzvPKE?si=abc 확인"),
    "https://youtu.be/uH6QxpzvPKE"
  )
  assert.equal(
    extractYouTubeUrl(
      "이거 봐 https://www.youtube.com/watch?v=abc123&t=12s"
    ),
    "https://www.youtube.com/watch?v=abc123"
  )
})
