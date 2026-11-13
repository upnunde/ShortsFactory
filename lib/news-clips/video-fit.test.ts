import assert from "node:assert/strict"
import test from "node:test"

import {
  buildMediaMotionFilter,
  buildScaleCropFilter,
  newsMediaMotionAmount,
} from "./video-fit.ts"

test("일반 영상은 1배 확대에서도 cover 경로를 탄다", () => {
  const filter = buildScaleCropFilter({
    targetWidth: 1080,
    targetHeight: 1920,
    zoom: 1,
    cropX: "(iw-ow)*0.5",
    cropY: "(ih-oh)*0.5",
  })
  assert.match(filter, /force_original_aspect_ratio=increase/)
})

test("이미지는 명시한 경우에만 contain 경로를 탄다", () => {
  const filter = buildScaleCropFilter({
    targetWidth: 1080,
    targetHeight: 1920,
    zoom: 1,
    cropX: "(iw-ow)*0.5",
    cropY: "(ih-oh)*0.5",
    fit: "contain",
  })
  assert.match(filter, /force_original_aspect_ratio=decrease/)
})

test("원본 비율 화면은 1배 미만 축소와 위치값을 렌더 필터에 유지한다", () => {
  const filter = buildScaleCropFilter({
    targetWidth: 1080,
    targetHeight: 1920,
    zoom: 0.5,
    cropX: "(iw-ow)*0.25",
    cropY: "(ih-oh)*0.75",
    fit: "contain",
    positionX: 0.25,
    positionY: 0.75,
  })
  assert.match(filter, /scale=540:960/)
  assert.match(filter, /\(ow-iw\)\*0\.2500/)
  assert.match(filter, /\(oh-ih\)\*0\.7500/)
})

test("원본 비율 이미지를 확대해도 작은 축의 위치값을 유지한다", () => {
  const filter = buildScaleCropFilter({
    targetWidth: 720,
    targetHeight: 1280,
    zoom: 1.25,
    cropX: "(iw-ow)*0.7",
    cropY: "(ih-oh)*0.2",
    fit: "contain",
    positionX: 0.7,
    positionY: 0.2,
  })
  assert.match(filter, /scale=900:1600/)
  assert.match(filter, /pad=w='max\(iw,720\)'/)
  assert.match(filter, /h='max\(ih,1280\)'/)
  assert.match(filter, /\(ow-iw\)\*0\.7000/)
  assert.match(filter, /\(oh-ih\)\*0\.2000/)
  assert.match(filter, /crop=720:1280/)
  assert.match(filter, /\(iw-ow\)\*0\.7000/)
  assert.match(filter, /\(ih-oh\)\*0\.2000/)
})

test("영상 모션은 장면 길이에 맞춘 확대량을 적용한다", () => {
  const filter = buildMediaMotionFilter({
    motion: "zoom-in",
    targetWidth: 720,
    targetHeight: 1280,
    durationSeconds: 3,
  })
  assert.match(filter, /0\.060000/)
  assert.match(filter, /perspective=/)
  assert.match(filter, /interpolation=cubic/)
  assert.match(filter, /scale=720:1280/)
})

test("긴 장면은 같은 속도를 유지하도록 전체 움직임이 더 커진다", () => {
  assert.equal(newsMediaMotionAmount(3), 0.06)
  assert.equal(newsMediaMotionAmount(10), 0.1)
  assert.equal(newsMediaMotionAmount(60), 0.28)
})

test("첨부 이미지는 한 프레임을 장면 길이만큼 부드럽게 움직인다", () => {
  const filter = buildMediaMotionFilter({
    motion: "pan-left",
    targetWidth: 720,
    targetHeight: 1280,
    durationSeconds: 3,
    inputIsStill: true,
  })
  assert.match(filter, /tpad=stop_mode=clone:stop_duration=3/)
  assert.match(filter, /eval=frame/)
})

test("움직임 없음은 추가 FFmpeg 필터를 만들지 않는다", () => {
  assert.equal(
    buildMediaMotionFilter({
      motion: "none",
      targetWidth: 720,
      targetHeight: 1280,
      durationSeconds: 3,
    }),
    ""
  )
})
