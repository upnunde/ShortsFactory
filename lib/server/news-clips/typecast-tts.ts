import "server-only"

import { mkdir, unlink, writeFile } from "node:fs/promises"
import path from "node:path"

import { normalizeKoreanSpeechText } from "@/lib/news-clips/korean-speech"
import {
  typecastTimestampedWav,
  type TypecastSpeechTiming,
} from "@/lib/news-clips/typecast-response"

export async function synthesizeTypecastKoreanSpeech(
  text: string,
  voiceId: string,
  ratePercent: number,
  output: string,
  apiKey: string,
  timingOutput?: string
) {
  const spokenText = normalizeKoreanSpeechText(
    text.replace(/\s*\n\s*/g, " ").trim()
  )
  if (!spokenText || !/^tc_[a-z0-9]{8,96}$/i.test(voiceId)) {
    throw new Error("typecast-failed")
  }

  const response = await fetch(
    "https://api.typecast.ai/v1/text-to-speech/with-timestamps?granularity=word",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        "User-Agent": "ShortsFactory/1.0",
      },
      body: JSON.stringify({
        voice_id: voiceId,
        text: spokenText,
        model: "ssfm-v30",
        language: "kor",
        output: {
          remove_silence_ms: 300,
          audio_tempo: Math.max(0.85, Math.min(1.08, 1 + ratePercent / 100)),
          audio_format: "wav",
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    }
  ).catch(() => {
    throw new Error("typecast-temporary")
  })

  if (!response.ok) {
    const failure = await response.text().catch(() => "")
    if (response.status === 403 && /unusual account activity/i.test(failure)) {
      throw new Error("typecast-account-restricted")
    }
    if (response.status === 401 || response.status === 403)
      throw new Error("typecast-auth")
    if (response.status === 402) throw new Error("typecast-credits")
    if (response.status === 429) throw new Error("typecast-rate-limit")
    if (response.status >= 500) throw new Error("typecast-temporary")
    throw new Error("typecast-failed")
  }

  const result = await typecastTimestampedWav(response)
  if (!result) throw new Error("typecast-failed")

  await mkdir(path.dirname(output), { recursive: true })
  try {
    await Promise.all([
      writeFile(output, result.wav),
      timingOutput
        ? writeFile(timingOutput, JSON.stringify(result.timing))
        : Promise.resolve(),
    ])
  } catch {
    await unlink(output).catch(() => undefined)
    if (timingOutput) await unlink(timingOutput).catch(() => undefined)
    throw new Error("typecast-failed")
  }
  return result.timing satisfies TypecastSpeechTiming
}
