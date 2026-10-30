# Framing span representation

The T7 linear structure takeoff supplies a beam's plan endpoints and length.
For a beam whose plan can be registered, Build It now keeps that span as a
diagrammatic axis. The scene draws a narrow, selectable marker along the
measured line. Its marker radius and display elevation are not member dimensions.

An axis is distinct from a wall run. It cannot enter the building footprint,
become a full-storey wall, or become an IFC solid. IFC exports it as `IfcBeam`
with the measured length and source properties but no physical Body
representation. A verified framing elevation and section are still required
before a solid can be generated. The element's review issue and Dimensions
panel state this limitation.

The saved Kelso demo audit places 45 S2.0 beam spans as axes. Another 56 S2.1
beam spans have no sheet scale, so they remain unplaced and no geometry is
invented. Their source records remain, but unscaled lengths add no linear
production time until they are calibrated. The refreshed
schedule is unchanged: Kelso 2027-07-07, Frederick 2025-08-07.

`MODEL_VERSION` is 15 so saved models built with the old wall-shaped beam
geometry are rebuilt. The targeted extraction/scene/IFC test and the read-only
Kelso/Frederick audit check this behavior.
