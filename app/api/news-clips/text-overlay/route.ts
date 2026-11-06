import { NextResponse } from "next/server"

import { normalizeNewsClipSettings } from "@/lib/news-clips/settings"
import type { NewsClipSettings } from "@/lib/news-clips/types"
import { renderNewsTextOverlay } from "@/lib/server/news-clips/render"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    mode?: unknown
    title?: unknown
    subtitle?: unknown
    settings?: unknown
  } | null
  if (body?.mode !== "title" && body?.mode !== "body") {
    return NextResponse.json({ message: "invalid-mode" }, { status: 400 })
  }
  const title =
    typeof body.title === "string" ? body.title.trim().slice(0, 200) : ""
  const subtitle =
    typeof body.subtitle === "string" ? body.subtitle.trim().slice(0, 500) : ""
  if (!title) {
    return NextResponse.json({ message: "invalid-title" }, { status: 400 })
  }
  const rawSettings =
    body.settings && typeof body.settings === "object"
      ? (body.settings as Partial<NewsClipSettings>)
      : {}
  const settings = normalizeNewsClipSettings(
    rawSettings,
    typeof rawSettings.profileId === "string"
      ? rawSettings.profileId
      : "default"
  )
  try {
    const png = await renderNewsTextOverlay({
      mode: body.mode,
      title,
      subtitle,
      settings,
    })
    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=86400",
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "text-overlay-failed",
      },
      { status: 500 }
    )
  }
}
