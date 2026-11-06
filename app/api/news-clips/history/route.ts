import { NextResponse } from "next/server"

import { NEWS_CLIP_STEPS } from "@/lib/news-clips/types"
import type { NewsHistorySnapshot } from "@/lib/news-clips/history"
import {
  listNewsHistory,
  saveNewsHistory,
} from "@/lib/server/news-clips/history"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const profileId = new URL(request.url).searchParams.get("profileId") ?? ""
  return NextResponse.json({ items: await listNewsHistory(profileId) })
}

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => null)) as NewsHistorySnapshot | null
  if (!validSnapshot(body) || !(await saveNewsHistory(body))) {
    return NextResponse.json(
      { message: "저장하지 못했습니다." },
      { status: 400 }
    )
  }
  return NextResponse.json({ saved: true })
}

function validSnapshot(
  value: NewsHistorySnapshot | null
): value is NewsHistorySnapshot {
  return Boolean(
    value?.project?.type === "news_clip" &&
    typeof value.project.id === "string" &&
    typeof value.project.profileId === "string" &&
    NEWS_CLIP_STEPS.some((step) => step.id === value.step) &&
    NEWS_CLIP_STEPS.some((step) => step.id === value.furthestStep)
  )
}
