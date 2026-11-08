import assert from "node:assert/strict"
import test from "node:test"

import {
  TYPECAST_KOREAN_MODEL,
  typecastKoreanTimestampRequest,
} from "./typecast-request.ts"

test("한국어 Typecast는 최신 안정 모델과 자연 호흡을 유지한다", () => {
  const request = typecastKoreanTimestampRequest({
    voiceId: "tc_12345678",
    text: "문장 전체를 자연스럽게 읽어.",
    tempo: 1,
  })

  assert.equal(TYPECAST_KOREAN_MODEL, "ssfm-v31")
  assert.equal(request.language, "kor")
  assert.equal(request.model, "ssfm-v31")
  assert.equal(request.prompt.emotion_preset, "normal")
  assert.equal(request.output.remove_silence_ms, null)
  assert.equal(request.output.audio_tempo, 1)
})

test("Typecast 재생 속도는 자연스러운 범위 안으로 제한한다", () => {
  assert.equal(
    typecastKoreanTimestampRequest({
      voiceId: "tc_12345678",
      text: "빠르게",
      tempo: 3,
    }).output.audio_tempo,
    1.08
  )
  assert.equal(
    typecastKoreanTimestampRequest({
      voiceId: "tc_12345678",
      text: "느리게",
      tempo: 0.2,
    }).output.audio_tempo,
    0.85
  )
})
