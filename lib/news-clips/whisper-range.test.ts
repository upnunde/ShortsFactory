import assert from "node:assert/strict"
import test from "node:test"

import { paddedWhisperRange } from "./whisper-range.ts"

test("구간 전사는 기본적으로 앞뒤 1.5초 문맥을 포함한다", () => {
  assert.deepEqual(paddedWhisperRange({ start: 10, end: 20 }), {
    start: 8.5,
    end: 21.5,
  })
})

test("의심 구간 재시도는 더 넓은 앞뒤 문맥을 사용할 수 있다", () => {
  assert.deepEqual(paddedWhisperRange({ start: 10, end: 20 }, 7), {
    start: 3,
    end: 27,
  })
})

test("영상 시작 전으로 넘어가는 문맥과 과도한 패딩을 제한한다", () => {
  assert.deepEqual(paddedWhisperRange({ start: 4, end: 2 }, 30), {
    start: 0,
    end: 19,
  })
})
