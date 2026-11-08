import assert from "node:assert/strict"
import test from "node:test"

import { parseNewsClipMetadata } from "./output-validation.ts"

test("FFmpeg 출력 메타데이터에서 영상·음성 규격을 읽는다", () => {
  const metadata = parseNewsClipMetadata(`
Duration: 00:00:52.40, start: 0.000000, bitrate: 3120 kb/s
  Stream #0:0: Video: h264, yuv420p, 720x1280, 30 fps, 30 tbr
  Stream #0:1: Audio: aac, 48000 Hz, stereo, fltp
`)
  assert.deepEqual(metadata, {
    width: 720,
    height: 1280,
    fps: 30,
    audioRate: 48000,
    stereo: true,
    duration: 52.4,
  })
})

test("영상이나 음성 정보가 빠지면 검증할 수 없다", () => {
  assert.equal(
    parseNewsClipMetadata(
      "Duration: 00:00:52.40\\nStream #0:0: Video: h264, 720x1280, 30 fps"
    ),
    null
  )
})
