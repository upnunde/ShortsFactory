import assert from "node:assert/strict"
import test from "node:test"

import {
  selectPreferredStoredTranscript,
  transcriptHasExplicitTimestamps,
} from "./transcript-storage.ts"

const sourceSrt = `1
00:00:01,000 --> 00:00:03,000
원본 음성 자막`

const generatedJson = JSON.stringify({
  format: "shortsfactory-word-timestamps-v1",
  segments: [
    {
      start: 1,
      end: 3,
      text: "앞 문장을 잘못 반복한 자동 전사",
      words: [
        { word: "앞", start: 1, end: 1.4, probability: 0.08 },
        { word: "문장", start: 1.5, end: 2, probability: 0.04 },
      ],
    },
  ],
})

test("자동 Whisper JSON보다 원본 시간 자막을 우선한다", () => {
  assert.equal(
    selectPreferredStoredTranscript({
      originalTimed: sourceSrt,
      generated: generatedJson,
    }),
    sourceSrt
  )
})

test("원본 자막이 없으면 단어 시간 Whisper JSON을 사용한다", () => {
  assert.equal(
    selectPreferredStoredTranscript({ generated: generatedJson }),
    generatedJson
  )
})

test("사용자가 교정한 JSON은 원본 자막보다 우선해 보존한다", () => {
  const reviewed = JSON.stringify({
    format: "shortsfactory-word-timestamps-v1",
    segments: [
      {
        start: 1,
        end: 3,
        text: "사용자가 고친 문장",
        original_text: "자동 전사 문장",
        caption_boundary_source: "manual",
        words: [{ word: "사용자가", start: 1, end: 1.7 }],
      },
    ],
  })
  assert.equal(
    selectPreferredStoredTranscript({
      originalTimed: sourceSrt,
      generated: reviewed,
    }),
    reviewed
  )
})

test("명시적 시간이 없는 일반 텍스트는 전체 STT 대체 대상이다", () => {
  assert.equal(transcriptHasExplicitTimestamps("일반 텍스트 원문"), false)
  assert.equal(transcriptHasExplicitTimestamps(sourceSrt), true)
  assert.equal(transcriptHasExplicitTimestamps(generatedJson), true)
})
