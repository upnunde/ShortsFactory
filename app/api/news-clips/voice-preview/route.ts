import { createHash } from "node:crypto"
import { access, mkdir, readFile } from "node:fs/promises"
import path from "node:path"

import { NextResponse } from "next/server"

import { newsTtsVoiceById } from "@/lib/news-clips/voices"
import {
  newsTtsCacheIdentity,
  newsTtsErrorMessage,
  resolveNewsTtsProvider,
  synthesizeNewsSpeech,
} from "@/lib/server/news-clips/tts-provider"
import type { NewsTtsProvider } from "@/lib/news-clips/types"

export const runtime = "nodejs"
export const maxDuration = 300

const previewDir = path.join(process.cwd(), "outputs", "news-voice-preview")

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") ?? ""
  if (!/^[a-f0-9]{16}$/.test(key)) {
    return NextResponse.json(
      { message: "미리듣기 파일을 찾을 수 없습니다." },
      { status: 404 }
    )
  }
  try {
    const bytes = await readFile(path.join(previewDir, `${key}.wav`))
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=86400",
      },
    })
  } catch {
    return NextResponse.json(
      { message: "미리듣기 파일을 찾을 수 없습니다." },
      { status: 404 }
    )
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    voiceId?: unknown
    provider?: unknown
    typecastVoiceId?: unknown
    ratePercent?: unknown
    text?: unknown
  } | null
  const text =
    typeof body?.text === "string" ? body.text.trim().slice(0, 500) : ""
  if (!text) {
    return NextResponse.json(
      { message: "미리 들을 문장이 없습니다." },
      { status: 400 }
    )
  }
  const voice = newsTtsVoiceById(
    typeof body?.voiceId === "string" ? body.voiceId : ""
  )
  const ratePercent =
    typeof body?.ratePercent === "number" && Number.isFinite(body.ratePercent)
      ? body.ratePercent
      : -4
  const preference: NewsTtsProvider =
    body?.provider === "free" || body?.provider === "typecast"
      ? body.provider
      : "auto"
  const typecastVoiceId =
    typeof body?.typecastVoiceId === "string" &&
    /^tc_[a-z0-9]{8,96}$/i.test(body.typecastVoiceId.trim())
      ? body.typecastVoiceId.trim()
      : "tc_5e4f7a5da82e1f000aca31af"
  const provider = await resolveNewsTtsProvider({
    ttsProvider: preference,
    titleVoice: voice.id,
    typecastVoiceId,
  }).catch((error: unknown) =>
    error instanceof Error ? error : new Error("typecast-failed")
  )
  if (provider instanceof Error) {
    return NextResponse.json(
      {
        message:
          newsTtsErrorMessage(provider.message) ||
          "한국어 음성 미리듣기를 만들지 못했습니다.",
      },
      { status: 422 }
    )
  }
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        tts: newsTtsCacheIdentity(provider),
        ratePercent,
        text,
      })
    )
    .digest("hex")
    .slice(0, 16)
  const output = path.join(previewDir, `${key}.wav`)
  try {
    await mkdir(previewDir, { recursive: true })
    let usedProvider = provider.id
    await access(output).catch(async () => {
      usedProvider = await synthesizeNewsSpeech(
        text,
        ratePercent,
        output,
        provider
      )
    })
    return NextResponse.json({
      key,
      url: `/api/news-clips/voice-preview?key=${key}`,
      voiceId: voice.id,
      provider: usedProvider,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    const typecastMessage = newsTtsErrorMessage(code)
    return NextResponse.json(
      {
        message:
          typecastMessage ||
          (code === "local-tts-unavailable"
            ? "이 컴퓨터에서 무료 한국어 음성 기능을 사용할 수 없습니다."
            : "한국어 음성 미리듣기를 만들지 못했습니다."),
      },
      { status: 502 }
    )
  }
}
