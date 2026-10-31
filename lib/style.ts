export const DEFAULT_IMAGE_STYLE_ANCHOR =
  "2D flat vector illustration, cute chibi style, a white rooster with a black turtleneck sweater and round glasses, clean lines, minimalist aesthetic, cozy dark atmosphere"

export function buildScenePrompt(anchor: string, sceneDescription: string) {
  const description = sceneDescription.trim()
  if (!description) {
    return anchor
  }
  return `${anchor}, ${description}`
}

export function buildCoverPrompt(anchor: string, topic: string) {
  const subject = topic.trim()
  if (!subject) {
    return anchor
  }
  return `${anchor}, cover image of: ${subject}`
}
