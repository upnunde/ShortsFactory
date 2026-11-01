import { narrationSeconds } from "./timing.ts"
import type { ActionBeat, ShotKind } from "./types.ts"
import type { WordTiming } from "./voice-timing.ts"

export type FilmScene = {
  id: string
  shot: ShotKind
  sceneDescription: string
  scriptTarget: string
  subtitle: string
  actionBeats: ActionBeat[]
  castIds: string[]
}

export type FilmLink = "start" | "continue" | "insert" | "return"

export function clipSeconds(narration: string) {
  const seconds = Math.ceil(narrationSeconds(narration))
  return Math.min(15, Math.max(4, seconds || 4))
}

export function filmLink(scenes: FilmScene[], index: number): FilmLink {
  const scene = scenes[index]
  if (!scene || scene.shot === "insert") {
    return "insert"
  }
  const previous = scenes[index - 1]
  if (!previous) {
    return "start"
  }
  return previous.shot === "room" ? "continue" : "return"
}

const characterLock = [
  "The character stays the same individual as the opening frame for the whole shot.",
  "Same face, glasses, beak, comb, wings, colors, and outfit.",
    "The character is the host explaining to the camera, not a person inside the story.",
    "Do not restyle or replace the character, do not change the outfit, and do not redesign the room.",
].join(" ")

export function roomStillPrompt(anchor: string, place: string, withSupport = false) {
  return [
    anchor,
    place,
    "Portrait 3:4 still. The picture fills the frame edge to edge.",
    "The same rooster from the reference photos faces the camera as the host, full body visible.",
    "The host explains from this room and does not enter the topic's event.",
    "Match that rooster exactly: same face, glasses, beak, comb, wings, colors, and outfit.",
    withSupport
      ? "The later reference photos are supporting characters standing with the host. Match each one exactly and keep them in this room."
      : "",
    "Do not invent a different character.",
    "No text.",
  ]
    .filter(Boolean)
    .join(" ")
}

export function insertStillPrompt(description: string) {
  return [
    "Flat editorial illustration, warm lamp light, dark cozy background, portrait 3:4. The picture fills the frame edge to edge.",
    description,
    "An object plate with no character, no person, and no animal.",
    "No text.",
  ].join(" ")
}

export function groupClipPrompt(
  scenes: FilmScene[],
  link: FilmLink,
  words: WordTiming[] = []
) {
  const scene = scenes[0]
  if (!scene || scenes.length === 1) {
    return clipPrompt(
      scene ?? {
        id: "",
        shot: "room",
        sceneDescription: "",
        scriptTarget: "",
        subtitle: "",
        actionBeats: [],
        castIds: [],
      },
      link,
      words
    )
  }
  const line = scenes
    .map((item) => item.scriptTarget.trim())
    .filter(Boolean)
    .join(" ")
  const action = scenes
    .map((item) => item.sceneDescription.trim())
    .filter(Boolean)
    .join(" Then ")
  return [
    characterLock,
    `Action only: ${action}.`,
    timedActionPrompt(
      scenes.flatMap((item) => item.actionBeats),
      words
    ),
    `The English narration will be added later: "${line}"`,
    "Do not generate speech. Keep the beak movement subtle.",
    "No subtitles and no captions.",
  ].join(" ")
}

export function clipPrompt(
  scene: FilmScene,
  link: FilmLink,
  words: WordTiming[] = []
) {
  const line = scene.scriptTarget.trim()
  if (link === "insert") {
    return [
      "Keep this exact plate.",
      "Nothing new enters the frame and no character appears.",
      `The English narration will be added later: "${line}"`,
      "Do not generate speech or visible speakers.",
      "No subtitles and no captions.",
    ].join(" ")
  }
  return [
    characterLock,
    `Action only: ${scene.sceneDescription}.`,
    timedActionPrompt(scene.actionBeats, words),
    `The English narration will be added later: "${line}"`,
    "Do not generate speech. Keep the beak movement subtle.",
    "No subtitles and no captions.",
  ].join(" ")
}

export function timedActionPrompt(beats: ActionBeat[], words: WordTiming[]) {
  if (beats.length === 0) {
    return "Use one calm, readable motion during the shot."
  }
  const duration = words.at(-1)?.end ?? Math.max(1, beats.length + 1)
  return beats
    .map((beat, index) => {
      const trigger = normalizeWord(beat.trigger.split(/\s+/)[0] ?? "")
      const match = words.find((word) => normalizeWord(word.word) === trigger)
      const at = match?.start ?? (duration * (index + 1)) / (beats.length + 1)
      return `At ${at.toFixed(2)} seconds, ${beat.action}.`
    })
    .join(" ")
}

function normalizeWord(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")
}
