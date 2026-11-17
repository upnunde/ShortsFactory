import { NextResponse, type NextRequest } from "next/server"

import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  credentialsMatch,
  getAuthConfig,
  sanitizeReturnTo,
} from "../../../../lib/auth"

export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const username = String(formData.get("username") ?? "").slice(0, 200)
  const password = String(formData.get("password") ?? "").slice(0, 500)
  const returnTo = sanitizeReturnTo(String(formData.get("returnTo") ?? "/"))
  const config = getAuthConfig()

  if (!config) {
    return redirectToLogin(request, "config", returnTo)
  }

  if (!credentialsMatch(config, username, password)) {
    return redirectToLogin(request, "invalid", returnTo)
  }

  const response = NextResponse.redirect(new URL(returnTo, request.url), 303)
  response.cookies.set(AUTH_COOKIE_NAME, createSessionToken(config), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    path: "/",
  })
  response.headers.set("Cache-Control", "no-store")

  return response
}

function redirectToLogin(
  request: NextRequest,
  error: "config" | "invalid",
  returnTo: string
) {
  const url = new URL("/login", request.url)
  url.searchParams.set("error", error)
  if (returnTo !== "/") url.searchParams.set("next", returnTo)

  return NextResponse.redirect(url, 303)
}
