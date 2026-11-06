import assert from "node:assert/strict"
import test from "node:test"

import {
  preferShortsSourceDurations,
  publicSearchEntriesToVideos,
} from "./youtube-search.ts"

test("YouTube API가 없어도 공개 검색 결과를 원본 후보로 변환한다", () => {
  const [video] = publicSearchEntriesToVideos(
    [
      {
        id: "abc123XYZ00",
        title: "울진 기본소득 관련 직접 발언",
        description: "정부 발표 내용입니다. 2026.11.02",
        duration: 145,
        channel_id: "UCtestchannel",
        channel: "테스트 뉴스",
        view_count: 76_448,
      },
    ],
    new Date("2026-11-05T00:00:00Z").getTime()
  )

  assert.equal(video.id, "abc123XYZ00")
  assert.equal(video.channel, "테스트 뉴스")
  assert.equal(video.durationSeconds, 145)
  assert.equal(video.viewCount, 76_448)
  assert.equal(video.publishedAt, "2026-11-02T00:00:00.000Z")
})

test("쇼츠 원본 후보는 수 시간 생중계보다 45초에서 30분 영상을 우선한다", () => {
  const videos = [
    { id: "live", durationSeconds: 10_000 },
    { id: "one", durationSeconds: 90 },
    { id: "two", durationSeconds: 300 },
    { id: "three", durationSeconds: 600 },
    { id: "four", durationSeconds: 900 },
    { id: "five", durationSeconds: 1_200 },
  ].map((video) => ({
    ...video,
    title: video.id,
    channelId: "channel",
    channel: "뉴스",
    publishedAt: "2026-11-05T00:00:00.000Z",
    viewCount: 0,
    commentCount: 0,
    description: "",
    transcriptExcerpt: "",
  }))

  const preferred = preferShortsSourceDurations(videos)

  assert.deepEqual(
    preferred.slice(0, 5).map((video) => video.id),
    ["one", "two", "three", "four", "five"]
  )
  assert.equal(
    preferred.some((video) => video.id === "live"),
    false
  )
})

test("영어 YouTube 원본 후보는 제외한다", () => {
  const videos = publicSearchEntriesToVideos([
    {
      id: "english12345",
      title: "Government announces a new policy",
      description: "English news report",
      duration: 120,
      language: "en",
    },
    {
      id: "korean12345",
      title: "AI 정책을 놓고 국회 공방",
      description: "한국어 뉴스 보도",
      duration: 120,
      language: "ko",
    },
  ])

  assert.deepEqual(
    videos.map((video) => video.id),
    ["korean12345"]
  )
})
