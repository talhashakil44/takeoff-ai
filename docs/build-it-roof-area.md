# T28: derived roof-plan quantity

Kelso A2.3 has no saved roof-covering takeoff. Its repeated outer grid bubbles give Ax–Ex = 580.8 sheet points and 9x–1x = 1,364.2 sheet points at 0.0352778 m/point. The rectangular **plan-area estimate is 984.3 m²**. The prior 702.1 m² suggestion came from the slab-on-grade footprint; it was a proxy and had not entered the plan.

Build It now records the A2.3 grid estimate as `model.roofPlan`, with an inferred basis and sheet reference. When the project has no measured roof area or saved envelope allowance, it adds `work:envelope:roof-covering` after roof structure and roof-level envelope work. The activity has no measured element IDs and uses the editable envelope production rate. At Kelso's current 74 m² per crew-day and one crew, it takes **14 working days**. The dry-in gate waits for this covering. A warning asks the user to confirm roof edges, roof types and slope.

The R2A/R2B mechanical-roof well lies within the outer grid rectangle. Its perimeter is not established by the available text and registered grid, so the 984.3 m² remains a combined roof plan area. Build It does not invent a separate R2 quantity or a slope-adjusted surface area. A measured roof takeoff or saved envelope allowance takes precedence over the derived activity.

On the 2,105-measurement refreshed Kelso demo, the audit finish changes from **2027-08-05 to 2027-08-25** with the new covering and dry-in sequence. Frederick remains **2025-08-07** and has no derived roof activity. The original project JSON and PDFs are untouched.
