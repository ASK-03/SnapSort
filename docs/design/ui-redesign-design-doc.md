# SnapSort UI/UX & Motion Redesign Design Doc

**Branch:** `feat/ui-changes`  
**Design artifacts:** [ui-prototype.html](file:///home/ask-03/Abhishek/projects/SnapSort-Main/SnapSort/docs/design/ui-prototype.html) (self-contained in `docs/design/` with `docs/design/assets/`)  
**Window targets:** `1200×800` (default) and `720×800` (narrow), Dark & Light themes, 100% offline  
**Baseline already on branch:** Frameless [TopBar.tsx](file:///home/ask-03/Abhishek/projects/SnapSort-Main/SnapSort/desktop/src/components/TopBar.tsx) with `Ctrl K` / `⌘K` search and inline clear `X`, `SearchResults` with abort/retry in [Gallery.tsx](file:///home/ask-03/Abhishek/projects/SnapSort-Main/SnapSort/desktop/src/components/Gallery.tsx), and collection-scoped `lightboxPaths` in [Lightbox.tsx](file:///home/ask-03/Abhishek/projects/SnapSort-Main/SnapSort/desktop/src/components/Lightbox.tsx).

---

## 1. Product Aesthetic & Direction

SnapSort should feel like a **quiet, photo-first desktop contact sheet** — warm, restrained, and trustworthy — where real photographs carry the color and chrome steps out of the way.

- **Surface hierarchy:** One neutral canvas (`--ss-bg`), one subtly differentiated sidebar (`--ss-surface`), one raised surface (`--ss-surface-hi`) for popovers, menus, and active pills, and one crisp hairline border (`--ss-border`). Shadows are reserved strictly for overlapping surfaces (`ContextMenu`).
- **One accent role:** `--ss-accent` marks the active navigation item, primary CTA (when empty or confirming), focus rings, and active adjustment indicators — never permanent loud competition against photos.
- **Museum/contact-sheet restraint (`canvas-design` + `theme-factory`):** Let real photographs supply ~90% of the visual weight and keep UI copy whisper-quiet (~10%). Maintain one cohesive dual-theme (`Light` + `Dark`) token identity across every screen (`Settings` and `About` included), never adding decorative glow effects.
- **No AI tells in shipped copy (`tastemaker`):** Ground every label in a concrete product fact, use concise sentence case, and avoid em dashes (`—`) in user-facing UI strings (prefer periods, colons, or `·` separators).
- **Honest local software:** No network font requests, no glow shadows, no fake toggles, and no dead `"Coming soon"` buttons in primary chrome.

---

## 2. Saved Skills Registry (Persisted for Future Sessions)

All requested skill suites are installed globally and persisted for future sessions:

| Suite | Saved Locations | Primary Responsibilities |
| --- | --- | --- |
| **Emil Kowalski** (`emilkowalski/skills`) | `~/.agents/skills/` & `~/.gemini/config/skills/` (`find-animation-opportunities`, `emil-design-eng`, `review-animations`, `improve-animations`, `remove-animations`, `animation-performance`, `choreograph`, `gestures`, `apple-design`) | Frequency-based motion gating, `<300ms` UI budgets, custom cubic-beziers, `:active` feedback, interruptibility, GPU-only transforms |
| **Jakub Krehel** (`jakubkrehel/skills`) | `~/.agents/skills/` & `~/.gemini/config/skills/` (`better-interface`, `better-accessibility`, `better-colors`, `better-layout`, `better-motion`, `better-typography`, `better-ui`, `better-writing`, `interface-review`, `state-machine`, `build-design`, `break`, `explain-interface`, `variant`, `upskill`, `afk`) | Exact press scale (`0.96`), pure-black/white `1px` inset image outlines, theme-switch transition suppression, `overscroll-behavior: contain`, WCAG 2.2 AA contrast & focus restoration, tabular figures |
| **Owl-Listener** (`Owl-Listener/designer-skills`) | Repo `.gemini/extensions/` & global `~/.gemini/extensions/` (`visual-critique`, `ui-design`, `design-systems`, `interaction-design`, `prototyping-testing`, `ux-strategy`, `design-research`, `design-ops`, `designer-toolkit`) | 7-dimension visual critique (Hierarchy, Composition, Color, Type, Affordance, Density, Brand Consistency) |
| **Anthropic Craft** (`anthropics/skills`) | `~/.agents/skills/` & `~/.gemini/config/skills/` (`theme-factory`, `canvas-design`) | Dual-theme palette/typography cohesion across views (`theme-factory`); visual-first restraint, zero text/image overlap, breathing room (`canvas-design`) |
| **Tastemaker** (`codeswithroh/tastemaker`) | `~/.agents/skills/tastemaker/` & `~/.gemini/config/skills/tastemaker/` | Contrast-contract color pairing (`check_contrast`), app-shell motion track, internal<=external card spacing, zero em dashes in UI copy, anti-slop & motion audits |
| **Core Craft** | `~/.gemini/config/skills/` (`stageshow`, `design-taste-frontend`, `frontend-design`, `web-design-guidelines`) | Squint test, restraint (`3–7` strings per focal group), `1.02x` framed tile zoom |

---

## 3. UI/UX Quality Standard (Target Bar)

Every screen must pass these measurable gates before shipping:

1. **Visual Hierarchy & Composition**
   - Exactly **1 primary focus** per screen (photos in Gallery, portraits in People, active image in Lightbox).
   - Collection header shows title + count once (`All Photos · 16 photos` or `<Folder> · N photos`), aligned to the same `24px` left edge as the search bar and photo grid.
   - Internal card/tile padding never exceeds external grid gaps (`internal <= external`), and zero permanent idle status cards or duplicate counts remain.
2. **Color, Surfaces & Contrast (WCAG 2.2 AA)**
   - **100% `--ss-*` semantic tokens** across every component (`Settings.tsx`, `About.tsx`, `Lightbox.tsx`, `EditPanel.tsx`, and `InfoPanel.tsx` included); zero hardcoded `slate-*`, `#0f1115`, `#1a1d24`, `blue-600`, or decorative blue glow shadows.
   - **Theme-aware Viewer & Editor:** In Light mode, the Viewer backdrop, header, right-side inspector drawers, segmented mode tabs, sliders, and zoom bar use light `--ss-viewer-*` / `--ss-*` surfaces rather than forcing a dark overlay.
   - Body and metadata text (`--ss-text`, `--ss-text-dim`, `--ss-text-mute`) **>= 4.5:1** contrast against both `--ss-bg` and `--ss-surface` in Dark and Light themes (adjust lightness within hue, never arbitrary colors).
   - Interactive control borders and `:focus-visible` rings **>= 3:1** contrast against adjacent surfaces (and visible on both near-white and near-black photos).
3. **Typography & Offline Integrity**
   - `Instrument Sans` (weights `400, 500, 600, 700`) bundled locally in `desktop/public/fonts/` with **0 external Google Fonts requests**.
   - Clear scale: `24px` (`1.5rem`) semibold (`600`) `-0.02em` tracking for collection titles, `14px` (`0.875rem`) medium (`500`) for nav/controls/person names, `12–13px` regular for counts and metadata. **Zero sub-`12px` text.**
   - Sentence-case headers (`Folders`, `Adjust`, `Details`, `People`), ellipsis (`…`), `tabular-nums` on every counter/percentage/zoom/slider readout, zero em dashes (`—`) in UI copy, and exact singular/plural (`1 photo` vs `16 photos`).
4. **Affordance, Trust & Product Honesty**
   - Every visible control is real, operable, and honest: remove dead `"Coming soon"` buttons (`Heart`, `MoreHorizontal`, disabled `ContextMenu` rows) until their backend endpoints ship.
   - `EditPanel` provides real `Crop`, `Adjust`, `Filters`, and `Rotate` tools backed by a `Save as Copy` endpoint that keeps the original untouched and preserves date/camera EXIF metadata.
   - `Settings` renders truthful local engine status rows instead of non-functional toggle `div`s and an empty `Clear Index` button.
   - Every empty, zero-match, or error state offers a concrete recovery CTA (`Add folder`, `Clear search`, `Retry`).
5. **Keyboard & Accessibility**
   - All photo and face/person tiles are semantic `<button>` elements (never `<div onClick>`) with descriptive `aria-label`s.
   - Every icon-only button has an explicit `aria-label`.
   - `Lightbox` exposes `role="dialog"`, `aria-modal="true"`, `aria-label`, traps/manages focus on open, and restores focus to the launching tile on `Escape`/close.
   - `prefers-reduced-motion`, `prefers-reduced-transparency`, and `@media (hover: hover) and (pointer: fine)` are respected globally.
6. **Motion Craft & 60fps Performance**
   - Zero `transition-all` declarations; zero `width`/`height`/`margin`/`padding` animations (`InfoPanel`, `EditPanel`, `Sidebar` progress).
   - `0ms` instant stepping on keyboard navigation (`ArrowLeft`/`ArrowRight`) and search shortcuts (`Ctrl K`, `Escape`).
   - All UI transitions `< 300ms`, asymmetric enters/exits, custom easing tokens (`--ease-out`, `--ease-in-out`, `--ease-drawer`), and clean theme-switch transition suppression.

---

## 4. Animation Opportunities Audit

Derived from `find-animation-opportunities`, `review-animations`, `apple-design`, and `better-motion`:

### Part A — High-Leverage Animation Opportunities (Capped at 7)

| # | Location | Today | Purpose | Frequency | Exact Motion Recipe |
| --- | --- | --- | --- | --- | --- |
| 1 | Interactive buttons & tiles (`Sidebar`, `TopBar`, `Gallery`, `Faces`, `Lightbox`, `EditPanel`, `ContextMenu`) | No `:active` press scale | **Feedback** | Tens/day | `:not(:disabled):active { transform: scale(0.96); }` (`scale(0.985)` on photo/person tiles), `transition: transform 140ms var(--ease-out)` |
| 2 | `EditPanel.tsx` & `InfoPanel.tsx` | `transition-[width] duration-320` causes full flexbox reflow per frame; Edit sits on left away from its top-right button | **Spatial consistency** | Occasional | Unified `320px` right-side inspector lane directly beneath the top-right `Edit`/`Info` buttons; transition `transform: translateX(100% -> 0)` + `opacity` at `240ms var(--ease-drawer)` enter / `160ms var(--ease-out)` exit |
| 3 | `Lightbox.tsx` & `index.css` | Symmetric `320ms` open/close; `ArrowLeft`/`ArrowRight` runs `320ms` View Transition | **Spatial consistency** | Occasional open / 100+/day step | Enter `260ms var(--ease-drawer)` (`scale(0.98)` + `opacity: 0` → `1`), exit `160ms var(--ease-out)` (`scale(0.99)` + `opacity: 0`); pointer prev/next crossfade `180ms`; keyboard `ArrowLeft`/`ArrowRight` **`0ms` instant** |
| 4 | `ContextMenu.tsx` | Unclamped `@keyframes` with `origin-top-left` | **Spatial consistency** | Tens/day | Clamp `{x, y}` to viewport; set dynamic `transform-origin` to opening corner; use `@starting-style` CSS transition (`opacity: 0; transform: scale(0.96)`) at `120ms var(--ease-out)` (or instant open + `110ms` fade-out on close); add `overscroll-behavior: contain` |
| 5 | `Gallery.tsx` (`PhotoGrid`) | Border-color hover only | **Feedback** | Tens/day | Inside `overflow-hidden` frame, subtle `group-hover:scale-[1.02]` on `<img>` (`transition: transform 200ms var(--ease-out)`), strictly wrapped in `@media (hover: hover) and (pointer: fine)` |
| 6 | `Sidebar.tsx` scan progress | Always-visible idle `0 / 0` card; progress bar animates `width` | **State indication** | Occasional | Render progress card only while `isScanning` with `@starting-style` (`opacity: 0; transform: translateY(4px)`, `200ms var(--ease-out)`); animate bar fill with `transform: scaleX(...)` (`transform-origin: left`, `200ms var(--ease-out)`) |
| 7 | Empty / recovery states (`Gallery.tsx`, `Faces.tsx`) | Static icon & text | **Preventing jarring change** | Rare / first-time | Gentle staged reveal (`opacity: 0; transform: translateY(8px)`, `240ms var(--ease-out)`) gated behind `prefers-reduced-motion: no-preference` |

### Part B — Existing Motion & Surface Violations to Fix

| Before | After | Why |
| --- | --- | --- |
| `transition-all` in `Sidebar.tsx`, `Faces.tsx`, `EditPanel.tsx`, `Lightbox.tsx` | Explicit `transition-[transform,opacity,background-color,color,border-color]` | Unbounded `all` animates unintended properties off-GPU |
| `transition-[width] duration-320` on `InfoPanel` / `EditPanel` & `style={{ width: ...% }}` on scan bar | Compositor-only `transform` / `opacity` and `scaleX()` | `width` triggers layout + paint on every frame |
| `ArrowLeft` / `ArrowRight` calls `withViewTransition` (`320ms`) | Direct state update (`0ms`) on keyboard nav | 100+/day keyboard actions must never feel delayed |
| `lightbox-out` symmetric `320ms` (`scale(0.97)`) | `lightbox-out` `160ms var(--ease-out)` (`scale(0.99)`) | Exits must be faster and subtler than entrances |
| `@keyframes ctxmenu` (`200ms`) with fixed `origin-top-left` | Viewport-clamped `@starting-style` + dynamic corner `transform-origin` | Keyframes cannot interrupt cleanly; fixed origin detaches from edge clicks |
| Theme toggle transitions every color simultaneously | Briefly add `.theme-switching` to suppress transitions for 1 frame | Prevents smeared multi-speed color crossfades (`better-motion`) |
| No `@media (prefers-reduced-motion: reduce)` or `@media (hover: hover)` rules | Global opt-out for travel/scale (keep `150ms` opacity fade) + hover gating | Prevents vestibular discomfort and touch sticky-hover bugs |

### Part C — Rejected Animation Candidates (Gate Audit)

1. **`Lightbox.tsx` keyboard `ArrowLeft`/`ArrowRight` crossfade** — *Rejected: Frequency (100+/day keyboard navigation). Must be 0ms.*
2. **`TopBar.tsx` search open/clear (`Ctrl K`, `Escape`)** — *Rejected: Frequency (100+/day keyboard command).*
3. **`Gallery.tsx` virtualized tile mount stagger** — *Rejected: Frequency & Function (scroll-recycling grid items must never stagger or block rapid scanning).*
4. **`SearchResults` list stagger on keystroke** — *Rejected: Speed & Function (live search refinement needs instant result settle).*
5. **`Lightbox.tsx` wheel/drag zoom CSS transition** — *Rejected: Direct manipulation (must stay 1:1 with pointer with zero lag).*

---

## 5. Phase-Wise Implementation Plan (6 Phases · 1 Commit Each)

> **Git Hygiene Rule:** **`brag-output/`, `video/`, and `video-hf/` must NEVER be included in any commit.** Before Phase 1, unstage any `brag-output/` entries (`git reset HEAD -- brag-output`) and verify `git diff --cached --name-only` contains zero paths under `brag-output/`, `video/`, or `video-hf/` before every phase commit (`git commit --only <phase-files> -m "..."`).

### Phase 1 — Design Tokens, Offline Fonts, Motion Curves & A11y Media Rules
**Time:** ~25 min  
**Commit:** `style(ui): bundle Instrument Sans offline, unify design and motion tokens, and add a11y rules`  
**Files:**
- Copy `InstrumentSans-{400,500,600,700}.ttf` from `brag-output/real-tour/assets/fonts/` → `desktop/public/fonts/`
- `desktop/index.html` — Remove Google Fonts `<link>` tags (100% offline boot).
- `desktop/src/index.css` — Add local `@font-face` rules (`400, 500, 600, 700`), raise `--ss-text-mute` contrast (`>= 4.5:1` in light & dark), define `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`, `.pressable` (`:not(:disabled):active { transform: scale(0.96); }`), `.img-frame-outline` (`1px` inset `oklch(0 0 0 / 0.1)` light / `oklch(1 0 0 / 0.1)` dark), `.theme-switching *` transition suppression, tightened asymmetric `lightbox-in` (`260ms`) / `lightbox-out` (`160ms`) / `viewer-image` (`180ms`), `@media (prefers-reduced-motion: reduce)`, `@media (prefers-reduced-transparency: reduce)`, and `@media (hover: hover) and (pointer: fine)` hover-zoom gating.
- `desktop/tailwind.config.js` — Expose `ease-out-ui`, `ease-drawer`, and typography/duration tokens.
- `desktop/src/lib/viewTransition.ts` — Respect `prefers-reduced-motion` cleanly and support optional `skipTransition` flag.

**Phase 1 Exit Check:** `npm run lint && npx tsc -b && npm run build` passes; DevTools Network tab shows 0 requests to `fonts.googleapis.com` / `fonts.gstatic.com`.

---

### Phase 2 — Photo-First Library Shell, Sidebar Hierarchy & Recovery Empty States
**Time:** ~35 min  
**Commit:** `feat(ui): redesign library header, sidebar hierarchy, tile framing, and empty states`  
**Files:**
- `desktop/src/components/Gallery.tsx` —
  - Add unified collection header aligned to `24px` (`px-6`) inset: `All Photos` (`24px` semibold `-0.02em`) + single `N photos` (`13px tabular-nums`, proper `1 photo` singular) or active folder name with clear chip; move thumbnail-size slider + icon to the right end of that header row.
  - Remove the duplicate bottom status/zoom bar so photos use full vertical space.
  - Convert `PhotoGrid` tiles from `<div onClick>` to semantic `<button type="button">` with `aria-label`, `6px` (`rounded-md`) radius, `8px` (`gap-2`) gutter, `ring-inset` focus/selection rings (never clipped by `react-virtuoso`), pure black/white `1px` inset photo outline, `@media (hover: hover)` `1.02x` inner image zoom, and `.pressable` (`scale(0.985)`).
  - Add actionable empty states: empty library shows local-privacy explanation + primary `Add folder` button; empty folder explains folder is empty; zero-match search offers `Clear search` button; `SearchResults` uses `150ms` debounce.
- `desktop/src/components/Sidebar.tsx` —
  - Replace full-width blue `Select Folder` button with a compact `Add folder` action button beside the sentence-case `Folders` section header (promoting primary `Add folder` to empty Gallery).
  - Convert `FOLDERS` → sentence-case `Folders`, bump sub-`12px` counts to `12px tabular-nums`, add `overscroll-behavior: contain` on folder list, replace `transition-all`, add `.pressable` and `aria-current="page"`.
  - Hide the permanent idle `0 / 0` card; show scan progress card only while `isScanning` (with active folder name when available, `tabular-nums`, and GPU `transform: scaleX()` progress bar).
- `desktop/src/components/TopBar.tsx` —
  - Align search container / spacing harmoniously with `24px` content grid, apply translucent surface material (`backdrop-blur-md` with reduced-transparency fallback), suppress transitions cleanly on theme switch, bump `<kbd>` from `10px` to `12px`, and ensure `aria-label` + `focus-visible` on every button.
- `desktop/src/App.tsx` —
  - Align `SearchResults` / `Gallery` padding and pass `onSelectFolder` or store trigger cleanly; track active scanning folder name in `store.ts` if needed (check `store.ts` only if adding `scanningFolder`).

**Phase 2 Exit Check:** At `1200×800`, header reads `All Photos · 16 photos` aligned with first tile, thumbnail slider aligns with right grid edge, bottom bar is gone, idle card is hidden when idle, and empty/zero-match/error states each show a working CTA.

---

### Phase 3 — People, Faces & Person Detail Redesign
**Time:** ~25 min  
**Commit:** `feat(ui): scale People cards, refine Faces grid, and align PersonView header`  
**Files:**
- `desktop/src/components/Faces.tsx` —
  - Share `24px` (`px-6`) content inset and `24px` semibold header (`People` / `Faces` + single `tabular-nums` count).
  - Give **People** view `grid-cols-[repeat(auto-fill,minmax(144px,1fr))]` (`gap-4`) with clean portrait cards: name (`14px` medium, line 1) and naturally pluralized count (`1 photo` / `N photos`, `12px` `tabular-nums`, line 2) on separate lines — removing `Person #<id>` from named cards.
  - Keep **Faces** view denser for comparison (`minmax(112px, 1fr)`), raise `10px` text to `12px`, convert clickable `<div>` / `<h3>` triggers to accessible `<button>` / keyboard controls, replace `transition-all`, add `.pressable` and `ring-inset` focus/selection.
  - Give empty `People` / `Faces` states clear explanatory copy and recovery link to `All Photos` or `Faces`.
- `desktop/src/components/PersonView.tsx` —
  - Align header to `24px` inset (`px-6`), keep `Back to people` button next to the `96px` portrait carrying `PERSON_AVATAR_VT` (with `1px` inset outline), fix `1 photo` singularization with `tabular-nums`, keep `PhotoGrid` shared edge, and add `aria-label` + `.pressable`.

**Phase 3 Exit Check:** 4 people cards fill comfortably at `1200×800`, narrow window (`720×800`) keeps long names + `1 photo` readable on separate lines, `Person #<id>` is absent on named cards, and opening/closing a person preserves avatar morph & scroll position.

---

### Phase 4 — Viewer Chrome, Right-Side `InfoPanel`, Backdrop Close, Fullscreen, Context Menu & Keyboard Flow
**Time:** ~35 min  
**Commit:** `feat(ui): protect viewer framing, polish InfoPanel and ContextMenu, and complete keyboard flow`  
**Files:**
- `desktop/src/components/Lightbox.tsx` —
  - Theme the Viewer backdrop, header, zoom bar, navigation buttons, and face chips via `--ss-viewer-*` / `--ss-*` tokens so Light mode uses a light canvas and light controls (`TopBar.tsx` / Electron window theme stays synced to `theme`).
  - Change top bar from `absolute` overlay to a slim `shrink-0` header lane (`56px` / `--window-height` + clearance) so filenames, `1 of N` (`tabular-nums`), and toolbar icons never cross image pixels; truncate long filenames (`min-w-0 truncate`) cleanly clear of action buttons.
  - Center the image inside the remaining area when the right-side inspector (`InfoPanel` or `EditPanel`, unified `320px` lane) opens so switching between `Edit` and `Info` never shifts the photo horizontally.
  - Clicking the empty dark backdrop around the photo at `100%` zoom closes the viewer (same as clicking `Close` or pressing `Escape`), while ignoring clicks on the photo, controls, drawers, or pan drags.
  - Wire the `Maximize2` / `Minimize2` icon button in the bottom zoom pill to toggle true Fullscreen (`requestFullscreen()` / `exitFullscreen()` synced with `fullscreenchange`), and make the `100%` `tabular-nums` percentage readout the clickable reset-zoom-to-fit button.
  - Remove dead disabled `Heart` and `MoreHorizontal` buttons from primary chrome.
  - Bypass `withViewTransition` on `ArrowLeft` / `ArrowRight` (`0ms` instant stepping); keep `260ms`/`160ms` open/close and `180ms` pointer-click crossfade.
  - Add `role="dialog"`, `aria-modal="true"`, `aria-label`, `aria-label` on `Close`, `Edit`, `Info`, `Previous photo`, `Next photo`, `Zoom out`, `Zoom in`, `Reset zoom`, `Toggle fullscreen`, focus entry on open, and focus restoration to the launching tile on close (coordinated with `Gallery.tsx` / `store.ts`).
  - Replace `transition-all` with explicit GPU properties and `.pressable`.
- `desktop/src/components/InfoPanel.tsx` —
  - Dock on the right (`320px`), replace `transition-[width] duration-320` layout reflow with compositor-friendly slide/reveal (`transform: translateX(100% -> 0)` + `opacity`, `240ms var(--ease-drawer)` enter / `160ms var(--ease-out)` exit), sentence-case `Details` & `People (N)` headers at `12px` (`font-medium`), and `overscroll-behavior: contain`.
- `desktop/src/components/ContextMenu.tsx` —
  - Remove dead disabled rows (`Reprocess faces`, `Rename`, `Add to favorites`, `Delete`) until backend support exists, keeping truthful working actions (`Open`, `Copy path`).
  - Clamp `{x, y}` against `window.innerWidth`/`window.innerHeight` (via `useLayoutEffect` measuring menu rect), set dynamic `transform-origin` to the anchored corner, use `@starting-style` transition (`120ms var(--ease-out)`), `overscroll-behavior: contain`, keyboard ArrowUp/Down/Escape navigation, and focus restoration.

**Phase 4 Exit Check:** Portrait, panorama, and long-filename images show all 4 edges at 100% fit with Info open; backdrop click closes viewer; fullscreen toggles cleanly; `Enter` on tile 2 of 3 → `ArrowRight` reaches `3 of 3` in `0ms` → `Escape` returns focus to tile 2; right-clicking all 4 screen corners never clips `ContextMenu`.

---

### Phase 5 — Full Photo Editor (`Crop`, `Adjust`, `Filters`, `Rotate`) & Backend `Save as Copy`
**Time:** ~45 min  
**Commit:** `feat(editor): add crop, adjust, filters, rotate, and save-as-copy with EXIF preservation`  
**Files:**
- `backend/api.py` (and `backend/db.py` / `backend/controller.py` as needed) —
  - Add `POST /api/images/save-copy` accepting `{ path, mode: "copy" | "replace" (default "copy"), crop?: { x, y, w, h }, rotate_deg, flip_h, flip_v, straighten_deg, filter_preset, adjustments: { light, contrast, saturation, warmth } }`.
  - Validate source via `_resolve_indexed_path`, apply `ImageOps.exif_transpose`, crop/rotate/flip/straighten, filter preset (`Original`, `Vivid`, `Warm`, `Cool`, `Mono`, `Noir`), and `Light`/`Contrast`/`Saturation`/`Warmth` adjustments with Pillow (`ImageEnhance`), and preserve original EXIF bytes (date taken & camera details) via `exif=raw_exif`.
  - When `mode == "copy"`: write `<stem>_edited.<ext>` next to the original (incrementing `_edited_2`, etc. to never overwrite), register the new image in DB/index so it appears immediately, and return `{ path, filename }`.
  - When `mode == "replace"`: write to a temporary file in the same directory, atomically swap via `os.replace`, invalidate the disk preview cache for that path, and return `{ path, filename }`.
- `desktop/src/api.ts` —
  - Add typed `saveEditedCopy(payload)` client calling `POST /api/images/save-copy`.
- `desktop/src/components/Lightbox.tsx` & `desktop/src/components/EditPanel.tsx` —
  - Dock `EditPanel` in the unified `320px` right-side inspector lane (GPU `translateX(100% -> 0)` + `opacity`) directly under top-right `Edit` / `Save as Copy`.
  - Render `Save as Copy` as a split button (`Save as Copy` | `▾`) in both the header (`z-30`, strictly above `z-12` inspector drawers) and drawer footer: clicking the primary segment runs `Save as Copy` (safe default), while the dropdown offers `Save as Copy` and `Replace Original` (destructive hue + inline `"Replace original file?"` confirmation before overwriting).
  - Add segmented header tabs (`Crop`, `Adjust`, `Filters`, `Rotate`), top-left active filter badge (when != `Original`), bottom-right `Original kept` (or `Original replaced`) badge, and live bottom thumbnail strip for `Filters` (`Original`, `Vivid`, `Warm`, `Cool`, `Mono`, `Noir`).
  - Add draggable rule-of-thirds crop overlay with corner handles (`nw`, `ne`, `sw`, `se`) and aspect ratio pills (`Free`, `1:1`, `4:3`, `16:9`, `3:2`).
  - Add `Rotate left`, `Rotate right`, `Flip H`, `Flip V`, and zero-centered `Straighten` (`-45°..+45°`) controls.
  - Render zero-centered `Light`, `Contrast`, `Saturation`, and bidirectional `Warmth` sliders with `tabular-nums`, reassurance card (`"Saved next to the original, keeping its date and camera details."`), `Cancel`, and the split `Save as Copy` control wired to `saveEditedCopy` with gallery/store refresh.

**Phase 5 Exit Check:** Applying `Mono` + crop + rotate + `Warmth` and clicking `Save as Copy` creates `<stem>_edited.<ext>` next to the untouched original, preserves EXIF date/camera metadata, and displays the copy in the Library; opening the dropdown and confirming `Replace Original` atomically overwrites the original while preserving EXIF and updating the preview cache.

---

### Phase 6 — Truthful Settings, About Token Unification & Final Polish
**Time:** ~25 min  
**Commit:** `feat(ui): unify Settings and About with design tokens and truthful controls`  
**Files:**
- `desktop/src/components/Settings.tsx` —
  - Migrate 100% from hardcoded `bg-slate-50`, `dark:bg-[#0f1115]`, `dark:bg-[#1a1d24]`, `bg-blue-600` to `--ss-*` semantic tokens (`bg-bg`, `bg-surface`, `bg-surface-hi`, `border-border`, `text-text`, `text-text-dim`, `text-accent`).
  - Match library typography (`24px` semibold `Settings` heading, `24px` content inset, sentence-case section titles, aligned label/control rows separated by `border-border` dividers).
  - Replace fake non-interactive toggle `<div>`s and no-op `Clear Index` button with truthful read-only active engine status badges (`Local · Active` for YuNet + SFace face detection and CLIP ViT-B/32 semantic search) plus working `Add folder` / `Open GitHub Issue` actions.
- `desktop/src/components/About.tsx` —
  - Migrate 100% to `--ss-*` tokens; remove decorative `shadow-xl shadow-blue-500/20` glow shadow and use crisp `bg-surface border border-border` surface elevation.
  - Display actual app version (`3.0.10` matching `desktop/package.json`), plain one-sentence offline privacy summary, `100% Offline Processing` status row with icon + label, Website and GitHub links with visible focus rings and `.pressable`.

**Phase 6 Exit Check:** Switching `All Photos → Settings → About` in both Dark and Light themes preserves one unified palette, typography scale, and alignment edge with zero fake controls.

---

## 6. Verification Plan

### A. Per-Phase Automated Gate (Run after every phase before committing)
```bash
cd desktop && npm run lint && npx tsc -b && npm run build
python3 ~/.gemini/config/skills/tastemaker/scripts/audit_motion.py desktop/src
python3 ~/.gemini/config/skills/tastemaker/scripts/anti_slop_scan.py desktop/src
```

### B. Full Runtime & Visual Verification (Run after Phase 6 at `1200×800` and `720×800`)
1. **Cold Offline Launch (Dark & Light):** Block network / run offline; verify `Instrument Sans` renders, 0 failed network font requests in DevTools, and `--ss-text-mute` passes `>= 4.5:1` contrast in both themes.
2. **Library & Scanning Sequence:**
   - Frame 1 (Empty): Main canvas offers `Add folder` + offline explanation.
   - Frame 2 (Scanning): Sidebar displays active folder name, `tabular-nums` counts, and `scaleX()` progress bar.
   - Frame 3 (Populated 16-photo reference): Header reads `All Photos · 16 photos`, slider sits on right edge of header, no bottom bar, `6px` radius + `8px` gaps, pure black/white `1px` inset outlines on white-sky and night photos.
3. **Search & Recovery:** Type query → results update smoothly; search nonsense phrase → `No matching photos` + `Clear search` button restores grid; simulate backend error → `Retry` re-runs query.
4. **People & Faces:** 4 named people at `1200×800` (`minmax(144px, 1fr)`), narrow to `720×800` → long name wraps/truncates without colliding with `1 photo`, no `Person #id` on named cards, click person → avatar morphs cleanly into `PersonView`, Back returns smoothly.
5. **Viewer, Panels & Keyboard Sequence:**
   - Open middle photo of 3-photo folder via `Enter` → press `ArrowRight` (`0ms` instant step to `3 of 3`) → press `Escape` (focus returns to launching tile).
   - Repeat with `prefers-reduced-motion: reduce` enabled (no scaling travel; gentle opacity crossfades only).
   - Check portrait, panorama, and very long filename with `Info` and `Edit` open on the right: all 4 image edges stay visible at 100%, filename clears toolbar icons, zero-centered sliders fill symmetrically from `0`, negative `Warmth` cools photo, clicking the dark backdrop closes the viewer, and the fullscreen button enters/exits fullscreen.
   - Test `Crop` (draggable rule-of-thirds overlay + aspect presets), `Filters` (`Original`, `Vivid`, `Warm`, `Cool`, `Mono`, `Noir` + active pill), `Rotate` (`90°` + Flip + Straighten), and the `Save as Copy` split-button dropdown (`Save as Copy` default vs `Replace Original` confirmation + atomic overwrite with preserved EXIF date/camera metadata).
   - Right-click near all 4 viewport corners: `ContextMenu` clamps inside viewport and scales from its anchored corner.
6. **Motion & Frame Inspection:** Play open/close and panel transitions at 25% speed in Chrome DevTools Animations panel; verify compositor-only `transform`/`opacity` updates with zero layout-thrashing spikes during panel toggle.
7. **Git Hygiene Check:** Inspect `git log -n 6 --stat` and confirm zero files under `brag-output/`, `video/`, or `video-hf/` appear in any commit.
