import assert from "node:assert/strict"
import test from "node:test"

import {
  NEWS_SOURCE_PLAYBACK_RATE,
  quoteOutputDurationSeconds,
  scaleQuoteTimelineSeconds,
} from "./playback.ts"

test("원본 영상 기본 배속은 1.2배다", () => {
  assert.equal(NEWS_SOURCE_PLAYBACK_RATE, 1.2)
})

test("직접 발언 출력 길이와 자막 타임코드는 배속에 맞춰 줄어든다", () => {
  assert.equal(quoteOutputDurationSeconds(10, 22), 10)
  assert.equal(scaleQuoteTimelineSeconds(6), 5)
})
