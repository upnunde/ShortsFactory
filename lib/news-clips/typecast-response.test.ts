import assert from "node:assert/strict"
import test from "node:test"

import {
  typecastTimestampedWav,
  typecastWavBytes,
} from "./typecast-response.ts"

function wavBytes(size = 5_000) {
  const bytes = Buffer.alloc(size)
  bytes.write("RIFF", 0, "ascii")
  bytes.write("WAVE", 8, "ascii")
  return bytes
}

test("Typecast의 WAV 직접 응답을 읽는다", async () => {
  const expected = wavBytes()
  const actual = await typecastWavBytes(
    new Response(expected, { headers: { "content-type": "audio/wav" } })
  )

  assert.equal(actual?.byteLength, expected.byteLength)
  assert.equal(actual?.subarray(0, 4).toString("ascii"), "RIFF")
})

test("Typecast의 기존 JSON base64 응답도 계속 읽는다", async () => {
  const expected = wavBytes()
  const actual = await typecastWavBytes(
    Response.json({
      audio: expected.toString("base64"),
      audio_format: "wav",
    })
  )

  assert.equal(actual?.byteLength, expected.byteLength)
})

test("WAV가 아닌 응답은 거부한다", async () => {
  const actual = await typecastWavBytes(
    new Response(Buffer.alloc(5_000), {
      headers: { "content-type": "audio/wav" },
    })
  )

  assert.equal(actual, null)
})

test("Typecast 음성과 단어 타임스탬프를 한 번에 읽는다", async () => {
  const expected = wavBytes()
  const actual = await typecastTimestampedWav(
    Response.json({
      audio: expected.toString("base64"),
      audio_format: "wav",
      audio_duration: 1.2,
      words: [
        { text: "안녕", start: 0.1, end: 0.5 },
        { text: "세상", start: 0.65, end: 1.1 },
      ],
    })
  )

  assert.equal(actual?.wav.byteLength, expected.byteLength)
  assert.equal(actual?.timing.audioDuration, 1.2)
  assert.deepEqual(actual?.timing.words, [
    { text: "안녕", start: 0.1, end: 0.5 },
    { text: "세상", start: 0.65, end: 1.1 },
  ])
})
