import assert from "node:assert/strict"
import test from "node:test"

import { snapSecondsToFrame, snapSubtitleCueTimes } from "./frame-snap.ts"

test("초 단위 시간을 30fps 프레임에 스냅한다", () => {
  assert.equal(snapSecondsToFrame(1.0), 1)
  assert.equal(snapSecondsToFrame(1.016), 1)
  assert.equal(snapSecondsToFrame(1.02), 1 + 1 / 30)
})

test("자막 cue start/end를 프레임에 맞춘다", () => {
  const snapped = snapSubtitleCueTimes([
    { id: "a", start: 0.01, end: 1.014 },
  ])
  assert.equal(snapped[0]?.start, 0)
  assert.ok((snapped[0]?.end ?? 0) >= 1 / 30)
})
