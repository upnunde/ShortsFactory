import assert from "node:assert/strict"
import test from "node:test"

import { timedActionPrompt } from "./film-plan.ts"

test("강조 단어가 시작되는 시각에 캐릭터 행동을 배치한다", () => {
  const prompt = timedActionPrompt(
    [{ trigger: "surprised", action: "opens both wings" }],
    [
      { word: "I", start: 0, end: 0.5 },
      { word: "was", start: 0.5, end: 1 },
      { word: "surprised", start: 1, end: 1.8 },
    ]
  )

  assert.match(prompt, /At 1\.00 seconds.*opens both wings/)
})

test("강조 단어를 찾지 못하면 행동을 장면 안에 고르게 배치한다", () => {
  const prompt = timedActionPrompt(
    [
      { trigger: "missing", action: "looks left" },
      { trigger: "absent", action: "nods" },
    ],
    [{ word: "Hello", start: 0, end: 4 }]
  )

  assert.match(prompt, /At 1\.33 seconds.*looks left/)
  assert.match(prompt, /At 2\.67 seconds.*nods/)
})
