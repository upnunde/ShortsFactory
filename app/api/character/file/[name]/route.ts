import { NextResponse } from "next/server"

import { readCharacterImage, removeCharacterImage } from "@/lib/server/character"

export async function GET(_request: Request, context: RouteContext<"/api/character/file/[name]">) {
  const { name } = await context.params
  const image = await readCharacterImage(name)
  if (!image) {
    return NextResponse.json({ error: "missing" }, { status: 404 })
  }
  return new NextResponse(Buffer.from(image.bytes), {
    headers: { "Content-Type": image.type, "Cache-Control": "no-store" },
  })
}

export async function DELETE(_request: Request, context: RouteContext<"/api/character/file/[name]">) {
  const { name } = await context.params
  await removeCharacterImage(name)
  return NextResponse.json({ ok: true })
}
