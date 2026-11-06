import assert from "node:assert/strict"
import test from "node:test"

import { newsRenderSettingsKey } from "./render-key.ts"
import { defaultNewsClipSettings } from "./types.ts"

test("프레임과 폰트 설정이 바뀌면 이전 영상 렌더 키를 재사용하지 않는다", () => {
  const original = newsRenderSettingsKey(defaultNewsClipSettings)
  const changedFrame = newsRenderSettingsKey({
    ...defaultNewsClipSettings,
    titleFrameImage: "/news/title-v2.png",
  })
  const changedFont = newsRenderSettingsKey({
    ...defaultNewsClipSettings,
    titleCardSecondFontSize:
      defaultNewsClipSettings.titleCardSecondFontSize + 10,
  })

  assert.notEqual(original, changedFrame)
  assert.notEqual(original, changedFont)
  assert.equal(original, newsRenderSettingsKey(defaultNewsClipSettings))
})
