import assert from "node:assert/strict"
import test from "node:test"

import { applyYoutubeCopy } from "./youtube-metadata.ts"

test("유튜브 설명에 질문과 해시태그를 강제로 남기지 않는다", () => {
  const copy = applyYoutubeCopy({
    title: " Test ",
    description:
      "A short summary.\n\nWhich fact surprised you the most? Comment below!\n\n#Shorts #facts",
    tags: "space",
  })

  assert.equal(copy.title, "Test")
  assert.equal(copy.description, "A short summary.")
  assert.match(copy.tags, /space/)
})
