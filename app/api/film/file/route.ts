import { readFile } from "node:fs/promises"

import { NextResponse } from "next/server"

import { finalFilmPath } from "@/lib/server/film-job"

export const runtime = "nodejs"

export async function GET() {
  try {
    const bytes = await readFile(finalFilmPath())
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "video/mp4",
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return NextResponse.json({ message: "합친 영상이 없습니다." }, { status: 404 })
  }
}
