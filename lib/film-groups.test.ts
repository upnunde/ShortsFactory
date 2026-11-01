import assert from "node:assert/strict"
import test from "node:test"

import { videoGroups } from "./film-groups.ts"
import type { FilmScene } from "./film-plan.ts"

function scene(id: string, words: number, shot: FilmScene["shot"] = "room"): FilmScene {
  return {
    id,
    shot,
    sceneDescription: id,
    scriptTarget: Array.from({ length: words }, () => "word").join(" "),
    subtitle: "",
    actionBeats: [],
    castIds: [],
  }
}

test("같은 장소의 짧은 씬은 한 영상으로 묶는다", () => {
  const groups = videoGroups([
    scene("a", 8),
    scene("b", 8),
    scene("c", 30),
  ])

  assert.deepEqual(
    groups.map((group) => group.sceneIds),
    [["a", "b"], ["c"]]
  )
})

test("삽입 장면은 따로 두고, 그 다음 장소 장면은 새 영상이 된다", () => {
  const groups = videoGroups([
    scene("room", 6),
    scene("plate", 6, "insert"),
    scene("back", 6),
  ])

  assert.deepEqual(
    groups.map((group) => group.sceneIds),
    [["room"], ["plate"], ["back"]]
  )
})
