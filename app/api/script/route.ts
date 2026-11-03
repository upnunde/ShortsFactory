import { NextResponse } from "next/server"

import {
  applyScript,
  directStoryboard,
  draftScript,
  fitScriptDuration,
  fillPlaces,
  outlineScript,
  rewritePlace,
  rewriteScene,
  translatePlace,
} from "@/lib/server/script"
import type { Scene } from "@/lib/types"
import type { WordTiming } from "@/lib/voice-timing"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        mode?: string
        topic?: string
        profileId?: string
        scriptKo?: string
        changedSceneId?: string
        titleKo?: string
        topicEn?: string
        sceneDescription?: string
        overviewKo?: string
        overviewEn?: string
        placeKo?: string
        note?: string
        scenes?: unknown[]
        durations?: Record<string, unknown>
        words?: Record<string, unknown>
        measuredSeconds?: number
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
          !!scene &&
          typeof scene === "object" &&
          typeof (scene as { id?: unknown }).id === "string" &&
          typeof (scene as { scriptKo?: unknown }).scriptKo === "string" &&
          typeof (scene as { scriptTarget?: unknown }).scriptTarget === "string",
      )
      if (scenes.length < 5) {
        return NextResponse.json({ message: "씬이 없습니다." }, { status: 400 })
      }
      return NextResponse.json(
        await fillPlaces({ profileId: body.profileId, topic: body.topic, scenes }),
      )
    }
    if (body.mode === "direction") {
      const scenes = (body.scenes ?? []).filter(isScene)
      if (scenes.length === 0) {
        return NextResponse.json({ message: "확정된 대본이 없습니다." }, { status: 400 })
      }
      const durations = Object.fromEntries(
        Object.entries(body.durations ?? {}).flatMap(([id, value]) =>
          typeof value === "number" && Number.isFinite(value) && value > 0
            ? [[id, value]]
            : []
        )
      )
      if (scenes.some((scene) => !durations[scene.id])) {
        return NextResponse.json({ message: "TTS 길이를 먼저 측정해야 합니다." }, { status: 400 })
      }
      const words = Object.fromEntries(
        Object.entries(body.words ?? {}).map(([id, value]) => [
          id,
          Array.isArray(value) ? value.filter(isWordTiming) : [],
        ])
      )
      return NextResponse.json({
        scenes: await directStoryboard({
          profileId: body.profileId,
          topic: body.topic,
          scenes,
          durations,
          words,
        }),
      })
    }
    if (body.mode === "fit-duration") {
      const scenes = (body.scenes ?? []).filter(isScene)
      if (
        scenes.length === 0 ||
        typeof body.measuredSeconds !== "number" ||
        !Number.isFinite(body.measuredSeconds) ||
        body.measuredSeconds <= 0
      ) {
        return NextResponse.json({ message: "측정된 음성 길이가 없습니다." }, { status: 400 })
      }
      return NextResponse.json(
        await fitScriptDuration({
          profileId: body.profileId,
          topic: body.topic,
          measuredSeconds: body.measuredSeconds,
          scenes,
        })
      )
    }
    if (body.mode === "scene") {
      const scenes = (body.scenes ?? []).filter(isScene)
      if (
        typeof body.changedSceneId !== "string" ||
        scenes.length === 0 ||
        !scenes.some(
          (scene) =>
            scene.id === body.changedSceneId && scene.scriptKo.trim() !== ""
        )
      ) {
        return NextResponse.json({ message: "한국어가 없습니다." }, { status: 400 })
      }
      return NextResponse.json(await rewriteScene({
        profileId: body.profileId,
        topic: body.topic,
        changedSceneId: body.changedSceneId,
        titleKo: typeof body.titleKo === "string" ? body.titleKo : "",
        topicEn: typeof body.topicEn === "string" ? body.topicEn : "",
        scenes,
      }))
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
    if (body?.mode === "fit-duration" && code === "duration-format") {
      return NextResponse.json(
        {
          message:
            "AI가 일부 본문 씬을 빠뜨려 길이를 조정하지 못했습니다. 다시 실행해 주세요.",
        },
        { status: 502 }
      )
    }
    if (
      body?.mode === "fit-duration" &&
      (code === "claude-failed" || code === "empty")
    ) {
      return NextResponse.json(
        { message: "대본 길이 조정 중 클로드 응답을 받지 못했습니다." },
        { status: 502 }
      )
    }
    const message =
      body?.mode === "outline"
        ? "전체 내용을 쓰지 못했습니다."
        : body?.mode === "apply"
          ? "대본을 적용하지 못했습니다."
          : body?.mode === "scene"
            ? "연결된 내용을 맞추지 못했습니다."
          : body?.mode === "direction"
            ? "화면 연출을 만들지 못했습니다."
          : body?.mode === "fit-duration"
            ? "대본 길이를 자동으로 맞추지 못했습니다."
          : body?.mode === "place-note"
            ? "진행 자리를 다시 쓰지 못했습니다."
            : body?.mode === "place" || body?.mode === "places"
              ? "화면 기준을 만들지 못했습니다."
              : "대본을 쓰지 못했습니다."
    return NextResponse.json({ message }, { status: 502 })
  }
}

function isWordTiming(value: unknown): value is WordTiming {
  if (!value || typeof value !== "object") return false
  const word = value as Partial<WordTiming>
  return (
    typeof word.word === "string" &&
    typeof word.start === "number" &&
    typeof word.end === "number"
  )
}

function isScene(value: unknown): value is Scene {
  if (!value || typeof value !== "object") return false
  const scene = value as Partial<Scene>
  return (
    typeof scene.id === "string" &&
    typeof scene.scriptKo === "string" &&
    typeof scene.approvedKo === "string" &&
    typeof scene.scriptTarget === "string" &&
    typeof scene.subtitle === "string" &&
    (scene.shot === "room" || scene.shot === "insert") &&
    typeof scene.productionMode === "string" &&
    typeof scene.sceneDescription === "string" &&
    typeof scene.visualDescription === "string" &&
    typeof scene.voiceScript === "string" &&
    Array.isArray(scene.actionBeats) &&
    Array.isArray(scene.castIds)
  )
}
