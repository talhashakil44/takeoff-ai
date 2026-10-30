# Takeoff AI

An AI-native construction takeoff tool for general contractors. It runs in your
browser on your own computer: drawings and takeoffs are stored locally and
nothing is uploaded anywhere.

## Status

**Build It development checkpoint (2026-10-29):** the
`codex/build-it-rework` branch adds a building-model workspace, drawing-derived
geometry, construction planning and shared IFC export geometry. It remains an
inferred model requiring architectural review, not coordinated BIM.

- Start here: [Build It / Claude handoff](docs/build-it-handoff.md).
- Implemented work and limitations: [quality report](docs/build-it-quality-pass.md).
- Future direction, not implemented: [Explore Drawing](docs/explore-drawing-concept.md),
  linking the original PDF to an interactive walkthrough using the same model.


**Interface:** a light, Mac-style window: segmented tools, a scale picker with
metric and imperial scales on every sheet, a Takeoffs list for quick deletes,
undo/redo, and an activity log of every change.

**Phase 1 — manual takeoff (done)**

- Upload PDF drawing sets; every page becomes a sheet.
- Sheet numbers (A2.1, A0.3, …) are read from the title block automatically.
- Drawing scales (1:100, 1:50, …) are detected from the sheet text and applied
  when a sheet has exactly one; detected scales are flagged "verify".
- Set scales from metric or imperial presets, or calibrate from a known dimension.
- Area (with cutouts), linear and count measurements, coloured by takeoff type.
- **Box select** (B, or Shift-drag in Select): drag left to right to pick the takeoffs
  wholly inside, right to left for everything the box touches; Delete removes them
  all at once (one undo). Click a takeoff to add or drop it from the selection.
