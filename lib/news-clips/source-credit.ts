import type { NewsSource } from "./types.ts"

const PLACEHOLDER_CHANNELS = new Set([
  "",
  "채널 정보 없음",
  "사용자 원본",
  "unknown",
  "Unknown",
])

export function sourceChannelName(source: NewsSource | null | undefined) {
  const channel = source?.channel?.trim() || ""
  if (!PLACEHOLDER_CHANNELS.has(channel)) return channel
  return ""
}

export function bodySourceCreditText(source: NewsSource | null | undefined) {
  const channel = sourceChannelName(source)
  if (channel) return `출처 · ${channel}`
  return ""
}
