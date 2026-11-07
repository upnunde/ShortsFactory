import { NextResponse } from "next/server"

import {
  archiveProfile,
  createProfile,
  listProfiles,
  updateProfile,
} from "@/lib/server/profiles"

export async function GET() {
  return NextResponse.json(await listProfiles())
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown
  } | null
  if (typeof body?.id !== "string") {
    return NextResponse.json(
      { message: "삭제할 채널을 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  if (body.id === "default") {
    return NextResponse.json(
      { message: "기본 채널은 삭제할 수 없습니다." },
      { status: 400 }
    )
  }
  const archived = await archiveProfile(body.id)
  return archived
    ? NextResponse.json({ archived: true })
    : NextResponse.json(
        { message: "채널을 삭제하지 못했습니다. 마지막 채널은 남겨 둡니다." },
        { status: 404 }
      )
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown
  } | null
  const profile = await createProfile(
    typeof body?.name === "string" ? body.name : ""
  )
  return NextResponse.json(profile)
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown
    name?: unknown
    system_prompt?: unknown
    image_style_anchor?: unknown
    default_bgm_id?: unknown
    youtube_bgm_volume?: unknown
  } | null
  if (!body || typeof body.id !== "string") {
    return NextResponse.json(
      { message: "채널을 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  return NextResponse.json(
    await updateProfile(body.id, {
      name: typeof body.name === "string" ? body.name : undefined,
      system_prompt:
        typeof body.system_prompt === "string" ? body.system_prompt : undefined,
      image_style_anchor:
        typeof body.image_style_anchor === "string"
          ? body.image_style_anchor
          : undefined,
      default_bgm_id:
        typeof body.default_bgm_id === "string"
          ? body.default_bgm_id
          : undefined,
      youtube_bgm_volume:
        typeof body.youtube_bgm_volume === "number"
          ? body.youtube_bgm_volume
          : undefined,
    })
  )
}
