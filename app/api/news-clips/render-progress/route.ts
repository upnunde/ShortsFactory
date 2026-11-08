import { NextResponse } from "next/server"

import {
  readNewsRenderProgress,
  removeNewsRenderProgress,
  validRenderJobId,
} from "@/lib/server/news-clips/render-progress"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId")
  if (!validRenderJobId(jobId)) {
    return NextResponse.json({ percent: 0 }, { status: 400 })
  }
  const progress = await readNewsRenderProgress(jobId)
  return NextResponse.json(progress ?? { percent: 0 }, {
    headers: { "Cache-Control": "no-store" },
  })
}

export async function DELETE(request: Request) {
  const jobId = new URL(request.url).searchParams.get("jobId")
  if (!validRenderJobId(jobId)) {
    return NextResponse.json({}, { status: 400 })
  }
  await removeNewsRenderProgress(jobId)
  return NextResponse.json({})
}
