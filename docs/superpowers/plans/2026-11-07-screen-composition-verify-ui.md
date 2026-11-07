# Screen Composition Verify UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the news-clips review 「화면 구성」 into intro/body sub-tabs with per-section controls that appear only when a body section is selected.

**Architecture:** Drop the standalone `intro` editor tab; add `compositionPane: "intro" | "body"` synced with `frameMode`. Body lists scenes compactly; crop + source-range controls appear only for the selected scene. Each scene stores its own optional `crop`; UI/render use `scene.crop ?? project.crop` so the same source can be reframed per segment.

**Tech Stack:** React (`review-step.tsx`), HeroUI, `NewsFramePreview` / `SourceRangeTimeline` / `RangeInput`, news-clips types + render.

**Spec:** `docs/superpowers/specs/2026-11-07-screen-composition-verify-ui-design.md`

## Global Constraints

- UI copy minimal — titles/tab labels only; no new guidance paragraphs.
- Per-section crop is required (same video, different framing per beat).
- Hide source-id / visual-type selects from this pane (read-only badge only).
- Korean UI labels: `인트로`, `본문`, `화면 구성`.
- Do not build auto face-tracking in this plan.

---

## File map

| File | Responsibility |
|------|----------------|
| `lib/news-clips/types.ts` | `NewsReportScene.crop?` |
| `lib/server/news-clips/render.ts` | Apply `scene.crop ?? project.crop` per scene |
| `components/news-clips/review-step.tsx` | Tab config, composition sub-tabs, intro move, per-section controls, preview sync |
| `components/news-clips/news-clips-app.tsx` | Preserve scene crop on hydrate if touched |
| Spec doc | Source of truth |

---

### Task 0: Per-scene crop model + render

**Files:**
- Modify: `lib/news-clips/types.ts` (`NewsReportScene`)
- Modify: `lib/server/news-clips/render.ts` (body scene filter crop)
- Optional helper in `lib/news-clips/types.ts` or inline: `sceneCrop(scene, fallback)`

**Interfaces:**
- Produces: `NewsReportScene.crop?: CropPosition`
- Render: for each timed scene, `const crop = scene.crop ?? project.crop`

- [ ] **Step 1: Extend type**

```ts
export type NewsReportScene = {
  id: string
  narration: string
  visual: "source" | "quote"
  sourceId?: string
  sourceStart: number
  sourceEnd: number
  crop?: CropPosition
}
```

- [ ] **Step 2: Render uses per-scene crop**

In `makeBodyVideo` / sceneFilters loop, replace project-wide zoom/crop with:

```ts
const crop = scene.crop ?? project.crop
const sceneZoom = Math.max(1.02, Math.min(1.8, crop.zoom))
const sceneCropX = `(iw-ow)*${Math.max(0, Math.min(100, crop.x)) / 100}`
const sceneCropY = `(ih-oh)*${Math.max(0, Math.min(100, crop.y)) / 100}`
```

Bump `NEWS_RENDER_SCHEMA_VERSION` by 1 so caches invalidate.

- [ ] **Step 3: Commit**

```bash
git add lib/news-clips/types.ts lib/server/news-clips/render.ts lib/news-clips/render-key.ts
git commit -m "$(cat <<'EOF'
feat: apply per-scene crop when rendering news body

EOF
)"
```

---

### Task 1: Editor tabs — remove standalone 인트로, keep 화면 구성

**Files:**
- Modify: `components/news-clips/review-step.tsx` (EDITOR_TABS, EditorTab type, tab click handler)

**Interfaces:**
- Consumes: existing `EditorTab`, `EDITOR_TABS`, `setFrameMode`
- Produces: `EditorTab` without `"intro"`; preview tabs without intro entry

- [ ] **Step 1: Narrow `EditorTab` and preview tab list**

Replace the type and `EDITOR_TABS` block near the top of `review-step.tsx`:

```tsx
type EditorTab = "script" | "captions" | "scenes" | "media"

const EDITOR_TABS: Record<
  ReviewMode,
  Array<{ id: EditorTab; label: string }>
> = {
  script: [
    { id: "script", label: "제목·대본" },
    { id: "captions", label: "자막" },
  ],
  direction: [
    { id: "scenes", label: "화면 구성" },
    { id: "media", label: "음향 설정" },
  ],
  preview: [
    { id: "script", label: "제목·대본" },
    { id: "captions", label: "자막" },
    { id: "scenes", label: "화면 구성" },
    { id: "media", label: "음향 설정" },
  ],
  final: [{ id: "media", label: "결과물" }],
}
```

