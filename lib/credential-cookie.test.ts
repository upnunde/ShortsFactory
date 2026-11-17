import assert from "node:assert/strict"
import test from "node:test"

import {
  sealProviderCredential,
  unsealProviderCredential,
} from "./credential-cookie.ts"

const username = "operator"
const secret = "test-credential-secret-with-enough-entropy"
const now = Date.UTC(2026, 10, 17)

test("공급자 API 키를 암호화하고 같은 공급자에서만 읽는다", () => {
  const token = sealProviderCredential(
    "typecast",
    "typecast-test-key",
    username,
    secret,
    3600,
    now
  )

  assert.equal(token.includes("typecast-test-key"), false)
  assert.equal(
    unsealProviderCredential("typecast", token, username, secret, now + 1000),
    "typecast-test-key"
  )
  assert.equal(
    unsealProviderCredential("higgsfield", token, username, secret, now),
    null
  )
})

test("다른 계정, 변조된 값, 만료된 공급자 쿠키를 거부한다", () => {
  const token = sealProviderCredential(
    "youtubeData",
    "youtube-test-key",
    username,
    secret,
    3600,
    now
  )
  const parts = token.split(".")
  parts[2] = `${parts[2].startsWith("a") ? "b" : "a"}${parts[2].slice(1)}`

  assert.equal(
    unsealProviderCredential(
      "youtubeData",
      parts.join("."),
      username,
      secret,
      now
    ),
    null
  )
  assert.equal(
    unsealProviderCredential("youtubeData", token, "other", secret, now),
    null
  )
  assert.equal(
    unsealProviderCredential(
      "youtubeData",
      token,
      username,
      secret,
      now + 3600001
    ),
    null
  )
})
