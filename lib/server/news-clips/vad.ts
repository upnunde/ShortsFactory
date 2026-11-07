import { spawn } from "node:child_process"

import { ffmpegBin } from "@/lib/server/ffmpeg-bin"
import { parseSilenceOutput, silenceDetectFilter } from "@/lib/news-clips/vad"

export async function detectAudioSilence(sourceFile: string) {
  const output = await run(ffmpegBin(), [
    "-hide_banner",
    "-i",
    sourceFile,
    "-af",
    silenceDetectFilter(),
    "-f",
    "null",
    "-",
  ])
  return parseSilenceOutput(output)
}

function run(bin: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] })
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    child.on("error", () => reject(new Error("vad-failed")))
    child.on("exit", (code) =>
      code === 0 ? resolve(stderr) : reject(new Error("vad-failed"))
    )
  })
}
