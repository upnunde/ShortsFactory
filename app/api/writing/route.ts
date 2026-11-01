import { NextResponse } from "next/server"

import { readWritingGuide, saveWritingGuide } from "@/lib/server/writing-guide"

export async function GET() {
  return NextResponse.json(await readWritingGuide())
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "요청을 읽을 수 없습니다." }, { status: 400 })
  }
  return NextResponse.json(await saveWritingGuide(body))
}
