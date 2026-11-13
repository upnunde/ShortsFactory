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
  const attribution = source?.attribution?.replace(/\s+/g, " ").trim() || ""
  if (attribution) return `출처 · ${attribution.slice(0, 120)}`
  const channel = sourceChannelName(source)
  if (channel) return `출처 · ${channel}`
  return ""
}

/** 프로젝트 공통 출처 입력란의 기본값. 화면용 접두사는 포함하지 않는다. */
export function sourceCreditInputText(source: NewsSource | null | undefined) {
  const attribution = source?.attribution?.replace(/\s+/g, " ").trim() || ""
  if (attribution) return attribution.slice(0, 120)
  return sourceChannelName(source)
}

/** 모든 프레임과 FFmpeg 렌더가 공유하는 최종 출처 표기. */
export function projectSourceCreditText(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim().slice(0, 120) || ""
  if (!normalized) return ""
  return /^출처\s*(?:[·:：-]\s*)?/u.test(normalized)
    ? normalized
    : `출처 · ${normalized}`
}
