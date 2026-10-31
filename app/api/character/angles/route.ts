import { NextResponse } from "next/server"

import { generateOutfitAngles } from "@/lib/server/draw-angles"

export async function POST(request: Request) {
  const outfitId = new URL(request.url).searchParams.get("outfitId")
  if (!outfitId) {
    return NextResponse.json({ error: "no-outfit" }, { status: 400 })
  }
  try {
    return NextResponse.json(await generateOutfitAngles(outfitId))
  } catch (error) {
    const code = error instanceof Error ? error.message : "draw-failed"
    const status = code === "no-front" || code === "missing" ? 400 : 500
    return NextResponse.json({ error: code }, { status })
  }
}
