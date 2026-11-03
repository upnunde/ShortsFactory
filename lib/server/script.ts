import {
  CLOSING_EN,
  CLOSING_KO,
  CLOSING_VISUAL,
  closingScene,
} from "@/lib/closing"
import { readProfile } from "@/lib/server/profiles"
import { getCharacterLibrary } from "@/lib/server/character"
import { readFrameLayout } from "@/lib/server/frame-layout"
import { readWritingGuide } from "@/lib/server/writing-guide"
import { readVideoSettings } from "@/lib/server/video-settings"
import {
  constrainAiVideoUsage,
  normalizeProductionMode,
} from "@/lib/scene-production"
import { claudeText } from "@/lib/server/anthropic"
import { defaultSubtitle } from "@/lib/timing"
import { applyYoutubeCopy } from "@/lib/youtube-metadata"
import {
  titleCharacterLimit,
  titleWithinCharacterLimit,
} from "@/lib/frame-layout"
import type { Scene, ShotKind, SocialPost, YoutubeMeta } from "@/lib/types"
import type { WordTiming } from "@/lib/voice-timing"

export type ScriptDraft = {
  placeKo: string
  placeEn: string
  scenes: Scene[]
  youtube: Pick<YoutubeMeta, "title" | "description" | "tags">
  instagram: Pick<SocialPost, "caption">
  tiktok: Pick<SocialPost, "caption">
}

const ESTIMATED_ENGLISH_WORDS_PER_SECOND = 2.2

