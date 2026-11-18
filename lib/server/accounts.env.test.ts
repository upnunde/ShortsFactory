import assert from "node:assert/strict"
import test from "node:test"

import {
  readChannelAccountStatus,
  youtubeAccessToken,
} from "./accounts.ts"

test("Vercel 환경변수만으로 YouTube 앱·채널 연결 상태를 읽는다", async () => {
  const previous = {
    clientId: process.env.YOUTUBE_OAUTH_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
    refreshToken: process.env.YOUTUBE_OAUTH_REFRESH_TOKEN,
    channelId: process.env.YOUTUBE_OAUTH_CHANNEL_ID,
    channelName: process.env.YOUTUBE_OAUTH_CHANNEL_NAME,
    profileId: process.env.YOUTUBE_OAUTH_PROFILE_ID,
  }
  process.env.YOUTUBE_OAUTH_CLIENT_ID = "env-client-id"
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "env-client-secret"
  process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = "env-refresh-token"
  process.env.YOUTUBE_OAUTH_CHANNEL_ID = "UCenvChannelIdxxxxxxxxxxxxxxx"
  process.env.YOUTUBE_OAUTH_CHANNEL_NAME = "환경변수 채널"
  process.env.YOUTUBE_OAUTH_PROFILE_ID = "news-channel-envtest"

  try {
    const status = await readChannelAccountStatus("news-channel-envtest")
    assert.equal(status.youtube.hasApp, true)
    assert.equal(status.youtube.connected, true)
    assert.equal(status.youtube.accountId, "UCenvChannelIdxxxxxxxxxxxxxxx")
    assert.equal(status.youtube.accountName, "환경변수 채널")
  } finally {
    restoreEnv(previous)
  }
})

test("프로필이 다른 환경변수 YouTube 연결은 쓰지 않는다", async () => {
  const previous = {
    clientId: process.env.YOUTUBE_OAUTH_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
    refreshToken: process.env.YOUTUBE_OAUTH_REFRESH_TOKEN,
    channelId: process.env.YOUTUBE_OAUTH_CHANNEL_ID,
    channelName: process.env.YOUTUBE_OAUTH_CHANNEL_NAME,
    profileId: process.env.YOUTUBE_OAUTH_PROFILE_ID,
  }
  process.env.YOUTUBE_OAUTH_CLIENT_ID = "env-client-id"
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "env-client-secret"
  process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = "env-refresh-token"
  process.env.YOUTUBE_OAUTH_CHANNEL_ID = "UCenvChannelIdxxxxxxxxxxxxxxx"
  process.env.YOUTUBE_OAUTH_CHANNEL_NAME = "환경변수 채널"
  process.env.YOUTUBE_OAUTH_PROFILE_ID = "news-channel-envtest"

  try {
    const status = await readChannelAccountStatus("news-channel-other")
    assert.equal(status.youtube.hasApp, false)
    assert.equal(status.youtube.connected, false)
  } finally {
    restoreEnv(previous)
  }
})

test("환경변수 refresh 토큰 갱신 실패는 youtube-refresh-failed로 올린다", async () => {
  const previous = {
    clientId: process.env.YOUTUBE_OAUTH_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET,
    refreshToken: process.env.YOUTUBE_OAUTH_REFRESH_TOKEN,
    channelId: process.env.YOUTUBE_OAUTH_CHANNEL_ID,
    channelName: process.env.YOUTUBE_OAUTH_CHANNEL_NAME,
    profileId: process.env.YOUTUBE_OAUTH_PROFILE_ID,
  }
  process.env.YOUTUBE_OAUTH_CLIENT_ID = "env-client-id"
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = "env-client-secret"
  process.env.YOUTUBE_OAUTH_REFRESH_TOKEN = "broken-refresh-token"
  process.env.YOUTUBE_OAUTH_CHANNEL_ID = "UCenvChannelIdxxxxxxxxxxxxxxx"
  process.env.YOUTUBE_OAUTH_PROFILE_ID = "news-channel-envtest"

  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "invalid_grant" }), {
      status: 400,
    })) as typeof fetch

  try {
    await assert.rejects(
      () => youtubeAccessToken("news-channel-envtest"),
      /youtube-refresh-failed/
    )
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(previous)
  }
})

function restoreEnv(previous: Record<string, string | undefined>) {
  setEnv("YOUTUBE_OAUTH_CLIENT_ID", previous.clientId)
  setEnv("YOUTUBE_OAUTH_CLIENT_SECRET", previous.clientSecret)
  setEnv("YOUTUBE_OAUTH_REFRESH_TOKEN", previous.refreshToken)
  setEnv("YOUTUBE_OAUTH_CHANNEL_ID", previous.channelId)
  setEnv("YOUTUBE_OAUTH_CHANNEL_NAME", previous.channelName)
  setEnv("YOUTUBE_OAUTH_PROFILE_ID", previous.profileId)
}

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
