export type ChannelProfile = {
  id: string
  name: string
  language: string
  system_prompt: string
  image_style_anchor: string
  lora_model: string
  tts_voice_id: string
  bgm_folder_path: string
  youtube_bgm_track: string
  youtube_bgm_artist: string
  youtube_bgm_volume: number
  youtube_channel_credentials: string
  instagram_credentials: string
  tiktok_credentials: string
}

export type Scene = {
  id: string
  scriptKo: string
  approvedKo: string
  scriptTarget: string
  subtitle: string
  sceneDescription: string
  visualDescription: string
  voiceScript: string
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
  scriptTopic: string
  profileId: string
  outfitId: string | null
  scenes: Scene[]
  autoUpload: boolean
  scheduledAt: string
  finalSignature: string
  youtube: YoutubeMeta
  instagram: SocialPost
  tiktok: SocialPost
}

export const STEPS = [
  { id: "topic", label: "주제" },
  { id: "script", label: "대본" },
  { id: "scenes", label: "씬" },
  { id: "film", label: "영상" },
  { id: "upload", label: "업로드" },
] as const

export type StepId = (typeof STEPS)[number]["id"]

export type StudioState = {
  step: StepId
  project: Project
}
