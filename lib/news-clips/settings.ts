import {
  defaultNewsClipSettings,
  NEWS_BODY_VIDEO_RECT,
  type NewsClipSettings,
  type NewsTextAlignment,
  type NewsTextLayout,
} from "./types.ts"
import { DEFAULT_TYPECAST_VOICE_ID, newsTtsVoiceById } from "./voices.ts"

export function normalizeNewsClipSettings(
  value: unknown,
  profileId = "default"
): NewsClipSettings {
  const raw =
    value && typeof value === "object"
      ? (value as Partial<NewsClipSettings>)
      : {}
  const legacyTitleSize = number(
    (raw as Partial<NewsClipSettings> & { titleFontSize?: number })
      .titleFontSize,
    42,
    110,
    defaultNewsClipSettings.titleCardText.fontSize
  )
  const legacySubtitleSize = number(
    (raw as Partial<NewsClipSettings> & { subtitleFontSize?: number })
      .subtitleFontSize,
    32,
    80,
    defaultNewsClipSettings.bodySubtitleText.fontSize
  )
  const typecastVoices = normalizeTypecastVoices(
    raw.typecastVoices,
    raw.typecastVoiceId
  )
  return {
    ...defaultNewsClipSettings,
    profileId: safeId(profileId),
    preferredChannels: normalizeChannels(raw.preferredChannels),
    issueSearchGuidance: textValue(raw.issueSearchGuidance, 500),
    communitySignalsEnabled: raw.communitySignalsEnabled === true,
    communityCacheMinutes: number(raw.communityCacheMinutes, 20, 180, 30),
    ...(() => {
      const targetMinSeconds = number(
        raw.targetMinSeconds,
        5,
        600,
        defaultNewsClipSettings.targetMinSeconds
      )
      const targetMaxSeconds = Math.max(
        targetMinSeconds,
        number(
          raw.targetMaxSeconds,
          5,
          600,
          defaultNewsClipSettings.targetMaxSeconds
        )
      )
      const idealMinSeconds = number(
        raw.idealMinSeconds,
        5,
        600,
        defaultNewsClipSettings.idealMinSeconds
      )
      const idealMaxSeconds = Math.max(
        idealMinSeconds,
        number(
          raw.idealMaxSeconds,
          5,
          600,
          defaultNewsClipSettings.idealMaxSeconds
        )
      )
      return {
        targetMinSeconds,
        targetMaxSeconds,
        idealMinSeconds,
        idealMaxSeconds,
      }
    })(),
    titleCardSeconds: number(raw.titleCardSeconds, 2, 3, 2.5),
    titleFrameImage: pathValue(raw.titleFrameImage),
    bodyFrameImage: pathValue(raw.bodyFrameImage),
    bgmFile: pathValue(raw.bgmFile),
    bgmEnabled: raw.bgmEnabled !== false,
    bgmVolume: number(raw.bgmVolume, 0, 0.4, 0.12),
    ttsProvider:
      raw.ttsProvider === "free" || raw.ttsProvider === "typecast"
        ? raw.ttsProvider
        : "auto",
    titleVoice: newsTtsVoiceById(
      typeof raw.titleVoice === "string" ? raw.titleVoice : ""
    ).id,
    typecastVoiceId: selectedTypecastVoiceId(
      raw.typecastVoiceId,
      typecastVoices
    ),
    typecastVoices,
    titleVoiceRate: number(raw.titleVoiceRate, -15, 8, 0),
    titleVolume: number(raw.titleVolume, 0, 2, 1),
    sourceVolume: number(raw.sourceVolume, 0, 2, 1),
    quoteVolume: number(raw.quoteVolume, 0, 2, 1),
    fontFamily:
      raw.fontFamily === "Black Han Sans" ? "Black Han Sans" : "Pretendard",
    titleCardText: normalizeTextLayout(
      raw.titleCardText,
      {
        ...defaultNewsClipSettings.titleCardText,
        fontSize: legacyTitleSize,
      },
      1080,
      220
    ),
    titleCardSecondFontSize: number(
      raw.titleCardSecondFontSize,
      28,
      220,
      defaultNewsClipSettings.titleCardSecondFontSize
    ),
    titleCardLineHeightPercent: number(
      raw.titleCardLineHeightPercent,
      70,
      200,
      defaultNewsClipSettings.titleCardLineHeightPercent
    ),
    titleCardColor: hexColor(raw.titleCardColor, "#ffffff"),
    titleCardSecondColor: hexColor(raw.titleCardSecondColor, "#ffd84d"),
    bodyTitleText: normalizeTextLayout(
      raw.bodyTitleText,
      {
        ...defaultNewsClipSettings.bodyTitleText,
        fontSize: Math.max(42, Math.round(legacyTitleSize * 0.72)),
      },
      1080
    ),
    bodyTitleColor: hexColor(raw.bodyTitleColor, "#ffffff"),
    bodySubtitleText: normalizeTextLayout(
      raw.bodySubtitleText,
      {
        ...defaultNewsClipSettings.bodySubtitleText,
        fontSize: legacySubtitleSize,
      },
      1080
    ),
    subtitleColor: hexColor(raw.subtitleColor, "#ffffff"),
    bodySourceText: normalizeTextLayout(
      raw.bodySourceText,
      defaultNewsClipSettings.bodySourceText,
      1080,
      72
    ),
    sourceColor: hexColor(raw.sourceColor, "#b8bcc8"),
    emphasisColor: raw.emphasisColor === "#5ee28b" ? "#5ee28b" : "#ffd84d",
    videoRect: { ...NEWS_BODY_VIDEO_RECT },
    safeMarginPercent: number(raw.safeMarginPercent, 5, 12, 7),
    removeFillers: raw.removeFillers === true,
    cutTransition: raw.cutTransition === "dissolve" ? "dissolve" : "hard",
    youtubeAutoUpload: raw.youtubeAutoUpload === true,
  }
}

