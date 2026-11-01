import {
  CLOSING_EN,
  CLOSING_KO,
  CLOSING_VISUAL,
  closingScene,
} from "@/lib/closing"
import { getProfile } from "@/lib/profiles"
import { readWritingGuide } from "@/lib/server/writing-guide"
import { claudeText } from "@/lib/server/anthropic"
import { defaultSubtitle } from "@/lib/timing"
import { applyYoutubeCopy } from "@/lib/youtube-metadata"
import type { Scene, ShotKind, SocialPost, YoutubeMeta } from "@/lib/types"

export type ScriptDraft = {
  placeKo: string
  placeEn: string
  scenes: Scene[]
  youtube: Pick<YoutubeMeta, "title" | "description" | "tags">
  instagram: Pick<SocialPost, "caption">
  tiktok: Pick<SocialPost, "caption">
}

const visualRules = `The character is the host who explains the topic to the camera. The host is not a person inside the story and does not travel into the topic's place, era, or job. The outfit stays the registered outfit in every short. Do not change clothes to match the topic.
The host stays in one cozy dark room for the whole short. Do not invent a new room per scene or per topic. The room is only the picture. Do not narrate how the host arrived there.
placeKo is Korean for the operator: that same host room, 2 or 3 sentences. placeEn is one English sentence of that same room. The light is the channel's cozy dark atmosphere. Every shot marked room uses this same room.
Each scene has shot "room" or "insert".
If shot is room, sceneDescription is only a small host gesture in that same room: a nod, a slight wing movement, or looking at the camera. The character is a rooster with wings and a beak, so do not mention hands, fingers, or a human face. Do not reenact the fact, do not describe the room again, do not name the character or the art style, and do not replace the host with another person.
Every room scene also has 1 to 3 actionBeats. Each trigger is an exact English word or short phrase copied from scriptTarget. Each action is that small host gesture and begins when that trigger is spoken. Insert scenes use an empty actionBeats array.
If shot is insert, sceneDescription is a fact plate the host's room cannot show, such as a diagram, a document, an object, or a wider view of the fact. The host is not in that plate and does not become someone else.
Use insert for the topic's objects and places. The question stays with the host, so that first scene is shot room.`

const spokenVoice = `Write the Korean spoken body first. That Korean is the source, and the English is the same speech in English, sentence by sentence. Do not write a formal English line and then translate it into stiff Korean.
Write as if telling a friend, still clear to a teenager and an older adult on the first listen. Use short sentences and everyday words. If a word is unfamiliar, explain it in the same sentence. One idea at a time. No jargon, slang, idioms, or stacked clauses.
Korean uses 해요체, the way someone talks: 했던 것이죠, 정했어요, 어긋났었죠. Write "그래서 1년을 365일로 정했어요." Do not write 합니다, 입니다, 하였다, or 것이다.
English keeps that same spoken shape. Use contractions such as it's and didn't. When one fact leads to the next, connect them with So, And, or But. Use we or you when the listener is part of the fact. Do not add right? to every sentence. If the Korean is "그래서 1년을 365일로 정했어요.", write "So he set the year at 365 days." Do not write "The year was established."`

const outputRules = `Reply with one JSON object and no other text.
The English narration across the scenes you write must stay under 95 words. A fixed sign-off is added afterward, and the finished short including that sign-off must stay under 50 seconds.
Use 5 to 7 scenes. The first scene is only the question about the topic. Every scene after it states one fact that answers that question. Do not write a scene about noticing something, getting curious, or looking at an object. Do not write 문득 or 궁금해졌어요. Do not add a recap scene. Do not write a goodbye or a sign-off.
${spokenVoice}
scriptKo is one sentence of that spoken Korean body. scriptTarget is the spoken English of that same sentence, not a more formal rewrite.
${visualRules}
youtube title, description, and tags are English. The description is a short summary only, without hashtags or a comment question. tags are comma-separated words for this video, without hash marks. instagramCaption and tiktokCaption are English and may include a few hashtags.`

async function guideBlock() {
  const guide = await readWritingGuide()
  return `Operator writing guide. Follow it for length, the first sentence, and the spoken tone. The Korean body is still the source of the English.\n${guide.body}`
}

