import { randomUUID } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { YOUTUBE_UPLOAD_SCOPES } from "../youtube-metadata.ts"

export const ACCOUNT_PLATFORMS = ["youtube", "instagram", "tiktok"] as const

export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number]

export type AccountStatus = {
  hasApp: boolean
  connected: boolean
  accountId: string | null
  accountName: string | null
  avatarUrl: string | null
}

type AppCredentials = {
  clientId: string
  clientSecret: string
}

type StoredToken = {
  accessToken: string
  refreshToken?: string
  accountId?: string
  accountName: string
  avatarUrl?: string
  connectedAt: string
}

const credentialsDir = path.join(process.cwd(), "config", "credentials")

export function isAccountPlatform(value: string): value is AccountPlatform {
  return ACCOUNT_PLATFORMS.includes(value as AccountPlatform)
}

export function redirectUri(origin: string, platform: AccountPlatform) {
  return `${origin}/api/accounts/${platform}/callback`
}

export async function readAccountStatus(): Promise<
  Record<AccountPlatform, AccountStatus>
> {
  const entries = await Promise.all(
    ACCOUNT_PLATFORMS.map(
      async (platform) =>
        [platform, await statusFor(platform, "default")] as const
    )
  )
  return Object.fromEntries(entries) as Record<AccountPlatform, AccountStatus>
}

export async function readChannelAccountStatus(
  profileId: string
): Promise<Record<AccountPlatform, AccountStatus>> {
  const entries = await Promise.all(
    ACCOUNT_PLATFORMS.map(
      async (platform) =>
        [platform, await statusFor(platform, profileId)] as const
    )
  )
  return Object.fromEntries(entries) as Record<AccountPlatform, AccountStatus>
}

export async function saveAppCredentials(
  platform: AccountPlatform,
  clientId: string,
  clientSecret: string,
  profileId = "default"
) {
  await mkdir(credentialsDir, { recursive: true })
  await writeFile(
    appPath(platform, profileId),
    JSON.stringify({ clientId, clientSecret }),
    { mode: 0o600 }
  )
}

export async function authorizationUrl(
  origin: string,
  platform: AccountPlatform,
  state: string,
  profileId = "default"
) {
  const app = await readApp(platform, profileId)
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
      "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement"
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

export function createOauthState(platform: AccountPlatform, profileId: string) {
  const id = safeProfileId(profileId)
  return `${platform}.${id}.${randomUUID()}`
}

export async function finishOauth(
  origin: string,
  platform: AccountPlatform,
  code: string,
  profileId = "default",
  expectedAccountId = ""
) {
  const app = await readApp(platform, profileId)
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
  const identity = await accountIdentityFor(platform, token.accessToken)
  if (
    platform === "youtube" &&
    expectedAccountId &&
    identity.id !== expectedAccountId
  ) {
    throw new Error("youtube-channel-mismatch")
  }
  const stored: StoredToken = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    accountId: identity.id,
    accountName: identity.name,
    avatarUrl: identity.avatarUrl,
    connectedAt: new Date().toISOString(),
  }
  await mkdir(credentialsDir, { recursive: true })
  await writeFile(tokenPath(platform, profileId), JSON.stringify(stored), {
    mode: 0o600,
  })
}

export async function disconnectAccount(
  platform: AccountPlatform,
  profileId = "default"
) {
  await rm(tokenPath(platform, profileId), { force: true })
}

export async function youtubeAccessToken(profileId = "default") {
  const app = await readApp("youtube", profileId)
  const token = await readToken("youtube", profileId)
  if (!app || !token) {
    throw new Error("youtube-not-connected")
  }
  if (!token.refreshToken) {
    return token.accessToken
  }
  const body = new URLSearchParams({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    refresh_token: token.refreshToken,
    grant_type: "refresh_token",
  })
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  const json = (await response.json()) as { access_token?: string }
  if (!response.ok || !json.access_token) {
    throw new Error("youtube-refresh-failed")
  }
  const refreshed = { ...token, accessToken: json.access_token }
  // Vercel은 로컬 파일을 유지하지 않으므로 환경변수 토큰은 메모리만 갱신한다.
  if (!tokenFromEnv("youtube", profileId)) {
    try {
      await writeFile(
        tokenPath("youtube", profileId),
        JSON.stringify(refreshed),
        { mode: 0o600 }
      )
    } catch {
      // 읽기 전용/일시 파일시스템에서도 새 access token은 반환한다.
    }
  }
  return refreshed.accessToken
}

function appPath(platform: AccountPlatform, profileId: string) {
  const prefix = safeProfileId(profileId)
  return path.join(
    credentialsDir,
    prefix === "default"
      ? `${platform}.app.json`
      : `${prefix}.${platform}.app.json`
  )
}

function tokenPath(platform: AccountPlatform, profileId: string) {
  const prefix = safeProfileId(profileId)
  return path.join(
    credentialsDir,
    prefix === "default"
      ? `${platform}.token.json`
      : `${prefix}.${platform}.token.json`
  )
}

