import { CLOSING_EN, CLOSING_KO, closingScene } from "@/lib/closing"
import { getProfile } from "@/lib/profiles"
import { claudeText } from "@/lib/server/anthropic"
import { defaultSubtitle } from "@/lib/timing"
import { applyYoutubeCopy } from "@/lib/youtube-metadata"
import type { Scene, SocialPost, YoutubeMeta } from "@/lib/types"

export type ScriptDraft = {
  scenes: Scene[]
  youtube: Pick<YoutubeMeta, "title" | "description" | "tags">
  instagram: Pick<SocialPost, "caption">
  tiktok: Pick<SocialPost, "caption">
}

const outputRules = `Reply with one JSON object and no other text.
The English narration across all scenes must stay under 130 words so the short is under 60 seconds.
Use 5 to 7 scenes. Do not write a goodbye or a sign-off.
scriptKo is Korean for the operator. scriptTarget is spoken English narration. sceneDescription is a short English visual, without naming the character or the art style.
youtube title, description, and tags are English. The description is a short summary only, without hashtags or a comment question. tags are comma-separated words for this video, without hash marks. instagramCaption and tiktokCaption are English and may include a few hashtags.`

export async function draftScript(topic: string, profileId: string): Promise<ScriptDraft> {
  const profile = getProfile(profileId)
  const text = await claudeText(
    profile.system_prompt,
    `${outputRules}
Topic: ${topic.trim()}
Shape: {"scenes":[{"scriptKo":"","scriptTarget":"","sceneDescription":""}],"youtube":{"title":"","description":"","tags":""},"instagramCaption":"","tiktokCaption":""}`,
    4096,
  )
  return parseDraft(parseObject(text))
}

export async function translateScene(input: {
  profileId: string
  topic: string
  scriptKo: string
  sceneDescription: string
  neighbors: { scriptKo: string; scriptTarget: string }[]
}) {
  if (input.scriptKo.trim() === CLOSING_KO) {
    return CLOSING_EN
  }
  const profile = getProfile(input.profileId)
  const text = await claudeText(
    profile.system_prompt,
    `Reply with one JSON object and no other text: {"scriptTarget":""}.
Rewrite only the spoken English for this one scene so it matches the Korean. Keep the same meaning and a similar length. Do not add a bedtime, midnight, or trying-to-sleep frame. Do not add facts.
Topic: ${input.topic}
Scene visual: ${input.sceneDescription}
Other scenes: ${JSON.stringify(input.neighbors)}
Korean to match: ${input.scriptKo}`,
    1024,
  )
  const parsed = parseObject(text) as { scriptTarget?: unknown }
  if (typeof parsed.scriptTarget !== "string" || parsed.scriptTarget.trim() === "") {
    throw new Error("bad-json")
  }
  return parsed.scriptTarget.trim()
}

function parseDraft(value: unknown): ScriptDraft {
  if (!value || typeof value !== "object") {
    throw new Error("bad-json")
  }
  const record = value as {
    scenes?: unknown
    youtube?: { title?: unknown; description?: unknown; tags?: unknown }
    instagramCaption?: unknown
    tiktokCaption?: unknown
  }
  if (!Array.isArray(record.scenes) || record.scenes.length < 5 || record.scenes.length > 8) {
    throw new Error("bad-json")
  }
  const drafted = record.scenes.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("bad-json")
    }
    const scene = item as { scriptKo?: unknown; scriptTarget?: unknown; sceneDescription?: unknown }
    const scriptKo = textOf(scene.scriptKo)
    const scriptTarget = textOf(scene.scriptTarget)
    const sceneDescription = textOf(scene.sceneDescription)
    if (!scriptKo || !scriptTarget || !sceneDescription) {
      throw new Error("bad-json")
    }
    return {
      id: "scene-00",
      scriptKo,
      approvedKo: scriptKo,
      scriptTarget,
      subtitle: defaultSubtitle(scriptTarget),
      sceneDescription,
      visualDescription: "",
      voiceScript: "",
    }
  })
  const body = drafted.filter((scene) => scene.scriptKo !== CLOSING_KO).slice(0, 7)
  if (body.length < 5) {
    throw new Error("bad-json")
  }
  const scenes = [...body, closingScene(body.length + 1)].map((scene, index) => ({
    ...scene,
    id: `scene-${String(index + 1).padStart(2, "0")}`,
  }))
  return {
    scenes,
    youtube: applyYoutubeCopy({
      title: textOf(record.youtube?.title),
      description: textOf(record.youtube?.description),
      tags: textOf(record.youtube?.tags),
    }),
    instagram: { caption: textOf(record.instagramCaption) },
    tiktok: { caption: textOf(record.tiktokCaption) },
  }
}

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function parseObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced?.[1] ?? text
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) {
    throw new Error("bad-json")
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown
  } catch {
    throw new Error("bad-json")
  }
}
