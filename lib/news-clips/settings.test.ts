import assert from "node:assert/strict"
import test from "node:test"

import { normalizeNewsClipSettings } from "./settings.ts"

test("뉴스 TTS는 한국어 전용 모델을 기본 선택한다", () => {
  const defaults = normalizeNewsClipSettings({}, "news-channel-test")
  const migrated = normalizeNewsClipSettings(
    { titleVoice: "ko-KR-SunHiNeural" },
    "news-channel-test"
  )
  const selected = normalizeNewsClipSettings(
    { titleVoice: "macos-yuna" },
    "news-channel-test"
  )

  assert.equal(defaults.titleVoice, "mms-kor")
  assert.equal(defaults.ttsProvider, "auto")
  assert.equal(defaults.typecastVoiceId, "tc_5e4f7a5da82e1f000aca31af")
  assert.deepEqual(defaults.typecastVoices, [
    {
      id: "typecast-default",
      name: "기본 Typecast 음성",
      voiceId: "tc_5e4f7a5da82e1f000aca31af",
    },
  ])
  assert.equal(migrated.titleVoice, "mms-kor")
  assert.equal(selected.titleVoice, "macos-yuna")
})

test("기존 단일 Typecast 코드를 음성 목록으로 이전한다", () => {
  const migrated = normalizeNewsClipSettings(
    { typecastVoiceId: "tc_12345678" },
    "news-channel-test"
  )
  const selected = normalizeNewsClipSettings(
    {
      typecastVoiceId: "tc_bbbbbbbb",
      typecastVoices: [
        { id: "voice-a", name: "앵커 A", voiceId: "tc_aaaaaaaa" },
        { id: "voice-b", name: "앵커 B", voiceId: "tc_bbbbbbbb" },
      ],
    },
    "news-channel-test"
  )

  assert.equal(migrated.typecastVoices[0].voiceId, "tc_12345678")
  assert.equal(selected.typecastVoiceId, "tc_bbbbbbbb")
  assert.equal(selected.typecastVoices[1].name, "앵커 B")
})

test("뉴스 TTS 제공자와 Typecast 음성 ID를 안전하게 정규화한다", () => {
  const selected = normalizeNewsClipSettings(
    {
      ttsProvider: "typecast",
      typecastVoiceId: "tc_12345678",
    },
    "news-channel-test"
  )
  const invalid = normalizeNewsClipSettings(
    {
      ttsProvider: "unknown",
      typecastVoiceId: "not-a-voice",
    },
    "news-channel-test"
  )

  assert.equal(selected.ttsProvider, "typecast")
  assert.equal(selected.typecastVoiceId, "tc_12345678")
  assert.equal(invalid.ttsProvider, "auto")
  assert.equal(invalid.typecastVoiceId, "tc_5e4f7a5da82e1f000aca31af")
})
