import { NextResponse, type NextRequest } from "next/server"

import { finishOauth, isAccountPlatform } from "@/lib/server/accounts"

export async function GET(request: NextRequest, context: RouteContext<"/api/accounts/[platform]/callback">) {
  const { platform: raw } = await context.params
  const origin = request.nextUrl.origin
  const back = (query: string) => NextResponse.redirect(new URL(`/?view=settings&tab=accounts&${query}`, origin))
  if (!isAccountPlatform(raw)) {
    return back("error=unknown")
  }
  const state = request.nextUrl.searchParams.get("state")
  const saved = request.cookies.get("oauth_state")?.value
  if (!state || state !== saved || !state.startsWith(`${raw}.`)) {
    return back(`error=state&platform=${raw}`)
  }
  const code = request.nextUrl.searchParams.get("code")
  if (!code) {
    return back(`error=denied&platform=${raw}`)
  }
  try {
    await finishOauth(origin, raw, code)
  } catch {
    return back(`error=token&platform=${raw}`)
  }
  const response = back(`connected=${raw}`)
  response.cookies.delete("oauth_state")
  return response
}
