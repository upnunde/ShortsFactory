export const DRAWING_STYLE =
  "2D flat vector illustration, cute chibi style, clean lines, minimalist aesthetic, cozy dark atmosphere"

export const CHARACTER_LOOK =
  "a white rooster with a black turtleneck sweater, round glasses, blue jeans, and grey sneakers"

export const DEFAULT_IMAGE_STYLE_ANCHOR = `${DRAWING_STYLE}, ${CHARACTER_LOOK}`

export function buildScenePrompt(input: {
  anchor: string
  place: string
  shot: "room" | "insert"
  sceneDescription: string
}) {
  const action = input.sceneDescription.trim()
  if (input.shot === "insert") {
    return `${DRAWING_STYLE}, an insert plate with no character in frame, ${action || "the fact as an object plate"}`
  }
  const room = input.place.trim() || "the same ordinary room"
  return `${input.anchor}, the same room in every room shot: ${room}. Action only: ${action || "stands in the room"}. Do not change the character, the outfit, or the room.`
}

export function buildCoverPrompt(anchor: string, topic: string) {
  const subject = topic.trim()
  if (!subject) {
    return anchor
  }
  return `${anchor}, cover image of: ${subject}`
}
