import { NextResponse, type NextRequest } from "next/server"

import {
  authorizationUrl,
  createOauthState,
  isAccountPlatform,
} from "@/lib/server/accounts"

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/accounts/[platform]/start">
) {
  const { platform: raw } = await context.params
  if (!isAccountPlatform(raw)) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 })
  }
  const origin = request.nextUrl.origin
  const profileId = request.nextUrl.searchParams.get("profileId") ?? "default"
  const state = createOauthState(raw, profileId)
  const url = await authorizationUrl(origin, raw, state, profileId)
  if (!url) {
    return NextResponse.redirect(
      new URL(
        `/?channel=${encodeURIComponent(profileId)}&view=settings&tab=accounts&setup=${raw}`,
        origin
      )
    )
  }
  const response = NextResponse.redirect(url)
  response.cookies.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  })
  return response
}
