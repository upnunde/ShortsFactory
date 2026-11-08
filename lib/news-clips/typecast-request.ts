export const TYPECAST_KOREAN_MODEL = "ssfm-v31"

export function typecastKoreanTimestampRequest({
  voiceId,
  text,
  tempo,
}: {
  voiceId: string
  text: string
  tempo: number
}) {
  return {
    voice_id: voiceId,
    text,
    model: TYPECAST_KOREAN_MODEL,
    language: "kor",
    prompt: {
      // 빌드업형은 과장된 감정보다 일정한 한국어 논평 톤을 우선한다.
      emotion_type: "preset",
      emotion_preset: "normal",
      emotion_intensity: 1,
    },
    output: {
      // null은 무음 제거를 끈다. 0은 무음을 0ms만 남겨 모두 제거하는 값이다.
      remove_silence_ms: null,
      audio_tempo: Math.max(0.85, Math.min(1.08, tempo)),
      audio_format: "wav",
    },
  }
}
