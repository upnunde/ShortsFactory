import { NextResponse } from "next/server"

import { deleteOutfit, updateOutfit } from "@/lib/server/character"

export async function PATCH(
  request: Request,
  context: RouteContext<"/api/character/outfits/[id]">
) {
  const { id } = await context.params
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  const body = (await request.json()) as { name?: string; active?: boolean }
  return NextResponse.json(await updateOutfit(id, body, profileId))
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/character/outfits/[id]">
) {
  const { id } = await context.params
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  return NextResponse.json(await deleteOutfit(id, profileId))
}
