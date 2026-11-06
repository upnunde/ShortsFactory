import "server-only"

import { readTypecastKey } from "@/lib/server/credentials"
import { synthesizeLocalKoreanSpeech } from "@/lib/server/news-clips/local-tts"
import { synthesizeTypecastKoreanSpeech } from "@/lib/server/news-clips/typecast-tts"
import type { NewsClipSettings } from "@/lib/news-clips/types"
import { selectNewsTtsProvider } from "@/lib/news-clips/tts-provider"
import {
  DEFAULT_TYPECAST_VOICE_ID,
  newsTtsVoiceById,
} from "@/lib/news-clips/voices"

export type ResolvedNewsTtsProvider =
  | {
      id: "free"
      localVoiceId: string
    }
  | {
      id: "typecast"
      apiKey: string
      typecastVoiceId: string
      localVoiceId: string
      fallbackAllowed: boolean
    }

export async function resolveNewsTtsProvider(
  settings: Pick<
    NewsClipSettings,
    "ttsProvider" | "typecastVoiceId" | "titleVoice"
  >
): Promise<ResolvedNewsTtsProvider> {
  const apiKey = await readTypecastKey()
  if (settings.ttsProvider === "typecast" && !apiKey) {
    throw new Error("typecast-key-missing")
  }
  const provider = selectNewsTtsProvider(settings.ttsProvider, Boolean(apiKey))
  const localVoiceId = newsTtsVoiceById(settings.titleVoice).id
  const typecastVoiceId = /^tc_[a-z0-9]{8,96}$/i.test(settings.typecastVoiceId)
    ? settings.typecastVoiceId
    : DEFAULT_TYPECAST_VOICE_ID
  if (provider === "typecast" && apiKey) {
    return {
      id: "typecast",
      apiKey,
      typecastVoiceId,
      localVoiceId,
      fallbackAllowed: settings.ttsProvider === "auto",
    }
  }
  return { id: "free", localVoiceId }
}

export function newsTtsCacheIdentity(provider: ResolvedNewsTtsProvider) {
  return provider.id === "typecast"
    ? {
        provider: provider.id,
        alignment: "word-timestamps-v1",
        voiceId: provider.typecastVoiceId,
        fallbackVoiceId: provider.localVoiceId,
        fallbackAllowed: provider.fallbackAllowed,
      }
    : { provider: provider.id, voiceId: provider.localVoiceId }
}

export async function synthesizeNewsSpeech(
  text: string,
  ratePercent: number,
  output: string,
  provider: ResolvedNewsTtsProvider,
  timingOutput?: string
) {
  if (provider.id === "typecast") {
    try {
      await synthesizeTypecastKoreanSpeech(
        text,
        provider.typecastVoiceId,
        ratePercent,
        output,
        provider.apiKey,
        timingOutput
      )
      return "typecast" as const
    } catch (error) {
      const code = error instanceof Error ? error.message : "typecast-failed"
      if (!provider.fallbackAllowed) {
        throw error instanceof Error ? error : new Error(code)
      }
      console.warn(`Typecast TTS fallback: ${code}`)
    }
  }
  await synthesizeLocalKoreanSpeech(
    text,
    provider.localVoiceId,
    ratePercent,
    output
  )
  return "free" as const
}

export function newsTtsErrorMessage(code: string) {
  if (code === "typecast-key-missing")
    return "Typecast API 키가 연결되지 않았습니다. 플랫폼 API 설정에서 키를 먼저 등록해 주세요."
  if (code === "typecast-account-restricted")
    return "Typecast가 비정상 계정 활동을 감지해 음성 생성을 차단했습니다. Typecast 계정 상태와 유료 플랜을 확인해 주세요."
  if (code === "typecast-auth")
    return "Typecast API 키 또는 이 음성의 사용 권한을 확인해 주세요."
  if (code === "typecast-credits")
    return "Typecast 크레딧이 부족하거나 결제가 필요합니다."
  if (code === "typecast-rate-limit")
    return "Typecast 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
  if (code === "typecast-temporary")
    return "Typecast 서버에 일시적으로 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
  if (code === "typecast-failed")
    return "Typecast 음성을 만들지 못했습니다. 음성 코드와 계정 권한을 확인해 주세요."
  return null
}