function narrationBudget(
  settings: Awaited<ReturnType<typeof readVideoSettings>>
) {
  const closingWords = CLOSING_EN.split(/\s+/).filter(Boolean).length
  const minimumSeconds = Math.max(
    1,
    settings.targetDurationSeconds - settings.durationToleranceSeconds
  )
  const maximumSeconds =
    settings.targetDurationSeconds + settings.durationToleranceSeconds
  return {
    bodyTarget: Math.max(
      30,
      Math.round(
        settings.targetDurationSeconds * ESTIMATED_ENGLISH_WORDS_PER_SECOND -
          closingWords
      )
    ),
    bodyMinimum: Math.max(
      25,
      Math.round(
        minimumSeconds * ESTIMATED_ENGLISH_WORDS_PER_SECOND - closingWords
      )
    ),
    bodyMaximum: Math.max(
      35,
      Math.round(
        maximumSeconds * ESTIMATED_ENGLISH_WORDS_PER_SECOND - closingWords
      )
    ),
  }
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
Write as if telling a friend, still clear to a teenager and an older adult on the first listen. Use everyday words and concise spoken beats, but do not chop every fact into a separate subject-predicate sentence. Link closely related cause, contrast, and result so one thought leads naturally to the next. If a word is unfamiliar, explain it where it appears. No jargon, slang, idioms, or long stacks of clauses.
Korean uses natural 해요체. Vary sentence endings and rhythm; do not repeat 했어요, 됐어요, 있어요, or the same ending in consecutive lines. Use connectors such as 그런데, 그래서, 반면, 덕분에, and 결국 only where the meaning calls for them. A natural flow is "처음엔 1년을 365일로 정했지만, 작은 차이가 쌓이면서 날짜와 계절이 어긋나기 시작했죠." Do not write 합니다, 입니다, 하였다, or 것이다. Do not force every line to end in 죠 or 거든요 either.
English keeps that same connected spoken flow. Use contractions such as it's and didn't. Connect related facts naturally, but do not begin every sentence with So, And, or But. Use you only when the listener is genuinely part of the fact. Do not add right? to every sentence. Avoid passive textbook phrasing such as "The year was established."`

function outputRules(
  settings: Awaited<ReturnType<typeof readVideoSettings>>
) {
  const budget = narrationBudget(settings)
  const minimum = Math.max(
    1,
    settings.targetDurationSeconds - settings.durationToleranceSeconds
  )
  const maximum =
    settings.targetDurationSeconds + settings.durationToleranceSeconds
  return `Reply with one JSON object and no other text.
The finished short including the fixed sign-off targets ${settings.targetDurationSeconds} seconds and must stay between ${minimum} and ${maximum} seconds. These channel limits override any other duration instruction. Keep the English narration concise enough for that range.
Before writing, reduce the topic to the central question plus only the facts required to answer it. The English body before the fixed closing should target about ${budget.bodyTarget} words and stay between ${budget.bodyMinimum} and ${budget.bodyMaximum} words. This word budget is a first-draft control, not a reason to pad the narration. Prefer fewer complete facts over many rushed facts.
Use 5 to 7 scenes. The first scene is only the question about the topic. Every scene after it adds a fact that answers that question, while continuing naturally from the previous scene. Do not make the scenes sound like an unrelated list of facts. Do not write a scene about noticing something, getting curious, or looking at an object. Do not write 문득 or 궁금해졌어요. Do not add a recap scene. Do not write a goodbye or a sign-off.
${spokenVoice}
scriptKo is one compact spoken beat. It may be one sentence or two closely connected short sentences when that sounds more natural. scriptTarget is the spoken English of that same beat, not a more formal rewrite.
Do not design shots, gestures, characters, or production modes yet. A separate director pass runs only after the narration and TTS timing are approved.
youtube title, description, and tags are English. The description is a short summary only, without hashtags or a comment question. tags are comma-separated words for this video, without hash marks. instagramCaption and tiktokCaption are English and may include a few hashtags.`
}

async function guideBlock(profileId: string) {
  const guide = await readWritingGuide(profileId)
  return `Operator writing guide. Follow it for length, the first sentence, and the spoken tone. The Korean body is still the source of the English.\n${guide.body}`
}

export async function outlineScript(topic: string, profileId: string) {
  const profile = await readProfile(profileId)
  const settings = await readVideoSettings(profileId)
  const layout = await readFrameLayout(profileId)
  const titleLimit = titleCharacterLimit(layout.titleSize)
  const budget = narrationBudget(settings)
  const text = await claudeText(
    profile.system_prompt,
    `${await guideBlock(profileId)}
Reply with one JSON object and no other text.
This is the plan the operator approves before any scene script exists.
Before writing, reduce the topic to its central question and the smallest set of facts needed for a complete answer. overviewKo is the spoken Korean body in 5 to 7 natural spoken beats. The first beat is the question about the topic. Every later beat must advance the answer; omit side stories, repeated examples, and secondary dates or names that are not necessary to understand the cause. The eventual English body before the fixed closing should target about ${budget.bodyTarget} words and stay between ${budget.bodyMinimum} and ${budget.bodyMaximum} words. The finished narration including the fixed sign-off targets ${settings.targetDurationSeconds} seconds with ±${settings.durationToleranceSeconds} seconds tolerance. These channel limits override any other duration instruction. These beats become the English narration, so write them in the familiar spoken voice before any English exists. Do not describe an everyday moment, the speaker noticing something, or the speaker becoming curious. ${spokenVoice} Do not number scenes, do not write camera directions, and do not mention room or insert.
The character is the host who explains, not a person inside the story. placeKo is Korean, 2 or 3 sentences, and it is always the same host room. Write "늘 같은 어두운 방입니다. 검은 터틀넥과 안경은 그대로이고, 카메라를 보며 내용을 설명합니다." Do not move the host into the topic's place, era, or job, and do not change the outfit.
placeEn is one English sentence of that same room. Write "The same cozy dark room. The rooster in the black turtleneck and glasses faces the camera and explains." Keep the channel's cozy dark light.
Do not write spoken scene lines yet.
After deciding the overview, create the title by summarizing its single central question or most important idea. Do not mechanically copy the operator's topic, cut it off, or list several facts. Keep only the idea the viewer must understand before watching. The title must remain accurate to the overview and must not promise a fact the narration does not explain.
titleKo is that summary as one short, natural Korean sentence. A question should stay a complete question, not a fragment. Write "왜 전 세계가 같은 달력을 쓸까요?" Do not write "같은 달력".
topicEn is the same summarized title in concise, natural spoken English. It must be a complete sentence or question, not a headline fragment. Write "Why does the world use one calendar?" It must be at most ${titleLimit} characters including spaces and punctuation so it fits on two screen lines at the channel's current title size. This is a strict limit. Prefer a shorter rephrasing over removing necessary grammar. This is the title burned above the picture.
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
  let titleKo = textOf(parsed.titleKo)
  let topicEn = textOf(parsed.topicEn)
  const overviewKo = textOf(parsed.overviewKo)
  const overviewEn = textOf(parsed.overviewEn)
  const placeKo = textOf(parsed.placeKo)
  const placeEn = textOf(parsed.placeEn)
  if (
    !titleKo ||
    !topicEn ||
    !overviewKo ||
    !overviewEn ||
    !placeKo ||
    !placeEn
  ) {
    throw new Error("bad-json")
  }
  if (!titleWithinCharacterLimit(topicEn, layout.titleSize)) {
    const shortened = parseObject(
      await claudeText(
        profile.system_prompt,
        `Reply with one JSON object and no other text: {"titleKo":"","topicEn":""}.
Rewrite the title as a fresh summary of the narration's one central question or most important idea. Do not truncate words or mechanically delete the end. Keep it accurate, natural, and specific enough to understand before watching. Keep it a complete sentence or question, not a fragment. topicEn must be at most ${titleLimit} characters including spaces and punctuation. titleKo must express that same summarized title in Korean.
Original topic: ${topic.trim()}
Narration summary, Korean: ${overviewKo}
Narration summary, English: ${overviewEn}
Korean title: ${titleKo}
English title: ${topicEn}`,
        512
      )
    ) as { titleKo?: unknown; topicEn?: unknown }
    titleKo = textOf(shortened.titleKo)
    topicEn = textOf(shortened.topicEn)
    if (
      !titleKo ||
      !topicEn ||
      !titleWithinCharacterLimit(topicEn, layout.titleSize)
    ) {
      throw new Error("title-too-long")
    }
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
  const profile = await readProfile(input.profileId)
  const settings = await readVideoSettings(input.profileId)
  const text = await claudeText(
    profile.system_prompt,
    `${outputRules(settings)}
${await guideBlock(input.profileId)}
The operator approved the overview and the host room below. Follow them. The host explains the facts and does not act them out. Do not add facts that are not in the overview. Keep scriptKo in the same familiar spoken Korean as the overview. Do not formalize it. scriptTarget follows the approved English overview when it is present, and otherwise follows scriptKo. Copy the Korean room into placeKo. placeEn must describe that same host room, not the topic's place.
Topic: ${input.topic.trim()}
Approved overview, Korean: ${input.overviewKo.trim()}
Approved overview, English: ${input.overviewEn.trim() || "(none yet)"}
Approved place, Korean: ${input.placeKo.trim()}
Shape: {"placeKo":"","placeEn":"","scenes":[{"scriptKo":"","scriptTarget":""}],"youtube":{"title":"","description":"","tags":""},"instagramCaption":"","tiktokCaption":""}`,
    4096
  )
  const draft = parseDraft(
    parseObject(text),
    settings
  )
  return { ...draft, placeKo: input.placeKo.trim() }
}

export async function draftScript(
  topic: string,
  profileId: string
): Promise<ScriptDraft> {
  const profile = await readProfile(profileId)
  const settings = await readVideoSettings(profileId)
  const text = await claudeText(
    profile.system_prompt,
    `${outputRules(settings)}
${await guideBlock(profileId)}
Topic: ${topic.trim()}
Shape: {"placeKo":"","placeEn":"","scenes":[{"scriptKo":"","scriptTarget":""}],"youtube":{"title":"","description":"","tags":""},"instagramCaption":"","tiktokCaption":""}`,
    4096
  )
  return parseDraft(
    parseObject(text),
    settings
  )
}

export async function fitScriptDuration(input: {
  profileId: string
  topic: string
  measuredSeconds: number
  scenes: Scene[]
}) {
  const profile = await readProfile(input.profileId)
  const settings = await readVideoSettings(input.profileId)
  const bodyScenes = input.scenes.filter(
    (scene, index) =>
      index !== input.scenes.length - 1 && scene.scriptKo !== CLOSING_KO
  )
  if (bodyScenes.length === 0) throw new Error("duration-format")
  const minimum = Math.max(
    1,
    settings.targetDurationSeconds - settings.durationToleranceSeconds
  )
  const maximum =
    settings.targetDurationSeconds + settings.durationToleranceSeconds
  const currentWords = input.scenes.reduce(
    (sum, scene) =>
      sum + scene.scriptTarget.split(/\s+/).filter(Boolean).length,
    0
  )
  const targetWords = Math.max(
    35,
    Math.round(
      currentWords *
        (settings.targetDurationSeconds / Math.max(1, input.measuredSeconds))
    )
  )
  const text = await claudeText(
    profile.system_prompt,
    `Reply with one JSON object and no other text.
The final TTS measured ${input.measuredSeconds.toFixed(1)} seconds, but this channel requires ${minimum} to ${maximum} seconds and targets ${settings.targetDurationSeconds} seconds. Rewrite the narration to land near the target when spoken by the same voice.
${spokenVoice}
Keep the same scene IDs, order, and count. The first body scene remains the central question. Keep the fixed closing unchanged. If the narration is too long, remove repetition, secondary examples, and less essential detail while preserving the complete central explanation. If it is too short, clarify the causal explanation using only information already present in the supplied narration; do not invent a new fact. Aim for about ${targetWords} English words including the closing. Korean remains the source and scriptTarget is its equivalent natural English. Do not design visuals yet.
Recreate the English YouTube and social copy from the fitted narration. The YouTube description is a short summary without hashtags or a comment question.
Topic: ${input.topic.trim()}
Body scenes to rewrite: ${JSON.stringify(bodyScenes.map((scene) => ({ id: scene.id, scriptKo: scene.scriptKo, scriptTarget: scene.scriptTarget })))}
Return every body scene ID exactly once. Do not return the closing scene; it is appended by the system unchanged.
Fixed closing added later: ${JSON.stringify({ scriptKo: CLOSING_KO, scriptTarget: CLOSING_EN })}
Shape: {"scenes":[{"id":"","scriptKo":"","scriptTarget":""}],"youtube":{"title":"","description":"","tags":""},"instagramCaption":"","tiktokCaption":""}`,
    4096
  )
  const parsed = parseObject(text) as {
    scenes?: unknown
    youtube?: { title?: unknown; description?: unknown; tags?: unknown }
    instagramCaption?: unknown
    tiktokCaption?: unknown
  }
  if (!Array.isArray(parsed.scenes)) {
    throw new Error("duration-format")
  }
  const rows = new Map(
    parsed.scenes.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const row = item as {
        id?: unknown
        scriptKo?: unknown
        scriptTarget?: unknown
      }
      return typeof row.id === "string" ? [[row.id, row] as const] : []
    })
  )
  if (!bodyScenes.some((scene) => rows.has(scene.id))) {
    throw new Error("duration-format")
  }
  const scenes = input.scenes.map((scene, index) => {
    const closing = index === input.scenes.length - 1 || scene.scriptKo === CLOSING_KO
    if (closing) {
      return {
        ...closingScene(index + 1),
        id: scene.id,
      }
    }
    const row = rows.get(scene.id)
    const scriptKo = textOf(row?.scriptKo) || scene.scriptKo
    const scriptTarget = textOf(row?.scriptTarget) || scene.scriptTarget
    return {
      ...scene,
      scriptKo,
      approvedKo: scriptKo,
      scriptTarget,
      subtitle: defaultSubtitle(scriptTarget),
      shot: "room" as const,
      productionMode: "character_motion" as const,
      sceneDescription: "화면 연출 대기",
      visualDescription: "",
      voiceScript: "",
      actionBeats: [],
      castIds: [],
    }
  })
  return {
    scenes,
    overviewKo: scenes
      .filter((scene) => scene.scriptKo !== CLOSING_KO)
      .map((scene) => scene.scriptKo)
      .join(" "),
    overviewEn: scenes
      .filter((scene) => scene.scriptKo !== CLOSING_KO)
      .map((scene) => scene.scriptTarget)
      .join(" "),
    youtube: applyYoutubeCopy({
      title: textOf(parsed.youtube?.title),
      description: textOf(parsed.youtube?.description),
      tags: textOf(parsed.youtube?.tags),
    }),
    instagram: { caption: textOf(parsed.instagramCaption) },
    tiktok: { caption: textOf(parsed.tiktokCaption) },
  }
}

