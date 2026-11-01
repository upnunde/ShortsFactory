import { NextResponse } from "next/server"

import { readBgmAudio } from "@/lib/server/bgm"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  context: RouteContext<"/api/bgm/[id]/file">
) {
  const { id } = await context.params
  const audio = await readBgmAudio(id)
  if (!audio) {
    return NextResponse.json(
      { message: "음악 파일이 없습니다." },
      { status: 404 }
    )
  }
  return new NextResponse(Buffer.from(audio.bytes), {
    headers: {
      "Content-Type": audio.type,
      "Content-Length": String(audio.bytes.byteLength),
      "Cache-Control": "private, max-age=86400",
    },
  })
}
