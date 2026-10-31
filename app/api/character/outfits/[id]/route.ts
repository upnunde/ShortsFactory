import { NextResponse } from "next/server"

import { deleteOutfit, updateOutfit } from "@/lib/server/character"

export async function PATCH(request: Request, context: RouteContext<"/api/character/outfits/[id]">) {
  const { id } = await context.params
  const body = (await request.json()) as { name?: string; active?: boolean }
  return NextResponse.json(await updateOutfit(id, body))
}

export async function DELETE(_request: Request, context: RouteContext<"/api/character/outfits/[id]">) {
  const { id } = await context.params
  return NextResponse.json(await deleteOutfit(id))
}
