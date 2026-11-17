import { NextResponse, type NextRequest } from "next/server"

import { AUTH_COOKIE_NAME } from "../../../../lib/auth"

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303)
  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  })
  response.headers.set("Cache-Control", "no-store")

  return response
}
