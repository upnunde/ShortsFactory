import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { cookies } from "next/headers"

import {
  AUTH_COOKIE_NAME,
  getAuthConfig,
  isValidSessionToken,
} from "@/lib/auth"
import {
  CLAUDE_KEY_COOKIE_NAME,
  sealClaudeKey,
  unsealClaudeKey,
} from "@/lib/claude-key-cookie"
import {
  CREDENTIAL_COOKIE_MAX_AGE_SECONDS,
  CREDENTIAL_COOKIE_NAMES,
  sealProviderCredential,
  unsealProviderCredential,
  type ProviderCredentialCookie,
} from "@/lib/credential-cookie"

const dir = path.join(process.cwd(), "config", "credentials")
const claudePath = path.join(dir, "anthropic.json")
const higgsfieldPath = path.join(dir, "higgsfield.json")
const azureSpeechPath = path.join(dir, "azure-speech.json")
const typecastPath = path.join(dir, "typecast.json")
const youtubeDataPath = path.join(dir, "youtube-data.json")

export type CredentialStatus = {
  claude: { saved: boolean }
  higgsfield: { saved: boolean }
  azureSpeech: { saved: boolean }
  typecast: { saved: boolean }
  youtubeData: { saved: boolean }
}

export type SavedCredentialCookie = {
  name: string
  value: string
}

type CredentialCookieContext = {
  cookieStore: Awaited<ReturnType<typeof cookies>>
  username: string
  secret: string
}

export async function credentialStatus(): Promise<CredentialStatus> {
  const cookieContext = await readCredentialCookieContext()
  const [claude, higgsfield, azureSpeech, typecast, youtubeData] =
    await Promise.all([
      readClaudeKey(cookieContext),
      readHiggsfield(cookieContext),
      readAzureSpeech(cookieContext),
      readTypecastKey(cookieContext),
      readYouTubeDataKey(cookieContext),
    ])
  return {
    claude: { saved: claude !== null },
    higgsfield: { saved: higgsfield !== null },
    azureSpeech: { saved: azureSpeech !== null },
    typecast: { saved: typecast !== null },
    youtubeData: { saved: youtubeData !== null },
  }
}

export async function readClaudeKey(context?: CredentialCookieContext | null) {
  const cookieContext =
    context === undefined ? await readCredentialCookieContext() : context
  const cookieKey = readClaudeKeyCookie(cookieContext)
  if (cookieKey) return cookieKey

  try {
    const parsed = JSON.parse(await readFile(claudePath, "utf8")) as {
      apiKey?: string
    }
    const apiKey = parsed.apiKey?.trim() ?? ""
    if (apiKey) return apiKey
  } catch {
    // Fall through to the environment variable for existing installations.
  }
  return process.env.ANTHROPIC_API_KEY?.trim() || null
}

export async function readHiggsfield(context?: CredentialCookieContext | null) {
  const cookieContext =
    context === undefined ? await readCredentialCookieContext() : context
  const cookieKey = readProviderCredentialCookie("higgsfield", cookieContext)
  if (cookieKey) return cookieKey

  try {
    const parsed = JSON.parse(await readFile(higgsfieldPath, "utf8")) as {
      apiKey?: string
      keyId?: string
      keySecret?: string
    }
    const apiKey = parsed.apiKey?.trim() ?? ""
    if (apiKey) {
      return apiKey
    }
    const keyId = parsed.keyId?.trim() ?? ""
    const keySecret = parsed.keySecret?.trim() ?? ""
    if (keyId && keySecret) {
      return `${keyId}:${keySecret}`
    }
  } catch {
    // Fall through to the environment variable for portable/Vercel installs.
  }
  return process.env.HIGGSFIELD_API_KEY?.trim() || null
}

