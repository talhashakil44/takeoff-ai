# Build It integration follow-up

Based on `claude/integration` at `5023d30`. This branch changes Build It only; it does not edit the saved takeoff projects, merge, or deploy.

## Routing and placement

- Measurements from `structure` and `foundations` enter the structure work package. Structural member names, including Div 06 glulam beams, also enter structure.
- Site measurements (including Div 32/33) have no building level and no inferred 3D route. A stated run length remains usable without sheet calibration. Their site activity starts after mobilization; the generic site procurement lead is now zero unless a specification requires a submittal.
- The Kelso structural PDF page 7 (S2.0) says **MAIN FLOOR FRAMING PLAN** and page 8 (S2.1) says **HIGH ROOF FRAMING PLAN**. The existing title-block hint resolver maps those to Level 1 and Roof. S2.1 has no calibrated scale in the saved demo, so counted members can be scheduled on Roof but receive no invented physical geometry.

## Production review

- Foundation concrete uses the takeoff assembly's `Concrete + 5%` volume as its production quantity when the formula evaluates to a positive value. The original count, line length, or area remains the measured quantity for estimates and IFC.
- The default structure rates remain **10 counted members per crew-day**, with an added **8 m³ per crew-day** for metric foundation concrete (**10 CY** imperial). These are provisional planning allowances, not rates established by the drawings. A schedule warning calls for confirmation of member complexity, forming, reinforcement, concrete placement and crew size. If the assembly cannot yield volume, Build It retains the primary quantity and marks the element for review.
- The road takeoff is a labelled chainage length; its assembly calculates road area (`L × W`). Build It uses that area for road production and keeps the length as the measured takeoff. The metric site defaults of 46 m/day and 139 m²/day yield 38 crew-days for the 900 m pipe plus 415 m road at 6 m width example, after mobilization. This is a regression scenario, not a new source quantity.

## Verification

- 414 tests and production build pass.
- The read-only saved-project audit passes for Kelso and Frederick; IFC4 validation reports 319 and 2,658 shapes with zero schema or geometry errors.
- The saved Kelso demo currently has 390 measurements and does not contain Claude's new `foundations`, `structure`, or `site` measurements. The new routing and production paths are covered by regression tests; the reported 2027-08-04 combined-project finish has not been recalculated from a saved combined takeoff here.
