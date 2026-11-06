import { NextResponse } from "next/server"

import {
  deleteNewsHistory,
  readNewsHistory,
} from "@/lib/server/news-clips/history"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const profileId = new URL(request.url).searchParams.get("profileId") ?? ""
  const snapshot = await readNewsHistory(id, profileId)
  if (!snapshot) {
    return NextResponse.json(
      { message: "저장 기록을 찾지 못했습니다." },
      { status: 404 }
    )
  }
  return NextResponse.json({ snapshot })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const profileId = new URL(request.url).searchParams.get("profileId") ?? ""
  if (!(await deleteNewsHistory(id, profileId))) {
    return NextResponse.json(
      { message: "삭제하지 못했습니다." },
      { status: 404 }
    )
  }
  return NextResponse.json({ deleted: true })
}
