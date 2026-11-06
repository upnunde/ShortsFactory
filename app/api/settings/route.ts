import { NextResponse } from "next/server"

import {
  credentialStatus,
  saveAzureSpeech,
  saveClaudeKey,
  saveHiggsfieldKey,
  saveTypecastKey,
  saveYouTubeDataKey,
} from "@/lib/server/credentials"

export async function GET() {
  return NextResponse.json(await credentialStatus())
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    provider?: string
    apiKey?: string
    region?: string
  } | null
  if (!body) {
    return NextResponse.json(
      { message: "요청을 읽을 수 없습니다." },
      { status: 400 }
    )
  }
  try {
    if (body.provider === "claude") {
      if (typeof body.apiKey !== "string" || body.apiKey.trim() === "") {
        return NextResponse.json(
          { message: "키를 입력하세요." },
          { status: 400 }
        )
      }
      await saveClaudeKey(body.apiKey)
    } else if (body.provider === "higgsfield") {
      if (typeof body.apiKey !== "string" || body.apiKey.trim() === "") {
        return NextResponse.json(
          { message: "키를 입력하세요." },
          { status: 400 }
        )
      }
      await saveHiggsfieldKey(body.apiKey)
    } else if (body.provider === "azureSpeech") {
      if (
        typeof body.apiKey !== "string" ||
        body.apiKey.trim() === "" ||
        typeof body.region !== "string" ||
        body.region.trim() === ""
      ) {
        return NextResponse.json(
          { message: "키와 리전을 입력하세요." },
          { status: 400 }
        )
      }
      await saveAzureSpeech(body.apiKey, body.region)
    } else if (body.provider === "youtubeData") {
      if (typeof body.apiKey !== "string" || body.apiKey.trim() === "") {
        return NextResponse.json(
          { message: "키를 입력하세요." },
          { status: 400 }
        )
      }
      await saveYouTubeDataKey(body.apiKey)
    } else if (body.provider === "typecast") {
      if (typeof body.apiKey !== "string" || body.apiKey.trim() === "") {
        return NextResponse.json(
          { message: "키를 입력하세요." },
          { status: 400 }
        )
      }
      await saveTypecastKey(body.apiKey)
    } else {
      return NextResponse.json(
        { message: "요청을 읽을 수 없습니다." },
        { status: 400 }
      )
    }
    return NextResponse.json(await credentialStatus())
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "invalid") {
      return NextResponse.json(
        { message: "연결 정보가 거부되었습니다. 저장하지 않았습니다." },
        { status: 401 }
      )
    }
    return NextResponse.json(
      { message: "키를 확인하지 못했습니다. 저장하지 않았습니다." },
      { status: 502 }
    )
  }
}
