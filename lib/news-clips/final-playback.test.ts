import assert from "node:assert/strict"
import test from "node:test"

import {
  finalPlaybackDuration,
  normalizeFinalPlaybackRate,
  retimeSubtitlesForFinalPlayback,
} from "./final-playback.ts"

test("최종 배속은 허용된 1.1~1.5배만 사용한다", () => {
  assert.equal(normalizeFinalPlaybackRate(1.3), 1.3)
  assert.equal(normalizeFinalPlaybackRate(1), 1.1)
  assert.equal(normalizeFinalPlaybackRate(2), 1.1)
})

test("최종 배속에 맞춰 길이와 외부 자막 타임코드를 함께 줄인다", () => {
  assert.equal(finalPlaybackDuration(55, 1.1), 50)
  const cues = retimeSubtitlesForFinalPlayback(
    [
      {
        id: "caption-1",
        start: 11,
        end: 16.5,
        text: "배속 자막",
        emphasis: [],
        emphasisColor: "yellow",
      },
    ],
    1.1
  )
  assert.equal(cues[0]?.start, 10)
  assert.equal(cues[0]?.end, 15)
})
