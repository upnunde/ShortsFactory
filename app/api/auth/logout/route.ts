import { NextResponse, type NextRequest } from "next/server"

import { AUTH_COOKIE_NAME } from "../../../../lib/auth"
import { CLAUDE_KEY_COOKIE_NAME } from "../../../../lib/claude-key-cookie"

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303)
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  })
  response.cookies.set(CLAUDE_KEY_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/api",
  })
  response.headers.set("Cache-Control", "no-store")

  return response
}
