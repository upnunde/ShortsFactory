import { NextResponse } from "next/server"

import { applyScript, draftScript, fillPlaces, outlineScript, rewritePlace, translatePlace, translateScene } from "@/lib/server/script"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        mode?: string
        topic?: string
        profileId?: string
        scriptKo?: string
        sceneDescription?: string
        overviewKo?: string
        overviewEn?: string
        placeKo?: string
        note?: string
        scenes?: { id?: string; scriptKo?: string; scriptTarget?: string }[]
        neighbors?: { scriptKo?: string; scriptTarget?: string }[]
      }
    | null
  if (!body || typeof body.topic !== "string" || body.topic.trim() === "" || typeof body.profileId !== "string") {
    return NextResponse.json({ message: "주제가 없습니다." }, { status: 400 })
  }
  try {
    if (body.mode === "outline") {
      return NextResponse.json(await outlineScript(body.topic, body.profileId))
    }
    if (body.mode === "apply") {
      if (typeof body.overviewKo !== "string" || body.overviewKo.trim() === "" || typeof body.placeKo !== "string" || body.placeKo.trim() === "") {
        return NextResponse.json({ message: "전체 내용과 진행 자리가 없습니다." }, { status: 400 })
      }
      return NextResponse.json(
        await applyScript({
          topic: body.topic,
          profileId: body.profileId,
          overviewKo: body.overviewKo,
          overviewEn: typeof body.overviewEn === "string" ? body.overviewEn : "",
          placeKo: body.placeKo,
        }),
      )
    }
    if (body.mode === "draft") {
      return NextResponse.json(await draftScript(body.topic, body.profileId))
    }
    if (body.mode === "place-note") {
      if (typeof body.note !== "string" || body.note.trim() === "") {
        return NextResponse.json({ message: "자리 메모가 없습니다." }, { status: 400 })
      }
      return NextResponse.json(
        await rewritePlace({
          topic: body.topic,
          profileId: body.profileId,
          overviewKo: typeof body.overviewKo === "string" ? body.overviewKo : "",
          placeKo: typeof body.placeKo === "string" ? body.placeKo : "",
          note: body.note,
        }),
      )
    }
    if (body.mode === "place") {
      if (typeof body.placeKo !== "string" || body.placeKo.trim() === "") {
        return NextResponse.json({ message: "장소 설명이 없습니다." }, { status: 400 })
      }
      return NextResponse.json({
        placeEn: await translatePlace({
          profileId: body.profileId,
          topic: body.topic,
          placeKo: body.placeKo,
        }),
      })
    }
    if (body.mode === "places") {
      const scenes = (body.scenes ?? []).filter(
        (scene): scene is { id: string; scriptKo: string; scriptTarget: string } =>
          typeof scene.id === "string" &&
          typeof scene.scriptKo === "string" &&
          typeof scene.scriptTarget === "string",
      )
      if (scenes.length < 5) {
        return NextResponse.json({ message: "씬이 없습니다." }, { status: 400 })
      }
      return NextResponse.json(
        await fillPlaces({ profileId: body.profileId, topic: body.topic, scenes }),
      )
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
    const message =
      body?.mode === "outline"
        ? "전체 내용을 쓰지 못했습니다."
        : body?.mode === "apply"
          ? "대본을 적용하지 못했습니다."
          : body?.mode === "place-note"
            ? "진행 자리를 다시 쓰지 못했습니다."
            : body?.mode === "place" || body?.mode === "places"
              ? "화면 기준을 만들지 못했습니다."
              : "대본을 쓰지 못했습니다."
    return NextResponse.json({ message }, { status: 502 })
  }
}
