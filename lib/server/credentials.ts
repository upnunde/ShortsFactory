import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

const dir = path.join(process.cwd(), "config", "credentials")
const claudePath = path.join(dir, "anthropic.json")
const higgsfieldPath = path.join(dir, "higgsfield.json")

export async function credentialStatus() {
  return {
    claude: { saved: (await readClaudeKey()) !== null },
    higgsfield: { saved: (await readHiggsfield()) !== null },
  }
}

export async function readClaudeKey() {
  try {
    const parsed = JSON.parse(await readFile(claudePath, "utf8")) as { apiKey?: string }
    const apiKey = parsed.apiKey?.trim() ?? ""
    return apiKey || null
  } catch {
    return null
  }
}

export async function readHiggsfield() {
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
    return null
  } catch {
    return null
  }
}

export async function saveClaudeKey(apiKey: string) {
  const key = apiKey.trim()
  if (!key.startsWith("sk-ant-")) {
    throw new Error("invalid")
  }
  if (!(await claudeKeyWorks(key))) {
    throw new Error("invalid")
  }
  await writeSecret(claudePath, { apiKey: key })
}

export async function saveHiggsfieldKey(apiKey: string) {
  const key = apiKey.trim()
  if (!key) {
    throw new Error("invalid")
  }
  if (!(await higgsfieldKeyWorks(key))) {
    throw new Error("invalid")
  }
  await writeSecret(higgsfieldPath, { apiKey: key })
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
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return false
  }
  throw new Error("check-failed")
}

async function higgsfieldKeyWorks(apiKey: string) {
  const response = await fetch(
    "https://api.higgsfield.ai/requests/00000000-0000-0000-0000-000000000000/status",
    { headers: { Authorization: `Key ${apiKey}` } },
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

async function writeSecret(filePath: string, value: unknown) {
  await mkdir(dir, { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}
