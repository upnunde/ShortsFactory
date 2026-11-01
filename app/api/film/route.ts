import { NextResponse } from "next/server"

import type { FilmScene } from "@/lib/film-plan"
import { readFilmStatus, startFilm } from "@/lib/server/film-job"
import type { ShotKind } from "@/lib/types"

export const runtime = "nodejs"

export async function GET() {
  return NextResponse.json(await readFilmStatus())
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    topic?: unknown
    profileId?: unknown
    autoUpload?: unknown
    scheduledAt?: unknown
    youtube?: unknown
    placeEn?: unknown
    anchor?: unknown
    outfitId?: unknown
    bgmId?: unknown
    signature?: unknown
    historyId?: unknown
    scenes?: unknown
  } | null
  const scenes = Array.isArray(body?.scenes) ? body.scenes.flatMap(sceneOf) : []
  const youtube =
    body?.youtube && typeof body.youtube === "object"
      ? (body.youtube as Record<string, unknown>)
      : {}
  const result = await startFilm({
    topic: typeof body?.topic === "string" ? body.topic : "",
    profileId: typeof body?.profileId === "string" ? body.profileId : "default",
    autoUpload: body?.autoUpload === true,
    scheduledAt: typeof body?.scheduledAt === "string" ? body.scheduledAt : "",
    youtube: {
      enabled: youtube.enabled === true,
      title: typeof youtube.title === "string" ? youtube.title : "",
      description:
        typeof youtube.description === "string" ? youtube.description : "",
      tags: typeof youtube.tags === "string" ? youtube.tags : "",
    },
    placeEn: typeof body?.placeEn === "string" ? body.placeEn : "",
    anchor: typeof body?.anchor === "string" ? body.anchor : "",
    outfitId: typeof body?.outfitId === "string" ? body.outfitId : null,
    bgmId: typeof body?.bgmId === "string" ? body.bgmId : "stella-waltz",
    signature: typeof body?.signature === "string" ? body.signature : "",
    historyId: typeof body?.historyId === "string" ? body.historyId : "",
    scenes,
  })
  if (!result.ok) {
    return NextResponse.json({ message: result.message }, { status: 409 })
  }
  return NextResponse.json(await readFilmStatus())
}

function sceneOf(value: unknown): FilmScene[] {
  if (!value || typeof value !== "object") {
    return []
  }
  const scene = value as Partial<FilmScene>
  const shot: ShotKind = scene.shot === "insert" ? "insert" : "room"
  if (
    typeof scene.id !== "string" ||
    typeof scene.sceneDescription !== "string" ||
    typeof scene.scriptTarget !== "string"
  ) {
    return []
  }
  return [
    {
      id: scene.id,
      shot,
      sceneDescription: scene.sceneDescription,
      scriptTarget: scene.scriptTarget,
      subtitle:
        typeof scene.subtitle === "string"
          ? scene.subtitle
          : scene.scriptTarget,
      actionBeats: Array.isArray(scene.actionBeats)
        ? scene.actionBeats.flatMap((beat) => {
            if (
              !beat ||
              typeof beat !== "object" ||
              typeof beat.trigger !== "string" ||
              typeof beat.action !== "string"
            ) {
              return []
            }
            return [{ trigger: beat.trigger, action: beat.action }]
          })
        : [],
      castIds: Array.isArray(scene.castIds)
        ? scene.castIds.filter((id): id is string => typeof id === "string")
        : [],
    },
  ]
}
