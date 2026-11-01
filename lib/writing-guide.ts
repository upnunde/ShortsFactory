export type WritingGuide = {
  body: string
}

export const defaultWritingGuide: WritingGuide = {
  body: "전체 영상은 50초 미만입니다. 첫 문장은 주제 질문이고, 다음 문장부터 바로 설명합니다. 10대와 어르신도 한 번에 알아듣도록, 친구에게 말하듯 짧은 문장으로 씁니다. 여기에 적은 문장이 대표 커버입니다.",
}

export function normalizeWritingGuide(value: unknown): WritingGuide {
  if (!value || typeof value !== "object") {
    return defaultWritingGuide
  }
  const body = (value as { body?: unknown }).body
  if (typeof body !== "string" || body.trim() === "") {
    return defaultWritingGuide
  }
  return { body: body.trim() }
}
