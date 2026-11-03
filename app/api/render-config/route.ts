import { createHash } from "node:crypto"

import { NextResponse } from "next/server"

import { readFrameLayout } from "@/lib/server/frame-layout"
import { readProfile } from "@/lib/server/profiles"
import { readVideoSettings } from "@/lib/server/video-settings"
import { readVoiceId } from "@/lib/server/voice"

export async function GET(request: Request) {
  const profileId =
    new URL(request.url).searchParams.get("profileId") ?? "default"
  const [profile, voiceId, frame, video] = await Promise.all([
    readProfile(profileId),
    readVoiceId(profileId),
    readFrameLayout(profileId),
    readVideoSettings(profileId),
  ])
  const snapshot = {
    profile: {
      id: profile.id,
      imageStyleAnchor: profile.image_style_anchor,
      bgmVolume: profile.youtube_bgm_volume,
    },
    voiceId,
    frame,
    video,
  }
  const key = createHash("sha256")
    .update(JSON.stringify(snapshot))
    .digest("hex")
    .slice(0, 16)
  return NextResponse.json({ key })
}
