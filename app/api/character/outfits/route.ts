import { NextResponse } from "next/server"

import { addOutfit } from "@/lib/server/character"

export async function POST(request: Request) {
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  return NextResponse.json(await addOutfit(profileId))
}
