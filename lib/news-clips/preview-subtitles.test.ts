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

test("잠긴 자막은 렌더 응답과 무관하게 문구와 시간을 모두 유지한다", () => {
  const result = preservePreviewSubtitleEdits(
    [edited],
    [{ ...edited, start: 20, end: 25, text: "자동 문구" }],
    true
  )

  assert.deepEqual(result, [edited])
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
