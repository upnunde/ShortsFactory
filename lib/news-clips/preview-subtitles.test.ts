import assert from "node:assert/strict"
import test from "node:test"

import {
  localizeLockedSubtitleCues,
  preservePreviewSubtitleEdits,
} from "./preview-subtitles.ts"
import type { SubtitleCue } from "./types.ts"

const edited: SubtitleCue = {
  id: "body-caption-4",
  sceneId: "buildup2-quote-cut-1",
  start: 10,
  end: 12,
  text: "내가 고친 첫 줄\n내가 고친 둘째 줄",
  originalText: "자동 자막 원문",
  emphasis: ["고친"],
  emphasisColor: "yellow",
  edited: true,
}

test("시간 잠금이 풀려도 동일 ID의 수동 자막 문구는 새 시간 위에 유지한다", () => {
  const rendered: SubtitleCue[] = [
    {
      ...edited,
      start: 10.4,
      end: 12.6,
      text: "재전사로 달라진 자동 문구",
      originalText: undefined,
      emphasis: [],
      edited: false,
    },
  ]

  const result = preservePreviewSubtitleEdits([edited], rendered, false)

  assert.equal(result[0]?.text, edited.text)
  assert.deepEqual(result[0]?.emphasis, edited.emphasis)
  assert.equal(result[0]?.start, 10.4)
  assert.equal(result[0]?.end, 12.6)
  assert.equal(result[0]?.edited, true)
})

test("시간을 다시 계산해도 사용자가 합친 자막은 다시 분리하지 않는다", () => {
  const first: SubtitleCue = {
    id: "quote-caption-scene-1-1",
    sceneId: "scene-1",
    start: 3,
    end: 4,
    sourceStart: 30,
    sourceEnd: 31,
    text: "첫 구간",
    emphasis: [],
    emphasisColor: "yellow",
  }
  const second: SubtitleCue = {
    ...first,
    id: "quote-caption-scene-1-2",
    start: 4,
    end: 5.5,
    sourceStart: 31,
    sourceEnd: 32.5,
    text: "둘째 구간",
  }
  const merged: SubtitleCue = {
    ...first,
    end: second.end,
    sourceEnd: second.sourceEnd,
    text: "첫 구간 둘째 구간",
    originalText: "첫 구간 둘째 구간",
    mergedFrom: [first, second],
    edited: true,
  }
  const rendered = [
    { ...first, start: 3.2, end: 4.1 },
    { ...second, start: 4.1, end: 5.8 },
  ]

  const result = preservePreviewSubtitleEdits([merged], rendered, false)

  assert.equal(result.length, 1)
  assert.equal(result[0]?.text, "첫 구간 둘째 구간")
  assert.equal(result[0]?.start, 3.2)
  assert.equal(result[0]?.end, 5.8)
  assert.deepEqual(result[0]?.mergedFrom, [first, second])
})

test("잠긴 수동 자막은 문구·시간을 유지하고 TTS 자동 칸은 렌더를 받는다", () => {
  const result = preservePreviewSubtitleEdits(
    [edited],
    [{ ...edited, start: 20, end: 25, text: "자동 문구", edited: false }],
    true
  )

  assert.equal(result.length, 1)
  assert.equal(result[0]?.text, edited.text)
  assert.equal(result[0]?.start, edited.start)
  assert.equal(result[0]?.end, edited.end)
  assert.equal(result[0]?.edited, true)
})

test("잠긴 본문에서도 현재 장면에서 제외된 이전 자막은 다시 붙이지 않는다", () => {
  const stale = {
    ...edited,
    id: "stale-caption",
    sceneId: "removed-scene",
    text: "이전 자막",
  }
  const result = preservePreviewSubtitleEdits(
    [edited, stale],
    [{ ...edited, start: 20, end: 25, text: "자동 문구", edited: false }],
    true
  )

  assert.equal(result.length, 1)
  assert.equal(result[0]?.id, edited.id)
  assert.equal(result[0]?.text, edited.text)
  assert.ok(result.every((cue) => cue.id !== stale.id))
})

test("서두를 다시 만든 speech-caption은 잠긴 상태에서도 목록에 남는다", () => {
  const oldLead = {
    id: "speech-caption-buildup2-lead-1",
    sceneId: "buildup2-lead",
    start: 0,
    end: 1,
    text: "옛 서두",
    emphasis: [] as string[],
    emphasisColor: "yellow" as const,
  }
  const quote = {
    id: "quote-caption-buildup2-quote-1",
    sceneId: "buildup2-quote",
    start: 5,
    end: 7,
    text: "원본 발언",
    emphasis: [] as string[],
    emphasisColor: "yellow" as const,
  }
  const rendered = [
    {
      ...oldLead,
      id: "speech-caption-buildup2-lead-1",
      start: 0.2,
      end: 1.4,
      text: "새 서두 첫 칸",
    },
    {
      ...oldLead,
      id: "speech-caption-buildup2-lead-2",
      start: 1.4,
      end: 2.5,
      text: "새 서두 둘째 칸",
    },
    { ...quote, start: 5.1, end: 7.2, text: "렌더 원본" },
  ]

  const result = preservePreviewSubtitleEdits([oldLead, quote], rendered, true)

  assert.equal(result.length, 3)
  assert.equal(result[0]?.text, "새 서두 첫 칸")
  assert.equal(result[1]?.text, "새 서두 둘째 칸")
  assert.equal(result[2]?.text, "원본 발언")
  assert.equal(result[2]?.start, 5)
  assert.equal(result[2]?.end, 7)
})

test("보도형은 잠긴 문구를 유지한 렌더의 TTS 실측 시간을 받아들인다", () => {
  const rendered = [{ ...edited, start: 10.4, end: 12.6 }]
  const result = preservePreviewSubtitleEdits([edited], rendered, true, {
    acceptRenderedLockedTimings: true,
  })

  assert.deepEqual(result, rendered)
})

test("부분 렌더가 자막을 돌려주지 않아도 현재 수정본을 비우지 않는다", () => {
  assert.deepEqual(preservePreviewSubtitleEdits([edited], undefined, false), [
    edited,
  ])
})

test("합본에서 남은 약 1초 오프셋은 실제 파트 길이에 맞춰 제거한다", () => {
  const result = localizeLockedSubtitleCues(
    [
      { ...edited, start: 8.28, end: 9.41 },
      { ...edited, id: "last", start: 33.11, end: 34.08 },
    ],
    7.3,
    25.84
  )

  assert.equal(result[0]?.start, 0.04)
  assert.equal(result[0]?.end, 1.17)
  assert.equal(result[1]?.end, 25.84)
})

test("파트 안에 정상적으로 들어오는 잠긴 시간은 변경하지 않는다", () => {
  const result = localizeLockedSubtitleCues(
    [{ ...edited, start: 8.2, end: 9.5 }],
    7.3,
    25.84
  )

  assert.equal(result[0]?.start, 0.9)
  assert.equal(result[0]?.end, 2.2)
})
