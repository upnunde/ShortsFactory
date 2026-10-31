import { randomUUID } from "node:crypto"
import { YOUTUBE_UPLOAD_SCOPES } from "@/lib/youtube-metadata"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export const ACCOUNT_PLATFORMS = ["youtube", "instagram", "tiktok"] as const

export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number]

export type AccountStatus = {
  hasApp: boolean
  connected: boolean
  accountName: string | null
}

type AppCredentials = {
  clientId: string
  clientSecret: string
}

type StoredToken = {
  accessToken: string
  refreshToken?: string
  accountName: string
  connectedAt: string
}

const credentialsDir = path.join(process.cwd(), "config", "credentials")

export function isAccountPlatform(value: string): value is AccountPlatform {
  return ACCOUNT_PLATFORMS.includes(value as AccountPlatform)
}

export function redirectUri(origin: string, platform: AccountPlatform) {
  return `${origin}/api/accounts/${platform}/callback`
}

export async function readAccountStatus(): Promise<Record<AccountPlatform, AccountStatus>> {
  const entries = await Promise.all(
    ACCOUNT_PLATFORMS.map(async (platform) => [platform, await statusFor(platform)] as const),
  )
  return Object.fromEntries(entries) as Record<AccountPlatform, AccountStatus>
}

export async function saveAppCredentials(platform: AccountPlatform, clientId: string, clientSecret: string) {
  await mkdir(credentialsDir, { recursive: true })
  await writeFile(appPath(platform), JSON.stringify({ clientId, clientSecret }), { mode: 0o600 })
}

export async function authorizationUrl(origin: string, platform: AccountPlatform, state: string) {
  const app = await readApp(platform)
  if (!app) {
    return null
  }
  const callback = redirectUri(origin, platform)
  if (platform === "youtube") {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
    url.searchParams.set("client_id", app.clientId)
    url.searchParams.set("redirect_uri", callback)
    url.searchParams.set("response_type", "code")
    url.searchParams.set("scope", YOUTUBE_UPLOAD_SCOPES.join(" "))
    url.searchParams.set("access_type", "offline")
    url.searchParams.set("prompt", "consent")
    url.searchParams.set("state", state)
    return url
  }
  if (platform === "instagram") {
    const url = new URL("https://www.facebook.com/v21.0/dialog/oauth")
    url.searchParams.set("client_id", app.clientId)
    url.searchParams.set("redirect_uri", callback)
    url.searchParams.set("response_type", "code")
    url.searchParams.set(
      "scope",
      "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement",
    )
    url.searchParams.set("state", state)
    return url
  }
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/")
  url.searchParams.set("client_key", app.clientId)
  url.searchParams.set("redirect_uri", callback)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", "user.info.basic,video.publish")
  url.searchParams.set("state", state)
  return url
}

export function createOauthState(platform: AccountPlatform) {
  return `${platform}.${randomUUID()}`
}

export async function finishOauth(origin: string, platform: AccountPlatform, code: string) {
  const app = await readApp(platform)
  if (!app) {
    throw new Error("missing app")
  }
  const callback = redirectUri(origin, platform)
  const token =
    platform === "youtube"
      ? await exchangeGoogle(app, callback, code)
      : platform === "instagram"
        ? await exchangeFacebook(app, callback, code)
        : await exchangeTikTok(app, callback, code)
  const accountName = await accountNameFor(platform, token.accessToken)
  const stored: StoredToken = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    accountName,
    connectedAt: new Date().toISOString(),
  }
  await mkdir(credentialsDir, { recursive: true })
  await writeFile(tokenPath(platform), JSON.stringify(stored), { mode: 0o600 })
}

export async function disconnectAccount(platform: AccountPlatform) {
  await rm(tokenPath(platform), { force: true })
}

function appPath(platform: AccountPlatform) {
  return path.join(credentialsDir, `${platform}.app.json`)
}

function tokenPath(platform: AccountPlatform) {
  return path.join(credentialsDir, `${platform}.token.json`)
}

async function statusFor(platform: AccountPlatform): Promise<AccountStatus> {
  const app = await readApp(platform)
  const token = await readToken(platform)
  return {
    hasApp: app !== null,
    connected: token !== null,
    accountName: token?.accountName ?? null,
  }
}

async function readApp(platform: AccountPlatform): Promise<AppCredentials | null> {
  return readJson<AppCredentials>(appPath(platform))
}

async function readToken(platform: AccountPlatform): Promise<StoredToken | null> {
  return readJson<StoredToken>(tokenPath(platform))
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function exchangeGoogle(app: AppCredentials, redirect: string, code: string) {
  const body = new URLSearchParams({
    code,
    client_id: app.clientId,
    client_secret: app.clientSecret,
    redirect_uri: redirect,
    grant_type: "authorization_code",
  })
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  const json = (await response.json()) as { access_token?: string; refresh_token?: string }
  if (!response.ok || !json.access_token) {
    throw new Error("google token")
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token }
}

async function exchangeFacebook(app: AppCredentials, redirect: string, code: string) {
  const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token")
  url.searchParams.set("client_id", app.clientId)
  url.searchParams.set("client_secret", app.clientSecret)
  url.searchParams.set("redirect_uri", redirect)
  url.searchParams.set("code", code)
  const response = await fetch(url)
  const json = (await response.json()) as { access_token?: string }
  if (!response.ok || !json.access_token) {
    throw new Error("facebook token")
  }
  return { accessToken: json.access_token, refreshToken: undefined }
}

async function exchangeTikTok(app: AppCredentials, redirect: string, code: string) {
  const body = new URLSearchParams({
    client_key: app.clientId,
    client_secret: app.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirect,
  })
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  const json = (await response.json()) as { access_token?: string; refresh_token?: string }
  if (!response.ok || !json.access_token) {
    throw new Error("tiktok token")
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token }
}

async function accountNameFor(platform: AccountPlatform, accessToken: string) {
  try {
    if (platform === "youtube") {
      const response = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      const json = (await response.json()) as { items?: { snippet?: { title?: string } }[] }
      return json.items?.[0]?.snippet?.title || "유튜브 채널"
    }
    if (platform === "instagram") {
      const response = await fetch("https://graph.facebook.com/v21.0/me?fields=name", {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const json = (await response.json()) as { name?: string }
      return json.name || "인스타그램 계정"
    }
    const response = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const json = (await response.json()) as { data?: { user?: { display_name?: string } } }
    return json.data?.user?.display_name || "틱톡 계정"
  } catch {
    return "연결된 계정"
  }
}
