# Handoff notes

Where the project stands, for picking it up in a new session.

## Latest Build It checkpoint — 2026-10-29

Read [Build It / Claude handoff](build-it-handoff.md) first for work on
`codex/build-it-rework`. It records the current implementation, verification,
remaining geometry gaps and the separate Explore Drawing proposal. Older notes
below remain context for other subsystems; they are not acceptance evidence for
the new building model.

## Status

- **MCP / Connect AI (desktop, 2026-10-21):** the desktop app serves MCP on 127.0.0.1:47821
  (`electron/mcpServer.cjs` transport, `electron/mcp.cjs` glue, `electron/mcp-stdio.cjs` pipe for
  command-based clients); tools in `src/mcp/tools.ts` run through the window's `commit`. Checked
  end to end against the real app (Electron under xvfb, through the stdio pipe): create project,
  add the sample set, rooms 5/5, walls EW1/W1, doors 5, ceilings, image, quantities, Excel saved to
  `<project>/Exports/`, a change made just before a hard kill was in project.json and reopened.
  Plan: Takeoff AI stays internal, released free on LinkedIn as a download; users bring their own
  AI subscription through MCP (no hosting, no API keys of ours).
- **Phase 1 (done):** manual takeoff. PDF sets split into sheets, sheet numbers
  and scales detected, area/linear/count tools, formula assemblies, Excel export,
  local persistence.
- **Phase 2 (in progress):** AI reads assembly legends (A0.2/A0.3 style sheets)
  into takeoff types. Two routes, same prompt and schema (`src/ai/`):
  - Hosted on claude.ai as an artifact: uses the viewer's Claude account through
    the artifact `sample` capability. No API key. Images are downsized to about
    1.2 MP there, so the sheet's text layer carries the small print.
  - Run locally (`npm run dev`): uses the user's Anthropic API key from
    **AI settings**, `claude-opus-5-5`, structured outputs.
- **Fill room (done; the estimator checked it against their Autodesk Takeoff areas: exact):** one-click room
  areas from PDF vector linework (`src/fill/`). On A2.1 at 1:100 every labelled
  room fills; closed rooms snap to the wall lines with 0.0 mm edge error, e.g.
  Staff Office 10.57 m², Staff Room 56.72, Elevator 5.49, Storage 23.30, BF WR
  7.60, Ski Service 40.66, Receiving 25.91, Mechanical 26.48, Electrical 11.54,
  Rescue & Safety 23.04, Jan. Cl. 2.66; the open-plan lobby/rental hall is
  273.87 m². How it works: wall pen = heaviest pen with mostly paired parallel
  lines (A2.1: 0.57 pt walls, 0.51 tags/frames, 0.28 furniture/hatch); gaps on a
  wall line up to 3 m are bridged (doors), up to 10 m when glazing runs along
  them (windows); flood fill at up to 2 px/pt (3 gave the same areas to 0.01 m² at twice the time), hole filling, boundary trace,
  then edges snapped to the drawn lines. First click reads the sheet's operator
  list (~3–6 s), then 0.1–2 s per room.
