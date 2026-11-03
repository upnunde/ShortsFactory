import { NextResponse } from "next/server"

import { getCharacterLibrary, saveFrontImage } from "@/lib/server/character"

export async function GET(request: Request) {
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  return NextResponse.json(await getCharacterLibrary(profileId))
}

export async function POST(request: Request) {
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  const form = await request.formData()
  const outfitId = form.get("outfitId")
  const file = form.get("front")
  if (
    typeof outfitId !== "string" ||
    !(file instanceof File) ||
    file.size === 0
  ) {
    return NextResponse.json({ error: "no-front" }, { status: 400 })
  }
  try {
    return NextResponse.json(
      await saveFrontImage(
        outfitId,
        {
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        },
        profileId
      )
    )
  } catch {
    return NextResponse.json({ error: "unsupported" }, { status: 400 })
  }
}
