import { CLOSING_EN, CLOSING_KO, CLOSING_VISUAL } from "@/lib/closing"
import { defaultSubtitle } from "@/lib/timing"
import { applyYoutubeCopy, nextKoreaUploadSlot } from "@/lib/youtube-metadata"
import type { Scene, StudioState } from "@/lib/types"

export const STORAGE_KEY = "shorts-factory.studio.v2"

function scene(
  id: string,
  scriptKo: string,
  scriptTarget: string,
  sceneDescription: string,
  shot: Scene["shot"] = "room"
): Scene {
  return {
    id,
    scriptKo,
    approvedKo: scriptKo,
    scriptTarget,
    subtitle: defaultSubtitle(scriptTarget),
    shot,
    productionMode: shot === "insert" ? "graphic_motion" : "character_motion",
    sceneDescription,
    visualDescription: "",
    voiceScript: "",
    actionBeats: [
      { trigger: scriptTarget.split(/\s+/)[0] || "", action: sceneDescription },
    ],
    castIds: [],
  }
}

export const sampleStudio: StudioState = {
  step: "topic",
  project: {
    topic: "꺼진 별의 빛이 아직도 오는 이유",
    titleKo: "",
    topicEn: "",
    scriptTopic: "꺼진 별의 빛이 아직도 오는 이유",
    overviewKo: "",
    overviewEn: "",
    profileId: "default",
    outfitId: null,
    bgmId: "stella-waltz",
    placeKo:
      "창이 하나 있는 평범한 방입니다. 책상과 창밖은 방 장면에서 그대로입니다.",
    placeEn:
      "an ordinary room with one window and a desk, the same window and the same light in every room shot",
    placeApprovedKo:
      "창이 하나 있는 평범한 방입니다. 책상과 창밖은 방 장면에서 그대로입니다.",
    autoUpload: false,
    scheduledAt: nextKoreaUploadSlot(),
    historyId: "",
    finalSignature: "",
    directionSignature: "",
    voicePreviewKey: "",
    sceneDurations: {},
    sceneWordTimings: {},
    scenes: [
      scene(
        "scene-01",
        "꺼진 별의 빛은 왜 아직도 우리에게 올까요?",
        "Why can light from a dead star still reach us?",
        "tilts its head, as if asking"
      ),
      scene(
        "scene-02",
        "빛은 빨라요. 하지만 별까지의 거리가 너무 멀어요.",
        "Light is fast. But the distance to a star is enormous.",
        "a long empty stretch between a near point and a far point",
        "insert"
      ),
      scene(
        "scene-03",
        "그래서 지금 보이는 빛은 별의 지금 모습이 아니에요.",
        "So the light you see now isn't the star as it is now.",
        "one point of light marked as an older moment",
        "insert"
      ),
      scene(
        "scene-04",
        "할머니가 태어나기 전에 꺼진 별의 빛이 오늘 도착할 수도 있어요.",
        "A star that burned out before my grandparents were born can have its light arrive today.",
        "an old burst of light still crossing a dark stretch",
        "insert"
      ),
      scene(
        "scene-05",
        "하늘을 볼 때 그중 일부는 이미 사라진 별일 수도 있어요.",
        "Some of what you see up there may be a star that's already gone.",
        "a field of small lights, a few of them marked as already gone",
        "insert"
      ),
      scene("scene-06", CLOSING_KO, CLOSING_EN, CLOSING_VISUAL),
    ],
    youtube: {
      enabled: true,
      ...applyYoutubeCopy({
        title: "Why a Dead Star Can Still Shine",
        description:
          "A stray question about starlight, and why the glow can outlast the star.",
        tags: "stars, light, space, curiosity",
      }),
    },
    instagram: {
      enabled: true,
      caption:
        "A stray question about starlight, and why the glow can outlast the star.\n\n#shorts #stars #space",
    },
    tiktok: {
      enabled: true,
      caption:
        "A stray question about starlight, and why the glow can outlast the star. #shorts #stars #space",
    },
  },
}
