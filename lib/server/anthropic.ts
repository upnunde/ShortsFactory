import { readClaudeKey } from "@/lib/server/credentials"

type ClaudeBody = {
  error?: { message?: string }
  content?: { type: string; text?: string }[]
}

export async function claudeText(system: string, user: string, maxTokens: number) {
  const apiKey = await readKey()
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2026-10-21",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: maxTokens,
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: user }],
    }),
  })
  const body = (await response.json()) as ClaudeBody
  if (!response.ok) {
    const message = body.error?.message?.toLowerCase() ?? ""
    if (response.status === 401) {
      throw new Error("rejected-key")
    }
    if (message.includes("credit")) {
      throw new Error("no-credit")
    }
    throw new Error("claude-failed")
  }
  const text = (body.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim()
  if (!text) {
    throw new Error("empty")
  }
  return text
}

async function readKey() {
  const apiKey = await readClaudeKey()
  if (!apiKey) {
    throw new Error("no-key")
  }
  return apiKey
}
