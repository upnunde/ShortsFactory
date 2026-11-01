import { readFile } from "node:fs/promises"

import { NextResponse } from "next/server"

import { historyVideoPath } from "@/lib/server/history"

export const runtime = "nodejs"

export async function GET(_request: Request, context: RouteContext<"/api/history/[id]/file">) {
  const { id } = await context.params
  const file = historyVideoPath(id)
  if (!file) {
    return NextResponse.json({ message: "영상이 없습니다." }, { status: 404 })
  }
  try {
    const bytes = await readFile(file)
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return NextResponse.json({ message: "영상이 없습니다." }, { status: 404 })
  }
}