export async function rewriteScene(input: {
  profileId: string
  topic: string
  changedSceneId: string
  titleKo: string
  topicEn: string
  scenes: Scene[]
}) {
  const changed = input.scenes.find((scene) => scene.id === input.changedSceneId)
  if (!changed || !changed.scriptKo.trim()) {
    throw new Error("bad-json")
  }
  const profile = await readProfile(input.profileId)
  const layout = await readFrameLayout(input.profileId)
  const titleLimit = titleCharacterLimit(layout.titleSize)
  const text = await claudeText(
    profile.system_prompt,
    `Reply with one JSON object and no other text.
The operator changed the Korean source of one scene. Update every derived item that depends on that change in one pass. Do not change any Korean source line and do not add facts.
${spokenVoice}
For changedScene, rewrite only scriptTarget from its Korean source. Do not design or revise any visual yet; the director pass runs after TTS timing is final.
Recreate titleKo and topicEn by summarizing the central question of the full revised narration. topicEn must be at most ${titleLimit} characters including spaces and punctuation. Recreate the English YouTube and social copy from the revised full narration. Do not use hashtags or a comment question in the YouTube description.
Topic: ${input.topic.trim()}
Changed scene ID: ${input.changedSceneId}
Current Korean title: ${input.titleKo}
Current English title: ${input.topicEn}
Full scenes: ${JSON.stringify(input.scenes)}
Shape: {"titleKo":"","topicEn":"","changedScene":{"id":"","scriptTarget":""},"youtube":{"title":"","description":"","tags":""},"instagramCaption":"","tiktokCaption":""}`,
    4096
  )
  const parsed = parseObject(text) as {
    titleKo?: unknown
    topicEn?: unknown
    changedScene?: unknown
    youtube?: { title?: unknown; description?: unknown; tags?: unknown }
    instagramCaption?: unknown
    tiktokCaption?: unknown
  }
  let titleKo = textOf(parsed.titleKo)
  let topicEn = textOf(parsed.topicEn)
  if (!titleKo || !topicEn) {
    throw new Error("bad-json")
  }
  if (!titleWithinCharacterLimit(topicEn, layout.titleSize)) {
    const shortened = parseObject(
      await claudeText(
        profile.system_prompt,
        `Reply with one JSON object and no other text: {"titleKo":"","topicEn":""}.
Rewrite these titles as a concise summary of the full narration's central question. Do not truncate words. Keep the English title at most ${titleLimit} characters including spaces and punctuation, and keep both languages equivalent.
Korean narration: ${input.scenes.map((scene) => scene.scriptKo).join(" ")}
Korean title: ${titleKo}
English title: ${topicEn}`,
        512
      )
    ) as { titleKo?: unknown; topicEn?: unknown }
    titleKo = textOf(shortened.titleKo)
    topicEn = textOf(shortened.topicEn)
  }
  if (
    !titleKo ||
    !topicEn ||
    !titleWithinCharacterLimit(topicEn, layout.titleSize) ||
    !parsed.changedScene ||
    typeof parsed.changedScene !== "object"
  ) {
    throw new Error("bad-json")
  }
  const plan = parsed.changedScene as {
    id?: unknown
    scriptTarget?: unknown
  }
  const scriptTarget = textOf(plan.scriptTarget)
  if (plan.id !== input.changedSceneId || !scriptTarget) {
    throw new Error("bad-json")
  }
  const scenes = input.scenes.map((scene) => {
    if (scene.id !== input.changedSceneId) {
      return scene
    }
    return {
      ...scene,
      approvedKo: scene.scriptKo,
      scriptTarget,
      subtitle: defaultSubtitle(scriptTarget),
      shot: "room" as const,
      productionMode: "character_motion" as const,
      sceneDescription: "화면 연출 대기",
      visualDescription: "",
      voiceScript: "",
      actionBeats: [],
      castIds: [],
    }
  })
  return {
    titleKo,
    topicEn,
    overviewKo: scenes
      .filter((scene) => scene.scriptKo !== CLOSING_KO)
      .map((scene) => scene.scriptKo)
      .join(" "),
    overviewEn: scenes
      .filter((scene) => scene.scriptKo !== CLOSING_KO)
      .map((scene) => scene.scriptTarget)
      .join(" "),
    scenes,
    youtube: applyYoutubeCopy({
      title: textOf(parsed.youtube?.title),
      description: textOf(parsed.youtube?.description),
      tags: textOf(parsed.youtube?.tags),
    }),
    instagram: { caption: textOf(parsed.instagramCaption) },
    tiktok: { caption: textOf(parsed.tiktokCaption) },
  }
}