- [ ] **Step 2: Fix tab click handler that referenced `intro`**

In the editor tab `onClick`, remove `if (tab.id === "intro") setFrameMode("title")`. Keep captions → body:

```tsx
onClick={() => {
  setEditorTabByMode((current) => ({
    ...current,
    [mode]: tab.id,
  }))
  if (tab.id === "captions") setFrameMode("body")
  if (tab.id === "scenes") {
    // Task 2 will set compositionPane; for now leave frameMode unchanged
  }
}}
```

- [ ] **Step 3: Typecheck / ensure no leftover `"intro"` EditorTab references under `editorTab === "intro"` still compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`  
Expected: errors pointing at remaining `editorTab === "intro"` blocks (Task 3 removes them) OR clean if already unused. Note remaining spots; do not “fix” by restoring the tab.

- [ ] **Step 4: Commit**

```bash
git add components/news-clips/review-step.tsx
git commit -m "$(cat <<'EOF'
refactor: drop standalone intro editor tab from review

EOF
)"
```

---

### Task 2: Add composition pane state synced with preview frameMode

**Files:**
- Modify: `components/news-clips/review-step.tsx`

**Interfaces:**
- Produces:
  - `type CompositionPane = "intro" | "body"`
  - `compositionPane` state
  - `setCompositionPane(pane)` that also sets `frameMode` to `"title"` | `"body"`
  - Left preview 인트로|본문 tabs call the same setter when `editorTab === "scenes"` or always in preview (keep one source of truth)

- [ ] **Step 1: Add state next to `frameMode`**

```tsx
type CompositionPane = "intro" | "body"

const [frameMode, setFrameMode] = useState<"title" | "body">("title")
const [compositionPane, setCompositionPaneState] =
  useState<CompositionPane>("intro")

function setCompositionPane(pane: CompositionPane) {
  setCompositionPaneState(pane)
  setFrameMode(pane === "intro" ? "title" : "body")
}
```

- [ ] **Step 2: Wire left preview tabs (preview mode) to `setCompositionPane`**

Replace `onClick={() => setFrameMode("title")}` / `"body"` on the sticky preview tablist with:

```tsx
onClick={() => setCompositionPane("intro")}
// ...
onClick={() => setCompositionPane("body")}
```

Keep `aria-selected` based on `frameMode` or `compositionPane` (they stay equal via the setter). Prefer `compositionPane === "intro"` for clarity.

- [ ] **Step 3: When opening 화면 구성 editor tab, sync pane**

```tsx
if (tab.id === "scenes") {
  setCompositionPane(compositionPane) // no-op refresh OK
  setFrameMode(compositionPane === "intro" ? "title" : "body")
}
```

Better: when switching to scenes, ensure frame matches current pane:

```tsx
if (tab.id === "scenes") {
  setFrameMode(compositionPane === "intro" ? "title" : "body")
}
```

- [ ] **Step 4: Commit**

```bash
git add components/news-clips/review-step.tsx
git commit -m "$(cat <<'EOF'
feat: sync composition pane with intro/body preview

