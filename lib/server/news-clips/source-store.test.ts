import assert from "node:assert/strict"
import test from "node:test"

import {
  LICENSED_WEB_IMAGE_MAX_BYTES,
  validateLicensedWebImageDownload,
} from "./licensed-web-image.ts"

test("Wikimedia HTTPS 원본과 지원 이미지 MIME만 허용한다", () => {
  assert.deepEqual(
    validateLicensedWebImageDownload({
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/photo.jpg",
      declaredMimeType: "image/jpeg",
      responseMimeType: "image/jpeg; charset=binary",
      contentLength: 2_000_000,
    }),
    {
      ok: true,
      url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/photo.jpg",
      mimeType: "image/jpeg",
      extension: ".jpg",
    }
  )
})

test("유사 도메인·HTTP·다른 포트·인증정보 URL은 거부한다", () => {
  const urls = [
    "http://upload.wikimedia.org/photo.jpg",
    "https://upload.wikimedia.org.evil.example/photo.jpg",
    "https://sub.upload.wikimedia.org/photo.jpg",
    "https://user:pass@upload.wikimedia.org/photo.jpg",
    "https://upload.wikimedia.org:8443/photo.jpg",
  ]

  for (const url of urls) {
    assert.deepEqual(
      validateLicensedWebImageDownload({
        url,
        declaredMimeType: "image/jpeg",
      }),
      { ok: false, reason: "invalid-web-image-url" }
    )
  }
})

test("영상 MIME과 선언·응답 MIME 불일치는 거부한다", () => {
  assert.deepEqual(
    validateLicensedWebImageDownload({
      url: "https://upload.wikimedia.org/video.webm",
      declaredMimeType: "video/webm",
    }),
    { ok: false, reason: "unsupported-web-image" }
  )
  assert.deepEqual(
    validateLicensedWebImageDownload({
      url: "https://upload.wikimedia.org/photo.jpg",
      declaredMimeType: "image/jpeg",
      responseMimeType: "image/png",
    }),
    { ok: false, reason: "unsupported-web-image" }
  )
})

test("최대 허용 용량을 넘는 응답은 다운로드 전에 거부한다", () => {
  assert.deepEqual(
    validateLicensedWebImageDownload({
      url: "https://upload.wikimedia.org/photo.webp",
      declaredMimeType: "image/webp",
      contentLength: LICENSED_WEB_IMAGE_MAX_BYTES + 1,
    }),
    { ok: false, reason: "web-image-too-large" }
  )
})
