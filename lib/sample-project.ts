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
): Scene {
  return {
    id,
    scriptKo,
    approvedKo: scriptKo,
    scriptTarget,
    subtitle: defaultSubtitle(scriptTarget),
    sceneDescription,
    visualDescription: "",
    voiceScript: "",
  }
}

export const sampleStudio: StudioState = {
  step: "topic",
  project: {
    topic: "꺼진 별의 빛이 아직도 오는 이유",
    scriptTopic: "꺼진 별의 빛이 아직도 오는 이유",
    profileId: "default",
    outfitId: null,
    autoUpload: false,
    scheduledAt: nextKoreaUploadSlot(),
    finalSignature: "",
    scenes: [
      scene(
        "scene-01",
        "별이 꺼져도 빛은 아직 온다는 말이 갑자기 궁금해졌다.",
        "A star can be gone, and its light can still be on the way. That got me curious.",
        "looking up at one distant point of light",
      ),
      scene(
        "scene-02",
        "빛은 빠르다. 그런데 별까지의 거리가 그 속도를 삼켜 버린다.",
        "Light is fast. The distance to the star just swallows that speed.",
        "a long empty stretch between a near point and a far point",
      ),
      scene(
        "scene-03",
        "그래서 지금 보이는 빛은 지금 별의 모습이 아니다.",
        "So the light you see now is not the star as it is now.",
        "a distant point of light shown as an older moment still traveling",
      ),
      scene(
        "scene-04",
        "할머니가 태어나기 전에 꺼진 별의 빛이 오늘 도착할 수도 있다.",
        "A star that burned out before my grandparents were born can have its light arrive today.",
        "an old burst of light still crossing empty space",
      ),
      scene(
        "scene-05",
        "하늘을 볼 때 그중 일부는 이미 없는 별이다.",
        "Some of what you see up there is a star that is already gone.",
        "a field of stars, a few of them already gone",
      ),
      scene(
        "scene-06",
        "잡생각이 하나 걸렸고, 찾아보니 그게 이유였다.",
        "It was just a stray thought. I looked it up, and that was the reason.",
        "an ordinary desk with one question written in a notebook",
      ),
      scene("scene-07", CLOSING_KO, CLOSING_EN, CLOSING_VISUAL),
    ],
    youtube: {
      enabled: true,
      ...applyYoutubeCopy({
        title: "Why a Dead Star Can Still Shine",
        description: "A stray question about starlight, and why the glow can outlast the star.",
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