async function statusFor(
  platform: AccountPlatform,
  profileId: string
): Promise<AccountStatus> {
  const app = await readApp(platform, profileId)
  const token = await readToken(platform, profileId)
  return {
    hasApp: app !== null,
    connected: token !== null,
    accountId: token?.accountId ?? null,
    accountName: token?.accountName ?? null,
    avatarUrl: token?.avatarUrl ?? null,
  }
}

async function readApp(
  platform: AccountPlatform,
  profileId: string
): Promise<AppCredentials | null> {
  const fromFile = await readJson<AppCredentials>(appPath(platform, profileId))
  if (fromFile?.clientId && fromFile?.clientSecret) return fromFile
  return appFromEnv(platform, profileId)
}

async function readToken(
  platform: AccountPlatform,
  profileId: string
): Promise<StoredToken | null> {
  const fromFile = await readJson<StoredToken>(tokenPath(platform, profileId))
  if (fromFile?.accessToken || fromFile?.refreshToken) return fromFile
  return tokenFromEnv(platform, profileId)
}

/** Vercel 등 파일 저장이 없는 환경에서 YouTube 업로드 연결을 유지한다. */
function appFromEnv(
  platform: AccountPlatform,
  profileId: string
): AppCredentials | null {
  if (platform !== "youtube" || !envProfileMatches(profileId)) return null
  const clientId = process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim() ?? ""
  const clientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim() ?? ""
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function tokenFromEnv(
  platform: AccountPlatform,
  profileId: string
): StoredToken | null {
  if (platform !== "youtube" || !envProfileMatches(profileId)) return null
  const refreshToken = process.env.YOUTUBE_OAUTH_REFRESH_TOKEN?.trim() ?? ""
  const accessToken = process.env.YOUTUBE_OAUTH_ACCESS_TOKEN?.trim() ?? ""
  if (!refreshToken && !accessToken) return null
  const accountId = process.env.YOUTUBE_OAUTH_CHANNEL_ID?.trim() ?? ""
  const accountName =
    process.env.YOUTUBE_OAUTH_CHANNEL_NAME?.trim() || "YouTube"
  return {
    accessToken: accessToken || "env-pending-refresh",
    ...(refreshToken ? { refreshToken } : {}),
    ...(accountId ? { accountId } : {}),
    accountName,
    connectedAt:
      process.env.YOUTUBE_OAUTH_CONNECTED_AT?.trim() ||
      new Date(0).toISOString(),
  }
}

function envProfileMatches(profileId: string) {
  const configured = process.env.YOUTUBE_OAUTH_PROFILE_ID?.trim()
  if (!configured) return true
  return configured === safeProfileId(profileId)
}

function safeProfileId(value: string) {
  return /^[a-z0-9-]{1,64}$/.test(value) ? value : "default"
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8")
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function exchangeGoogle(
  app: AppCredentials,
  redirect: string,
  code: string
) {
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
  const json = (await response.json()) as {
    access_token?: string
    refresh_token?: string
  }
  if (!response.ok || !json.access_token) {
    throw new Error("google token")
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token }
}

async function exchangeFacebook(
  app: AppCredentials,
  redirect: string,
  code: string
) {
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

async function exchangeTikTok(
  app: AppCredentials,
  redirect: string,
  code: string
) {
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
  const json = (await response.json()) as {
    access_token?: string
    refresh_token?: string
  }
  if (!response.ok || !json.access_token) {
    throw new Error("tiktok token")
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token }
}

async function accountIdentityFor(
  platform: AccountPlatform,
  accessToken: string
) {
  try {
    if (platform === "youtube") {
      const response = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      const json = (await response.json()) as {
        items?: {
          id?: string
          snippet?: {
            title?: string
            thumbnails?: Record<string, { url?: string }>
          }
        }[]
      }
      const channel = json.items?.[0]
      const snippet = channel?.snippet
      return {
        id: channel?.id || "",
        name: snippet?.title || "유튜브 채널",
        avatarUrl:
          snippet?.thumbnails?.high?.url ||
          snippet?.thumbnails?.medium?.url ||
          snippet?.thumbnails?.default?.url ||
          "",
      }
    }
    if (platform === "instagram") {
      const response = await fetch(
        "https://graph.facebook.com/v21.0/me?fields=name",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )
      const json = (await response.json()) as { name?: string }
      return {
        id: "",
        name: json.name || "인스타그램 계정",
        avatarUrl: "",
      }
    }
    const response = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=display_name",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )
    const json = (await response.json()) as {
      data?: { user?: { display_name?: string } }
    }
    return {
      id: "",
      name: json.data?.user?.display_name || "틱톡 계정",
      avatarUrl: "",
    }
  } catch {
    return { id: "", name: "연결된 계정", avatarUrl: "" }
  }
}
