import { narrationSeconds } from "./timing.ts"
import type { FilmScene } from "./film-plan.ts"

export const MAX_CLIP_SECONDS = 15

export type VideoGroup = {
  id: string
  sceneIds: string[]
  scenes: FilmScene[]
}

export function videoGroups(scenes: FilmScene[]): VideoGroup[] {
  const buckets: FilmScene[][] = []
  let bucket: FilmScene[] = []
  let seconds = 0

  function flush() {
    if (bucket.length === 0) {
      return
    }
    buckets.push(bucket)
    bucket = []
    seconds = 0
  }

  for (const scene of scenes) {
    const next = narrationSeconds(scene.scriptTarget)
    const sameRoom =
      bucket.length > 0 &&
      bucket.every((item) => item.shot === "room") &&
      scene.shot === "room"
    if (sameRoom && seconds + next <= MAX_CLIP_SECONDS) {
      bucket.push(scene)
      seconds += next
      continue
    }
    flush()
    bucket = [scene]
    seconds = next
  }
  flush()

  return buckets.map((items, index) => ({
    id: `clip-${String(index + 1).padStart(2, "0")}`,
    sceneIds: items.map((item) => item.id),
    scenes: items,
  }))
}
