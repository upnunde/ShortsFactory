import { randomUUID } from "node:crypto"

import { readHiggsfield } from "@/lib/server/credentials"

const base = "https://api.higgsfield.ai"

type Completed = {
  video?: { url?: string }
  images?: { url?: string }[]
}

export function mediaUrl(body: Completed) {
  return body.video?.url || body.images?.[0]?.url || ""
}

export async function uploadBytes(bytes: Buffer, contentType: string) {
  const key = await keyOrThrow()
  const ticketResponse = await fetch(`${base}/files/generate-upload-url`, {
    method: "POST",
    headers: auth(key),
    body: JSON.stringify({ content_type: contentType }),
  })
  if (!ticketResponse.ok) {
    throw new Error("upload-failed")
  }
  const ticket = (await ticketResponse.json()) as {
    public_url?: string
    upload_url?: string
    upload_headers?: Record<string, string>
  }
  if (!ticket.public_url || !ticket.upload_url) {
    throw new Error("upload-failed")
  }
  const put = await fetch(ticket.upload_url, {
    method: "PUT",
    headers: ticket.upload_headers ?? { "Content-Type": contentType },
    body: new Uint8Array(bytes),
  })
  if (!put.ok) {
    throw new Error("upload-failed")
  }
  return ticket.public_url
}

export async function generateMedia(path: string, input: Record<string, unknown>) {
  const key = await keyOrThrow()
  const response = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: {
      ...auth(key),
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(input),
  })
  if (response.status === 401 || response.status === 403) {
    throw new Error("no-key")
  }
  if (response.status === 402) {
    throw new Error("no-credit")
  }
  if (!response.ok) {
    throw new Error("generate-failed")
  }
  const accepted = (await response.json()) as { request_id?: string }
  if (!accepted.request_id) {
    throw new Error("generate-failed")
  }
  return poll(accepted.request_id)
}

export async function downloadFile(url: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error("download-failed")
  }
  return Buffer.from(await response.arrayBuffer())
}

async function poll(requestId: string) {
  const key = await keyOrThrow()
  const started = Date.now()
  while (Date.now() - started < 8 * 60 * 1000) {
    const response = await fetch(`${base}/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${key}` },
    })
    if (!response.ok) {
      throw new Error("generate-failed")
    }
    const body = (await response.json()) as Completed & { status?: string }
    if (body.status === "completed") {
      const url = mediaUrl(body)
      if (!url) {
        throw new Error("generate-failed")
      }
      return url
    }
    if (body.status === "failed" || body.status === "nsfw" || body.status === "canceled") {
      throw new Error("generate-failed")
    }
    await wait(4000)
  }
  throw new Error("generate-failed")
}

async function keyOrThrow() {
  const key = await readHiggsfield()
  if (!key) {
    throw new Error("no-key")
  }
  return key
}

function auth(key: string) {
  return {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
