import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "kokoro-js",
    "@huggingface/transformers",
    "phonemizer",
    "onnxruntime-node",
    "ffmpeg-static",
  ],
  // proxy가 요청 본문을 버퍼링할 때 기본 10MB로 잘리므로 업로드 한도를 푼다.
  experimental: {
    proxyClientMaxBodySize: "4gb",
  },
}

export default nextConfig
