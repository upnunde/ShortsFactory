import { createHash, createHmac, timingSafeEqual } from "node:crypto"

export const AUTH_COOKIE_NAME = "shorts_factory_session"
export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export type AuthConfig = {
  username: string
  password: string
  secret: string
}

type SessionPayload = {
  username: string
  expiresAt: number
}

export function getAuthConfig(): AuthConfig | null {
  const username = process.env.APP_LOGIN_ID?.trim()
  const password = process.env.APP_LOGIN_PASSWORD
  const secret = process.env.APP_SESSION_SECRET

  if (!username || !password || !secret) return null

  return { username, password, secret }
}

export function credentialsMatch(
  config: AuthConfig,
  username: string,
  password: string
) {
  const usernameMatches = safeEqual(username.trim(), config.username)
  const passwordMatches = safeEqual(password, config.password)

  return usernameMatches && passwordMatches
}

export function createSessionToken(
  config: AuthConfig,
  now = Date.now()
): string {
  const payload: SessionPayload = {
    username: config.username,
    expiresAt: now + AUTH_SESSION_MAX_AGE_SECONDS * 1000,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  )

  return `${encodedPayload}.${sign(encodedPayload, config.secret)}`
}

export function isValidSessionToken(
  token: string | undefined,
  config: AuthConfig,
  now = Date.now()
) {
  if (!token) return false

  const [encodedPayload, signature, extra] = token.split(".")
  if (!encodedPayload || !signature || extra) return false
  if (!safeEqual(signature, sign(encodedPayload, config.secret))) return false

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as Partial<SessionPayload>

    return (
      payload.username === config.username &&
      typeof payload.expiresAt === "number" &&
      payload.expiresAt > now
    )
  } catch {
    return false
  }
}

export function sanitizeReturnTo(value: string | null | undefined) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/"

  try {
    const base = new URL("https://shorts-factory.local")
    const target = new URL(value, base)
    if (target.origin !== base.origin) return "/"

    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return "/"
  }
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url")
}

function safeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest()
  const rightDigest = createHash("sha256").update(right).digest()

  return timingSafeEqual(leftDigest, rightDigest)
}
