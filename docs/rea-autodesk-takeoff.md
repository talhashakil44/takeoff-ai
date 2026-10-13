# Autodesk Takeoff: how it works

Research notes for building the same features into this app. They describe how
Autodesk Takeoff (Autodesk Construction Cloud / Forma, "Preconstruction")
behaves and how its data is structured, as seen from a signed-in session on our
own project. They do not reproduce Autodesk code, and they leave out the paths
and payloads of Autodesk's internal (undocumented) web API. Where a structure is
also in Autodesk's **public** Takeoff API documentation, that is noted, since
the public docs are the safe reference.

Nothing here contains HAR files, cookies, tokens or drawings. Project-specific
names and quantities are left out apart from the sheet numbers already listed in
`docs/handoff.md`.

## Baseline: browser tools

**Method.** Claude in Chrome, on the Kelso Glen Eden project in Takeoff, on
2026-10-12. I watched the app's requests with an in-page recorder that kept only
the response *shape* (field names and types, not values or credentials), read
the viewer's own state from the page, and used the UI the way an estimator
would. I opened two packages, sheets A2.1 and A0.2, the inventory, the "Create
takeoff type" form (cancelled without saving), Settings, and ran Symbol
Detection once (cancelled without saving). Nothing in the project was changed:
the only non-read requests were sheet lookups, a viewer session request and the
detection call.

**Time.** About 50 minutes of wall-clock time, including cloning the repo and
finding the project.

Each finding below is marked **Observed** (seen directly in the UI, the page
state or the request/response shapes) or **Inferred** (my reading of what was
observed).

### 1. Sheets: processing and display

**Observed**

- Uploaded PDFs go through Autodesk's Model Derivative service (the
  `pdf-bubble-generator` extractor). The resulting manifest has one 2D viewable
  per PDF page, and each page carries several derived resources:
  - `graphics` – vector graphics in Autodesk's F2D format;
  - `leaflet` and `leaflet-zip` – a PNG tile pyramid at 5400 × 3600 px for a
    36 × 24 in (Arch D) sheet, i.e. **150 dpi**, with paper units and size;
  - `raster-page` – a single PNG of the page;
  - `pdf-page` – the page split out as its own one-page PDF;
  - `pdf-strings` – the page's extracted text;
  - `titleBlockJson` – title-block data (sheet number and title);
  - `pug` – an Autodesk-internal format at the same 5400 × 3600 resolution;
  - a thumbnail at several sizes.
- The page carries `pdfPaperSize` (inches) and a total raster pixel count.
- Sheets are versioned: each sheet has a stable "lineage" (the sheet number,
  e.g. `A2.1`) with versions under it, each tied to an issue set ("Tender Set",
  "Addenda 5"), an upload file name, a discipline order and its viewable. The
  sheet list shows the current version and its set, and a dropdown switches
  versions.
- Takeoff shows sheets in the standard **APS Viewer** (v7.127), with the
  `Autodesk.PDF`, `Autodesk.Edit2D`, `Autodesk.Snapping`,
  `Autodesk.StringExtractor`, `Autodesk.AEC.ViewportsExtension`,
  `Autodesk.CompGeom`, `Autodesk.LayerManager` and `Autodesk.Measure`
  extensions loaded. These are public, documented viewer extensions.
- When a sheet opens, the viewer fetches that page's **one-page PDF** and
  renders it as vectors (`isPdf: true`, `isLeaflet: false`). The model's units
  are **inches of paper**. A grey low-resolution preview shows first, then the
  vectors fill in.
- A sheet's viewer data includes the PDF's viewports (several on A2.1), each
  with its own transform and units.

**Inferred**

- Raster tiles exist but are not what the takeoff viewer draws. They feed
  symbol detection (see §6) and probably thumbnails and the
  compare/"PixelCompare" tool.
- Snapping to linework works because the page is rendered as vectors.
- Text is extracted once on the server (`pdf-strings`, `titleBlockJson`).
  That's how sheet numbers and titles get filled in without the user typing
  them.

**For this app:** we already render with pdf.js and read the text layer in the
browser, which is the same vector-first approach. Two things are worth copying:
one PDF per sheet, so opening a sheet doesn't load the whole set; and keeping a
150 dpi raster of each sheet for image-based features such as symbol
detection.

### 2. Scale and calibration

**Observed**

- Scale is set **per sheet**. On A2.1 the toolbar shows `1 : 100`; on A0.2 (a
  legend sheet) it shows **"Scale not set"**, with a red "Scale not set" banner
  above the drawing.
- The scale menu offers metric ratios (1:1, 1:2, 1:5, 1:10, 1:20, 1:25, 1:50,
  1:100, 1:200, 1:500, 1:1000, 1:2000, 1:5000) and "Custom". Next to it is a
  separate **Calibrate** tool (a ruler icon) and a plain **Measure** tool.