- **Room fill wall linework (generalized, tested on 84 Frederick A211-A214):** the sheet's
  wall pens are still picked once (`detectWallPens`), but rooms that do not close, or whose
  outline holds another room's tag, are filled again with the next lighter pen that also
  draws in wall-like pairs (`WallModel.lighter`, `settle` in `src/fill/rooms.ts`; the room
  tags' own box pen is skipped). A result is kept only if it holds its own tags and no
  other's, spans its tag box and name, and at least 60% of its outline runs along a wall
  face (a line with another a wall thickness outside it, or a closed opening:
  `wallFaceShare`); a space that had closed as one with several tags is split only when the
  parts cover 80% of it (the rest share what is left). This is the Kelso A2.2 retry that was
  dropped before, now with those guards (219/220 merging and the door-swing triangle are
  what they reject); Kelso itself was not available to re-check. Room tags placed outside a
  small room with a leader ending in a dot or arrow (WCs, closets) fill from the leader's
  end (`RoomLabel.seed`). Small closed slanted symbols in the wall pen (keynote triangles,
  diamonds) are left out of the fill's walls (`symbolShapes`); the wall takeoff still gets
  them (`WallModel.symbols`). A211: 13 of 53 tags filled before, 46 rooms (49 tags) now;
  A212-A214 every tag fills with no merges (were 44/47, 38/45, 32/36 with 2, 7, 3 merges).
- **Wall tag labelling (generalized, tested on 84 Frederick A212/A213):** which codes are
  wall tags comes from the set itself (`src/walls/setTypes.ts`, read once per drawing file
  by `setTypesOf`): codes listed under wall/partition/furring/foundation headings on an
  assembly types sheet ("Partition (p) Types:") are walls with that kind, codes under
  floor/ceiling/soffit/window headings are not, and a plan legend's placeholders ("w#  Wall
  Type", "Wxx  Window Type") give prefixes, case-sensitively. A set that lists its wall
  types rejects every other code; without one, `WALL_TAG` (any case, "x" existing marker)
  and leader-only generic codes as before, but a guessed code in a different symbol than
  the confirmed tags (hexagon window, triangle keynote) is dropped. Symbols can be filled
  shapes; leaders can be in a finer pen; a tag with no leader labels the nearest wall
  within 1.5x its symbol size. Partition and exterior/foundation types compete (nearest
  tag wins, one never carries through the other); types do not carry into or out of the
  thin leaves lining a thick (>= 250 mm) wall, and an exterior tag landing on such a leaf
  goes to the thick wall. Bands a fraction of a degree off square on a square sheet are
  dropped (two unrelated lines). Reading the set's text takes ~8-11 s for 40 sheets the
  first time a drawing file is used.
- **Wall takeoff:** `src/walls/`. Latest score across A2.0–A2.3 against the
  workbook: 10.7% total difference (A2.0 2%, A2.1 8%, A2.2 15%, A2.3 22%); 8.2% with W2 set to stop at doors (`CUT=W2 score4.sh`), which is how the estimator measures W2 but not W1;
  re-score with the per-sheet keys after any change to the carry rules (each
  rule change was kept only if the four-sheet total improved). Rules now: walls
  join across breaks up to 2.5× thickness; thick walls meet round corner
  columns; exterior/foundation types follow thickness changes up to 20% and can
  stack (EW6A over EW6B BELOW); furring does not run straight past a junction; a furring tag pointing
  into a column goes to the furring wrapped round it (a ring of walls ≤ 6 m
  round, found by rays from the piece it lands on), and a wrap side on a
  furring line that runs past the column carries both types (A2.1 FR2 24.2 vs
  24.6 m, was 11.7). Free wall ends facing each other on nearly one line (a
  pier between, faces stepping by up to 1.5 pt / 30% of thickness, thickness
  within 35%) meet in the middle and carry types straight through, and so do
  two collinear walls ending at one junction (A2.0 EW1 71.4 vs 73.5, was 63.6).
  A2.3 (roof) is still off. The roof deck hatch lines are about 17 pt (0.6 m) apart, inside
  wall-thickness range, so the EW6B tag's run carries on along a hatch-line pair across the deck
  (about 8.7 m). The EW6A over-count comes from the parapet line pair along the north edge, which
  carries the run past the tagged stretch. A ladder test (a pair with a third and fourth parallel
  line at the same spacing is hatching) would drop the EW6B stretch, but EW6B is then short of
  the workbook, so check which roof edges the estimator counts before changing it. EW7A/EW7B on A2.2 (5 and 6 m in the workbook) have no tags
  on the sheet.
  Earlier notes: Centreline lengths by
  wall type from vector linework and type tags. Against the estimator's ACC
  takeoff (workbook rows per sheet): A2.1 total difference 11%; EW3A 42.76 vs
  42.76 m, FR1 96.9 vs 98.3, W1 66.9 vs 68.7, CB3 18.7 vs 19.0, W3 1.98 vs 2.05,
  EW1 41.2 vs 39.7; A2.2 W1 17.5 vs 19.1, W3 10.1 vs 9.9, W5 10.7 vs 10.7, W6B 7.8
  vs 7.6, EW5A 41.7 vs 43.3. Walls drawn "below/above" in light pens are measured
  from the line the tag's leader lands on, up to the walls meeting it (A2.2:
  FR1 11.7 vs 11.3, EW3A 9.2 vs 12.0, EW1A 8.2 vs 10.8). The estimator does not
  measure partitions through doors; the option to cut partitions at doors gets W2
  right (A2.1 26.0 vs 25.8, A2.2 78.8 vs 80.9) but takes W1 and CB2 well under the
  workbook, so measuring through stays the default. Known gaps: where
  a tag's type stops on untagged walls is a guess (nearest tag along the walls),
  which over-counts W2 on both sheets and FR2 on A2.2; the workbook lists EW3B
  (11.9 m) and EW1B on A2.1 where the drawing tags less. How it works: rays from
  every wall line find the parallel line a wall-thickness away (bands),
  collinear pieces merge across short breaks, ends join at corners (centreline
  intersection) and tees (to the other wall's centreline), walls split at
  junctions; tag symbols are the closed loop around the text (per pen, so
  furniture under a tag does not confuse it) and leaders run from a symbol
  corner; types carry by kind (partition, exterior, furring, foundation).
- **Room finishes:** `Measurement.finishes` maps floor/base/walls/ceiling to
  takeoff types; `contributions()` in `src/quantities.ts` adds each room to its
  finish types (area for floor and ceiling, perimeter for base and walls) and
  everything (quantities, Excel division rows, Measurements sheet) reads from
  it. `src/finishSchedule.ts` reads a room finish schedule from sheet text (no
  sample in this drawing set; tested on a synthetic table).
- **Hatch match (ceilings, finish plans):** `src/fill/marks.ts` groups segments
  into shapes (subpaths) with a class (pen, dot / line at an angle / shape
  size; filled lettering is excluded); `src/fill/similar.ts` picks the class
  many times denser inside the sample than on the sheet (lines weigh by
  length; a perpendicular line class of the same pen joins it as a grid),
  labels every space the walls enclose on one sheet-wide raster, takes spaces
  the pattern covers (≥50% of cells, ≥35% of the sample's density) to their
  walls with `fillRoom`, and outlines partly hatched spaces (dot patterns only).
  The RCPs here (A6.1/A6.2, PDF pages 34–35) have no text layer (text is drawn
  as outlines), so their sheet names read "Page 34/35" and tags can't be read.
  GWB ceiling (stipple, pen 0.54 dots): A6.1 79.6 vs 81.7 m² workbook, A6.2
  112.9 vs 127.2. ACT grid (0.30 lines) finds the matching rooms (a false
  hit over the entry stair went once the density bound rose to 0.45 of the sample's). RCP walls are 1.44 (exterior) and 0.84 (interior),
  so wall pen detection now keeps every paired pen ≥55% of the heaviest and
  relaxes the paired share to 40% when no pen reaches 50% (the 1.44 pen also
  draws the sheet border).
- **Automate › Count symbols (no boxing):** `src/fill/autoSymbols.ts` + `src/fill/symbolLook.ts`.
  Legends are found by heading text ("Legend", "RCP Legend", "Symbols"…), framed or not; each
  row drawn with a symbol (not a tag with a placeholder like 07/w#/A301, not a "see sheet…"
  reference, not a hatch swatch of a surface) is matched by eye, not line by line, because
  legends are drawn apart from the plan's blocks (84 Frederick: surface light 0.6x, heat
  detector 0.78x, exterior sconces 1.56x, heavier pens): candidates are shapes like the
  symbol's body, compared on a small raster at 8 turns (white mask fills ignored, filled parts
  compared on their own, every part must be there both ways, short same-pen lines running out
  of the footprint count as extra parts). Overlaps go to the bigger drawing (sconce over pot
  light). A legend's symbols are counted on sheets carrying a legend of that name, and on
  legend-less sheets at the same scale. A click with the Symbols tool picks the symbol under it
  (`symbolBoxAt`), counted at block size on every sheet at that scale.
- **Count symbols:** `src/fill/symbols.ts`. Takes the lines inside the dragged
  box as the sample, picks its rarest long line (by length and pen) as the
  anchor, and at every sheet line matching the anchor (4 quarter turns, both
  ends) checks that ≥85% of the sample's lines are there too (endpoint
  tolerance 1% of the box, min 0.35 pt). A6.1 CAN light: 32 found, 0.3 s.
