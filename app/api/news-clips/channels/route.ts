import { NextResponse } from "next/server"

import {
  archiveNewsChannel,
  createNewsChannel,
  listNewsChannels,
  updateNewsChannel,
} from "@/lib/server/news-clips/channels"

export async function GET() {
  return NextResponse.json(await listNewsChannels())
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown
  } | null
  if (typeof body?.id !== "string") {
    return NextResponse.json(
      { message: "삭제할 뉴스 채널을 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  const archived = await archiveNewsChannel(body.id)
  return archived
    ? NextResponse.json({ archived: true })
    : NextResponse.json(
        { message: "뉴스 채널을 찾을 수 없습니다." },
        { status: 404 }
      )
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown
  } | null
  return NextResponse.json(
    await createNewsChannel(typeof body?.name === "string" ? body.name : "")
  )
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown
    name?: unknown
  } | null
  if (typeof body?.id !== "string" || typeof body?.name !== "string") {
    return NextResponse.json(
      { message: "뉴스 채널 정보를 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  const profile = await updateNewsChannel(body.id, body.name)
  return profile
    ? NextResponse.json(profile)
    : NextResponse.json(
        { message: "뉴스 채널을 찾을 수 없습니다." },
        { status: 404 }
      )
}
