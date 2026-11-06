import assert from "node:assert/strict"
import test from "node:test"

import { parseSilenceOutput } from "./vad.ts"

test("FFmpeg VAD 결과에서 발음 보호 여백을 남긴 삭제 구간을 만든다", () => {
  const ranges = parseSilenceOutput(`
    [silencedetect] silence_start: 3.2
    [silencedetect] silence_end: 3.8 | silence_duration: 0.6
    [silencedetect] silence_start: 8.0
    [silencedetect] silence_end: 8.2 | silence_duration: 0.2
  `)
  assert.deepEqual(ranges, [
    {
      id: "vad-1",
      start: 3.28,
      end: 3.72,
      reason: "silence",
      restored: false,
    },
  ])
})