- **More from the night shift:**
  - **Trace** (`src/fill/trace.ts`): follows same-pen strokes end to end (dash
    gaps ≤ 4 pt) and goes on at forks only straight ahead.
  - **Door tags** (`findDoorTags` in `src/fill/rooms.ts`): a 3–4 digit number in
    a closed non-rectangular symbol; letter-prefixed tags get their own type.
  - **Bare room numbers**: when a sheet has no boxed numbers, a number with a
    name block directly above counts.
  - **Scale check** (`src/scaleCheck.ts`): pairs dimension figures with the line
    they sit on, votes, and snaps to a standard scale (±2%); a confirmed
    detected scale becomes `scaleSource: 'verified'`.
  - **On all sheets** (symbols and hatches): other sheets are read uncached
    (`segmentsOnce`), skipped when their scale (set, or read from their
    dimensions) differs, and for hatches when they carry little of the
    pattern.
  - **Point editing** in `Viewer.tsx` (drag handles, edge midpoints insert,
    Option-click removes); the drag keeps its points in a ref, since React's
    StrictMode runs state updaters twice.
  - **Starting types** (`starter-types` key), **backups** (a zip of .takeoff
    files), **sheet image** (`src/sheetImage.ts`), **Quick start**,
    **duplicate type**, Quantities per sheet.
  - Segment and wall-model caches keep the four most recent sheets.
  - **Revisions** (`offerRevision` in App): new sheets matching an existing
    sheet's name and page size take over its takeoffs; the old one is renamed
    "(superseded)". `compareSheets.ts` renders both at ~3000 px and colours
    ink only on the old (red), only on the new (blue), on both (grey).
  - **Door tags on all sheets**: only tags inside the sheet's room-number range
    (±20) count, and other sheets need ≥4 of them, which leaves out level
    markers (4000, 8570) on sections and elevations.
  - **Stops at doors** per wall type (`stopAtDoors` option, saved as
    `TakeoffType.stopsAtDoors`).
  - Tried and dropped (made verified results worse): glass-partition pairs as
    room boundaries (A2.1 Staff Room 56.72 → 56.65 m², A2.2 unchanged); a
    grid-direction mix test for hatch matching (lost a real ACT area, kept the
    false one). Also: retrying unclosed rooms with the next-lighter
    partition pen (0.51 on A2.2) as walls. It closed 202, 203 and 204
    correctly, but it merged 219 with 220 and cut 218 WR. Corr. down to a
    door-swing triangle. Adding 0.37 as well splits 219/220 but carves the
    Community Hall up around its furniture. Those rooms are left for drawing
    by hand.
