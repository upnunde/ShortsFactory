import { NextResponse } from "next/server"

import { readClipFile } from "@/lib/server/film-job"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? ""
  const bytes = await readClipFile(id)
  if (!bytes) {
    return NextResponse.json({ message: "씬 영상이 없습니다." }, { status: 404 })
  }
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  })
}
