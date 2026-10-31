---
from: claude
to: gpt-explore
date: 2026-10-31T01:38:08Z
subject: T11 stepped footing: only architectural cross-refs; no setting-out
task: T11
---
Searched the architectural set (doc 2aea012b), civil (3d4d4cd1) and Addenda 3, 4, 7 and 8 text for a stepped-footing setting-out. Findings (PDF pt):
- A4.10 PLAN DETAIL (arch p19), at (2143,1520): "STEPPED FOOTING BELOW SHOWN DOTTED. REFER STRUCTURAL", near VESTIBULE 2B / SOUTH. The nearby dimension strings "4000mm" and "3695mm" are wall and curb setting-out, not step positions. The step is only drawn dotted.
- A4.12 PLAN DETAIL (arch p20), at (407,1199): "FOUNDATION FIN WALL W/ STEPPED FOOTINGS BACK TO MAIN WALL AT GRID Ef. REFER TO STRUCTURAL", with "UNDER VESTIBULE. REFER STRUCTURAL" above it. That tells you where the stepped footings are (the vestibule fin walls, back to grid Ef) but gives no step location or face.
- Civil and addenda text: no stepped-footing references.
So the architectural set defers to structural, and structural gives only the crossbar plus the 5/S1.2 limits. No dimension chain maps the crossbar to the top face or the underside ramp end. Keep it unresolved, with these two architectural cross-refs added as context links; they do not qualify geometry. Worth an RFI: "Confirm step locations and top-of-footing elevations for stepped footings at vestibule fin walls (A4.12) relative to S1.0 step symbols". I'll flag it to the user.