export async function outlineScript(topic: string, profileId: string) {
  const profile = getProfile(profileId)
  const text = await claudeText(
    profile.system_prompt,
    `${await guideBlock()}
Reply with one JSON object and no other text.
This is the plan the operator approves before any scene script exists.
overviewKo is the spoken Korean body, about 8 to 14 short sentences. The first sentence is the question about the topic. Every sentence after it is a fact the viewer will hear, in order. These sentences become the English narration, so write them in the familiar spoken voice before any English exists. Do not describe an everyday moment, the speaker noticing something, or the speaker becoming curious. ${spokenVoice} Do not number scenes, do not write camera directions, and do not mention room or insert.
The character is the host who explains, not a person inside the story. placeKo is Korean, 2 or 3 sentences, and it is always the same host room. Write "늘 같은 어두운 방입니다. 검은 터틀넥과 안경은 그대로이고, 카메라를 보며 내용을 설명합니다." Do not move the host into the topic's place, era, or job, and do not change the outfit.
placeEn is one English sentence of that same room. Write "The same cozy dark room. The rooster in the black turtleneck and glasses faces the camera and explains." Keep the channel's cozy dark light.
Do not write spoken scene lines yet.
titleKo is the Korean title shown on the result. Turn the topic into one finished spoken sentence, not a fragment. A question topic stays a complete question. Write "전 세계 사람들은 어떻게 같은 달력을 쓰게 됐을까요?" Do not write "같은 달력".
topicEn is that same sentence in spoken English, also one complete sentence, not a headline fragment. Write "How did people all over the world end up using the same calendar?" It must fit on two screen lines. This is the title burned above the picture.
overviewEn is the spoken English of overviewKo, sentence by sentence, in the same order and the same familiar voice.
Topic: ${topic.trim()}
Shape: {"titleKo":"","topicEn":"","overviewKo":"","overviewEn":"","placeKo":"","placeEn":""}`,
    4096
  )
  const parsed = parseObject(text) as {
    titleKo?: unknown
    topicEn?: unknown
    overviewKo?: unknown
    overviewEn?: unknown
    placeKo?: unknown
    placeEn?: unknown
  }
  const titleKo = textOf(parsed.titleKo)
  const topicEn = textOf(parsed.topicEn)
  const overviewKo = textOf(parsed.overviewKo)
  const overviewEn = textOf(parsed.overviewEn)
  const placeKo = textOf(parsed.placeKo)
  const placeEn = textOf(parsed.placeEn)
  if (!titleKo || !topicEn || !overviewKo || !overviewEn || !placeKo || !placeEn) {
    throw new Error("bad-json")
  }
  return { titleKo, topicEn, overviewKo, overviewEn, placeKo, placeEn }
}

export async function applyScript(input: {
  topic: string
  profileId: string
  overviewKo: string
  overviewEn: string
  placeKo: string
}): Promise<ScriptDraft> {
  const profile = getProfile(input.profileId)
  const text = await claudeText(
    profile.system_prompt,
    `${outputRules}
${await guideBlock()}
The operator approved the overview and the host room below. Follow them. The host explains the facts and does not act them out. Do not add facts that are not in the overview. Keep scriptKo in the same familiar spoken Korean as the overview. Do not formalize it. scriptTarget follows the approved English overview when it is present, and otherwise follows scriptKo. Copy the Korean room into placeKo. placeEn must describe that same host room, not the topic's place.
Topic: ${input.topic.trim()}
Approved overview, Korean: ${input.overviewKo.trim()}
Approved overview, English: ${input.overviewEn.trim() || "(none yet)"}
Approved place, Korean: ${input.placeKo.trim()}
Shape: {"placeKo":"","placeEn":"","scenes":[{"scriptKo":"","scriptTarget":"","shot":"room","sceneDescription":"","actionBeats":[{"trigger":"","action":""}]}],"youtube":{"title":"","description":"","tags":""},"instagramCaption":"","tiktokCaption":""}`,
    4096
  )
  const draft = parseDraft(parseObject(text))
  return { ...draft, placeKo: input.placeKo.trim() }
}

