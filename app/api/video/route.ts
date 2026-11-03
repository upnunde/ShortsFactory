import { NextResponse } from "next/server"

import {
  readVideoSettings,
  saveVideoSettings,
} from "@/lib/server/video-settings"

export async function GET(request: Request) {
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  return NextResponse.json(await readVideoSettings(profileId))
}

export async function POST(request: Request) {
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { message: "요청을 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  return NextResponse.json(await saveVideoSettings(body, profileId))
}
