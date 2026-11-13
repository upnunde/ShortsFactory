import { NEWS_SOURCE_PLAYBACK_RATE } from "./playback.ts"
import { reportSceneAudioMode, reportSubtitles } from "./report.ts"
import {
  automaticSubtitleCueCharacterLimit,
  layoutTimedSubtitleCues,
  subtitleLineCharacterLimit,
} from "./text-layout.ts"
import type {
  NewsReportScene,
  NewsTextLayout,
  SubtitleCue,
  TranscriptSegment,
} from "./types.ts"

type SourceTimedSubtitleCue = SubtitleCue & {
  /** New previews persist these absolute source-media boundaries. */
  sourceStart?: number
  sourceEnd?: number
}

export type SubtitleSourceRange = {
  start: number
  end: number
  sceneId: string
}

/**
 * Converts a rendered subtitle cue back to the absolute source-media range.
 *
 * New previews use the persisted source range directly. Legacy previews only
 * stored the combined output timeline, so their scene-local cues are rebuilt
 * from word timestamps and matched by the stable cue id. The current cue
 * duration is used when the user merged adjacent cues, preserving the entire
 * merged interval even if its text was edited.
 */
export function subtitleCueSourceRange(
  cue: SubtitleCue,
  scenes: NewsReportScene[],
  transcript: TranscriptSegment[],
  layout: NewsTextLayout
): SubtitleSourceRange | null {
  if (!cue.sceneId) return null
  const scene = scenes.find((item) => item.id === cue.sceneId)
  if (!scene || reportSceneAudioMode(scene) !== "original") return null

  const sceneStart = Math.min(scene.sourceStart, scene.sourceEnd)
  const sceneEnd = Math.max(scene.sourceStart, scene.sourceEnd)
  if (
    !Number.isFinite(sceneStart) ||
    !Number.isFinite(sceneEnd) ||
    sceneEnd - sceneStart < 0.1
  ) {
    return null
  }

  const persisted = cue as SourceTimedSubtitleCue
  if (
    Number.isFinite(persisted.sourceStart) &&
    Number.isFinite(persisted.sourceEnd)
  ) {
    return clampSourceRange(
      persisted.sourceStart!,
      persisted.sourceEnd!,
      sceneStart,
      sceneEnd,
      scene.id
    )
  }

  const regenerated = layoutTimedSubtitleCues(
    reportSubtitles([scene], undefined, undefined, transcript, {
      maxCaptionCharacters: automaticSubtitleCueCharacterLimit(layout),
      preferredCaptionCharacters: subtitleLineCharacterLimit(layout),
    }),
    layout
  )
  const matched = findLegacyCueMatch(cue, regenerated)
  if (!matched) return null

  const matchedSourceStart =
    sceneStart + matched.start * NEWS_SOURCE_PLAYBACK_RATE
  const matchedSourceEnd = sceneStart + matched.end * NEWS_SOURCE_PLAYBACK_RATE
  const currentOutputDuration = Math.max(0, cue.end - cue.start)
  const matchedOutputDuration = Math.max(0, matched.end - matched.start)
  // A merge keeps the first cue id while widening start~end. Detect that
  // widened interval rather than relying on editable text or `edited` state.
  const sourceEnd =
    currentOutputDuration > matchedOutputDuration + 0.05
      ? matchedSourceStart + currentOutputDuration * NEWS_SOURCE_PLAYBACK_RATE
      : matchedSourceEnd

  return clampSourceRange(
    matchedSourceStart,
    sourceEnd,
    sceneStart,
    sceneEnd,
    scene.id
  )
}

function findLegacyCueMatch(cue: SubtitleCue, regenerated: SubtitleCue[]) {
  const exact = regenerated.find((item) => item.id === cue.id)
  if (exact) return exact

  const originalText = normalizeCaptionText(cue.originalText ?? cue.text)
  const byText = regenerated.find(
    (item) => normalizeCaptionText(item.text) === originalText
  )
  if (byText) return byText

  // Layout splitting appends `-N` to the stable speech cue id. Prefer the
  // longest shared prefix so scene ids containing numbers remain unambiguous.
  return regenerated
    .filter(
      (item) =>
        cue.id.startsWith(`${item.id}-`) || item.id.startsWith(`${cue.id}-`)
    )
    .sort((left, right) => right.id.length - left.id.length)[0]
}

function clampSourceRange(
  rawStart: number,
  rawEnd: number,
  sceneStart: number,
  sceneEnd: number,
  sceneId: string
): SubtitleSourceRange | null {
  const start = round(Math.max(sceneStart, Math.min(sceneEnd, rawStart)))
  const end = round(Math.max(start, Math.min(sceneEnd, rawEnd)))
  if (end - start < 0.04) return null
  return { start, end, sceneId }
}

function normalizeCaptionText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLowerCase()
}

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