- Doorways: a room filled by Fill, Rooms or its hatch remembers how much of
  its outline crosses door openings (`O` in formulas; windows, with glazing
  along them, don't count, since the wall carries on below). Base set on rooms
  stops at doorways (`P - O`); wall finishes lose only the door opening
  (`P * H - O * 2.1`, 7 ft in imperial), since the wall carries on above the
  door. Ceiling wall angle, track and trim keep the full perimeter `P`.
- Assemblies: each takeoff type has material lines driven by formulas, e.g.
  studs = `ceil(L / 0.61) + N`, drywall = `2 * A * 1.1`.
- Live quantities panel and Excel export in the estimator's bid workbook layout:
  a Bid Summary (cost per division, editable markup, totals) linked to one tab
  per division with the columns Mark … Notes, blue GROUP rows per subtrade
  package, imperial pricing formulas, yellow input cells for rates, Height and
  Incl?, and a subtotal that skips GROUP rows; plus assembly materials and every
  measurement, and a Room Finishes sheet (each named room with its area,
  perimeter and floor, base, walls and ceiling types). Each takeoff type has an
  estimate division and subtrade package.
- Metric (m, m²) or imperial (ft, SF) projects.

**Phase 2 — AI setup (in progress)**

- **Read assembly types (done):** on a wall/floor/roof type legend sheet, click
  **✦ Read assembly types**. Claude reads every type (W1, EW3C, F1, R1, …) and
  its layers; you review them and add the ones you want as takeoff types with
  assembly items built from the layers (studs and track from framing spacing,
  board and membranes with 10% waste, slab and fill volumes, and so on). Tags
  printed on the sheet that the AI did not return are flagged, so nothing is
  silently missed. A type whose tag already exists is updated in place and keeps
  its measurements.
- **Score the AI (done):** with **More › Show bid workbook scoring** turned on
  (off by default, so subs don't see it), after reading a legend **Score against
  bid workbook…** compares the result with an estimator's transcription (any
  workbook with a `Type | Design / assembly name | Construction | Notes` table,
  sections headed with their sheet number). It reports types found, layers read
  exactly (sizes and spacings must match), framing spacings, overall thickness
  and category, and lists every difference. **Download AI result** saves the raw
  answer as JSON for deeper analysis.
- **Fill room (done):** pick an area type, click **Fill room**, click inside a
  room. The outline follows the inside face of the walls; furniture, text and
  door swings are ignored, and door openings are closed off along the wall face,
  so the opening is not part of the area. It works from the PDF's vector
  linework (no image model): the wall pen is found from parallel line pairs and
  line weight, wall gaps up to **Close openings up to** (3 m by default) are
  closed, and wider gaps close only where window glazing is drawn along them.
  Shift+click a neighbouring space to join it into the last fill, through the
  opening between them. Needs a vector PDF (not a scan).
- **Wall takeoff (done):** on a plan with a scale, **✦ Wall takeoff** measures
  every tagged wall on the centreline, by type. Walls are found from the PDF's
  vector linework (pairs of wall lines a wall-thickness apart, carried through
  doors); each type tag's leader is followed to the wall it points at; walls
  are split at junctions, and a type carries on along its wall, round corners
  and into untagged walls of the same thickness that run into it (nearest tag
  wins). Review lengths per type, choose which takeoff type each goes to (new
  types are built from the AI-read assembly legend when there is one), then add
  them as linear measurements. A tag whose leader lands on a wall drawn in
  light lines (shown above or below, curtain walls) measures the line it points
  at, up to the walls that meet it, flagged "check". Partitions can be measured
  through door openings or not (exterior walls always run through openings), and
  each partition type can be set to stop at doors on its own (**Stops at doors**
  in the results; types the legend calls finishes-only start checked): with W2
  stopped at doors, as the estimator measures it, the four-sheet difference is
  8.2% (W2 26.0 vs 25.8 m on A2.1, 78.8 vs 80.9 m on A2.2). **Score against bid
  workbook…** compares lengths per type with the workbook's rows for that sheet.
- **Room finishes (done):** **Automate › Room finishes** lists every room
  takeoff with a floor, base, walls and ceiling type each. The room's area
  counts toward its floor and ceiling types, its perimeter toward base and
  walls (walls × the wall type's height), in the quantities and the Excel
  export. Set finishes room by room or for several rooms at once, make a new
  finish type from its code (CPT-1, RB-1, ACT-1), or **Read finish schedule**
  to fill them from a room finish schedule on the drawings (a table with a
  room number column and floor, base, walls or ceiling columns). Base and wall
  lengths are the room's perimeter with door openings included (the outline
  closes across doors); allow for doors in the base type's formula.
- **Find areas hatched like this (done):** select an area on a reflected
  ceiling plan or a finish plan and click **Find areas hatched like this**.
  The sample's hatch (stipple dots, a ceiling tile grid, hatch lines) is found
  from the PDF's linework, every space the walls enclose is checked, and each
  one carrying that hatch is added as the same type: whole rooms to their
  walls, part-hatched rooms (bulkheads, bands) as the hatched part. On the
  sample set's A6.1, one GWB-ceiling room finds 79.6 m² of GWB ceiling against
  81.7 m² in the bid workbook (A6.2: 112.9 against 127.2 m²). **Find on all
  sheets** (on the result) looks for the same hatch on every other sheet:
  A6.1's sample adds 35 areas on A6.2 in about 25 s; check the sheets it lists,
  since a detail drawn with the same stipple can match too.
- **Count symbols (done):** pick a count type, choose **Symbols** (S) and
  drag a box around one symbol (a light fixture, a toilet, a receptacle). Every
  copy on the sheet drawn with the same lines and pens, turned or mirrored, is
  counted. On A6.1 one box around a CAN light counts all 32 in about 0.3 s.
  Copies already counted as that type are skipped, so it can be run again.
  **Count on all sheets** (on the result) looks for the same symbol on every
  other sheet drawn at that scale: A6.1's CAN light finds 34 more on A6.2, about
  18 s for the 51-sheet set.
- **Sheet names without text (done):** some sheets have their text drawn as
  outlines (no text layer), so they come in as "Page 34". **More › Name sheets
  with AI…** reads each one's title block (the right and bottom strips) and
  names it with its sheet number. Double-click a sheet to rename it by hand.
- **Scale check (done):** the scale picker reads the sheet's dimension strings
  (5300, 12'-6") against the dimension lines they sit on and reports the scale
  most of them agree on: "Matches 12 dimensions on the sheet" (A2.1), or a
  warning with a one-click fix when they read differently. A scale read from
  the title block that the dimensions confirm loses its amber Check mark.
  Elevations and sections with few dimensions say so rather than guess.

**Phase 3 — AI takeoff:** walls by type from the plan tags and PDF vector lines,
rooms with finishes, all as suggestions you accept or correct.

## Use it on the web (for subs)

The web app runs on Cloudflare Pages with its own AI service at `/api/ai`: subs
open a URL, enter an access code in **AI settings**, and never need an API key.
The server holds the model key (any OpenAI-compatible model, OpenRouter by
default) and caps each code's requests per day. Setup and deploy:
`docs/web-deploy.md`; deploy with `npm run deploy:web`.

## Use it hosted on claude.ai

A hosted copy runs on claude.ai as a private artifact. AI features there use your
own Claude account, so no API key is needed. To update it, run
`npm run build:artifact` and republish `dist/artifact.html` with the files listed
in `dist/artifact-files.json` (see `docs/handoff.md`).

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

### AI features

AI features use your own Anthropic API key (get one at console.anthropic.com).
Click **AI settings** in the top bar and paste it there. It is stored only in that
browser. When you use an AI feature, the sheet you chose (as images and its text)
is sent to Anthropic's API; nothing else leaves your computer. Reading one legend
sheet takes one to three minutes.

## Saving, projects and installing

- **Projects:** click the arrow beside the project name. Every project is saved
  automatically in the browser's database on this computer (IndexedDB), with
  its drawings and its history; the app asks the browser to keep this data
  permanently. Open, create (metric or imperial) and delete projects there.
- **Project files:** **Save to file…** writes one `.takeoff` file holding the
  project, its history and its drawings, for backups or another computer;
  **Open file…** opens one as a new project.
- **Install as an app:** when served from a normal web host (see below), Chrome
  and Edge offer to install it (More › Install as an app…) and Safari adds it
  with File › Add to Dock. It then opens in its own window, works offline, opens
  `.takeoff` files and PDFs from Finder (Chrome), and updates itself: when a new
  version is published it shows **Restart** to switch.

Back up everything: **Projects › Back up all projects…** saves every project,
with its history and drawings, in one zip. Open it with **Open file…** to
restore them all (on this computer or another one).

Your own takeoff types: set up the types you use (assemblies, divisions,
packages, heights), then **More › Use these types for new projects**. New
projects in the same units start with them instead of the built-in set;
**Reset types for new projects** goes back to the built-in set.

### Desktop app (Mac and Windows)

The same app, packaged with Electron (`electron/`, `electron-builder.yml`).
`.github/workflows/desktop.yml` builds it on every change to `main` and attaches
the files to a GitHub Release (Releases, on the repository page):

- **Mac:** `Takeoff-AI-Mac-arm64.dmg` (Apple silicon) or `Takeoff-AI-Mac-x64.dmg`
  (Intel). Drag it to Applications. It is ad-hoc signed (no Apple developer
  account), so the first launch needs System Settings › Privacy & Security ›
  **Open Anyway**.
- **Windows:** `Takeoff-AI-Windows-Setup.exe`. SmartScreen may warn: More info ›
  Run anyway.

**Projects folder:** at first launch the app asks where projects live (iCloud
Drive › Takeoff AI by default; any synced folder works: OneDrive, Dropbox,
Google Drive). Every project is a folder there:

    Takeoff AI/
      Kelso Lodge (7d01cf89)/
        project.json      the takeoffs, types, sheets and history
        meta.json         name and last save, for listing
        drawings/*.pdf    the drawings as added
        .versions/*.json  earlier project.json, every 10 minutes, the last 50
        Exports/          Excel workbooks, marked-up PDFs and sheet images saved from it

**New project** asks for the job name and makes its folder at once; adding
drawings to the blank starting project asks for a name first. Renaming a
project renames its folder. Closing or quitting waits until the last change is
written. **More › Show this project's folder** opens it in Finder or Explorer.
The app also keeps its own database as a working copy. Saves go out a moment after each change; the
other computer brings them in at launch, every 45 s and whenever its window
comes to the front, and reloads the open project when it changed only there. A
project edited on both computers before they synced keeps both: the other
computer's version comes in as "… (from the other computer)". Deleting a
project moves its folder to the Trash. Logic and tests: `src/folderSync.ts`,
`test/folderSync.test.ts`.

Locally: `npm run desktop` runs it; `npm run desktop:mac` / `desktop:win` build
the installers (Mac builds need a Mac).

### Connect AI (MCP): let Claude, Codex or a local model drive it

The desktop app runs an MCP server on the computer's loopback address
(`electron/mcpServer.cjs`, `electron/mcp.cjs`), so an AI app on your own
subscription can work in Takeoff AI: open or create projects, add drawing PDFs
by path, list sheets, read sheet text with positions, look at sheet images
(with the takeoffs drawn on), set scales, create types, add and delete
takeoffs, run the automatic takeoffs (rooms, walls, doors, windows, ceilings,
sprinklers, legend symbols), read quantities and export to Excel. The tools are
in `src/mcp/tools.ts`; each change goes through the same undoable commit as a
click, so it shows in the window, lands in the activity log and is saved to the
project's folder. Takeoffs an AI adds by hand are labelled **AI** so you can
find and check them.

**More › Connect AI** shows it running, adds it to Claude Desktop in one click
(then quit and reopen Claude Desktop), and gives copy-paste setup for Claude
Code, Codex (`~/.codex/config.toml`) and other apps. Apps that start servers as
a command run the app's own binary on `mcp-stdio.cjs` (shipped in the app's
Resources), which forwards to the running app and opens it if it is closed.
Requests need a key (Connect AI › New key makes another) and are refused from
browsers and other computers. Tests: `test/mcpServer.test.ts`,
`test/mcpTools.test.ts`.

### Publishing it for your team

`.github/workflows/app.yml` checks every change and, on `main`, publishes the
built app to GitHub Pages. Turn it on once under Settings › Pages › Source:
GitHub Actions (Pages on private repositories needs a paid GitHub plan).
Any static host works too: run `npm run build` and upload the `dist` folder
(Netlify, Cloudflare Pages, S3). Each person's projects stay in their own
browser; share work as Excel exports or `.takeoff` files.

## Using it

The window works like a Mac document: sheets and takeoff types on the left, the
drawing in the middle, and an inspector (Quantities, Takeoffs, History) on the
right. Tools sit in the title bar.

1. **Add drawings** (title bar). Every PDF page becomes a sheet, named from its
   title block, with its scale read from the sheet where it can be.
2. Pick a sheet. The **scale pill** in the title bar shows its scale; an amber
   **Check** means it was read from the sheet. Click it to pick any metric or
   imperial scale (whatever the project's units), type another one (`1:150`,
   `3/32" = 1'-0"`), or **Calibrate from a dimension**: click both ends of a
   known dimension and type its length (`3.5`, `3500mm`, `12'6"`).
3. Click a **takeoff type** on the left, then **Measure** (M):
   - Area and length: click points; double-click or Return finishes. Shift keeps
     lines straight, Backspace removes the last point, Esc cancels.
   - Count: click each item.
4. **Fill** (R): pick an area type and click inside a room. If it leaks into
   the next space, lower **Close openings up to**; if it says the space isn't
   closed, raise it or draw by hand.
5. **Automate** (title bar):
   - **Read assembly types** on a legend sheet (Claude reads every type).
   - **Wall takeoff** on a plan: measures every tagged wall by type; check the
     lengths and where each type goes, then **Add**.
   - **Rooms** on a plan: finds every room tag (a number in a box, or a bare number when the sheet has no boxed tags, with the name above),
     fills each room to the inside face of its walls, and adds the ones you pick
     as named areas ("112 RECEIVING & GEN. STORAGE") on the area type you
     choose. Room numbers repeated on a second plan count once; tags in one open
     space share it. A room that doesn't close offers **try wider openings**
     (closing gaps up to 8 m for that room only, flagged to check): on A2.2 that
     recovers 3 of the 9 open rooms.
   - **Door tags** on a plan: counts every door tag (a door number in an oval,
     circle or hexagon) as a door named by its number; tags with a letter
     prefix (S114A screens) are counted under their own type. A2.1: 15 doors and
     1 screen; A2.2: 18 doors and 8 screens. Run again, it skips doors already
     counted. **Count on all sheets** adds the other plans (a door number counts
     once in the project; on other sheets only tags in that sheet's room-number
     range count, so level markers on sections and elevations are left out).
   - **Room finishes**: floor, base, walls and ceiling for every room, picked
     per room, set for a selection, or read from a finish schedule.
   Running wall or room takeoff again on a sheet replaces its earlier results.
   Rooms go under a **Rooms** type; their finishes carry the floor and ceiling
   areas, so nothing is counted twice.
6. **Find areas hatched like this**: select a hatched area (a GWB ceiling, an
   ACT grid, a tile floor) and click it on the selection card to add every
   other area on the sheet drawn with the same hatch.
7. **Symbols** (S): pick a count type and drag a box around one symbol to
   count every copy on the sheet. **Trace** (T): pick a length type and click a
   drawn line (a curb, roof edge, duct run, fence) to measure its whole run in
   that pen, round corners and across dash gaps.
8. **Cutout** (C): select an area, then draw the hole.
9. Hover a type on the left to edit (pencil) or delete (bin) it.
10. **More › Save sheet as image…** saves the sheet as a PNG with its takeoffs
    drawn on and a legend of each type's total on that sheet, to send a sub or
    a reviewer what was taken off.
11. **Export** saves the takeoff to Excel, including the activity log, or as a
    **marked-up PDF**: a summary page of each type's total, then every sheet with
    takeoffs, the original drawing kept in vector with the takeoffs drawn over it
    and a legend of that sheet's totals along the top. Attach it to a quote.
12. **Typical floors:** More → *Count this sheet ×N…* makes a sheet's
    takeoffs count ×N (one plan drawn for several floors). The sheet list shows
    ×N, and the quantities, Excel and PDF legend include it.
13. **Search sheets and text:** the sheet search also finds text drawn on the
    sheets (room names, tags, notes). Matching sheets show how many hits; open
    one to see them outlined, and click it again for the next hit.
    When the search is a tag drawn as text (WC-1, EX-1, RWL), *Count the N tags
    as a takeoff* makes a count type with one count at each exact match on
    every sheet.
14. **Type library:** + beside Takeoff types → *From the library…* adds
    ready-made types by trade (partitions, furring, bulkheads, 2×4 and 2×2
    acoustic ceilings, GWB ceilings, carpet tile, LVT, porcelain, sealed
    concrete, base, paint, doors, windows, lights, receptacles, slabs,
    footings), each with its materials worked out in the project's units
    (`src/typeLibrary.ts`). The same menu copies the types of any other project on
    this computer.
15. **Read a legend:** Automate → *Read a legend*, then box a symbols legend.
    Each line becomes a takeoff type (count, area or length, from its graphic:
    symbol, framed swatch or line type), and symbols are counted where the same
    symbol, or its tag (FH, HP), is drawn on the sheet (`src/fill/legend.ts`).
    On a scaled sheet, a swatch whose hatch is dense enough to sample (a stipple)
    also finds the areas hatched like it. Symbols can be counted on every other
    sheet too.
17. **Duplicate a project** (Projects → Duplicate this project) for a bid
    alternate: the copy gets its own copy of the drawings, so deleting either
    project never breaks the other.
    Site plans often draw plan symbols differently from the legend; those rows
    say so and are counted with Symbols.
16. **Sample plan:** the welcome screen's *Try a sample plan* draws a small 1:100
    floor plan (in imperial projects, the same plan at 1/8" = 1'-0" with
    feet-and-inch dimensions) and its reflected ceiling plan (an ACT grid, a GWB
    stipple, 22 downlights and a ceiling legend), its floor finish plan (tile
    grid, carpet stipple, sealed concrete hatch and a finish legend), with a
    room finish schedule on the floor plan (`src/samplePlan.ts`: five tagged rooms, door tags, W1/EW1 wall
    tags, dimension strings, title block) so anyone can try every tool without a
    drawing set. `test/samplePlan.test.ts` runs the sheet name, scale check,
    rooms, door tags, wall takeoff and finish schedule on both versions, and the legend, symbol
    count and hatch matching on the ceiling plan, and checks the exact
    quantities. Imperial scale notes in title blocks (1/8" = 1'-0", 1" = 20')
    are detected like metric ratios.

Editing: select a takeoff to show its points. Drag a corner to move it, drag
the dot in the middle of an edge to add a point there, Option-click a corner
to remove it (a count's single point drags to move it). Each drag is one undo.

Revisions: add the new drawings (an addendum or re-issue) as usual. When new
sheets have the numbers of sheets you've taken off, and the same page size, the
app offers to move those takeoffs onto the new revision; the old sheets stay,
renamed "(superseded)", and a scale you set by hand carries over. **More ›
Compare with previous revision** overlays the two: linework only on the old
sheet in red, only on the new one in blue, on both in grey.

Typical floors: **More › Copy takeoffs to another sheet…** copies every
takeoff on the sheet to another sheet of the same page size, in the same place,
as new takeoffs (the target sheet's scale applies). Undo removes the copy.

Deleting: select a takeoff and press Delete, use **Delete takeoff** on the
selection card, or open **Takeoffs** in the inspector to delete one row, a whole
type or everything on the sheet. Every delete shows an **Undo** button;
⌘Z / ⇧⌘Z undo and redo (200 steps).

History: every takeoff, type, scale and drawing change is recorded with its time,
sheet and quantity, saved in the browser's database beside the project, shown in
the **History** tab and exported as the **Activity** sheet.

Takeoff types: the eye beside each type shows or hides its takeoffs on the drawing (they still count in quantities and exports); Option-click shows only that type. Groups (the folder button) file types into folders you name: move a type with its folder button or drag it onto a group; a group's eye hides all of it.

Navigation: a mouse wheel zooms; a Magic Mouse or trackpad swipe pans (⌘ + swipe or pinch zooms); drag, middle-drag or Space-drag pans in any tool (a click still places a point); while drawing, the sheet scrolls when the cursor nears its edge; F fits the sheet.
**More → Keyboard shortcuts** lists them all.

### Assembly formula variables

| Variable | Meaning |
| --- | --- |
| `L` | total length of the type's linear measurements |
| `H` | the type's height |
| `A` | area: measured area for area types, `L × H` for linear types |
| `P` | perimeter of area measurements, including cutouts |
| `N` | number of measurements (runs, rooms or counted items) |
| `I` | inner perimeter: the edges of cutouts (already in `P`) |
| `W`, `D`, `T` | the type's width, depth and thickness, set in the type editor |

Autodesk Takeoff's names work too, so its formulas can be pasted in: `Distance`
(= `L`), `Area`, `Perimeter`, `InnerPerimeter`, `Height`, `Width`, `Depth`,
`Thickness`, `Count`. A strip footing is `L * W * D`, or
`Distance * Width * Depth`.

Functions: `ceil`, `floor`, `round`, `min`, `max`, `abs`.

## Development

```bash
npm test          # unit tests
npm run typecheck
npm run build
```

Code layout: `src/units.ts` (scales, units), `src/geometry.ts`,
`src/formula.ts` (safe formula evaluator), `src/quantities.ts` (rollups),
`src/sheetInfo.ts` (sheet number and scale detection), `src/exportExcel.ts`,
`src/ai/` (Claude request and extraction schema), `src/assemblyBuilder.ts`
(layers to assembly formulas),
`src/fill/` (room fill: vector linework, wall detection, opening bridges,
raster flood fill and outline tracing), `src/walls/` (wall takeoff: wall bands,
tag leaders, junctions and type carrying), `src/eval/wallKey.ts` (wall lengths
from a bid workbook),
`src/components/Viewer.tsx` (PDF rendering and measuring tools).

PDF rendering uses the pdf.js *legacy* build because current pdf.js relies on
JavaScript features (`Math.sumPrecise`, `Map.prototype.getOrInsertComputed`)
that shipping browsers do not yet support.
