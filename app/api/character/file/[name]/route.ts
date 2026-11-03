import { NextResponse } from "next/server"

import {
  readCharacterImage,
  removeCharacterImage,
} from "@/lib/server/character"

export async function GET(
  request: Request,
  context: RouteContext<"/api/character/file/[name]">
) {
  const { name } = await context.params
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  const image = await readCharacterImage(name, profileId)
  if (!image) {
    return NextResponse.json({ error: "missing" }, { status: 404 })
  }
  return new NextResponse(Buffer.from(image.bytes), {
    headers: { "Content-Type": image.type, "Cache-Control": "no-store" },
  })
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/character/file/[name]">
) {
  const { name } = await context.params
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  await removeCharacterImage(name, profileId)
  return NextResponse.json({ ok: true })
}
