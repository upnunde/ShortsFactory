import assert from "node:assert/strict"
import test from "node:test"

import { parseSilenceOutput } from "./vad.ts"

test("FFmpeg VAD 결과에서 발음 보호 여백을 남긴 삭제 구간을 만든다", () => {
  const ranges = parseSilenceOutput(`
    [silencedetect] silence_start: 3.2
    [silencedetect] silence_end: 3.8 | silence_duration: 0.6
    [silencedetect] silence_start: 8.0
    [silencedetect] silence_end: 8.12 | silence_duration: 0.12
    [silencedetect] silence_start: 10.0
    [silencedetect] silence_end: 10.5 | silence_duration: 0.5
  `)
  assert.deepEqual(ranges, [
    {
      id: "vad-1",
      start: 3.24,
      end: 3.76,
      reason: "silence",
      restored: false,
    },
    {
      id: "vad-2",
      start: 10.04,
      end: 10.46,
      reason: "silence",
      restored: false,
    },
  ])
})
