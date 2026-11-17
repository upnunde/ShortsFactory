import { NextResponse, type NextRequest } from "next/server"

import {
  AUTH_COOKIE_NAME,
  getAuthConfig,
  isValidSessionToken,
} from "./lib/auth"

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login"])

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const config = getAuthConfig()
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = config ? isValidSessionToken(token, config) : false

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/login" && isAuthenticated) {
      return NextResponse.redirect(new URL("/", request.url))
    }

    return NextResponse.next()
  }

  if (isAuthenticated) return NextResponse.next()

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { message: "로그인이 필요해." },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      }
    )
  }

  const loginUrl = new URL("/login", request.url)
  if (request.method === "GET" || request.method === "HEAD") {
    loginUrl.searchParams.set("next", `${pathname}${search}`)
  }

  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|fonts/).*)"],
}
