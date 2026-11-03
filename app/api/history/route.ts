import { NextResponse } from "next/server"

import { listHistory, saveHistory } from "@/lib/server/history"
import { STEPS, type StudioState } from "@/lib/types"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  return NextResponse.json({ items: await listHistory(profileId) })
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as StudioState | null
  if (!isStudio(body)) {
    return NextResponse.json(
      { message: "작업을 저장하지 못했습니다." },
      { status: 400 }
    )
  }
  const result = await saveHistory(body)
  if (!result.ok) {
    return NextResponse.json(
      { message: "작업을 저장하지 못했습니다." },
      { status: 400 }
    )
  }
  return NextResponse.json({ frozen: result.frozen })
}

function isStudio(value: unknown): value is StudioState {
  if (!value || typeof value !== "object") {
    return false
  }
  const studio = value as StudioState
  return (
    STEPS.some((step) => step.id === studio.step) &&
    !!studio.project &&
    typeof studio.project.historyId === "string" &&
    typeof studio.project.topic === "string" &&
    Array.isArray(studio.project.scenes)
  )
}
