import { NextResponse } from "next/server"

import { uploadYoutubeShort } from "@/lib/server/youtube-upload"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    historyId?: unknown
    title?: unknown
    description?: unknown
    tags?: unknown
    scheduledAt?: unknown
    profileId?: unknown
  } | null
  if (
    typeof body?.historyId !== "string" ||
    typeof body.title !== "string" ||
    typeof body.description !== "string" ||
    typeof body.tags !== "string" ||
    typeof body.scheduledAt !== "string" ||
    typeof body.profileId !== "string"
  ) {
    return NextResponse.json(
      { message: "업로드 정보를 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  try {
    return NextResponse.json(
      await uploadYoutubeShort({
        profileId: body.profileId,
        historyId: body.historyId,
        title: body.title,
        description: body.description,
        tags: body.tags,
        scheduledAt: body.scheduledAt,
      })
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    const message =
      code === "youtube-not-connected"
        ? "유튜브 계정을 먼저 연결해 주세요."
        : code === "video-not-found"
          ? "업로드할 완성 영상이 없습니다."
          : code === "youtube-refresh-failed"
            ? "유튜브 로그인이 만료되었습니다. 다시 연결해 주세요."
            : "유튜브에 업로드하지 못했습니다."
    return NextResponse.json({ message }, { status: 502 })
  }
}
