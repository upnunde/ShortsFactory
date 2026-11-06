import assert from "node:assert/strict"
import test from "node:test"

import { selectNewsTtsProvider } from "./tts-provider.ts"

test("Typecast 키가 없으면 모든 자동 선택이 무료 TTS를 사용한다", () => {
  assert.equal(selectNewsTtsProvider("auto", false), "free")
  assert.equal(selectNewsTtsProvider("typecast", false), "free")
})

test("Typecast 키가 있어도 무료 선택은 우선한다", () => {
  assert.equal(selectNewsTtsProvider("free", true), "free")
  assert.equal(selectNewsTtsProvider("auto", true), "typecast")
  assert.equal(selectNewsTtsProvider("typecast", true), "typecast")
})
