import assert from "node:assert/strict"
import test from "node:test"

import {
  createSessionToken,
  credentialsMatch,
  isValidSessionToken,
  sanitizeReturnTo,
  type AuthConfig,
} from "./auth.ts"

const config: AuthConfig = {
  username: "operator",
  password: "simple-password",
  secret: "test-session-secret",
}

test("아이디와 비밀번호가 모두 맞아야 한다", () => {
  assert.equal(credentialsMatch(config, "operator", "simple-password"), true)
  assert.equal(credentialsMatch(config, "other", "simple-password"), false)
  assert.equal(credentialsMatch(config, "operator", "wrong"), false)
})

test("서명된 세션만 만료 전까지 허용한다", () => {
  const now = Date.UTC(2026, 10, 17)
  const token = createSessionToken(config, now)

  assert.equal(isValidSessionToken(token, config, now + 1000), true)
  assert.equal(
    isValidSessionToken(`${token}tampered`, config, now + 1000),
    false
  )
  assert.equal(
    isValidSessionToken(token, config, now + 8 * 24 * 60 * 60 * 1000),
    false
  )
})

test("로그인 후 이동 경로는 같은 사이트의 상대 경로만 허용한다", () => {
  assert.equal(
    sanitizeReturnTo("/studio/news-clips?tab=source"),
    "/studio/news-clips?tab=source"
  )
  assert.equal(sanitizeReturnTo("https://example.com"), "/")
  assert.equal(sanitizeReturnTo("//example.com"), "/")
})
