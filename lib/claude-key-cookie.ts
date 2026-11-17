import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto"

export const CLAUDE_KEY_COOKIE_NAME = "shorts_factory_claude_key"
export const CLAUDE_KEY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

const VERSION = "v1"
const AAD = Buffer.from(`${CLAUDE_KEY_COOKIE_NAME}:${VERSION}`)
const HKDF_SALT = Buffer.from("shortsfactory/credential/v1")
const HKDF_INFO = Buffer.from("claude-cookie")

type ClaudeKeyPayload = {
  version: 1
  apiKey: string
  username: string
  expiresAt: number
}

export function sealClaudeKey(
  apiKey: string,
  username: string,
  secret: string,
  now = Date.now()
) {
  if (
    !apiKey.startsWith("sk-ant-") ||
    apiKey.length > 512 ||
    !username ||
    username.length > 200 ||
    secret.length < 32
  ) {
    throw new Error("invalid-credential-cookie")
  }

  const payload: ClaudeKeyPayload = {
    version: 1,
    apiKey,
    username,
    expiresAt: now + CLAUDE_KEY_COOKIE_MAX_AGE_SECONDS * 1000,
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv)
  cipher.setAAD(AAD)
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

export function unsealClaudeKey(
  token: string | undefined,
  username: string,
  secret: string,
  now = Date.now()
) {
  if (!token || token.length > 2048 || !username || secret.length < 32) {
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

    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv)
    decipher.setAAD(AAD)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8")
    const payload = JSON.parse(plaintext) as Partial<ClaudeKeyPayload>

    if (
      payload.version !== 1 ||
      payload.username !== username ||
      typeof payload.apiKey !== "string" ||
      !payload.apiKey.startsWith("sk-ant-") ||
      payload.apiKey.length > 512 ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= now
    ) {
      return null
    }

    return payload.apiKey
  } catch {
    return null
  }
}

function deriveKey(secret: string) {
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret), HKDF_SALT, HKDF_INFO, 32)
  )
}
