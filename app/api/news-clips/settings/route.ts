import { NextResponse } from "next/server"

import {
  readNewsClipSettings,
  saveNewsClipAsset,
  saveNewsClipSettings,
} from "@/lib/server/news-clips/settings"
import { newsChannelId } from "@/lib/server/news-clips/channels"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const profileId = new URL(request.url).searchParams.get("profileId") ?? ""
  if (!newsChannelId(profileId)) {
    return NextResponse.json(
      { message: "뉴스 채널을 먼저 선택해 주세요." },
      { status: 400 }
    )
  }
  return NextResponse.json(await readNewsClipSettings(profileId))
}

export async function POST(request: Request) {
  const profileId = new URL(request.url).searchParams.get("profileId") ?? ""
  if (!newsChannelId(profileId)) {
    return NextResponse.json(
      { message: "뉴스 채널을 먼저 선택해 주세요." },
      { status: 400 }
    )
  }
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null)
    const file = form?.get("file")
    const kind = form?.get("kind")
    if (
      !(file instanceof File) ||
      (kind !== "titleFrame" && kind !== "bodyFrame" && kind !== "bgm")
    ) {
      return NextResponse.json(
        { message: "파일과 종류를 확인해 주세요." },
        { status: 400 }
      )
    }
    try {
      return NextResponse.json(await saveNewsClipAsset(profileId, kind, file))
    } catch {
      return NextResponse.json(
        { message: "지원하지 않거나 크기를 초과한 파일입니다." },
        { status: 400 }
      )
    }
  }
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { message: "설정을 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  return NextResponse.json(await saveNewsClipSettings(body, profileId))
}
