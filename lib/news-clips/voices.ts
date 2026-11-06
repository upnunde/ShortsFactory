export const NEWS_TTS_VOICES = [
  {
    id: "mms-kor",
    label: "MMS 한국어",
    detail: "한국어 전용 오픈소스 모델",
    recommended: true,
  },
  {
    id: "macos-yuna",
    label: "유나",
    detail: "macOS 한국어 시스템 음성 · 예비",
    recommended: false,
  },
] as const

export const DEFAULT_NEWS_TTS_VOICE_ID = "mms-kor"
export const DEFAULT_TYPECAST_VOICE_ID = "tc_5e4f7a5da82e1f000aca31af"

export function newsTtsVoiceById(id: string) {
  return (
    NEWS_TTS_VOICES.find((voice) => voice.id === id) ??
    NEWS_TTS_VOICES.find((voice) => voice.id === DEFAULT_NEWS_TTS_VOICE_ID)!
  )
}
