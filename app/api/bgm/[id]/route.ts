import { NextResponse } from "next/server"

import { removeBgmTrack } from "@/lib/server/bgm"

export const runtime = "nodejs"

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/bgm/[id]">
) {
  const { id } = await context.params
  try {
    return NextResponse.json(await removeBgmTrack(id))
  } catch {
    return NextResponse.json(
      { message: "기본 배경음악은 지우지 않습니다." },
      { status: 400 }
    )
  }
}
