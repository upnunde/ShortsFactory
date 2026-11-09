import assert from "node:assert/strict"
import test from "node:test"

import { snapSecondsToFrame, snapSubtitleCueTimes } from "./frame-snap.ts"

test("초 단위 시간을 30fps 프레임에 스냅한다", () => {
  assert.equal(snapSecondsToFrame(1.0), 1)
  assert.equal(snapSecondsToFrame(1.016), 1)
  assert.equal(snapSecondsToFrame(1.02), 1 + 1 / 30)
})

test("자막 cue start/end를 프레임에 맞춘다", () => {
  const snapped = snapSubtitleCueTimes([{ id: "a", start: 0.01, end: 1.014 }])
  assert.equal(snapped[0]?.start, 0)
  assert.ok((snapped[0]?.end ?? 0) >= 1 / 30)
})

test("프레임 반올림 뒤에도 인접 자막 시간이 겹치지 않는다", () => {
  const snapped = snapSubtitleCueTimes([
    { id: "a", start: 8.133, end: 9.067 },
    { id: "b", start: 9.05, end: 10 },
  ])

  assert.ok(snapped[1]!.start >= snapped[0]!.end)
})
