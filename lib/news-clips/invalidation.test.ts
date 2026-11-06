import assert from "node:assert/strict"
import test from "node:test"

import { invalidatedArtifacts } from "./invalidation.ts"

test("구간 변경은 타임라인·자막·렌더만 무효화한다", () => {
  assert.deepEqual(invalidatedArtifacts("range"), [
    "timeline",
    "subtitles",
    "render",
  ])
  assert.deepEqual(invalidatedArtifacts("title"), [
    "titleFrame",
    "thumbnail",
    "metadata",
    "render",
  ])
  assert.deepEqual(invalidatedArtifacts("bgm"), ["render"])
})