EOF
)"
```

---

### Task 3: Move intro controls under 화면 구성 > 인트로

**Files:**
- Modify: `components/news-clips/review-step.tsx` (intro card block ~1161–1306 and scenes block)

**Interfaces:**
- Consumes: `compositionPane`, `editorTab === "scenes"`, existing intro handlers (`setIntroStillFromCursor`, `restoreAutomaticIntroStill`, intro RangeInputs)
- Produces: intro UI visible when `(mode === "preview" || mode === "direction") && editorTab === "scenes" && compositionPane === "intro"` — direction may hide intro pane (spec: intro meaningful in preview). **Use preview-only for intro pane.**

- [ ] **Step 1: Change intro card guard**

From:

```tsx
{mode === "preview" && editorTab === "intro" && introVideoUrl ? (
```

To:

```tsx
{mode === "preview" &&
editorTab === "scenes" &&
compositionPane === "intro" &&
introVideoUrl ? (
```

Keep the card body identical (timeline, zoom, x/y, auto restore). Optionally shorten `Card.Description` to empty/remove if it adds guidance — prefer delete description text to match minimal-copy rule, keep title `인트로`.

- [ ] **Step 2: Inside scenes editor area, add sub-tablist before content**

At the start of the scenes `Card` (when `editorTab === "scenes"`), for preview mode render:

```tsx
{mode === "preview" ? (
  <div
    role="tablist"
    aria-label="화면 구성"
    className="mb-4 flex w-full gap-1 rounded-xl border border-separator bg-default p-1"
  >
    <button
      type="button"
      role="tab"
      aria-selected={compositionPane === "intro"}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
        compositionPane === "intro"
          ? "bg-background text-foreground shadow-sm"
          : "text-muted hover:text-foreground"
      }`}
      onClick={() => setCompositionPane("intro")}
    >
      인트로
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={compositionPane === "body"}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
        compositionPane === "body"
          ? "bg-background text-foreground shadow-sm"
          : "text-muted hover:text-foreground"
      }`}
      onClick={() => setCompositionPane("body")}
    >
      본문
    </button>
  </div>
) : null}
```

- [ ] **Step 3: Gate body scene list with `compositionPane === "body" || mode === "direction"`**

Wrap the former scenes body content so it only shows for body pane (preview) or always in direction:

```tsx
{(mode === "direction" || compositionPane === "body") && (
  /* scene list + controls from Task 4 */
)}
```

When preview + intro pane, scene list is hidden (intro card from Step 1 shows instead). Structure options:

**Preferred structure for scenes Card content:**

```tsx
{(mode === "direction" || mode === "preview") && editorTab === "scenes" ? (
  <Card>
    <Card.Header>...</Card.Header>
    <Card.Content>
      {mode === "preview" ? /* sub-tablist */ : null}
      {mode === "preview" && compositionPane === "intro"
        ? /* move intro controls HERE instead of separate card, OR keep separate card above */
        : null}
      {(mode === "direction" || compositionPane === "body")
        ? /* body list */
        : null}
    </Card.Content>
  </Card>
) : null}
```

Consolidate so intro controls live inside the same Card as the sub-tabs (avoid two competing cards). Cut the old standalone intro Card and paste its content into the intro pane branch.

- [ ] **Step 4: Manual check**

Run the app, open preview → 화면 구성 → 인트로: still scrubber + framing works; independent top editor 「인트로」 tab is gone.

- [ ] **Step 5: Commit**

```bash
git add components/news-clips/review-step.tsx
git commit -m "$(cat <<'EOF'
feat: nest intro framing controls under composition tab

EOF
)"
```

---

### Task 4: Body section list — select to reveal crop + range only

**Files:**
- Modify: `components/news-clips/review-step.tsx` (scenes list ~1409–1560)

**Interfaces:**
- Consumes: `selectedDirectionSceneId`, `selectDirectionScene`, `updateReportScene`, `scene.crop ?? project.crop`
- Produces: compact selectable rows; expanded panel only when `scene.id === selectedDirectionSceneId`; crop edits write to `scene.crop`

- [ ] **Step 1: Remove 「전체 화면 설정」 section**

Delete the entire `<section>…전체 화면 설정…</section>` block with the three always-visible `RangeInput`s for global crop.

- [ ] **Step 2: Replace always-expanded scene cards with selectable rows**

For each scene, render a button/row:

```tsx
<button
  type="button"
  className={`flex w-full flex-col gap-1 rounded-xl border p-3 text-left ${
    scene.id === selectedDirectionScene?.id
      ? "border-foreground/35 bg-default"
      : "border-separator"
  }`}
  onClick={() => selectDirectionScene(scene.id, scene.sourceStart)}
>
  <span className="flex items-center gap-2 text-xs text-muted">
    <span>구간 {index + 1}</span>
    <span className="rounded-md border border-separator px-1.5 py-0.5">
      {scene.visual === "quote" ? "직접발언" : "자료"}
    </span>
  </span>
  <span className="line-clamp-2 text-sm leading-6">{scene.narration}</span>
</button>
```

Use `selectDirectionScene` in preview as well (not only direction).

- [ ] **Step 3: Below the selected row only, show controls**

Immediately after the selected row (or inside an expanded panel under it):

```tsx
{scene.id === selectedDirectionScene?.id ? (
  <div className="mt-2 flex flex-col gap-4 rounded-xl border border-separator p-3">
    <div className="grid gap-5 md:grid-cols-3">
      {(() => {
        const crop = scene.crop ?? project.crop
        const patchCrop = (partial: Partial<typeof crop>) =>
          updateReportScene(scene.id, {
            crop: { ...crop, ...partial },
          })
        return (
          <>
            <RangeInput
              label="화면 확대"
              value={crop.zoom}
              min={1.02}
              max={1.8}
              step={0.01}
              formatValue={ratioPercent}
              onChange={(zoom) => patchCrop({ zoom })}
            />
            <RangeInput
              label="가로 크롭 중심"
              value={crop.x}
              min={0}
              max={100}
              step={1}
              formatValue={screenPercent}
              onChange={(x) => patchCrop({ x })}
            />
            <RangeInput
              label="세로 크롭 중심"
              value={crop.y}
              min={0}
              max={100}
              step={1}
              formatValue={screenPercent}
              onChange={(y) => patchCrop({ y })}
            />
          </>
        )
      })()}
    </div>
    <SourceRangeTimeline
      scene={scene}
      sourceId={scene.sourceId || project.source?.id || ""}
      duration={sceneSourceDuration(
        project,
        scene,
        directionSourceMetadata.url ===
          sourceVideoUrlFor(scene.sourceId || project.source?.id)
          ? directionSourceMetadata.duration
          : 0
      )}
      onStartChange={(sourceStart) => {
        selectDirectionScene(scene.id, sourceStart)
        updateReportScene(scene.id, { sourceStart })
      }}
      onEndChange={(sourceEnd) => {
        selectDirectionScene(
          scene.id,
          Math.max(scene.sourceStart, sourceEnd - 0.1)
        )
        updateReportScene(scene.id, { sourceEnd })
      }}
    />
  </div>
) : null}
```

- [ ] **Step 4: Remove source select + visual select from this pane**

Delete the `<label>사용 자료</label>` and `<label>화면 종류</label>` blocks from the composition body UI. Badge on the row replaces them for readout.

- [ ] **Step 5: Update card title/description**

```tsx
<Card.Title className={cardTitleClass}>화면 구성</Card.Title>
```

Remove or empty `Card.Description` (no “자료는 TTS…” guidance).

- [ ] **Step 6: Manual verification checklist**

1. Preview → 화면 구성 → 본문: only section list visible; no crop sliders until click.
2. Click section: crop + timeline appear; left preview seeks to `sourceStart`.
3. Change crop on section A: only A’s preview framing changes; B unchanged.
4. Preview → 인트로 sub-tab: intro controls; no body list.
5. Top editor tabs: no standalone 인트로.

- [ ] **Step 7: Commit**

```bash
git add components/news-clips/review-step.tsx
git commit -m "$(cat <<'EOF'
feat: show body framing controls only for selected section

EOF
)"
```

---

### Task 5: Smoke + lint cleanup

**Files:**
- Modify: `components/news-clips/review-step.tsx` (any leftover intro tab / unused vars)

- [ ] **Step 1: Search for leftovers**

```bash
rg -n 'editorTab === "intro"|id: "intro"|전체 화면 설정|사용 자료|화면 종류' components/news-clips/review-step.tsx
```

Expected: no matches for intro editor tab or always-on global crop / source-type controls in composition pane.

- [ ] **Step 2: Lint**

Use IDE diagnostics / `npx tsc --noEmit -p tsconfig.json` and fix any errors introduced in this file.

- [ ] **Step 3: Final commit if cleanup needed**

```bash
git add components/news-clips/review-step.tsx
git commit -m "$(cat <<'EOF'
chore: clean leftover composition UI references

EOF
)"
```

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| Remove standalone intro editor tab | Task 1 |
| Composition sub-tabs 인트로 \| 본문 | Task 2–3 |
| Preview sync with sub-tabs | Task 2 |
| Move intro controls under composition | Task 3 |
| Per-scene crop type + render | Task 0 |
| Remove always-on global crop block | Task 4 |
| Section list + controls only when selected | Task 4 |
| Hide source/visual selects; badge only | Task 4 |
| Minimal copy | Task 3–4 |

## Placeholder / consistency review

- No TBD steps.
- `CompositionPane` naming consistent across tasks.
- Crop: `scene.crop ?? project.crop` in UI and render.
- Intro pane preview-only as specified.
