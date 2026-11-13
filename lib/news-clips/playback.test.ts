import assert from "node:assert/strict"
import test from "node:test"

import {
  NEWS_SOURCE_PLAYBACK_RATE,
  quoteOutputDurationSeconds,
  scaleQuoteTimelineSeconds,
  unscaleQuoteTimelineSeconds,
} from "./playback.ts"

test("원본 영상은 배속 없이 원배속으로 재생한다", () => {
  assert.equal(NEWS_SOURCE_PLAYBACK_RATE, 1)
})

test("직접 발언 출력 길이와 자막 타임코드는 원본 구간과 같다", () => {
  assert.equal(quoteOutputDurationSeconds(10, 22), 12)
  assert.equal(scaleQuoteTimelineSeconds(6), 6)
})

test("배속된 출력 타임코드는 원본 상대 타임코드로 되돌릴 수 있다", () => {
  const outputSeconds = scaleQuoteTimelineSeconds(6, 1.25)
  assert.equal(unscaleQuoteTimelineSeconds(outputSeconds, 1.25), 6)
})
