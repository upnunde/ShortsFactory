import { NextResponse, type NextRequest } from "next/server"

import {
  authorizationUrl,
  createOauthState,
  isAccountPlatform,
} from "@/lib/server/accounts"

export async function GET(request: NextRequest, context: RouteContext<"/api/accounts/[platform]/start">) {
  const { platform: raw } = await context.params
  if (!isAccountPlatform(raw)) {
    return NextResponse.json({ error: "unknown platform" }, { status: 404 })
  }
  const origin = request.nextUrl.origin
  const state = createOauthState(raw)
  const url = await authorizationUrl(origin, raw, state)
  if (!url) {
    return NextResponse.redirect(new URL(`/?view=settings&tab=accounts&setup=${raw}`, origin))
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
