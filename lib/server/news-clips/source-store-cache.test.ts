import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import type { NewsSource } from "../../news-clips/types.ts"
import {
  canonicalSourceUrl,
  findReusableDownloadedSource,
} from "./source-cache.ts"

test("YouTube URL 형식과 추적 파라미터가 달라도 같은 원본으로 본다", () => {
  const expected = "https://www.youtube.com/watch?v=RLpSdLmedwI"

  assert.equal(
    canonicalSourceUrl(
      "https://www.youtube.com/watch?v=RLpSdLmedwI&utm_source=test&feature=share"
    ),
    expected
  )
  assert.equal(
    canonicalSourceUrl("https://youtu.be/RLpSdLmedwI?si=tracking"),
    expected
  )
  assert.equal(
    canonicalSourceUrl("https://www.youtube.com/shorts/RLpSdLmedwI"),
    expected
  )
})

test("실제 영상 파일이 남아 있는 동일 URL 소스만 재사용한다", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "news-source-cache-"))
  const staleId = "11111111-1111-4111-8111-111111111111"
  const cachedId = "22222222-2222-4222-8222-222222222222"
  try {
    const staleFolder = path.join(storageRoot, staleId)
    await mkdir(staleFolder, { recursive: true })
    await writeFile(
      path.join(staleFolder, "source.json"),
      JSON.stringify(
        sourceFixture({
          id: staleId,
          originalUrl: "https://www.youtube.com/watch?v=RLpSdLmedwI",
          localFile: path.join(staleFolder, "missing.mp4"),
        })
      )
    )

    const cachedFolder = path.join(storageRoot, cachedId)
    const cachedFile = path.join(cachedFolder, "source.mp4")
    await mkdir(cachedFolder, { recursive: true })
    await writeFile(cachedFile, "video")
    await writeFile(
      path.join(cachedFolder, "source.json"),
      JSON.stringify(
        sourceFixture({
          id: cachedId,
          originalUrl: "https://youtu.be/RLpSdLmedwI?si=old",
          localFile: cachedFile,
        })
      )
    )

    const reusable = await findReusableDownloadedSource(
      "https://www.youtube.com/watch?v=RLpSdLmedwI&feature=share",
      storageRoot
    )

    assert.equal(reusable?.id, cachedId)
    assert.equal(reusable?.localFile, cachedFile)
  } finally {
    await rm(storageRoot, { recursive: true, force: true })
  }
})

test("소스 폴더 밖 파일을 가리키는 레코드는 캐시로 사용하지 않는다", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "news-source-cache-"))
  const cachedId = "33333333-3333-4333-8333-333333333333"
  try {
    const cachedFolder = path.join(storageRoot, cachedId)
    const outsideFile = path.join(storageRoot, "outside.mp4")
    await mkdir(cachedFolder, { recursive: true })
    await writeFile(outsideFile, "video")
    await writeFile(
      path.join(cachedFolder, "source.json"),
      JSON.stringify(
        sourceFixture({
          id: cachedId,
          originalUrl: "https://youtu.be/RLpSdLmedwI",
          localFile: outsideFile,
        })
      )
    )

    assert.equal(
      await findReusableDownloadedSource(
        "https://www.youtube.com/watch?v=RLpSdLmedwI",
        storageRoot
      ),
      null
    )
  } finally {
    await rm(storageRoot, { recursive: true, force: true })
  }
})

function sourceFixture(
  patch: Pick<NewsSource, "id" | "originalUrl" | "localFile">
): NewsSource {
  return {
    ...patch,
    kind: "search",
    mediaType: "video",
    provider: "youtube_search",
    title: "뉴스 원본",
    channel: "뉴스 채널",
    publishedAt: "",
    durationSeconds: 120,
    viewCount: 100,
    commentCount: 10,
    summary: "뉴스 원본 설명",
    approved: true,
    requiresUpload: false,
    searchMetrics: null,
  }
}
