import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto"

export const CREDENTIAL_COOKIE_NAMES = {
  claude: "shorts_factory_claude_key",
  higgsfield: "shorts_factory_higgsfield_key",
  azureSpeech: "shorts_factory_azure_speech_key",
  typecast: "shorts_factory_typecast_key",
  youtubeData: "shorts_factory_youtube_data_key",
} as const

export const CREDENTIAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export const ALL_CREDENTIAL_COOKIE_NAMES = Object.values(
  CREDENTIAL_COOKIE_NAMES
)

export type ProviderCredentialCookie = Exclude<
  keyof typeof CREDENTIAL_COOKIE_NAMES,
  "claude"
>

const VERSION = "v1"
const HKDF_SALT = Buffer.from("shortsfactory/credential/v1")
const MAX_VALUE_LENGTH = 1024

type CredentialPayload = {
  version: 1
  provider: ProviderCredentialCookie
  value: string
  username: string
  expiresAt: number
}

export function sealProviderCredential(
  provider: ProviderCredentialCookie,
  value: string,
  username: string,
  secret: string,
  maxAgeSeconds: number,
  now = Date.now()
) {
  if (
    !value ||
    value.length > MAX_VALUE_LENGTH ||
    !username ||
    username.length > 200 ||
    secret.length < 32 ||
    !Number.isSafeInteger(maxAgeSeconds) ||
    maxAgeSeconds <= 0
  ) {
    throw new Error("invalid-credential-cookie")
  }

  const payload: CredentialPayload = {
    version: 1,
    provider,
    value,
    username,
    expiresAt: now + maxAgeSeconds * 1000,
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", deriveKey(provider, secret), iv)
  cipher.setAAD(aad(provider))
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ])

  return [
    VERSION,
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".")
}

export function unsealProviderCredential(
  provider: ProviderCredentialCookie,
  token: string | undefined,
  username: string,
  secret: string,
  now = Date.now()
) {
  if (!token || token.length > 3072 || !username || secret.length < 32) {
    return null
  }

  try {
    const [version, encodedIv, encodedValue, encodedTag, extra] =
      token.split(".")
    if (
      version !== VERSION ||
      !encodedIv ||
      !encodedValue ||
      !encodedTag ||
      extra
    ) {
      return null
    }

    const iv = Buffer.from(encodedIv, "base64url")
    const encrypted = Buffer.from(encodedValue, "base64url")
    const tag = Buffer.from(encodedTag, "base64url")
    if (iv.length !== 12 || encrypted.length === 0 || tag.length !== 16) {
      return null
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(provider, secret),
      iv
    )
    decipher.setAAD(aad(provider))
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8")
    const payload = JSON.parse(plaintext) as Partial<CredentialPayload>

    if (
      payload.version !== 1 ||
      payload.provider !== provider ||
      payload.username !== username ||
      typeof payload.value !== "string" ||
      !payload.value ||
      payload.value.length > MAX_VALUE_LENGTH ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= now
    ) {
      return null
    }

    return payload.value
  } catch {
    return null
  }
}

function aad(provider: ProviderCredentialCookie) {
  return Buffer.from(`${CREDENTIAL_COOKIE_NAMES[provider]}:${VERSION}`)
}

function deriveKey(provider: ProviderCredentialCookie, secret: string) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret),
      HKDF_SALT,
      Buffer.from(`${provider}-cookie`),
      32
    )
  )
}