- Measurements are stored in **paper coordinates**, not real-world units. A
  saved linear item's geometry is an SVG path string in paper inches, e.g.
  `M x,y V y2`. In one sample the path is 1.3084 in long, and
  1.3084 in × 25.4 mm/in × 100 = 3.3233 m, which is exactly the stored quantity
  (3.32327 m). So quantity = paper length × sheet scale, and the scale is kept
  apart from the geometry.
- Opening a sheet requested no scale or calibration data. Takeoff types, takeoff
  items and project preferences (`unitSystem: "METRIC"`) load when the package
  opens. Scale must come from data loaded at app start.

**Inferred**

- Scale is probably stored per sheet version with the project's "content space"
  (the set of documents takeoff runs against), which loads when the app opens.
  The items also carry a calculation version, which suggests quantities are
  recomputed when the scale changes.
- I could not tell whether `1 : 100` on A2.1 was detected from the sheet's
  "1 : 100" notation or set by the estimator.

**For this app:** our `Sheet.metersPerPoint` plus storing geometry in PDF
points is the same design. Keep it: a scale correction then fixes every
quantity on the sheet without touching the geometry. The red "Scale not set"
banner is worth copying, because measuring an unscaled sheet is a common
mistake.

### 3. Data model: packages, takeoff types, items, inventory

**Observed** (field names match Autodesk's public Takeoff API docs)

- **Project settings:** a measurement system (Imperial/Metric, fixed per
  project), up to two **classification systems** (a project-wide code list,
  e.g. MasterFormat), currency, and an **output definitions** library. Output
  definitions are reusable line-item templates (name, unit, cost,
  classification 1/2) that can be created in the UI or imported from a
  spreadsheet.
- **Package** (e.g. "Exterior Wall Partitions"): a named bucket of takeoff work.
  Packages hold takeoff types; the URL selects one with a scope id.
- **Snapshots:** the package list has a "Work in progress" state and saved
  snapshots (limit 50, e.g. "Export snapshot 9/2/2026"). They are frozen copies
  of the whole takeoff.
- **Takeoff type** – one per assembly. Fields:
  - `name`, `description`, `color`, `borderColor`, `lineWidth` +
    `lineWidthUnit`;
  - `tool`: in the public docs `AREA`, `DISTANCE`, `COUNT` and `SELECT`
    (shown in the UI as Area, Linear, Count and a 3D/BIM selection tool);
  - `primaryQuantityDefinition`: `classificationCodeOne`, `expression`
    (the formula), `unitOfMeasure`, optional embodied-carbon definition,
    `syncedToEstimation`, and a link to an output-definition template;
  - `secondaryQuantityDefinitions[]`: more line items, each with its own
    output name, expression, unit and classification codes;
  - `propertyDefinitions[]`: user-entered parameters for the type;
  - a version number (`takeoffTypeVersion`) that the items reference.
- **Takeoff item** – one per measurement:
  - `type`/`tool` (`DISTANCE`, …), the `takeoffTypeId` and the type version it
    was computed with, `packageId`;
  - `geometry` (an SVG path in paper inches), the sheet version (lineage and
    content version) it lies on, and a content hash;
  - `propertyValues[]`: e.g. `{name: "Distance", source: "MEASUREMENT", unitOfMeasure: "M", value}`;
  - `primaryQuantity` `{classificationCodeOne, quantity, unitOfMeasure}` and
    `secondaryQuantities[]`. The computed quantities are **stored on the item**.
- The types panel groups types by classification code and name (e.g.
  "03 00 00 - Concrete") and shows each type's running total.
- **Inventory** (table under the drawing): rows are types with their line items
  under them, showing instance count, quantity, unit and classification
  description. Group by **Classification 1**, **Document** (sheet),
  **Takeoff type** or **Location**. Clicking a line item lists its instances
  (name, quantity, unit, measured Distance, sheet). It has its own **Export**
  button.

**Inferred**

- Storing a type version and the computed quantities on each item means a
  formula change can be applied as a recalculation, and snapshots stay stable.
- "Location" grouping implies items can be tagged with a location breakdown
  (level, zone). We did not see where locations are defined.

**For this app:** our `TakeoffType` → `AssemblyItem[]` maps onto
primary + secondary quantity definitions. Two things are missing:
classification codes on each line item (we keep one `division` per type), and
a per-item record of the type version and computed quantity.

### 4. Assemblies and quantity formulas

**Observed**

- In the "Create takeoff type" form, a type has a **Primary line item**
  (required) and **Additional line items**. Each line item has a name (picked
  from the output-definitions library or typed), unit of measure, cost,
  Classification 1, **Quantity Formula** and embodied carbon (beta).
- The formula field autocompletes three kinds of names:
  - *Measured value*: `Distance` for linear types; `Area`, `Perimeter` and
    `InnerPerimeter` for area types (inner perimeter is the cutout edges).
  - *User provided value*: `Length`, `Width`, `Height`, `Depth`, `Thickness`.
    These are parameters the estimator fills in on the type.
  - *Takeoff type property*: `WeightByLength`, `WeightByArea`, `WeightByVolume`.
  - *Math function*: the **math.js** function set (`add`, `divide`, `ceil`,
    `round`, `mod`, `gcd`, `mean`, `median`, `std`, `compare`, `larger`,
    `isInteger`, `dotMultiply`, trig functions …).
- The default formula is the tool's measured value (`Distance` with unit M for a
  new linear type). Count types used `1` with unit EA.
