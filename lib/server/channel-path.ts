import path from "node:path"

export function channelId(value: string) {
  return /^[a-z0-9-]{1,64}$/.test(value) ? value : "default"
}

export function channelConfigPath(
  profileId: string,
  file: string,
  legacyFile: string
) {
  const id = channelId(profileId)
  return id === "default"
    ? path.join(process.cwd(), "config", legacyFile)
    : path.join(process.cwd(), "config", "channels", id, file)
}
