import { NextResponse, type NextRequest } from "next/server"

import { AUTH_COOKIE_NAME } from "../../../../lib/auth"
import { ALL_CREDENTIAL_COOKIE_NAMES } from "../../../../lib/credential-cookie"

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303)
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  })
  for (const cookieName of ALL_CREDENTIAL_COOKIE_NAMES) {
    response.cookies.set(cookieName, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 0,
      path: "/api",
    })
  }
  response.headers.set("Cache-Control", "no-store")

  return response
}