- Autodesk's public docs give formula examples such as
  `Distance*Width*Height*1.1` (unit CY) and a secondary `Distance*Width`.
- Linear types have a line width setting (default 152 mm) that is purely
  visual.
- In the two packages inspected (38 types, 211 items) every type had only a
  primary line item with formula `Distance` or `1`. The estimator does not use
  assemblies in Takeoff; the build-up happens later in the bid workbook.

**Inferred**

- Formulas are evaluated per item. The measured value is that item's own
  measurement and the user-provided values come from the type. The results are
  then summed per line item.

**For this app:** our `formula.ts` (L, H, A, P, N with ceil, floor, round, min,
max, abs) covers the same ground with shorter names. To be able to import
Takeoff types we would need: Takeoff's long variable names (`Distance`, `Area`,
`Perimeter`, `InnerPerimeter`, `Width`, `Height`, `Depth`, `Thickness`) as
aliases; per-type user parameters beyond height; and an outer-minus-cutouts
perimeter.

### 5. Export

**Observed**

- Three export entry points: **Export all** and **Export takeoff packages**
  (selected packages) on the package list, and **Export** in the inventory.
- Settings → Output definitions has its own **Import / Export** to a
  spreadsheet.

**Not determined.** I did not run an export, because doing so downloads a file
from your account and I hadn't asked to. The column layout of Autodesk's Excel
file is still unconfirmed (see "Could not determine").

### 6. Automatic and AI features

**Observed**

- **Symbol Detection** is in the Count tool's menu. The user drags a box
  around one symbol and clicks Apply. Detection runs on Autodesk's servers as
  one round trip of about **5 seconds** for one sheet. Each match comes back as
  a box on the sheet with a confidence score, and nothing scoring below about
  0.6 was returned, which suggests a fixed cut-off.
- On A2.1, boxing one "W1" wall tag returned **11 matches**: the template
  itself (confidence 1.00) and ten others between 0.61 and 0.73. The other
  matches were diamond tags with *different* text (W1, W2, W3, FR1, CB3). It
  matches by **shape, not by label**.
- The returned box edges fall exactly on multiples of 1/5400 and 1/3600: they
  are pixel positions on the sheet's 5400 × 3600 raster.
- The results panel shows a thumbnail per match with a checkbox ("11 symbols
  selected", "Deselect all") and **Save**/**Cancel**. Matches only become count
  items when you save, and you pick which ones.
- There is an "Autodesk Assistant" button in the header. The app appears to
  check at start-up whether AI features are enabled for the user.
- No auto-measure, area-detection or AI line-item tools showed up in the
  toolbar or menus. Area offers polygon area; **Combine/Cutout** is a geometry
  operation.

**Inferred**

- Symbol Detection is server-side **template matching** (correlation-style
  scoring) on the sheet's pre-rendered 150 dpi raster, run on one sheet at a
  time. A self-match scoring 1.0 and near-misses around 0.6–0.7 fit plain
  template matching better than a learned detector.
- Because it ignores the text inside a tag, it over-counts when one tag shape
  is used for many types. The estimator has to untick the wrong matches.

**For this app:** this is easy to beat. We already have the PDF text layer, so
tags can be matched by **shape plus label**: find text runs equal to "W1", then
check the surrounding vector shape. That gives exact counts with no
false-positive cleanup, and works across every sheet in one pass.

### Could not determine

- Where per-sheet scale/calibration is stored and whether `1 : 100` was
  auto-detected. Its data loads before the recorder could be attached; it would
  need a capture from the moment the app opens (the HAR route).
- The calibrate tool's exact flow (two points plus a known length is the usual
  pattern). Running it would have changed the sheet's scale.
- Autodesk's Excel export layout (needs a download; see §5).
- How secondary line items and user-provided values look on real data. None of
  the inspected types use them.
- Location breakdown setup, model-based (3D/BIM `SELECT`) takeoff, and what
  the "Autodesk Assistant" can do inside Takeoff.
- Whether Symbol Detection can run across several sheets at once.

## REA

_Not run yet._ REA needs Node.js, which isn't installed on this machine yet.
This section will be added after `npx rea-agents setup` has been reviewed and
run.
