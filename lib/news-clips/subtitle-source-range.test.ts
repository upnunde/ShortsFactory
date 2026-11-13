import assert from "node:assert/strict"
import test from "node:test"

import { NEWS_SOURCE_PLAYBACK_RATE } from "./playback.ts"
import { reportSubtitles } from "./report.ts"
import { subtitleCueSourceRange } from "./subtitle-source-range.ts"
import {
  automaticSubtitleCueCharacterLimit,
  layoutTimedSubtitleCues,
  subtitleLineCharacterLimit,
} from "./text-layout.ts"
import {
  defaultNewsClipSettings,
  type NewsReportScene,
  type SubtitleCue,
  type TranscriptSegment,
} from "./types.ts"

const layout = defaultNewsClipSettings.bodySubtitleText
const scene: NewsReportScene = {
  id: "buildup2-quote-cut-1",
  narration: "",
  part: "body",
  audioMode: "original",
  visualMode: "quote",
  visual: "quote",
  sourceId: "source-1",
  sourceStart: 100,
  sourceEnd: 112,
}
const transcript: TranscriptSegment[] = [
  segment("speech-1", "첫 번째 핵심 발언입니다.", 100.6, 103.1),
  segment("speech-2", "두 번째 문제 제기입니다.", 103.5, 106.4),
  segment("speech-3", "마지막 결론을 말했습니다.", 107, 110.8),
]

function segment(id: string, text: string, start: number, end: number) {
  return {
    id,
    text,
    start,
    end,
    speaker: "speaker-1",
    words: [{ text, start, end }],
    captionBoundaryAfter: true,
    captionBoundarySource: "manual" as const,
  } satisfies TranscriptSegment
}

function localCues() {
  return layoutTimedSubtitleCues(
    reportSubtitles([scene], undefined, undefined, transcript, {
      maxCaptionCharacters: automaticSubtitleCueCharacterLimit(layout),
      preferredCaptionCharacters: subtitleLineCharacterLimit(layout),
    }),
    layout
  )
}

test("저장된 원본 경계가 있으면 출력 시간이나 수정 문구와 무관하게 우선한다", () => {
  const cue = {
    id: "edited-caption",
    sceneId: scene.id,
    start: 40,
    end: 42,
    text: "사용자가 완전히 바꾼 문구",
    emphasis: [],
    emphasisColor: "yellow",
    edited: true,
    sourceStart: 103.25,
    sourceEnd: 105.75,
  } satisfies SubtitleCue & { sourceStart: number; sourceEnd: number }

  assert.deepEqual(subtitleCueSourceRange(cue, [scene], transcript, layout), {
    start: 103.25,
    end: 105.75,
    sceneId: scene.id,
  })
})

test("레거시 자막은 전체 출력 오프셋을 무시하고 장면 단어 시간으로 복원한다", () => {
  const generated = localCues()
  const target = generated[0]!
  const combinedTimelineCue: SubtitleCue = {
    ...target,
    start: target.start + 17.4,
    end: target.end + 17.4,
    text: "오타를 고친 문구",
    originalText: target.text,
    edited: true,
  }

  assert.deepEqual(
    subtitleCueSourceRange(combinedTimelineCue, [scene], transcript, layout),
    {
      start: round(
        scene.sourceStart + target.start * NEWS_SOURCE_PLAYBACK_RATE
      ),
      end: round(scene.sourceStart + target.end * NEWS_SOURCE_PLAYBACK_RATE),
      sceneId: scene.id,
    }
  )
})

test("다음 자막과 합친 레거시 cue는 첫 시작점부터 넓어진 전체 시간을 삭제한다", () => {
  const generated = localCues()
  assert.ok(generated.length >= 2)
  const first = generated[0]!
  const second = generated[1]!
  const outputOffset = 9.2
  const legacyFirst: SubtitleCue = { ...first }
  delete legacyFirst.sourceStart
  delete legacyFirst.sourceEnd
  const merged: SubtitleCue = {
    ...legacyFirst,
    start: first.start + outputOffset,
    end: second.end + outputOffset,
    text: `${first.text} ${second.text}`,
    originalText: `${first.text} ${second.text}`,
    edited: true,
  }

  assert.deepEqual(
    subtitleCueSourceRange(merged, [scene], transcript, layout),
    {
      start: round(scene.sourceStart + first.start * NEWS_SOURCE_PLAYBACK_RATE),
      end: round(
        scene.sourceStart +
          (first.start + (merged.end - merged.start)) *
            NEWS_SOURCE_PLAYBACK_RATE
      ),
      sceneId: scene.id,
    }
  )
})

test("TTS 장면이나 장면을 식별할 수 없는 자막은 원본 삭제 범위를 만들지 않는다", () => {
  const cue: SubtitleCue = {
    id: "speech-caption",
    sceneId: "tts-scene",
    start: 0,
    end: 1,
    text: "서두",
    emphasis: [],
    emphasisColor: "yellow",
  }
  const ttsScene: NewsReportScene = {
    ...scene,
    id: "tts-scene",
    audioMode: "tts",
  }

  assert.equal(
    subtitleCueSourceRange(cue, [ttsScene], transcript, layout),
    null
  )
  assert.equal(
    subtitleCueSourceRange(
      { ...cue, sceneId: "missing" },
      [scene],
      transcript,
      layout
    ),
    null
  )
})

function round(value: number) {
  return Math.round(value * 1000) / 1000
}
