import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

export function ffmpegBin() {
  const fromEnv = process.env.FFMPEG_BIN
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv
  }
  try {
    const require = createRequire(path.join(process.cwd(), "package.json"))
    const resolved = require("ffmpeg-static") as string | null
    if (resolved && existsSync(resolved) && !resolved.startsWith("/ROOT/")) {
      return resolved
    }
  } catch {
    // The bundled path is not the installed binary.
  }
  const local = path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg")
  if (existsSync(local)) {
    return local
  }
  throw new Error("no-ffmpeg")
}