export async function rewritePlace(input: {
  topic: string
  profileId: string
  overviewKo: string
  placeKo: string
  note: string
}) {
  const profile = await readProfile(input.profileId)
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
  const profile = await readProfile(input.profileId)
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
  const profile = await readProfile(input.profileId)
  const settings = await readVideoSettings(input.profileId)
  const support = await supportingCharacters(input.profileId)
  const text = await claudeText(
    profile.system_prompt,
    `Reply with one JSON object and no other text.
Do not change the spoken lines. Write only the place and each scene's shot and sceneDescription.
${visualRules}
${castRules(support)}
Topic: ${input.topic}
For each scene also select productionMode using the same cost rules: ordinary host explanation is character_motion; documents, maps, diagrams, numbers, and objects are graphic_motion or still_motion; continuous movement essential to the explanation may be ai_video. Use no more than ${settings.maxAiVideoScenes} ai_video scenes and ${settings.maxAiVideoSeconds} seconds total. The closing is always character_motion.
Shape: {"placeKo":"","placeEn":"","scenes":[{"id":"","shot":"room","productionMode":"character_motion","sceneDescription":"","castIds":[]}]}
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
    const row = item as {
      shot?: unknown
      productionMode?: unknown
      sceneDescription?: unknown
      castIds?: unknown
    }
    const sceneDescription = textOf(row.sceneDescription)
    if (!sceneDescription) {
      throw new Error("bad-json")
    }
    const closing = scene.scriptKo.trim() === CLOSING_KO
    return {
      id: scene.id,
      shot: closing ? ("room" as const) : parseShot(row.shot),
      productionMode: closing
        ? ("character_motion" as const)
        : normalizeProductionMode(row.productionMode, parseShot(row.shot)),
      sceneDescription: closing ? CLOSING_VISUAL : sceneDescription,
      castIds:
        parseShot(row.shot) === "insert"
          ? []
          : castIdsOf(
              row.castIds,
              support.map((person) => person.id)
            ),
    }
  })
  return { placeKo, placeEn, scenes: continueSupportingCast(scenes) }
}

export async function directStoryboard(input: {
  profileId: string
  topic: string
  scenes: Scene[]
  durations: Record<string, number>
  words: Record<string, WordTiming[]>
}) {
  const profile = await readProfile(input.profileId)
  const settings = await readVideoSettings(input.profileId)
  const support = await supportingCharacters(input.profileId)
  const timedScenes = input.scenes.map((scene) => ({
    id: scene.id,
    scriptKo: scene.scriptKo,
    scriptTarget: scene.scriptTarget,
    duration: Math.max(0, input.durations[scene.id] ?? 0),
    words: input.words[scene.id] ?? [],
  }))
  const text = await claudeText(
    profile.system_prompt,
    `Reply with one JSON object and no other text.
Act as the director after the narration and TTS timing are final. Design one coherent storyboard across the whole short. Do not change, translate, or rewrite any spoken line.
${visualRules}
${castRules(support)}
Use the measured duration of each narration beat to keep gestures simple enough to finish while the words are spoken. actionBeats triggers must be exact English words or short phrases copied from that scene's scriptTarget. A room scene has 1 to 3 actionBeats; an insert scene has none.
Balance the whole short rather than choosing every scene independently. Adjacent room narration beats with the same productionMode can share one continuous clip. Use insert scenes for facts that genuinely need an object, document, diagram, map, date, or place. Avoid repetitive room gestures and avoid decorative inserts that add no information.
Select productionMode by cost: character_motion for ordinary host explanation; graphic_motion or still_motion for documents, maps, numbers, diagrams, and objects; composite only when a registered character and fact plate must share a frame; ai_video only when continuous movement is essential. Across the whole short use no more than ${settings.maxAiVideoScenes} ai_video scenes and no more than ${settings.maxAiVideoSeconds} measured seconds. The closing is always a room scene using character_motion.
Topic: ${input.topic.trim()}
Final timed narration: ${JSON.stringify(timedScenes)}
Shape: {"scenes":[{"id":"","shot":"room","productionMode":"character_motion","sceneDescription":"","actionBeats":[{"trigger":"","action":""}],"castIds":[]}]}`,
    4096
  )
  const parsed = parseObject(text) as { scenes?: unknown }
  if (!Array.isArray(parsed.scenes) || parsed.scenes.length !== input.scenes.length) {
    throw new Error("bad-json")
  }
  const rows = new Map(
    parsed.scenes.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const row = item as {
        id?: unknown
        shot?: unknown
        productionMode?: unknown
        sceneDescription?: unknown
        actionBeats?: unknown
        castIds?: unknown
      }
      return typeof row.id === "string" ? [[row.id, row] as const] : []
    })
  )
  const allowedCastIds = support.map((person) => person.id)
  const planned = input.scenes.map((scene, index) => {
    const row = rows.get(scene.id)
    if (!row) throw new Error("bad-json")
    const closing = index === input.scenes.length - 1 || scene.scriptKo === CLOSING_KO
    const shot = closing ? ("room" as const) : parseShot(row.shot)
    const sceneDescription = closing
      ? CLOSING_VISUAL
      : textOf(row.sceneDescription)
    if (!sceneDescription) throw new Error("bad-json")
    return {
      ...scene,
      shot,
      productionMode: closing
        ? ("character_motion" as const)
        : normalizeProductionMode(row.productionMode, shot),
      sceneDescription,
      visualDescription: "",
      voiceScript: "",
      actionBeats:
        shot === "room"
          ? beatsOf(row.actionBeats, scene.scriptTarget, sceneDescription)
          : [],
      castIds:
        shot === "insert" ? [] : castIdsOf(row.castIds, allowedCastIds),
    }
  })
  return constrainTimedAiVideoUsage(
    continueSupportingCast(planned),
    input.durations,
    settings.maxAiVideoScenes,
    settings.maxAiVideoSeconds
  )
}

function constrainTimedAiVideoUsage(
  scenes: Scene[],
  durations: Record<string, number>,
  maxScenes: number,
  maxSeconds: number
) {
  let usedScenes = 0
  let usedSeconds = 0
  return scenes.map((scene) => {
    if (scene.productionMode !== "ai_video") return scene
    const seconds = Math.max(4, Math.ceil(durations[scene.id] ?? 0))
    if (usedScenes >= maxScenes || usedSeconds + seconds > maxSeconds) {
      return {
        ...scene,
        productionMode:
          scene.shot === "insert"
            ? ("graphic_motion" as const)
            : ("character_motion" as const),
      }
    }
    usedScenes += 1
    usedSeconds += seconds
    return scene
  })
}

function parseDraft(
  value: unknown,
  settings: Awaited<ReturnType<typeof readVideoSettings>>
): ScriptDraft {
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
      productionMode?: unknown
      sceneDescription?: unknown
      actionBeats?: unknown
      castIds?: unknown
    }
    const scriptKo = textOf(scene.scriptKo)
    const scriptTarget = textOf(scene.scriptTarget)
    if (!scriptKo || !scriptTarget) {
      throw new Error("bad-json")
    }
    return {
      id: "scene-00",
      scriptKo,
      approvedKo: scriptKo,
      scriptTarget,
      subtitle: defaultSubtitle(scriptTarget),
      shot: "room" as const,
      productionMode: "character_motion" as const,
      sceneDescription: "화면 연출 대기",
      visualDescription: "",
      voiceScript: "",
      actionBeats: [],
      castIds: [],
    }
  })
  const body = continueSupportingCast(drafted)
    .filter((scene) => scene.scriptKo !== CLOSING_KO)
    .slice(0, 7)
  if (body.length < 5) {
    throw new Error("bad-json")
  }
  const ending = {
    ...closingScene(body.length + 1),
    castIds: body.at(-1)?.castIds ?? [],
  }
  const scenes = constrainAiVideoUsage(
    [...body, ending],
    settings.maxAiVideoScenes,
    settings.maxAiVideoSeconds
  ).map(
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

type SupportingCharacter = { id: string; name: string }

async function supportingCharacters(
  profileId: string
): Promise<SupportingCharacter[]> {
  const library = await getCharacterLibrary(profileId)
  return library.outfits
    .filter(
      (person) =>
        person.id !== library.hostId && person.active && person.front !== null
    )
    .map((person) => ({ id: person.id, name: person.name }))
}

function castRules(support: SupportingCharacter[]) {
  if (support.length === 0) {
    return "No supporting character is available. Every scene must use an empty castIds array."
  }
  return `Available silent supporting characters: ${JSON.stringify(support)}.
castIds contains only IDs from that list. The host is always present in room scenes and is never included in castIds. Use an empty array by default. Select a supporting character only when a silent reaction, comparison, or simple demonstration materially helps explain that scene; never add one merely to fill the picture. Use at most one unless the fact genuinely requires comparing two. Supporting characters never speak. Insert scenes always use an empty castIds array. Once a supporting character first appears, keep that ID in every later room scene through the closing. When castIds is not empty, sceneDescription may include one small silent gesture from that support character while the host remains the speaker.`
}

function castIdsOf(value: unknown, allowed: string[]) {
  if (!Array.isArray(value)) return []
  const permitted = new Set(allowed)
  return [...new Set(value)].filter(
    (id): id is string => typeof id === "string" && permitted.has(id)
  )
}

function continueSupportingCast<T extends { shot: ShotKind; castIds: string[] }>(
  scenes: T[]
) {
  const present = new Set<string>()
  return scenes.map((scene) => {
    if (scene.shot === "insert") {
      return { ...scene, castIds: [] }
    }
    for (const id of scene.castIds) present.add(id)
    return { ...scene, castIds: [...present] }
  })
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
