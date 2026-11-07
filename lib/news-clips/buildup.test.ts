import assert from "node:assert/strict"
import test from "node:test"

import {
  collapseBuildupHighlightCuts,
  densifySourceKeeps,
  expandScenesWithSilenceCuts,
  keepRangesInside,
} from "./buildup.ts"

test("무음 구간을 제외한 keep 구간을 만든다", () => {
  const keeps = keepRangesInside(
    10,
    20,
    [
      { id: "s1", start: 12, end: 14, reason: "silence", restored: false },
      { id: "s2", start: 16.2, end: 16.4, reason: "silence", restored: false },
    ],
    0.35
  )
  assert.deepEqual(keeps, [
    { start: 10, end: 12 },
    { start: 14, end: 20 },
  ])
})

test("원본 음성 quote는 무음 기준으로 장면을 쪼개지 않는다", () => {
  const scenes = expandScenesWithSilenceCuts(
    [
      {
        id: "buildup-highlight",
        narration: "원본 발언",
        visual: "quote",
        sourceStart: 10,
        sourceEnd: 20,
      },
    ],
    [{ id: "s1", start: 12, end: 15, reason: "silence", restored: false }]
  )
  assert.equal(scenes.length, 1)
  assert.equal(scenes[0]?.id, "buildup-highlight")
  assert.equal(scenes[0]?.sourceStart, 10)
  assert.equal(scenes[0]?.sourceEnd, 20)
})

test("자료 화면은 TTS 길이에 맞춰 무음을 건너뛴 keep을 모은다", () => {
  const packed = densifySourceKeeps(
    10,
    20,
    [{ id: "s1", start: 12, end: 15, reason: "silence", restored: false }],
    5,
    40
  )
  assert.deepEqual(packed, [
    { start: 10, end: 12 },
    { start: 15, end: 18 },
  ])
  const total = packed.reduce((sum, keep) => sum + keep.end - keep.start, 0)
  assert.ok(Math.abs(total - 5) < 0.01)
})

test("겹친 하이라이트 컷을 한 장면으로 합친다", () => {
  const collapsed = collapseBuildupHighlightCuts([
    {
      id: "buildup-teaser",
      narration: "들어봐",
      visual: "source",
      sourceStart: 100,
      sourceEnd: 103,
    },
    {
      id: "buildup-highlight-cut-1",
      narration: "",
      visual: "quote",
      sourceStart: 100,
      sourceEnd: 105,
    },
    {
      id: "buildup-highlight-cut-2",
      narration: "",
      visual: "quote",
      sourceStart: 100,
      sourceEnd: 112,
    },
    {
      id: "end-cta",
      narration: "댓글",
      visual: "source",
      sourceStart: 100,
      sourceEnd: 102.5,
    },
  ])
  assert.equal(collapsed.length, 3)
  assert.equal(collapsed[1]?.id, "buildup-highlight")
  assert.equal(collapsed[1]?.sourceStart, 100)
  assert.equal(collapsed[1]?.sourceEnd, 112)
})
