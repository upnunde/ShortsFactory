import assert from "node:assert/strict"
import test from "node:test"

import { clampProgress } from "./task-progress.ts"

test("버튼 진행률은 정수 0~100 범위로 제한한다", () => {
  assert.equal(clampProgress(-4), 0)
  assert.equal(clampProgress(42.6), 43)
  assert.equal(clampProgress(104), 100)
})
