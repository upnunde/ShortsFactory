import { defaultSubtitle } from "@/lib/timing"
import type { Scene } from "@/lib/types"

export const CLOSING_KO = "그럼 다음에 더 새로운 잡지식으로 찾아뵐께요 안녕!"
export const CLOSING_EN = "I'll be back next time with some newer trivia. Bye!"
export const CLOSING_VISUAL = "a small wave, ordinary room, the short ending"

export function closingScene(index: number): Scene {
  return {
    id: `scene-${String(index).padStart(2, "0")}`,
    scriptKo: CLOSING_KO,
    approvedKo: CLOSING_KO,
    scriptTarget: CLOSING_EN,
    subtitle: defaultSubtitle(CLOSING_EN),
    sceneDescription: CLOSING_VISUAL,
    visualDescription: "",
    voiceScript: "",
  }
}