- **Added in the second overnight session:**
  - **Marked-up PDF** (`src/markupPdf.ts`, Export → Marked-up PDF): pdf-lib
    copies each sheet with takeoffs from the original drawing (one
    `copyPages` per document, so shared resources copy once) and draws the
    takeoffs in PDF user space through the inverse of pdf.js's scale-1
    viewport transform (handles /Rotate and CropBox offsets), with a legend
    per sheet and summary pages first. Owner-password (encrypted) sets fall
    back to a JPEG of the page. pdf-lib loads only on export.
  - **Typical floors:** `Sheet.repeat` multiplies a sheet's shares in
    `contributions()` (only there). Excel division rows show "A2.2 ×3", the
    Measurements sheet keeps each takeoff as drawn with a Sheet counts column.
  - **Text search:** the sheet search also searches every sheet's text layer
    (cached per page) and outlines hits (`highlights`, `focus.box` in Viewer).
  - **Type library** (`src/typeLibrary.ts`, + → From the library…): trade
    assemblies with formulas in both unit systems; a test evaluates them all.
  - **Read a legend** (`src/fill/legend.ts`): label column = the left edge
    most text shares; wrapped lines (closer than 1.8× text height) join a row;
    each row's graphic is the linework left of the labels in its band.
    Framed swatch → area, long thin → linear, else symbol (exact
    `matchSymbol` on the sheet, else its tag text, e.g. FH). On the Kelso
    site plan (A1.1) the rows read correctly but plan symbols are different
    blocks from the legend's, so counts there are by tag only (1 hydrant).
  - **Sample set** (`src/samplePlan.ts`, welcome → Try a sample plan): A1.01
    floor plan (rooms, door tags, W1/EW1 tags, dimensions, finish schedule)
    and A2.01 ceiling plan (ACT grid, GWB stipple, 22 downlights, legend), in
    metric 1:100 or imperial 1/8" = 1'-0". `test/samplePlan.test.ts` runs the
    readers on it with exact expected quantities: the first regression test
    that needs no client drawings.
  - **Imperial scale notes** (1/8" = 1'-0", 1" = 20') are detected from title
    blocks; the scale check reads mm and feet-inch dimensions whatever the
    project units; imperial starter types are named in inches.
  - Scanned sheets (no text, almost no linework) get a notice that the
    automatic tools need CAD-exported PDFs.
  - **Export styles** (each a `samplePlanPdf` option with a test): walls as
    solid poché with no outline (filled shapes score as pen `fill`, used only
    when no stroked pen pairs), walls exploded into short pieces (pens scored
    again on joined collinear runs, only when none is found otherwise; joining
    always would make RCP hatch rows look like walls), drawings without
    lineweights (the room tag box is in the wall pen: the fill retries from
    outside the box; door swings then come off rooms, a few percent), sheets
    saved turned (scale check uses the text's angle), text written a
    character at a time (pdf.js joins it already).
  - **Floor finishes from a legend:** the sample's A1.02 finish plan (tile grid,
    carpet stipple, concrete hatch) is taken off in one step by Read a legend
    (swatches sampled with looser minimums, since a swatch at plan scale may
    hold only two grid lines each way; areas named by the room tag inside).
    That found a bug: stipple dots in the wall pen were wall lines; lines
    under 0.3 pt no longer are (Kelso rooms and walls unchanged).
  - **Hatch matches** need ≥ 0.45 of the sample's density (was 0.35): A6.1's
    entry stair under an ACT sample was 0.36, real matches 0.56–1.07. Find on
    all sheets now lists results per sheet to untick before adding (Kelso
    millwork pages 44/45 pick up the GWB stipple; they have no scale to compare).
  - Tried and dropped: rejecting gap bridges that cut through a wall (meant for
    tag boxes lined up across rooms on one-pen drawings) changed A2.1 rooms
    105 and 221 and needed tuning to keep the wall score; not worth it.
  - **Doorways:** bridges carry `bridge: true` (and `window: true` when glazing
    covers half the gap); `openingLength()` in `roomFill.ts` measures the outline
    beside door bridges (parallel, between their ends), `Measurement.openings`
    stores it (sheet points, cleared by hand edits), `O` in formulas. Base room
    finishes use P less it; wall finishes take off only the door opening
    (`doorHeight()` in `model.ts`: 2.1 m / 7 ft); ceiling perimeter items keep
    full P (they run over door heads). Hatch-found rooms (`SimilarArea.openings`)
    and "Try wider openings" keep it too. Sample: lobby 5.4 m, rooms 0.9 m (±0.1).
  - **Count a text tag** from the search (exact matches, every current sheet),
    **duplicate project** (drawings copied under new ids), an upload note
    (scales read, sheets without text), quiet scale verification when a sheet
    opens, build version in Quick start (`__BUILD__` from `vite.config.ts`).
  - **First-time-sub pass** (a walkthrough audit at 1280 and 1440 px):
    - A toast's Undo shows only while its change is the latest in the history
      (`Toast.after` against `historyRev`, which commits, undo, redo and opening
      a project advance; the quiet scale verification does not). Before, Undo
      after ⌘Z undid an older change.
    - Tools are never greyed out for want of a type: `chooseTool()` takes the
      first type of the kind the tool needs and says so.
    - Select, Measure, Fill and Symbols keep their labels down to 1260 px; Trace
      and Cutout go icon-only first.
    - Bid workbook scoring is behind **More › Show bid workbook scoring**
      (`src/scoring.ts`, per browser).
    - Esc closes Rooms, Wall takeoff and Room finishes (`useEscape` in
      `Dialogs.tsx`). Room finishes ignores a stray click or Esc while edits are
      unsaved, and offers **Find rooms on this sheet** when there are none.
    - Other fixes: the Automate menu says when reading assemblies needs an API key,
      Door tags has its own icon, "?" opens the shortcuts, the More menu is wider,
      the selected line's label sits above its handle, and the Projects panel
      marks the open project "Current".
    - Wall finish types show their total as area (`TakeoffType.headline`, set by
      `finishType('walls')`, a checkbox in the type editor for any length type).
      Only `typeTotals().primary/unit` change; the Excel export reads items.
    - Not done: the sample's starter types (W1/FR1, Floor finish, Ceiling) sit
      unused beside the types read from the sample.
- **Box select** (`src/boxSelect.ts`, Viewer `band.select`): B or Shift-drag in
  Select; left-to-right drags take what is wholly inside, right-to-left what the
  box touches (lines tested segment by segment, areas also when the box sits
  inside them). App keeps `multiIds` per sheet; a bar offers Delete and Clear.
- **Desktop app** (`electron/`): `main.cjs` serves `dist` under `app://takeoff/`
  (a standard, secure scheme, so IndexedDB persists) and exposes only the
  projects folder through `preload.cjs`; `folder.cjs` does the disk work (paths
  checked to stay inside the folder, atomic writes). `src/folderSync.ts` syncs
  this computer's database with the folder: sync marks hold the folder copy's
  savedAt and this computer's clock at sync time, so the two computers' clocks
  are never compared; a conflict keeps both. `saveProject` skips saves that
  change nothing (the autosave after opening), which would otherwise bounce a
  project between computers. Tested with two Electron profiles sharing a folder
  (Playwright `_electron` under xvfb): carry over, edit back, live reload while
  both are open (within one 45 s poll). Mac and Windows installers come from
  `.github/workflows/desktop.yml` (Releases).
  - The folder is required: a setup screen at first launch (or when the saved
    folder is missing) offers iCloud Drive › Takeoff AI (`folder:default`) or a
    pick. New project asks for a name and pushes at once; the blank starting
    project is never written until it has drawings, takeoffs or a name (and
    adding drawings to it asks for the name). A rename renames the folder
    (`folder:rename`, in `pushNow`). The window's close waits for
    `FolderSync.flush()` through `app:flush`/`app:flushed` (8 s cap), and ⌘Q
    still quits. `.versions/` keeps the previous project.json every 10 minutes,
    50 kept. Workflow e2e: setup, new project folder, Kelso drawings on disk,
    rename, edit 0.6 s before quit lands, relaunch.
- **Sheet numbers from the title block** (`src/sheetNumbers.ts`,
  `SheetNumbersDialog.tsx`): Number sheets (Sheets header, More, the toast after
  adding drawings) marks a box; it is kept as fractions of the sheet and read on
  every sheet (`linesIn` groups text into lines, sideways title blocks too;
  `readNumber` takes the biggest text shaped like a sheet number, captions such
  as "SHEET NO." stripped). An optional title box fills `Sheet.title`. Kelso: 41
  of 51 read from one box; the rest have no text layer (34–35, 44–51), which
  needs OCR.
- **Types:** new projects start with no types (`newProject`); only the sample
  gets `defaultTypes`. Height is optional (blank = 0). Wall tags: any type code
  (`TYPE_TAG`, e.g. VS1) counts when its symbol's leader lands on a wall;
  codes outside `WALL_TAG` are never reported unmatched (Kelso 10.7% → 9.9%,
  storefront tags S200A… now take their own length off W2). Materials have a
  "Calculated" picker (per length, per wall area, per area, per perimeter,
  each, custom); new ones follow the type's kind and height.
- **Interface (redesigned):** light, Mac-style (system font, segmented tools,
  source-list sidebar, inspector with Quantities / Takeoffs / History). State
  changes go through `commit()` in `App.tsx`, which keeps undo/redo stacks and
  diffs each change into the activity log (`src/activity.ts`, saved under the
  `activity` key in IndexedDB, exported as the Activity sheet). Typing in one
  field within 4 s counts as one change.
- **Verified since:** assembly reading ran for real on A0.3 (23/23 types, 80/80
  layers; see Next). Sheet naming has only been tested with the AI call
  intercepted.

## Web app and AI service

`npm run build:web` (mode `web`, `.env.web`: `VITE_AI_SERVICE=1`) builds the version
for subs. Its AI goes to `/api/ai` on the same site, a Cloudflare Pages Function
(`functions/api/ai.ts` → `worker/aiProxy.ts`) that checks the access code
(`ACCESS_CODES` secret), counts requests per code and in total per UTC day in KV
(`USAGE`), and forwards to any OpenAI-compatible model (`AI_BASE_URL`, `AI_MODEL`,
`AI_API_KEY` secret). Route order in `aiRoute()`: artifact account, then service
(when built for web and a code is saved), then API key. The client (`src/ai/service.ts`)
sends 2×2 tiles at 1600 px for legends and the two title-block strips for sheet names,
and takes the first JSON object from the answer. The service worker skips `/api/`.
Tested end to end with `wrangler pages dev` and a fake provider (Playwright: wrong
code refused, status shown, legend read through the proxy). Setup: `docs/web-deploy.md`.
Not done: picking the model (score candidates on Kelso A0.2/A0.3), and a per-code
monthly cap if daily caps aren't enough.

## Hosted version

`npm run build:artifact` builds `dist/artifact.html` plus `dist/assets/*`
(listed in `dist/artifact-files.json`) for publishing as a claude.ai artifact
with capabilities `{sample: {images: true}, downloads: true}`. The build script
escapes raw control characters and U+FFFD in bundled libraries because the
publisher refuses them. Hosted pages cannot use `alert/confirm/prompt` (see
`src/components/Dialogs.tsx`) or start downloads themselves (Excel goes through
the `downloads` capability).

## Test data (not in the repo; client documents)

- Architectural set for Kelso Glen Eden – West Beginner Lodge (51 sheets, Arch D,
  metric). Plans A2.x at 1:100, verified against dimension strings. Legends:
  A0.2 (EW1–EW7B exterior walls, R1–R3B roofs) and A0.3 (W1–W7D, FR1–FR3, F1–F3).
- The estimator's real bid takeoff for the same project (consolidated by
  division, grouped by subtrade package). Its quantities come from the
  estimator's own Autodesk Construction Cloud takeoff, so it is the answer key
  for checking AI takeoff results and the model for the Excel export layout.

