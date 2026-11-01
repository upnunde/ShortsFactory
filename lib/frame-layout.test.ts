import assert from "node:assert/strict"
import test from "node:test"

import {
  fitCaption,
  normalizeFrameLayout,
  setSubtitleY,
} from "./frame-layout.ts"

test("예전 배치 파일은 고정 화면의 기본 글꼴과 자막 위치로 읽는다", () => {
  const layout = normalizeFrameLayout({
    mode: "split",
    titleHeight: 20,
    subtitleY: 71,
  })

  assert.equal(layout.fontFamily, "pretendard")
  assert.equal(layout.fontWeight, 700)
  assert.equal(layout.titleSize, 60)
  assert.equal(layout.subtitleSize, 50)
  assert.equal(layout.subtitleY, 75)
})

test("자막 위치와 글자 크기는 허용 범위 안으로 제한한다", () => {
  const layout = normalizeFrameLayout({
    fontWeight: 500,
    titleSize: 200,
    subtitleSize: 10,
    subtitleY: 99,
  })

  assert.equal(layout.fontWeight, 500)
  assert.equal(layout.titleSize, 96)
  assert.equal(layout.subtitleSize, 28)
  assert.equal(layout.subtitleY, 92)
  assert.equal(setSubtitleY(layout, 10).subtitleY, 28)
})

test("두 줄을 넘는 자막은 문장 전체를 두 줄로 다시 나눈다", () => {
  assert.deepEqual(
    fitCaption("자막이 2줄 일 경우\n예시 화면", 16),
    ["자막이 2줄 일 경우", "예시 화면"]
  )
  const wrapped = fitCaption(
    "I was looking at\nthe calendar on my\nwall, and I suddenly\ngot curious.",
    16
  )
  assert.equal(wrapped.length, 2)
  assert.match(wrapped.join(" "), /got curious/)
})
