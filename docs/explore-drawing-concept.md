# Explore Drawing — product direction

Status: proposed, not implemented. Captured October 29, 2026 following the owner's request to keep interactive/walkable PDFs in the product direction. Geometry accuracy remains the active Build It priority.

## References and observed evidence

- [First video](https://www.youtube.com/watch?v=UTCPqJZFg04): Samnang Aing's flat-to-3D demonstrations. Reviewed the description, linked repository and live exploded-house demo, including its dining-room camera stop. Full video playback/transcript review was not completed; the transcript panel remained loading.
- [Demo source](https://github.com/Sam1983Aing/flat-to-3d) and [live examples](https://sam1983aing.github.io/flat-to-3d/): code-authored Three.js scenes, with flat-to-perspective transitions, sections and staged assembly. The creator explains that five demos start as an existing 3D scene viewed through a long lens. This demonstrates an interaction technique, not general-purpose PDF reconstruction. This repository declares MIT licensing; no code was copied.
- [Second video](https://www.youtube.com/watch?v=H9o7SJCrdYI): reviewed its description and chapter list, which discuss rendering commoditization, workflow engineering and digital twins. Its economic claims were not independently verified, and its transcript did not load. Treat these as the creator's argument rather than established market findings.

## Proposed product shape

Add a separate **Explore Drawing** mode within the product, sharing Build It's geometry and source references. Do not create a separate geometry database or diverging quantity calculation.

1. Open the actual PDF sheet at calibrated scale. Preserve its drawing identity and revision.
2. Select a room or an identified object to highlight its measurement, specification and model counterpart.
3. Use an explicit **Lift into 3D** control to transition from the registered drawing plane to the derived building. Also allow a reduced-motion instant switch; ordinary PDF scrolling must remain ordinary scrolling.
4. Enter a room via an explicit walkthrough control with a location mini-map and a clear return-to-sheet action. Movement must respect reviewed floors, walls, openings and head heights.
5. Select an object inside the model to return to its exact drawing location, quantity, specification and schedule activity.
6. Let drawing callouts navigate among plans, elevations, sections and details. Tables and schedules become searchable linked records; they do not need artificial 3D representations.

This is a proposal for making the whole document interactive: spatial navigation where appropriate, linked evidence everywhere else.

## First bounded prototype

Use one calibrated floor and one reviewed room. Demonstrate PDF-to-model alignment, a smooth or instant camera transition, room entry, object selection and an exact return to the source. Establish drawing/model agreement before adding furniture or presentation effects. Keep original files unchanged.

Acceptance requires stable measurement IDs and quantities, explicit inferred/unknown geometry, no movement through walls or outside reviewed floors, keyboard-accessible controls, a reliable escape action, and usable performance on the target hardware. A decorative approximation cannot pass as an accurate reconstruction.

## Commercial hypothesis

The proposed value is faster project understanding and fewer missed scope items through linked drawings, quantities, specifications and construction sequence. Validate that with real estimator and contractor workflows. Visual appeal alone does not establish willingness to pay, retention or a revenue forecast.

## Delivery approach

Use reviewed Git checkpoints on the feature branch, with validation evidence and clear remaining limitations. Keep production release and main-branch merge separate from saving development progress. Do not include source drawings, project datasets or generated diagnostic exports in code checkpoints.
