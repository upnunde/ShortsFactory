import type { NewsClipSettings } from "./types.ts"

export const NEWS_RENDER_SCHEMA_VERSION = 32

export function newsRenderSettingsKey(settings: NewsClipSettings) {
  const source = JSON.stringify({
    version: NEWS_RENDER_SCHEMA_VERSION,
    titleFrameImage: settings.titleFrameImage,
    bodyFrameImage: settings.bodyFrameImage,
    bgmFile: settings.bgmFile,
    bgmEnabled: settings.bgmEnabled,
    bgmVolume: settings.bgmVolume,
    ttsProvider: settings.ttsProvider,
    titleVoice: settings.titleVoice,
    typecastVoiceId: settings.typecastVoiceId,
    titleVoiceRate: settings.titleVoiceRate,
    fontFamily: settings.fontFamily,
    titleCardText: settings.titleCardText,
    titleCardSecondFontSize: settings.titleCardSecondFontSize,
    titleCardLineHeightPercent: settings.titleCardLineHeightPercent,
    titleCardColor: settings.titleCardColor,
    titleCardSecondColor: settings.titleCardSecondColor,
    bodyTitleText: settings.bodyTitleText,
    bodyTitleColor: settings.bodyTitleColor,
    bodySubtitleText: settings.bodySubtitleText,
    subtitleColor: settings.subtitleColor,
    emphasisColor: settings.emphasisColor,
    videoRect: settings.videoRect,
    safeMarginPercent: settings.safeMarginPercent,
  })

  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `news-render-${NEWS_RENDER_SCHEMA_VERSION}-${(hash >>> 0).toString(16)}`
}
