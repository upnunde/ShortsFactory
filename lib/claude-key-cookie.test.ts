import assert from "node:assert/strict"
import test from "node:test"

import {
  CLAUDE_KEY_COOKIE_MAX_AGE_SECONDS,
  sealClaudeKey,
  unsealClaudeKey,
} from "./claude-key-cookie.ts"

const apiKey = "sk-ant-api03-test-key"
const username = "operator"
const secret = "test-session-secret-with-enough-entropy"
const now = Date.UTC(2026, 10, 17)

test("Claude 키를 원문 없이 암호화하고 다시 읽는다", () => {
  const first = sealClaudeKey(apiKey, username, secret, now)
  const second = sealClaudeKey(apiKey, username, secret, now)

  assert.equal(first.includes(apiKey), false)
  assert.notEqual(first, second)
  assert.equal(unsealClaudeKey(first, username, secret, now + 1000), apiKey)
})

test("변조되거나 다른 계정과 비밀키로 만든 쿠키는 거부한다", () => {
  const token = sealClaudeKey(apiKey, username, secret, now)
  const parts = token.split(".")
  parts[2] = `${parts[2].startsWith("a") ? "b" : "a"}${parts[2].slice(1)}`
  const tampered = parts.join(".")

  assert.equal(unsealClaudeKey(tampered, username, secret, now), null)
  assert.equal(unsealClaudeKey(token, "other", secret, now), null)
  assert.equal(unsealClaudeKey(token, username, "other-secret", now), null)
  assert.equal(unsealClaudeKey("broken", username, secret, now), null)
})

test("Claude 키 쿠키는 7일 뒤 만료된다", () => {
  const token = sealClaudeKey(apiKey, username, secret, now)
  const expiredAt = now + CLAUDE_KEY_COOKIE_MAX_AGE_SECONDS * 1000 + 1

  assert.equal(unsealClaudeKey(token, username, secret, expiredAt), null)
})
