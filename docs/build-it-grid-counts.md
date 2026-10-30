# Grid-located structural counts (T25)

Build It now reads the two registered structural grid families for each
calibrated plan sheet. A measured pad footing, mass footing, pier, base plate,
or column count gets a **symbolic 3D locator** at the closest intersection of
registered letter and number axes if the original tag is within 2.5 m. The
original measurement point stays in the sheet source box and project JSON;
the model element records grid labels and tag-to-grid distance. Model version
21 refreshes cached geometry.

These small scene spheres show location only. No physical footing, pier,
plate or column section or height is inferred from a count tag. IFC4 stores
the product at the grid coordinate, its tag point as a property, and no
invented solid. Counts, production quantities and schedule durations are
unchanged. Counted braces and lintels remain without physical placement.

On the refreshed 2,098-measurement Kelso demo, 141 of 204 eligible counts
receive locators: **97 on S1.0 and 44 on S2.0**, including 32 S2.0 columns.
Four S1.0 BP6 tags are farther than 2.5 m from a registered crossing.
S2.1's 59 columns have no sheet scale or grid registration; their level and
quantity remain in the model, but Build It does not place them from paper
coordinates. A model warning lists these 63 unplaced counts. Calibrating and
registering S2.1 is required before locating them reliably.

The refreshed-demo audit keeps Kelso's earliest finish at 2027-08-05 and
Frederick's at 2025-08-07. IFC4 validation on the audit exports found 1,309
Kelso and 2,661 Frederick shapes, with zero schema and geometry errors.
Original project JSON and PDFs were not modified.
