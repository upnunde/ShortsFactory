import { NextResponse } from "next/server"

import { draftScript, translateScene } from "@/lib/server/script"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        mode?: string
        topic?: string
        profileId?: string
        scriptKo?: string
        sceneDescription?: string
        neighbors?: { scriptKo?: string; scriptTarget?: string }[]
      }
    | null
  if (!body || typeof body.topic !== "string" || body.topic.trim() === "" || typeof body.profileId !== "string") {
    return NextResponse.json({ message: "주제가 없습니다." }, { status: 400 })
  }
  try {
    if (body.mode === "draft") {
      return NextResponse.json(await draftScript(body.topic, body.profileId))
    }
    if (body.mode === "scene") {
      if (typeof body.scriptKo !== "string" || body.scriptKo.trim() === "") {
        return NextResponse.json({ message: "한국어가 없습니다." }, { status: 400 })
      }
      const scriptTarget = await translateScene({
        profileId: body.profileId,
        topic: body.topic,
        scriptKo: body.scriptKo,
        sceneDescription: typeof body.sceneDescription === "string" ? body.sceneDescription : "",
        neighbors: (body.neighbors ?? [])
          .filter((item) => typeof item.scriptKo === "string" && typeof item.scriptTarget === "string")
          .map((item) => ({ scriptKo: item.scriptKo as string, scriptTarget: item.scriptTarget as string })),
      })
      return NextResponse.json({ scriptTarget })
    }
    return NextResponse.json({ message: "요청을 읽을 수 없습니다." }, { status: 400 })
  } catch (error) {
    const code = error instanceof Error ? error.message : ""
    if (code === "no-key" || code === "rejected-key") {
      return NextResponse.json({ message: "클로드 키를 확인하지 못했습니다." }, { status: 401 })
    }
    if (code === "no-credit") {
      return NextResponse.json({ message: "클로드 크레딧이 없습니다." }, { status: 402 })
    }
    return NextResponse.json({ message: "대본을 쓰지 못했습니다." }, { status: 502 })
  }
}
