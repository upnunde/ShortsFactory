import assert from "node:assert/strict"
import test from "node:test"

import {
  koreanSpeechUnits,
  koreanTtsInput,
  normalizeKoreanSpeechText,
} from "./korean-speech.ts"

test("한국어 TTS가 숫자와 단위를 자연스러운 읽기 형태로 바꾼다", () => {
  assert.equal(
    normalizeKoreanSpeechText("2026년에는 30만 명이 3.5% 늘었습니다."),
    "이천이십육년에는 삼십만 명이 삼점오 퍼센트 늘었습니다."
  )
})

test("한국어 전용 MMS 모델 입력은 한글을 로마자로 변환한다", () => {
  assert.equal(koreanTtsInput("안녕하세요."), "annyeonghaseyo.")
})

test("명·개·번 같은 세기 단위는 고유어 수사로 읽는다", () => {
  assert.equal(
    normalizeKoreanSpeechText("3명이 2개를 20번 확인했다."),
    "세 명이 두 개를 스무 번 확인했다."
  )
})

test("줄바꿈·쉼표·문장 끝에 따라 TTS 쉼을 구성한다", () => {
  assert.deepEqual(
    koreanSpeechUnits("이건 이상해, 근데 중요해.\n바로 들어보자."),
    [
      { text: "이건 이상해,", pauseAfterSeconds: 0.12 },
      { text: "근데 중요해.", pauseAfterSeconds: 0.4 },
      { text: "바로 들어보자.", pauseAfterSeconds: 0.25 },
    ]
  )
})