export async function readAzureSpeech(
  context?: CredentialCookieContext | null
) {
  const cookieContext =
    context === undefined ? await readCredentialCookieContext() : context
  const cookieValue = readProviderCredentialCookie("azureSpeech", cookieContext)
  if (cookieValue) {
    try {
      const parsed = JSON.parse(cookieValue) as {
        apiKey?: string
        region?: string
      }
      const apiKey = parsed.apiKey?.trim() ?? ""
      const region = parsed.region?.trim().toLowerCase() ?? ""
      if (apiKey && validAzureRegion(region)) return { apiKey, region }
    } catch {
      // Fall through to local files and environment variables.
    }
  }

  try {
    const parsed = JSON.parse(await readFile(azureSpeechPath, "utf8")) as {
      apiKey?: string
      region?: string
    }
    const apiKey = parsed.apiKey?.trim() ?? ""
    const region = parsed.region?.trim().toLowerCase() ?? ""
    if (apiKey && validAzureRegion(region)) return { apiKey, region }
  } catch {
    // Fall through to environment variables for existing installations.
  }
  const apiKey = process.env.AZURE_SPEECH_KEY?.trim() ?? ""
  const region = process.env.AZURE_SPEECH_REGION?.trim().toLowerCase() ?? ""
  return apiKey && validAzureRegion(region) ? { apiKey, region } : null
}

export async function readYouTubeDataKey(
  context?: CredentialCookieContext | null
) {
  const cookieContext =
    context === undefined ? await readCredentialCookieContext() : context
  const cookieKey = readProviderCredentialCookie("youtubeData", cookieContext)
  if (cookieKey) return cookieKey

  try {
    const parsed = JSON.parse(await readFile(youtubeDataPath, "utf8")) as {
      apiKey?: string
    }
    const apiKey = parsed.apiKey?.trim() ?? ""
    if (apiKey) return apiKey
  } catch {
    // Fall through to the environment variable for existing installations.
  }
  return process.env.YOUTUBE_DATA_API_KEY?.trim() || null
}

export async function readTypecastKey(
  context?: CredentialCookieContext | null
) {
  const cookieContext =
    context === undefined ? await readCredentialCookieContext() : context
  const cookieKey = readProviderCredentialCookie("typecast", cookieContext)
  if (cookieKey) return cookieKey

  try {
    const parsed = JSON.parse(await readFile(typecastPath, "utf8")) as {
      apiKey?: string
    }
    const apiKey = parsed.apiKey?.trim() ?? ""
    if (apiKey) return apiKey
  } catch {
    // Fall through to the environment variable for existing installations.
  }
  return process.env.TYPECAST_API_KEY?.trim() || null
}

export async function saveClaudeKey(apiKey: string) {
  const key = apiKey.trim()
  if (!key.startsWith("sk-ant-") || key.length > 512) {
    throw new Error("invalid")
  }
  if (!(await claudeKeyWorks(key))) {
    throw new Error("invalid")
  }

  if (process.env.VERCEL === "1") {
    const config = getAuthConfig()
    const secret = process.env.APP_CREDENTIALS_SECRET ?? ""
    if (!config || secret.length < 32) throw new Error("config")
    return {
      name: CLAUDE_KEY_COOKIE_NAME,
      value: sealClaudeKey(key, config.username, secret),
    } satisfies SavedCredentialCookie
  }

  await writeSecret(claudePath, { apiKey: key })
  return null
}

export async function saveHiggsfieldKey(apiKey: string) {
  const key = apiKey.trim()
  if (!key || key.length > 512) {
    throw new Error("invalid")
  }
  if (!(await higgsfieldKeyWorks(key))) {
    throw new Error("invalid")
  }
  const cookie = createProviderCredentialCookie("higgsfield", key)
  if (cookie) return cookie

  await writeSecret(higgsfieldPath, { apiKey: key })
  return null
}

export async function saveAzureSpeech(apiKey: string, region: string) {
  const key = apiKey.trim()
  const normalizedRegion = region.trim().toLowerCase()
  if (!key || key.length > 256 || !validAzureRegion(normalizedRegion)) {
    throw new Error("invalid")
  }
  if (!(await azureSpeechWorks(key, normalizedRegion))) {
    throw new Error("invalid")
  }
  const cookie = createProviderCredentialCookie(
    "azureSpeech",
    JSON.stringify({ apiKey: key, region: normalizedRegion })
  )
  if (cookie) return cookie

  await writeSecret(azureSpeechPath, {
    apiKey: key,
    region: normalizedRegion,
  })
  return null
}

export async function saveYouTubeDataKey(apiKey: string) {
  const key = apiKey.trim()
  if (!key || key.length > 128 || !(await youtubeDataKeyWorks(key))) {
    throw new Error("invalid")
  }
  const cookie = createProviderCredentialCookie("youtubeData", key)
  if (cookie) return cookie

  await writeSecret(youtubeDataPath, { apiKey: key })
  return null
}

