import assert from "node:assert/strict"
import test from "node:test"

import {
  searchWikimediaCommonsImages,
  type WikimediaFetch,
} from "./wikimedia-commons.ts"

const sharedImage = {
  pageid: 101,
  title: "File:National Assembly building.jpg",
  canonicalurl:
    "https://commons.wikimedia.org/wiki/File:National_Assembly_building.jpg",
}

function response(language: "ko" | "en") {
  return {
    ok: true,
    async json() {
      return {
        query: {
          pages: [
            {
              ...sharedImage,
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/example/original.jpg",
                  descriptionurl: sharedImage.canonicalurl,
                  thumburl: "https://upload.wikimedia.org/example/1920px.jpg",
                  width: 3200,
                  height: 1800,
                  size: 1_234_567,
                  mime: "image/jpeg",
                  extmetadata: {
                    ObjectName: {
                      value:
                        language === "ko"
                          ? "대한민국 국회의사당"
                          : "National Assembly of South Korea",
                    },
                    ImageDescription: {
                      value:
                        language === "ko"
                          ? "<b>대한민국</b> 국회의사당 전경"
                          : "View of the National Assembly &amp; plaza",
                    },
                    Artist: { value: "<a>User:Reporter</a> Kim" },
                    LicenseShortName: { value: "CC BY-SA 4.0" },
                    LicenseUrl: {
                      value: "https://creativecommons.org/licenses/by-sa/4.0/",
                    },
                    UsageTerms: { value: "Creative Commons BY-SA 4.0" },
                    AttributionRequired: { value: "true" },
                  },
                },
              ],
            },
            {
              pageid: 102,
              title: "File:Speech.webm",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/example/speech.webm",
                  width: 3840,
                  height: 2160,
                  mime: "video/webm",
                  extmetadata: {
                    LicenseShortName: { value: "CC BY 4.0" },
                    LicenseUrl: {
                      value: "https://creativecommons.org/licenses/by/4.0/",
                    },
                  },
                },
              ],
            },
            {
              pageid: 103,
              title: "File:Small image.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/example/small.jpg",
                  width: 640,
                  height: 480,
                  mime: "image/jpeg",
                  extmetadata: {
                    LicenseShortName: { value: "CC0" },
                    LicenseUrl: {
                      value:
                        "https://creativecommons.org/publicdomain/zero/1.0/",
                    },
                  },
                },
              ],
            },
            {
              pageid: 104,
              title: "File:Non commercial image.jpg",
              imageinfo: [
                {
                  url: "https://upload.wikimedia.org/example/nc.jpg",
                  width: 2400,
                  height: 1600,
                  mime: "image/jpeg",
                  extmetadata: {
                    LicenseShortName: { value: "CC BY-NC 4.0" },
                    LicenseUrl: {
                      value: "https://creativecommons.org/licenses/by-nc/4.0/",
                    },
                  },
                },
              ],
            },
          ],
        },
      }
    },
  }
}

test("Commons 이미지 검색은 한·영 메타데이터와 라이선스를 보존한다", async () => {
  const requested: URL[] = []
  const fetchImpl: WikimediaFetch = async (input) => {
    const url = new URL(input)
    requested.push(url)
    return response(
      url.searchParams.get("iiextmetadatalanguage") === "ko" ? "ko" : "en"
    )
  }

  const images = await searchWikimediaCommonsImages("국회 본회의", {
    fetchImpl,
  })

  assert.equal(requested.length, 2)
  assert.equal(requested[0].searchParams.get("gsrnamespace"), "6")
  assert.equal(requested[0].searchParams.get("gsrsearch"), "국회 본회의")
  assert.deepEqual(
    new Set(
      requested.map((url) => url.searchParams.get("iiextmetadatalanguage"))
    ),
    new Set(["ko", "en"])
  )
  assert.equal(images.length, 1)
  assert.deepEqual(images[0], {
    id: "wikimedia-101",
    provider: "wikimedia_commons",
    mediaType: "image",
    title: "대한민국 국회의사당",
    titleKo: "대한민국 국회의사당",
    titleEn: "National Assembly of South Korea",
    descriptionKo: "대한민국 국회의사당 전경",
    descriptionEn: "View of the National Assembly & plaza",
    author: "User:Reporter Kim",
    mimeType: "image/jpeg",
    width: 3200,
    height: 1800,
    fileSizeBytes: 1_234_567,
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:National_Assembly_building.jpg",
    downloadUrl: "https://upload.wikimedia.org/example/original.jpg",
    previewUrl: "https://upload.wikimedia.org/example/1920px.jpg",
    license: {
      name: "CC BY-SA 4.0",
      url: "https://creativecommons.org/licenses/by-sa/4.0/",
      usageTerms: "Creative Commons BY-SA 4.0",
      attributionRequired: true,
    },
  })
})

test("영상·오디오와 최소 화질 미만 이미지는 제외한다", async () => {
  const images = await searchWikimediaCommonsImages("국회", {
    fetchImpl: async () => response("ko"),
  })

  assert.deepEqual(
    images.map((image) => image.id),
    ["wikimedia-101"]
  )
})

test("한 언어 조회가 실패해도 나머지 메타데이터로 결과를 만든다", async () => {
  const fetchImpl: WikimediaFetch = async (input) => {
    const language = new URL(input).searchParams.get("iiextmetadatalanguage")
    if (language === "ko") throw new Error("temporary-error")
    return response("en")
  }

  const [image] = await searchWikimediaCommonsImages("assembly", {
    fetchImpl,
  })

  assert.equal(image.title, "National Assembly of South Korea")
  assert.equal(image.descriptionKo, "")
  assert.equal(image.descriptionEn, "View of the National Assembly & plaza")
})

test("빈 검색어는 네트워크를 호출하지 않는다", async () => {
  let called = false
  const result = await searchWikimediaCommonsImages("   ", {
    fetchImpl: async () => {
      called = true
      return response("ko")
    },
  })

  assert.deepEqual(result, [])
  assert.equal(called, false)
})

test("모든 언어 요청이 실패하면 명확한 오류를 반환한다", async () => {
  await assert.rejects(
    searchWikimediaCommonsImages("assembly", {
      fetchImpl: async () => {
        throw new Error("offline")
      },
    }),
    /wikimedia-search-failed/
  )
})
