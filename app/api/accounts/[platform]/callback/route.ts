import { NextResponse, type NextRequest } from "next/server"

import { finishOauth, isAccountPlatform } from "@/lib/server/accounts"

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/accounts/[platform]/callback">
) {
  const { platform: raw } = await context.params
  const origin = request.nextUrl.origin
  const state = request.nextUrl.searchParams.get("state")
  const profileId = state?.split(".")[1] || "default"
  const returnTo =
    request.cookies.get("oauth_return_to")?.value === "news"
      ? "news"
      : "character"
  const expectedAccountId =
    request.cookies.get("oauth_expected_account")?.value ?? ""
  const back = (query: string) =>
    NextResponse.redirect(
      new URL(
        `${returnTo === "news" ? "/studio/news-clips" : "/studio/character"}?channel=${encodeURIComponent(profileId)}&view=settings&tab=accounts&${query}`,
        origin
      )
    )
  if (!isAccountPlatform(raw)) {
    return back("error=unknown")
  }
  const saved = request.cookies.get("oauth_state")?.value
  if (!state || state !== saved || !state.startsWith(`${raw}.`)) {
    return back(`error=state&platform=${raw}`)
  }
  const code = request.nextUrl.searchParams.get("code")
  if (!code) {
    return back(`error=denied&platform=${raw}`)
  }
  try {
    await finishOauth(origin, raw, code, profileId, expectedAccountId)
  } catch (error) {
    return back(
      `error=${error instanceof Error && error.message === "youtube-channel-mismatch" ? "channel" : "token"}&platform=${raw}`
    )
  }
  const response = back(`connected=${raw}`)
  response.cookies.delete("oauth_state")
  response.cookies.delete("oauth_return_to")
  response.cookies.delete("oauth_expected_account")
  return response
}