export async function saveTypecastKey(apiKey: string) {
  const key = apiKey.trim()
  if (!key || key.length > 512 || !(await typecastKeyWorks(key))) {
    throw new Error("invalid")
  }
  const cookie = createProviderCredentialCookie("typecast", key)
  if (cookie) return cookie

  await writeSecret(typecastPath, { apiKey: key })
  return null
}

async function claudeKeyWorks(apiKey: string) {
  const response = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  })
  await response.arrayBuffer()
  if (response.status === 200) {
    return true
  }
  if (
    response.status === 401 ||
    response.status === 403 ||
    response.status === 404
  ) {
    return false
  }
  throw new Error("check-failed")
}

async function higgsfieldKeyWorks(apiKey: string) {
  const response = await fetch(
    "https://api.higgsfield.ai/requests/00000000-0000-0000-0000-000000000000/status",
    { headers: { Authorization: `Key ${apiKey}` } }
  )
  await response.arrayBuffer()
  if (response.status === 401 || response.status === 403) {
    return false
  }
  if (response.status >= 500) {
    throw new Error("check-failed")
  }
  return true
}

async function azureSpeechWorks(apiKey: string, region: string) {
  const response = await fetch(
    `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
    }
  )
  await response.arrayBuffer()
  if (response.status === 200) return true
  if (response.status === 401 || response.status === 403) return false
  throw new Error("check-failed")
}

async function youtubeDataKeyWorks(apiKey: string) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos")
  url.search = new URLSearchParams({
    part: "id",
    id: "dQw4w9WgXcQ",
    key: apiKey,
  }).toString()
  const response = await fetch(url, { cache: "no-store" })
  await response.arrayBuffer()
  if (response.status === 200) return true
  if (
    response.status === 400 ||
    response.status === 401 ||
    response.status === 403
  )
    return false
  throw new Error("check-failed")
}

async function typecastKeyWorks(apiKey: string) {
  const response = await fetch(
    "https://api.typecast.ai/v1/users/me/subscription",
    {
      headers: {
        "X-API-KEY": apiKey,
        "User-Agent": "ShortsFactory/1.0",
      },
      cache: "no-store",
    }
  )
  await response.arrayBuffer()
  if (response.status === 200) return true
  if (response.status === 401 || response.status === 403) return false
  throw new Error("check-failed")
}

function validAzureRegion(value: string) {
  return /^[a-z0-9-]{2,32}$/.test(value)
}

async function writeSecret(filePath: string, value: unknown) {
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  })
}

function readClaudeKeyCookie(context: CredentialCookieContext | null) {
  if (!context) return null
  const token = context.cookieStore.get(CLAUDE_KEY_COOKIE_NAME)?.value
  return unsealClaudeKey(token, context.username, context.secret)
}

function readProviderCredentialCookie(
  provider: ProviderCredentialCookie,
  context: CredentialCookieContext | null
) {
  if (!context) return null
  const token = context.cookieStore.get(
    CREDENTIAL_COOKIE_NAMES[provider]
  )?.value
  return unsealProviderCredential(
    provider,
    token,
    context.username,
    context.secret
  )
}

async function readCredentialCookieContext(): Promise<CredentialCookieContext | null> {
  const config = getAuthConfig()
  const secret = process.env.APP_CREDENTIALS_SECRET ?? ""
  if (!config || secret.length < 32) return null

  try {
    const cookieStore = await cookies()
    const sessionToken = cookieStore.get(AUTH_COOKIE_NAME)?.value
    if (!isValidSessionToken(sessionToken, config)) return null
    return { cookieStore, username: config.username, secret }
  } catch {
    return null
  }
}

function createProviderCredentialCookie(
  provider: ProviderCredentialCookie,
  value: string
): SavedCredentialCookie | null {
  if (process.env.VERCEL !== "1") return null

  const config = getAuthConfig()
  const secret = process.env.APP_CREDENTIALS_SECRET ?? ""
  if (!config || secret.length < 32) throw new Error("config")

  return {
    name: CREDENTIAL_COOKIE_NAMES[provider],
    value: sealProviderCredential(
      provider,
      value,
      config.username,
      secret,
      CREDENTIAL_COOKIE_MAX_AGE_SECONDS
    ),
  }
}
