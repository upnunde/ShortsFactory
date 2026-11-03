export type ChannelProfile = {
  id: string
  name: string
  language: string
  system_prompt: string
  image_style_anchor: string
  lora_model: string
  tts_voice_id: string
  bgm_folder_path: string
  default_bgm_id: string
  youtube_bgm_track: string
  youtube_bgm_artist: string
  youtube_bgm_volume: number
  youtube_channel_credentials: string
  instagram_credentials: string
  tiktok_credentials: string
}

export type ShotKind = "room" | "insert"

import type { SceneProductionMode } from "./scene-production"
import type { WordTiming } from "./voice-timing"

export type ActionBeat = {
  trigger: string
  action: string
}

export type Scene = {
  id: string
  scriptKo: string
  approvedKo: string
  scriptTarget: string
  subtitle: string
  shot: ShotKind
  productionMode: SceneProductionMode
  sceneDescription: string
  visualDescription: string
  voiceScript: string
  actionBeats: ActionBeat[]
  castIds: string[]
}

export type YoutubeMeta = {
  enabled: boolean
  title: string
  description: string
  tags: string
}

export type SocialPost = {
  enabled: boolean
  caption: string
}

export type Project = {
  topic: string
  titleKo: string
  topicEn: string
  scriptTopic: string
  overviewKo: string
  overviewEn: string
  profileId: string
  outfitId: string | null
  bgmId: string
  placeKo: string
  placeEn: string
  placeApprovedKo: string
  scenes: Scene[]
  autoUpload: boolean
  scheduledAt: string
  historyId: string
  finalSignature: string
  directionSignature: string
  voicePreviewKey: string
  sceneDurations: Record<string, number>
  sceneWordTimings: Record<string, WordTiming[]>
  youtube: YoutubeMeta
  instagram: SocialPost
  tiktok: SocialPost
}

export const STEPS = [
  { id: "topic", label: "주제" },
  { id: "script", label: "대본" },
  { id: "direction", label: "화면 연출" },
  { id: "scenes", label: "씬" },
  { id: "film", label: "영상" },
  { id: "upload", label: "업로드" },
] as const

export type StepId = (typeof STEPS)[number]["id"]

export type StudioState = {
  step: StepId
  project: Project
}
