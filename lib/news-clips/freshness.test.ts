import assert from "node:assert/strict"
import test from "node:test"

import { NEWS_MAX_AGE_DAYS, isWithinNewsMaxAge } from "./freshness.ts"

const now = new Date("2026-11-07T12:00:00Z").getTime()

test("뉴스 최신성 한도는 2일이다", () => {
  assert.equal(NEWS_MAX_AGE_DAYS, 2)
})

test("2일 이내 게시만 허용한다", () => {
  assert.equal(
    isWithinNewsMaxAge("2026-11-06T12:00:00Z", now),
    true
  )
  assert.equal(
    isWithinNewsMaxAge("2026-11-05T12:00:00Z", now),
    true
  )
  assert.equal(
    isWithinNewsMaxAge("2026-11-05T11:59:00Z", now),
    false
  )
  assert.equal(isWithinNewsMaxAge("", now), false)
  assert.equal(isWithinNewsMaxAge(undefined, now), false)
})
