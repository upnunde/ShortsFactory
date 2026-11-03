import assert from "node:assert/strict"
import test from "node:test"

import {
  speechSpeed,
  videoSecondsForAudio,
  wordTimings,
} from "./voice-timing.ts"

test("실제 음성 길이 안에 모든 단어 타임스탬프를 배치한다", () => {
  const words = wordTimings("One small step.", 3)

  assert.equal(words.length, 3)
  assert.equal(words[0].start, 0)
  assert.equal(words[2].end, 3)
  assert.equal(words[1].word, "small")
})

test("45초를 넘는 음성은 제한된 범위에서 말하기 속도를 높인다", () => {
  assert.equal(speechSpeed(45), 1)
  assert.equal(speechSpeed(46), 1.18)
  assert.equal(speechSpeed(100), 1.25)
})

test("영상 요청 길이는 음성을 덮는 정수 초로 제한한다", () => {
  assert.equal(videoSecondsForAudio(2.2), 4)
  assert.equal(videoSecondsForAudio(7.1), 8)
  assert.equal(videoSecondsForAudio(40), 30)
})
