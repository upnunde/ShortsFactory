import { NextResponse } from "next/server"

import { readVoiceId, saveVoiceId } from "@/lib/server/voice"

export async function GET() {
  return NextResponse.json({ id: await readVoiceId() })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ message: "목소리를 읽을 수 없습니다." }, { status: 400 })
  }
  return NextResponse.json({ id: await saveVoiceId(body.id) })
}
