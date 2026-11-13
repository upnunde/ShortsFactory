import assert from "node:assert/strict"
import test from "node:test"

import { projectPatchInvalidatesSubtitleTimeline } from "./project-edit.ts"

test("화면·음량·게시 정보 변경은 4번 자막 잠금을 유지한다", () => {
  assert.equal(
    projectPatchInvalidatesSubtitleTimeline([
      "crop",
      "introStillZoom",
      "bgmVolume",
      "youtubeScheduledAt",
    ]),
    false
  )
})

test("대본·장면·원문 구간 변경은 자막 시간을 다시 계산한다", () => {
  for (const key of [
    "reportScript",
    "reportScenes",
    "transcript",
    "removedRanges",
    "keepRanges",
  ]) {
    assert.equal(projectPatchInvalidatesSubtitleTimeline([key]), true)
  }
})