export async function draftScript(
  topic: string,
  profileId: string
): Promise<ScriptDraft> {
  const profile = getProfile(profileId)
  const text = await claudeText(
    profile.system_prompt,
    `${outputRules}
${await guideBlock()}
Topic: ${topic.trim()}
Shape: {"placeKo":"","placeEn":"","scenes":[{"scriptKo":"","scriptTarget":"","shot":"room","sceneDescription":"","actionBeats":[{"trigger":"","action":""}]}],"youtube":{"title":"","description":"","tags":""},"instagramCaption":"","tiktokCaption":""}`,
    4096
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
Rewrite only the spoken English for this one scene so it matches the Korean. Keep the same meaning and a similar length. ${spokenVoice} Do not add a bedtime, midnight, or trying-to-sleep frame. Do not add a setup about noticing something or getting curious. Do not add facts.
Topic: ${input.topic}
Scene visual: ${input.sceneDescription}
Other scenes: ${JSON.stringify(input.neighbors)}
Korean to match: ${input.scriptKo}`,
    1024
  )
  const parsed = parseObject(text) as { scriptTarget?: unknown }
  if (
    typeof parsed.scriptTarget !== "string" ||
    parsed.scriptTarget.trim() === ""
  ) {
    throw new Error("bad-json")
  }
  return parsed.scriptTarget.trim()
}

export async function rewritePlace(input: {
  topic: string
  profileId: string
  overviewKo: string
  placeKo: string
  note: string
}) {
  const profile = getProfile(input.profileId)
  const text = await claudeText(
    profile.system_prompt,
    `Reply with one JSON object and no other text.
The operator wrote a short note, not a finished situation. Rewrite the picture situation from that note.
The character stays the host in one room. placeKo is Korean, 2 or 3 sentences: that host room and what is around the host. Follow the note only as a change to the room. Do not put the host inside the topic's place, era, or job, and do not change the outfit.
placeEn is one English sentence of that same host room. Keep the channel's cozy dark light.
Do not narrate how the host arrived, what they noticed, or the spoken facts. Do not copy the note as the whole description.
Topic: ${input.topic.trim()}
Spoken plan, Korean: ${input.overviewKo.trim()}
Current situation, Korean: ${input.placeKo.trim()}
Operator note: ${input.note.trim()}
Shape: {"placeKo":"","placeEn":""}`,
    1024
  )
  const parsed = parseObject(text) as { placeKo?: unknown; placeEn?: unknown }
  const placeKo = textOf(parsed.placeKo)
  const placeEn = textOf(parsed.placeEn)
  if (!placeKo || !placeEn) {
    throw new Error("bad-json")
  }
  return { placeKo, placeEn }
}

export async function translatePlace(input: {
  profileId: string
  topic: string
  placeKo: string
}) {
  const profile = getProfile(input.profileId)
  const text = await claudeText(
    profile.system_prompt,
    `Reply with one JSON object and no other text: {"placeEn":""}.
Translate the Korean place into one English sentence for a picture. Keep the same place and the same light. Do not add a new place.
Topic: ${input.topic}
Korean place: ${input.placeKo}`,
    512
  )
  const parsed = parseObject(text) as { placeEn?: unknown }
  const placeEn = textOf(parsed.placeEn)
  if (!placeEn) {
    throw new Error("bad-json")
  }
  return placeEn
}

export async function fillPlaces(input: {
  profileId: string
  topic: string
  scenes: { id: string; scriptKo: string; scriptTarget: string }[]
}) {
  const profile = getProfile(input.profileId)
  const text = await claudeText(
    profile.system_prompt,
    `Reply with one JSON object and no other text.
Do not change the spoken lines. Write only the place and each scene's shot and sceneDescription.
${visualRules}
Topic: ${input.topic}
Shape: {"placeKo":"","placeEn":"","scenes":[{"id":"","shot":"room","sceneDescription":""}]}
Scenes: ${JSON.stringify(input.scenes)}`,
    2048
  )
  const parsed = parseObject(text) as {
    placeKo?: unknown
    placeEn?: unknown
    scenes?: unknown
  }
  const placeKo = textOf(parsed.placeKo)
  const placeEn = textOf(parsed.placeEn)
  const rows = parsed.scenes
  if (
    !placeKo ||
    !placeEn ||
    !Array.isArray(rows) ||
    rows.length !== input.scenes.length
  ) {
    throw new Error("bad-json")
  }
  const scenes = input.scenes.map((scene, index) => {
    const item = rows[index]
    if (!item || typeof item !== "object") {
      throw new Error("bad-json")
    }
    const row = item as { shot?: unknown; sceneDescription?: unknown }
    const sceneDescription = textOf(row.sceneDescription)
    if (!sceneDescription) {
      throw new Error("bad-json")
    }
    const closing = scene.scriptKo.trim() === CLOSING_KO
    return {
      id: scene.id,
      shot: closing ? ("room" as const) : parseShot(row.shot),
      sceneDescription: closing ? CLOSING_VISUAL : sceneDescription,
    }
  })
  return { placeKo, placeEn, scenes }
}

function parseDraft(value: unknown): ScriptDraft {
  if (!value || typeof value !== "object") {
    throw new Error("bad-json")
  }
  const record = value as {
    placeKo?: unknown
    placeEn?: unknown
    scenes?: unknown
    youtube?: { title?: unknown; description?: unknown; tags?: unknown }
    instagramCaption?: unknown
    tiktokCaption?: unknown
  }
  const placeKo = textOf(record.placeKo)
  const placeEn = textOf(record.placeEn)
  if (!placeKo || !placeEn) {
    throw new Error("bad-json")
  }
  if (
    !Array.isArray(record.scenes) ||
    record.scenes.length < 5 ||
    record.scenes.length > 8
  ) {
    throw new Error("bad-json")
  }
  const drafted = record.scenes.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("bad-json")
    }
    const scene = item as {
      scriptKo?: unknown
      scriptTarget?: unknown
      shot?: unknown
      sceneDescription?: unknown
      actionBeats?: unknown
    }
    const scriptKo = textOf(scene.scriptKo)
    const scriptTarget = textOf(scene.scriptTarget)
    const sceneDescription = textOf(scene.sceneDescription)
    if (!scriptKo || !scriptTarget || !sceneDescription) {
      throw new Error("bad-json")
    }
    const shot = parseShot(scene.shot)
    return {
      id: "scene-00",
      scriptKo,
      approvedKo: scriptKo,
      scriptTarget,
      subtitle: defaultSubtitle(scriptTarget),
      shot,
      sceneDescription,
      visualDescription: "",
      voiceScript: "",
      actionBeats:
        shot === "room"
          ? beatsOf(scene.actionBeats, scriptTarget, sceneDescription)
          : [],
      castIds: [],
    }
  })
  const body = drafted
    .filter((scene) => scene.scriptKo !== CLOSING_KO)
    .slice(0, 7)
  if (body.length < 5) {
    throw new Error("bad-json")
  }
  const scenes = [...body, closingScene(body.length + 1)].map(
    (scene, index) => ({
      ...scene,
      id: `scene-${String(index + 1).padStart(2, "0")}`,
    })
  )
  return {
    placeKo,
    placeEn,
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

function parseShot(value: unknown): ShotKind {
  if (value === "room" || value === "insert") {
    return value
  }
  throw new Error("bad-json")
}

function beatsOf(value: unknown, scriptTarget: string, fallbackAction: string) {
  if (!Array.isArray(value)) {
    return [
      { trigger: scriptTarget.split(/\s+/)[0] || "", action: fallbackAction },
    ]
  }
  const beats = value.slice(0, 3).flatMap((item) => {
    if (!item || typeof item !== "object") {
      return []
    }
    const beat = item as { trigger?: unknown; action?: unknown }
    const trigger = textOf(beat.trigger)
    const action = textOf(beat.action)
    return trigger && action ? [{ trigger, action }] : []
  })
  return beats.length > 0
    ? beats
    : [{ trigger: scriptTarget.split(/\s+/)[0] || "", action: fallbackAction }]
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
