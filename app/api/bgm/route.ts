import { NextResponse } from "next/server"

import { addBgmTrack, readBgmLibrary } from "@/lib/server/bgm"

export const runtime = "nodejs"

export async function GET() {
  return NextResponse.json(await readBgmLibrary())
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { message: "음악 파일을 선택해 주세요." },
      { status: 400 }
    )
  }
  try {
    return NextResponse.json(
      await addBgmTrack(file.name, new Uint8Array(await file.arrayBuffer()))
    )
  } catch {
    return NextResponse.json(
      {
        message:
          "mp3, wav, m4a, aac, flac 파일만 20MB 이하로 추가할 수 있습니다.",
      },
      { status: 400 }
    )
  }
}
