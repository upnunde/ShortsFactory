import { NextResponse } from "next/server"

import { disconnectAccount, isAccountPlatform } from "@/lib/server/accounts"

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/accounts/[platform]">
) {
  const { platform: raw } = await context.params
  if (!isAccountPlatform(raw)) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 })
  }
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  await disconnectAccount(raw, profileId)
  return NextResponse.json({ ok: true })
}
