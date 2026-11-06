export type NewsClipChange =
  | "range"
  | "silence"
  | "subtitle"
  | "frame"
  | "bgm"
  | "title"
  | "crop"
  | "audio"

export type NewsClipArtifact =
  "timeline" | "subtitles" | "titleFrame" | "thumbnail" | "metadata" | "render"

const INVALIDATION: Record<NewsClipChange, NewsClipArtifact[]> = {
  range: ["timeline", "subtitles", "render"],
  silence: ["timeline", "subtitles", "render"],
  subtitle: ["subtitles", "render"],
  frame: ["titleFrame", "thumbnail", "render"],
  bgm: ["render"],
  title: ["titleFrame", "thumbnail", "metadata", "render"],
  crop: ["render"],
  audio: ["render"],
}

export function invalidatedArtifacts(change: NewsClipChange) {
  return [...INVALIDATION[change]]
}