function normalizeTextLayout(
  value: unknown,
  fallback: NewsTextLayout,
  maximumWidth = 972,
  maximumFontSize = 150
): NewsTextLayout {
  const raw =
    value && typeof value === "object" ? (value as Partial<NewsTextLayout>) : {}
  return {
    fontSize: number(raw.fontSize, 28, maximumFontSize, fallback.fontSize),
    fontWeight: fontWeight(raw.fontWeight, fallback.fontWeight),
    letterSpacing: number(raw.letterSpacing, -5, 20, fallback.letterSpacing),
    x: fallback.x,
    y: number(raw.y, 0, 1800, fallback.y),
    width: number(raw.width, 540, maximumWidth, fallback.width),
    alignment: alignment(raw.alignment, fallback.alignment),
  }
}

function fontWeight(value: unknown, fallback: NewsTextLayout["fontWeight"]) {
  return [400, 500, 600, 700, 800, 900].includes(Number(value))
    ? (Number(value) as NewsTextLayout["fontWeight"])
    : fallback
}

function alignment(
  value: unknown,
  fallback: NewsTextAlignment
): NewsTextAlignment {
  return value === "left" || value === "center" || value === "right"
    ? value
    : fallback
}

function hexColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback
}

function normalizeChannels(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .flatMap((item, index) => {
      if (typeof item === "string") {
        const name = item.trim()
        return name
          ? [
              {
                id: `legacy-${index + 1}`,
                name,
                youtubeChannelId: "",
                priority: 3,
                enabled: true,
              },
            ]
          : []
      }
      if (!item || typeof item !== "object") return []
      const channel = item as Record<string, unknown>
      const name = typeof channel.name === "string" ? channel.name.trim() : ""
      const youtubeChannelId =
        typeof channel.youtubeChannelId === "string"
          ? channel.youtubeChannelId.trim()
          : ""
      if (!name && !youtubeChannelId) return []
      return [
        {
          id:
            typeof channel.id === "string" &&
            /^[a-z0-9-]{1,64}$/i.test(channel.id)
              ? channel.id
              : `channel-${index + 1}`,
          name: name || youtubeChannelId,
          youtubeChannelId,
          priority: number(channel.priority, 1, 5, 3),
          enabled: channel.enabled !== false,
        },
      ]
    })
    .slice(0, 30)
}

function safeId(value: string) {
  return /^[a-z0-9-]{1,64}$/.test(value) ? value : "default"
}

function pathValue(value: unknown) {
  return typeof value === "string" && value.startsWith("/news-clips/")
    ? value
    : ""
}

function validTypecastVoiceId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : ""
  return /^tc_[a-z0-9]{8,96}$/i.test(id) ? id : ""
}

function normalizeTypecastVoices(value: unknown, legacyVoiceId: unknown) {
  const normalized = Array.isArray(value)
    ? value
        .flatMap((item, index) => {
          if (!item || typeof item !== "object") return []
          const voice = item as Record<string, unknown>
          const voiceId = validTypecastVoiceId(voice.voiceId)
          if (!voiceId) return []
          return [
            {
              id:
                typeof voice.id === "string" &&
                /^[a-z0-9-]{1,64}$/i.test(voice.id)
                  ? voice.id
                  : `typecast-${index + 1}`,
              name: textValue(voice.name, 60) || `Typecast 음성 ${index + 1}`,
              voiceId,
            },
          ]
        })
        .filter(
          (voice, index, voices) =>
            voices.findIndex((item) => item.voiceId === voice.voiceId) === index
        )
        .slice(0, 20)
    : []
  if (normalized.length) return normalized
  const voiceId = validTypecastVoiceId(legacyVoiceId)
  return [
    {
      id: "typecast-default",
      name: "기본 Typecast 음성",
      voiceId: voiceId || DEFAULT_TYPECAST_VOICE_ID,
    },
  ]
}

function selectedTypecastVoiceId(
  value: unknown,
  voices: { voiceId: string }[]
) {
  const selected = validTypecastVoiceId(value)
  return voices.some((voice) => voice.voiceId === selected)
    ? selected
    : voices[0]?.voiceId || DEFAULT_TYPECAST_VOICE_ID
}

function textValue(value: unknown, maximumLength: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximumLength)
    : ""
}

function number(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback
}
