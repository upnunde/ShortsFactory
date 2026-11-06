import assert from "node:assert/strict"
import test from "node:test"

import { koreanTtsInput, normalizeKoreanSpeechText } from "./korean-speech.ts"

test("한국어 TTS가 숫자와 단위를 자연스러운 읽기 형태로 바꾼다", () => {
  assert.equal(
    normalizeKoreanSpeechText("2026년에는 30만 명이 3.5% 늘었습니다."),
    "이천이십육년에는 삼십만 명이 삼점오 퍼센트 늘었습니다."
  )
})

test("한국어 전용 MMS 모델 입력은 한글을 로마자로 변환한다", () => {
  assert.equal(koreanTtsInput("안녕하세요."), "annyeonghaseyo.")
})
