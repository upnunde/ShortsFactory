import { NextResponse } from "next/server"

import { readHistory } from "@/lib/server/history"

export const runtime = "nodejs"

export async function GET(_request: Request, context: RouteContext<"/api/history/[id]">) {
  const { id } = await context.params
  const saved = await readHistory(id)
  if (!saved) {
    return NextResponse.json({ message: "작업을 찾지 못했습니다." }, { status: 404 })
  }
  return NextResponse.json({
    studio: saved.studio,
    hasVideo: saved.entry?.hasVideo === true,
    signature: saved.entry?.signature ?? "",
  })
}
