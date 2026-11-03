export const VIDEO_MODELS = [
  {
    id: "bytedance/seedance-2.5/image-to-video",
    label: "Seedance 2.5 Image to Video",
  },
] as const

export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const

export type VideoModel = (typeof VIDEO_MODELS)[number]["id"]
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number]

export type VideoSettings = {
  model: VideoModel
  resolution: VideoResolution
  aspectRatio: "3:4"
  estimatedCostPerSecondUsd: number
  maxEstimatedCostUsd: number
  targetDurationSeconds: number
  durationToleranceSeconds: number
  maxAiVideoSeconds: number
  maxAiVideoScenes: number
  maxRetriesPerScene: number
}

export const defaultVideoSettings: VideoSettings = {
  model: "bytedance/seedance-2.5/image-to-video",
  resolution: "720p",
  aspectRatio: "3:4",
  estimatedCostPerSecondUsd: 0,
  maxEstimatedCostUsd: 0,
  targetDurationSeconds: 40,
  durationToleranceSeconds: 5,
  maxAiVideoSeconds: 12,
  maxAiVideoScenes: 3,
  maxRetriesPerScene: 2,
}

export function normalizeVideoSettings(value: unknown): VideoSettings {
  const record =
    value && typeof value === "object" ? (value as Partial<VideoSettings>) : {}
  return {
    model: VIDEO_MODELS.some((item) => item.id === record.model)
      ? (record.model as VideoModel)
      : defaultVideoSettings.model,
    resolution: VIDEO_RESOLUTIONS.includes(record.resolution as VideoResolution)
      ? (record.resolution as VideoResolution)
      : defaultVideoSettings.resolution,
    aspectRatio: "3:4",
    estimatedCostPerSecondUsd: moneyOf(record.estimatedCostPerSecondUsd),
    maxEstimatedCostUsd: moneyOf(record.maxEstimatedCostUsd),
    targetDurationSeconds: integerOf(record.targetDurationSeconds, 20, 60, 40),
    durationToleranceSeconds: integerOf(record.durationToleranceSeconds, 0, 15, 5),
    maxAiVideoSeconds: integerOf(record.maxAiVideoSeconds, 0, 30, 12),
    maxAiVideoScenes: integerOf(record.maxAiVideoScenes, 0, 8, 3),
    maxRetriesPerScene: integerOf(record.maxRetriesPerScene, 0, 5, 2),
  }
}

export function videoSettingsKey(settings: VideoSettings) {
  return [
    settings.model,
    settings.resolution,
    settings.aspectRatio,
    settings.estimatedCostPerSecondUsd,
    settings.maxEstimatedCostUsd,
    settings.targetDurationSeconds,
    settings.durationToleranceSeconds,
    settings.maxAiVideoSeconds,
    settings.maxAiVideoScenes,
    settings.maxRetriesPerScene,
  ].join("|")
}

function integerOf(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.round(value)))
}

function moneyOf(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0
  }
  return Math.min(1000, Math.max(0, Math.round(value * 10000) / 10000))
}
