import assert from "node:assert/strict"
import test from "node:test"

import {
  buildLayoutAss,
  buildTimedSrt,
  cueSlices,
  frameVideoFilter,
} from "./frame-render.ts"
import { normalizeFrameLayout } from "./frame-layout.ts"

test("고정 화면 필터는 영상을 제목 칸 아래에 맞춘다", () => {
  const filter = frameVideoFilter(
    normalizeFrameLayout({ mode: "split", titleHeight: 20, subtitleHeight: 20 })
  )

  assert.match(filter, /force_original_aspect_ratio=increase/)
  assert.match(filter, /crop=1080:1440/)
  assert.match(filter, /pad=1080:1920:0:480:0x111111/)
})

test("ASS 문서는 고른 글꼴과 자막 위치를 쓴다", () => {
  const layout = normalizeFrameLayout({
    fontWeight: 500,
    titleSize: 60,
    subtitleSize: 50,
    subtitleY: 90,
  })
  const ass = buildLayoutAss(layout, "테스트 제목", [
    { subtitle: "First line", duration: 4 },
    { subtitle: "Second\nline", duration: 5 },
  ])

  assert.match(ass, /Pretendard Medium,72/)
  assert.match(ass, /Pretendard Medium,60/)
  assert.match(ass, /Style: Title,.*?,76,76,0,1/)
  assert.match(ass, /Style: Subtitle,.*?,108,108,0,1/)
  assert.match(ass, /&H80000000/)
  assert.match(ass, /\\an2\\pos\(540,410\).*테스트 제목/)
  assert.match(ass, /\\an8\\pos\(540,1752\)\\xbord24\\ybord24.*First line/)
  assert.match(ass, /0:00:04\.00,0:00:06\.50.*Second/)
  assert.match(ass, /0:00:06\.50,0:00:09\.00.*line/)
})

test("빈 자막은 다음 자막 시각을 당기지 않는다", () => {
  const srt = buildTimedSrt([
    { subtitle: "   ", duration: 2 },
    { subtitle: "Next", duration: 1 },
  ])

  assert.match(srt, /00:00:02,000 --> 00:00:03,000\nNext/)
})

test("줄바꿈은 단어 수에 맞춰 음성 구간으로 나뉜다", () => {
  const srt = buildTimedSrt([{ subtitle: "one two\nthree", duration: 3 }])

  assert.match(srt, /00:00:00,000 --> 00:00:02,000\none two/)
  assert.match(srt, /00:00:02,000 --> 00:00:03,000\nthree/)
})

test("실제 장면 음성 길이로 YouTube SRT를 만든다", () => {
  const srt = buildTimedSrt([
    { subtitle: "First line", duration: 2.5 },
    { subtitle: "Second line", duration: 3 },
  ])

  assert.match(srt, /00:00:00,000 --> 00:00:02,500/)
  assert.match(srt, /00:00:02,500 --> 00:00:05,500/)
})

test("720p 최종 캔버스도 같은 9:16 배치를 사용한다", () => {
  const layout = normalizeFrameLayout({ outputSize: "720x1280" })
  const filter = frameVideoFilter(layout)
  const ass = buildLayoutAss(layout, "Title", [
    { subtitle: "Caption", duration: 2 },
  ])

  assert.match(filter, /crop=720:960/)
  assert.match(filter, /pad=720:1280:0:320/)
  assert.match(ass, /PlayResX: 720/)
  assert.match(ass, /PlayResY: 1280/)
})

test("저장된 TTS 단어 경계로 자막 줄 전환 시각을 정한다", () => {
  const cues = cueSlices("one two\nthree", 3, [
    { word: "one", start: 0, end: 0.5 },
    { word: "two", start: 0.5, end: 1.4 },
    { word: "three", start: 1.4, end: 3 },
  ])

  assert.equal(cues[0]?.duration, 1.4)
  assert.equal(cues[1]?.duration, 1.6)
})
