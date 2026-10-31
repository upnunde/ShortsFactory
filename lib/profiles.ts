import type { ChannelProfile } from "@/lib/types"
import defaultProfile from "@/config/profiles/default.json"

export const profiles: ChannelProfile[] = [defaultProfile]

export function getProfile(profileId: string) {
  return profiles.find((profile) => profile.id === profileId) ?? profiles[0]
}
