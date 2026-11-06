import assert from "node:assert/strict"
import test from "node:test"

import { normalizeNewsClipSettings } from "../../news-clips/settings.ts"
import { defaultNewsClipSettings } from "../../news-clips/types.ts"

test("뉴스 편집 설정을 안전한 범위로 제한한다", () => {
  const settings = normalizeNewsClipSettings(
    {
      targetMinSeconds: 5,
      targetMaxSeconds: 100,
      titleCardSeconds: 10,
      bgmVolume: 9,
      safeMarginPercent: 2,
      preferredChannels: [
        {
          id: "yonhap",
          name: "연합뉴스",
          youtubeChannelId: "UC-test",
          priority: 9,
          enabled: true,
        },
        "KBS News",
      ],
      issueSearchGuidance:
        "  현 정부 정책의 모순,   민주당 관련 논란, 세금 정책 영향  ",
      communitySignalsEnabled: true,
      videoRect: { x: -5, y: 3000, width: 50, height: 9999 },
      titleCardText: {
        fontSize: 999,
        fontWeight: 123,
        x: 1000,
        y: -20,
        width: 9999,
        alignment: "diagonal",
      },
      titleCardColor: "#ABCDEF",
      titleCardSecondColor: "#FEDCBA",
      titleCardLineHeightPercent: 999,
      bodyTitleColor: "red",
      subtitleColor: "#123456",
      fontFamily: "Black Han Sans",
    },
    "bad/id"
  )
  assert.equal(settings.profileId, "default")
  assert.equal(settings.targetMinSeconds, 45)
  assert.equal(settings.targetMaxSeconds, 58)
  assert.equal(settings.idealMinSeconds, 50)
  assert.equal(settings.idealMaxSeconds, 55)
  assert.equal(settings.hardMaxSeconds, 59)
  assert.equal(settings.titleCardSeconds, 3)
  assert.equal(settings.bgmVolume, 0.4)
  assert.equal(settings.safeMarginPercent, 5)
  assert.deepEqual(settings.preferredChannels, [
    {
      id: "yonhap",
      name: "연합뉴스",
      youtubeChannelId: "UC-test",
      priority: 5,
      enabled: true,
    },
    {
      id: "legacy-2",
      name: "KBS News",
      youtubeChannelId: "",
      priority: 3,
      enabled: true,
    },
  ])
  assert.equal(settings.communitySignalsEnabled, true)
  assert.equal(
    settings.issueSearchGuidance,
    "현 정부 정책의 모순, 민주당 관련 논란, 세금 정책 영향"
  )
  assert.deepEqual(settings.videoRect, {
    x: 0,
    y: 420,
    width: 1080,
    height: 720,
  })
  assert.deepEqual(settings.titleCardText, {
    fontSize: 220,
    fontWeight: 700,
    letterSpacing: 0,
    x: 108,
    y: 0,
    width: 1080,
    alignment: "center",
  })
  assert.equal(settings.titleCardColor, "#abcdef")
  assert.equal(settings.titleCardSecondColor, "#fedcba")
  assert.equal(settings.titleCardLineHeightPercent, 200)
  assert.equal(settings.bodyTitleColor, "#ffffff")
  assert.equal(settings.subtitleColor, "#123456")
  assert.equal(settings.fontFamily, "Black Han Sans")
  assert.equal(settings.bodySubtitleText.width, 1037)
})

test("기존 뉴스 글자 크기를 새 프레임별 배치 설정으로 이전한다", () => {
  const settings = normalizeNewsClipSettings({
    titleFontSize: 90,
    subtitleFontSize: 70,
  })

  assert.equal(settings.titleCardText.fontSize, 90)
  assert.equal(settings.bodyTitleText.fontSize, 65)
  assert.equal(settings.bodySubtitleText.fontSize, 70)
  assert.deepEqual(settings.videoRect, {
    x: 0,
    y: 420,
    width: 1080,
    height: 720,
  })
})

test("본문 자막 폭은 9:16 화면 전체 너비까지 허용한다", () => {
  const settings = normalizeNewsClipSettings({
    bodySubtitleText: {
      ...defaultNewsClipSettings.bodySubtitleText,
      width: 9999,
    },
  })

  assert.equal(settings.bodySubtitleText.width, 1080)
})
