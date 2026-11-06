import assert from "node:assert/strict"
import test from "node:test"

import { isPrimarilyKorean } from "./language.ts"

test("한국어 문장 안의 영문 약어와 인명은 허용한다", () => {
  assert.equal(
    isPrimarilyKorean("AI 반도체 지원책을 놓고 Trump 정부와 공방"),
    true
  )
})

test("영어로 작성된 기사와 영상 제목은 제외한다", () => {
  assert.equal(
    isPrimarilyKorean("Government announces a new economic policy today"),
    false
  )
  assert.equal(isPrimarilyKorean("Breaking News 속보"), false)
})
