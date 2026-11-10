import "server-only"

import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const progressFolder = path.join(os.tmpdir(), "shorts-factory-render-progress")

export type NewsRenderProgress = {
  percent: number
  label: string
  updatedAt: number
}

export type NewsRenderCancellation = {
  reason: string
  requestedAt: number
}

function progressPath(jobId: string) {
  return path.join(progressFolder, `${jobId}.json`)
}

function cancellationPath(jobId: string) {
  return path.join(progressFolder, `${jobId}.cancel.json`)
}

export function validRenderJobId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{8,80}$/i.test(value)
}

export async function writeNewsRenderProgress(
  jobId: string,
  percent: number,
  label: string
) {
  if (!validRenderJobId(jobId)) return
  const progress: NewsRenderProgress = {
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    label,
    updatedAt: Date.now(),
  }
  await mkdir(progressFolder, { recursive: true })
  await writeFile(progressPath(jobId), JSON.stringify(progress))
}

export async function readNewsRenderProgress(jobId: string) {
  if (!validRenderJobId(jobId)) return null
  try {
    return JSON.parse(
      await readFile(progressPath(jobId), "utf8")
    ) as NewsRenderProgress
  } catch {
    return null
  }
}

export async function removeNewsRenderProgress(jobId: string) {
  if (!validRenderJobId(jobId)) return
  await rm(progressPath(jobId), { force: true })
}

export async function requestNewsRenderCancellation(
  jobId: string,
  reason = "user"
) {
  if (!validRenderJobId(jobId)) return
  const cancellation: NewsRenderCancellation = {
    reason,
    requestedAt: Date.now(),
  }
  await mkdir(progressFolder, { recursive: true })
  await writeFile(cancellationPath(jobId), JSON.stringify(cancellation))
}

export async function readNewsRenderCancellation(jobId: string) {
  if (!validRenderJobId(jobId)) return null
  try {
    return JSON.parse(
      await readFile(cancellationPath(jobId), "utf8")
    ) as NewsRenderCancellation
  } catch {
    return null
  }
}

export async function clearNewsRenderCancellation(jobId: string) {
  if (!validRenderJobId(jobId)) return
  await rm(cancellationPath(jobId), { force: true })
}
