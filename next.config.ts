import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "kokoro-js",
    "@huggingface/transformers",
    "phonemizer",
    "onnxruntime-node",
    "ffmpeg-static",
  ],
}

export default nextConfig
