# Electrical rough-in from measured tags (T23)

Circuit/device tags in the takeoff remain finish-device elements. Build It now
uses each new `etags` count in Division 26 or 28 as one electrical rough-in
point when that level has no direct electrical rough-in takeoff. It creates
`work:elec-rough:<level>` activities and links them to the counted tag IDs.
This is a schedule proxy only: it adds no cable, conduit, boxes, or 3D/IFC
geometry to the building model. The extraction retains the measurement source
on each element, and model version 20 rebuilds cached models for that field.

The existing default is **30 points per crew-day**, one crew, plus the
electrical rough-in trade's assumed 15 working-day procurement lead. The
`ea` rate and crew count remain editable in Build Setup; the duration is
rounded up from points / rate / crews. This rate is an assumption, not a
published or project-specific production commitment. The activity reason and
a schedule warning state that device-to-rough-in equivalence, containment,
circuits, and crew output need trade review. If a level already has a direct
electrical rough-in takeoff, the tag proxy is omitted there. A saved
`elec-rough` scope allowance takes precedence over tag proxies so an older
accepted floor-area allowance is not stacked with them. New GFA rough-in
suggestions are suppressed when measured tags exist.

On the current read-only refreshed demos:

| Project | Electrical tag points | Tag-based rough-in activities | Earliest finish |
| --- | ---: | --- | --- |
| Kelso (2,098 measurements) | 641 | L1 256 points / 9 d; L2 334 / 12 d; Roof 4 / 1 d; unplaced 47 / 2 d | 2027-08-05 |
| 84 Frederick (2,806 measurements) | 0 | None; existing GFA suggestion still available | 2025-08-07 |

The 47 Kelso unplaced points are 2 tags from E0-01 Site Plan and 45 from
E3-04 Enlarged Plans. They remain explicitly unplaced; no building level is
invented. The added rough-in does not move Kelso's current finish, which is
driven by other work. Both demo finish dates are from the refreshed-demo audit
with the saved setup and no new accepted allowances. Original project JSON
and PDFs were not edited.
