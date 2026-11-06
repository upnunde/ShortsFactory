import assert from "node:assert/strict"
import test from "node:test"

import { newsChannelId, normalizeNewsChannelProfile } from "./channels.ts"

test("뉴스 채널 ID는 캐릭터 채널 ID와 구분한다", () => {
  assert.equal(newsChannelId("channel-character"), "")
  assert.equal(newsChannelId("news-channel-1234abcd"), "news-channel-1234abcd")
})

test("뉴스 채널 프로필은 뉴스 전용 정보만 정규화한다", () => {
  const profile = normalizeNewsChannelProfile({
    id: "news-channel-1234abcd",
    name: "  정치 뉴스  ",
    createdAt: "2026-11-04T00:00:00.000Z",
  })
  assert.deepEqual(profile, {
    id: "news-channel-1234abcd",
    name: "정치 뉴스",
    language: "ko",
    avatarUrl: "",
    youtubeChannelCredentials: "config/credentials/news-channel-1234abcd.json",
    createdAt: "2026-11-04T00:00:00.000Z",
  })
})
