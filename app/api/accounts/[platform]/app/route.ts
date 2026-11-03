import { NextResponse, type NextRequest } from "next/server"

import { isAccountPlatform, saveAppCredentials } from "@/lib/server/accounts"

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/accounts/[platform]/app">
) {
  const { platform: raw } = await context.params
  if (!isAccountPlatform(raw)) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 })
  }
  const body = (await request.json()) as {
    clientId?: string
    clientSecret?: string
  }
  const clientId = body.clientId?.trim() ?? ""
  const clientSecret = body.clientSecret?.trim() ?? ""
  const profileId = request.nextUrl.searchParams.get("profileId") ?? "default"
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "missing" }, { status: 400 })
  }
  await saveAppCredentials(raw, clientId, clientSecret, profileId)
  return NextResponse.json({ ok: true })
}
