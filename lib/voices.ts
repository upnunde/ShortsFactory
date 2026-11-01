export const KOKORO_VOICES = [
  { id: "am_michael", label: "마이클", detail: "미국 영어 · 남성" },
  { id: "am_fenrir", label: "펜리르", detail: "미국 영어 · 남성" },
  { id: "am_puck", label: "퍽", detail: "미국 영어 · 남성" },
  { id: "am_echo", label: "에코", detail: "미국 영어 · 남성" },
  { id: "am_eric", label: "에릭", detail: "미국 영어 · 남성" },
  { id: "am_liam", label: "리암", detail: "미국 영어 · 남성" },
  { id: "am_onyx", label: "오닉스", detail: "미국 영어 · 남성" },
  { id: "am_adam", label: "아담", detail: "미국 영어 · 남성" },
  { id: "am_santa", label: "산타", detail: "미국 영어 · 남성" },
  { id: "af_heart", label: "하트", detail: "미국 영어 · 여성" },
  { id: "af_bella", label: "벨라", detail: "미국 영어 · 여성" },
  { id: "af_nicole", label: "니콜", detail: "미국 영어 · 여성" },
  { id: "af_aoede", label: "아오이데", detail: "미국 영어 · 여성" },
  { id: "af_kore", label: "코레", detail: "미국 영어 · 여성" },
  { id: "af_sarah", label: "사라", detail: "미국 영어 · 여성" },
  { id: "af_alloy", label: "얼로이", detail: "미국 영어 · 여성" },
  { id: "af_nova", label: "노바", detail: "미국 영어 · 여성" },
  { id: "af_jessica", label: "제시카", detail: "미국 영어 · 여성" },
  { id: "af_river", label: "리버", detail: "미국 영어 · 여성" },
  { id: "af_sky", label: "스카이", detail: "미국 영어 · 여성" },
  { id: "bm_george", label: "조지", detail: "영국 영어 · 남성" },
  { id: "bm_fable", label: "페이블", detail: "영국 영어 · 남성" },
  { id: "bm_daniel", label: "대니얼", detail: "영국 영어 · 남성" },
  { id: "bm_lewis", label: "루이스", detail: "영국 영어 · 남성" },
  { id: "bf_emma", label: "엠마", detail: "영국 영어 · 여성" },
  { id: "bf_isabella", label: "이사벨라", detail: "영국 영어 · 여성" },
  { id: "bf_alice", label: "앨리스", detail: "영국 영어 · 여성" },
  { id: "bf_lily", label: "릴리", detail: "영국 영어 · 여성" },
] as const

export const DEFAULT_VOICE_ID = "am_michael"

export function voiceById(id: string) {
  return (
    KOKORO_VOICES.find((voice) => voice.id === id) ??
    KOKORO_VOICES.find((voice) => voice.id === DEFAULT_VOICE_ID)!
  )
}
