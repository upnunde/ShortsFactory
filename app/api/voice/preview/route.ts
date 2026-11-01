import { NextResponse } from "next/server"

import { previewNarration, readPreviewAudio } from "@/lib/server/voice-preview"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const key = url.searchParams.get("key") ?? ""
  const clip = url.searchParams.get("clip") ?? ""
  const bytes = await readPreviewAudio(key, clip)
  if (!bytes) {
    return NextResponse.json({ message: "들어볼 음성이 없습니다." }, { status: 404 })
  }
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, max-age=86400",
    },
  })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    scenes?: { id?: unknown; text?: unknown }[]
  } | null
  const scenes = (body?.scenes ?? []).flatMap((scene) => {
    if (typeof scene.id !== "string" || typeof scene.text !== "string") {
      return []
    }
    const text = scene.text.trim()
    if (!scene.id.trim() || !text) {
      return []
    }
    return [{ id: scene.id, text }]
  })
  if (scenes.length === 0) {
    return NextResponse.json({ message: "들을 대본이 없습니다." }, { status: 400 })
  }
  try {
    const preview = await previewNarration(scenes)
    return NextResponse.json({
      key: preview.key,
      total: preview.total,
      clips: preview.clips,
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      { message: "음성을 만들지 못했습니다." },
      { status: 502 }
    )
  }
}