## Next

1. Run the AI legend reading on A0.2/A0.3 for real and tune it. The scorer
   (`src/eval/`, **Score against bid workbook…** in the review screen, shown once
   **More › Show bid workbook scoring** is on; `src/scoring.ts`) grades it
   against the estimator's "Schedules A0.2 A0.3" tab: 25 entries on A0.2 and 23 on
   A0.3. A perfect answer scores 100% and deliberately damaged ones lose exactly
   the expected points (checked on the real workbook).
   - **First real run, A0.3 (hosted, the user's Claude account):** 23/23 types,
     80/80 layers exact, 15/15 framing spacings, 19/19 overall thicknesses, 23/23
     categories. The estimator also checked it against the drawing. Two fixes came
     out of it: the scorer accepts a layer split at "W/" (W7B/W7C framing with
     insulation), and "2 LAYERS" of board now doubles the board quantity (W1B).
   - **Real runs, A0.2:** 23 types, which the estimator confirmed is complete: EW1C
     and R1 option 2 were removed by the latest addendum (their text stays in the
     PDF, so the tag check lists them; the AI correctly left them out). The
     workbook still lists them because it predates that addendum. First run notes: 15/15 framing spacings; every
     overall thickness the AI gave matches the dimension printed on the drawing.
     The workbook differs from the drawing on wood siding (Addendum 7: 17.5mm
     siding replaced the 10mm veneer on EW3B/EW4B/EW5B/EW6A/EW6C) and on five
     "Overall" notes (EW3A, EW3C, EW4A, EW4B, EW6A), where the drawing agrees with
     the AI. Fix: the request now lists the tags found in the sheet text as a
     checklist and asks for one entry per option; the review screen handles
     repeated tags. Re-run A0.2 to confirm.
   - Addenda are not read: the AI reads the drawing as issued. Supporting
     addendum documents is a future feature.
2. ~~Match the Excel export to the estimator's bid workbook layout~~ (done;
   formulas verified by recalculating an export in LibreOffice).
3. ~~Compare Fill room areas with the estimator's Autodesk Takeoff areas~~
   (done: they match).
4. Wall takeoff: walls drawn in light pens ("below"), and a better rule for
   where a type stops on untagged walls (room-by-room for furring and finishes).
   Then finish schedules into room types.
5. REA: analyse Autodesk Takeoff from a HAR capture recorded by the user (the
   cloud environment cannot reach autodesk.com, and Takeoff needs a login), and
   point REA at this app to test what it can recover.
