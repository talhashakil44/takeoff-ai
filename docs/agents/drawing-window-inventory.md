# Drawing-coordinate window migration inventory

Snapshot: model47 working source, 2026-10-31. This is a triage inventory, not a
list of constants to replace blindly. The search includes crop padding, physical
limits and some non-coordinate values; multiline expressions may be missed.
No third-project generalisation pass is claimed. Hold-out evaluation is pending.

| Priority | Area | General replacement rule | Failure mode to test |
|---|---|---|---|
| 1 | Roof/column section title, scale, grid and datum association | Segment actual view regions; use glyph boxes and printed scale for local searches | Adjacent view contributes a plausible but wrong datum |
| 1 | Foundation schedule columns and row values | Infer table columns and row spacing from headings and glyph boxes | Enlarged/reduced table binds a neighbour row |
| 1 | Foundation datum label-number/leader association | Text-box neighbourhood plus connected leader identity | Nearby note attaches to the wrong footing |
| 2 | Foundation section/detail references and mass-datum chains | Local view bounds, callout sizes and source line topology | Typical detail promoted to a specific local datum |
| 2 | Beam maximum/cantilever notes and girt/reference route | Shared glyph-relative mark parser plus explicit cut identity | Unrelated CANT note qualifies another span |
| Separate | Source crop boxes | Derive padding from glyph/profile extent | Poor review crop; not itself physical geometry evidence |
| Preserve | Metre tolerances / schedule sizes / numerical quantisation | Keep physical-unit checks distinct; assess PDF quantisation separately | Relaxing physical-size checks while changing layout windows |

Remaining fixed windows in roofSectionEndEvidence and columnGeometry include
scale/title, grid-to-section and datum-leader searches. Removing the header150pt
band did not generalise those entire functions. roofRegistration still recognises
roof-plan titles and printed scales using a bounded grammar; that is separate
from the now title-independent cantilever fallback.

The same local CANT parser now gates registration, bearing recovery and physical
cantilever qualification. Combined mark+CANT strings must also match the per-bay
beam mark, which is tested synthetically. Prior fixed30pt physical qualifier was
removed in this checkpoint.

## Search candidates (file:line at this checkpoint)

```text
src/build/structural.ts:70:          t.cy - heading.cy < 35 &&
src/build/structural.ts:71:          Math.abs(t.cx - heading.cx) < 150,
src/build/structural.ts:87:          t.cy < header.cy + 100,
src/build/structural.ts:95:            t.cx < (right?.cx ?? header.cx + 150),
src/build/structural.ts:113:                  t.cx < right.cx + 75,
src/build/structural.ts:132:                ? right.cx + 75
src/build/structural.ts:133:                : (right?.cx ?? size.cx + 70),
src/build/structural.ts:392:                tag.cy - t.cy < 500 &&
src/build/structural.ts:413:                  (t.cx - group.at(-1)!.cx > 300 ||
src/build/structural.ts:426:                tag.cx < row[0].cx - 30 ||
src/build/structural.ts:427:                tag.cx > row.at(-1)!.cx + 30 ||
src/build/structural.ts:519:    Math.abs(p.bottom) > 100 ||
src/build/openingDetails.ts:62:      const sameRow = tags.filter((t) => Math.abs(t.cy - tag.cy) < 20),
src/build/openingDetails.ts:63:        prevRow = tags.filter((t) => t.cy < tag.cy - 30);
src/build/openingDetails.ts:64:      const left = sameRow.filter((t) => t.cx < tag.cx - 20).sort((a, b) => b.cx - a.cx)[0];
src/build/openingDetails.ts:65:      const right = sameRow.filter((t) => t.cx > tag.cx + 20).sort((a, b) => a.cx - b.cx)[0];
src/build/openingDetails.ts:66:      const y0 = Math.max(0, ...prevRow.map((t) => t.cy + 20));
src/build/openingDetails.ts:68:        x0: left ? (left.cx + tag.cx) / 2 - 20 : tag.cx - 180,
src/build/openingDetails.ts:69:        x1: right ? (right.cx + tag.cx) / 2 + 20 : tag.cx + 180,
src/build/openingDetails.ts:104:        .filter((t) => /^\d{1,5}$/.test(t.str) && Math.abs(t.cy - datum.cy) < 5 && Math.abs(t.cx - datum.cx) < 140)
src/build/openingDetails.ts:108:      const datumLines = ls.filter((l) => Math.abs(l.y1 - l.y2) < 0.2 && Math.abs(l.y1 - datum.cy) < 8 && Math.abs(l.x2 - l.x1) > 80);
src/build/openingDetails.ts:119:            frame.y0 - t.cy < 60 &&
src/build/openingDetails.ts:120:            Math.abs(t.cx - (frame.x0 + frame.x1) / 2) < 40 &&
src/build/openingDetails.ts:128:            (Math.abs(t.cx - frame.x0) < 75 || Math.abs(t.cx - frame.x1) < 75) &&
src/build/openingDetails.ts:136:        .filter((t) => t.cx < frame.x0 && frame.x0 - t.cx < 75 && t.cy > frame.y1 && t.cy < tag.cy && Math.abs(t.value - sill) < 0.3)
src/build/openingDetails.ts:154:          box: [frame.x0 - 30, frame.y0 - 30, frame.x1 + 30, tag.cy + 20],
src/build/flatRoofSectionEvidence.ts:42:      r.bounds[1] - t.cy < 150,
src/build/flatRoofSectionEvidence.ts:56:        Math.abs(t.cx - ref.cx) < 20 &&
src/build/flatRoofSectionEvidence.ts:79:        t.cy - title.cy < 25 &&
src/build/flatRoofSectionEvidence.ts:80:        Math.abs(t.cx - title.cx) < 110,
src/build/flatRoofSectionEvidence.ts:89:          t.cx > title.cx - 50 &&
src/build/flatRoofSectionEvidence.ts:90:          t.cx < title.cx + 850 &&
src/build/flatRoofSectionEvidence.ts:91:          t.cy < title.cy - 100 &&
src/build/flatRoofSectionEvidence.ts:92:          title.cy - t.cy < 650,
src/build/flatRoofSectionEvidence.ts:101:        d.box[0] < title.cx + 850 &&
src/build/flatRoofSectionEvidence.ts:133:          box: [grid.cx - 20, top.y1 - 10, grid.cx + 25, bottom.y1 + 10],
src/build/building.ts:337:        .filter((v) => /^-?\d{1,6}(?:\.\d+)?$/.test(v.str) && Math.abs(v.cy - t.cy) < 4 && v.cx < t.cx && t.cx - v.cx < 130)
src/build/building.ts:342:      if (Math.abs(n) < 100) values[level] = [...(values[level] ?? []), n];
src/build/roofSectionEndEvidence.ts:24:    const title=titles[0],scales=ts.filter(t=>/1\s*:\s*\d+/.test(t.str)&&t.cy>title.cy&&t.cy<title.cy+25&&Math.abs(t.cx-title.cx)<110);
src/build/roofSectionEndEvidence.ts:33:      const label=labels[0],nums=ts.filter(t=>/^\d{4,5}$/.test(t.str)&&Math.abs(t.cx-label.cx)<60&&t.cy-label.cy>5&&t.cy-label.cy<11);
src/build/roofSectionEndEvidence.ts:36:      const leaders=ls.filter(l=>!l.filled&&!l.curve&&Math.abs(l.y1-l.y2)<.05&&Math.abs(l.y1-y)<.4&&Math.abs((l.x1+l.x2)/2-label.cx)<80&&Math.abs(l.x2-l.x1)>3);
src/build/canopyRegistration.ts:116:          Math.abs(t.cx - label.cx) < 45,
src/build/canopyRegistration.ts:127:          box: [label.cx - 65, label.cy - 10, t.cx + 20, t.cy + 10],
src/build/canopyRegistration.ts:182:          t.cy - title.cy < 30 &&
src/build/canopyRegistration.ts:183:          Math.abs(t.cx - title.cx) < 180
src/build/canopyRegistration.ts:191:            t.cx > title.cx - 220 &&
src/build/canopyRegistration.ts:192:            t.cx < title.cx + 220 &&
src/build/canopyRegistration.ts:193:            t.cy > title.cy - 450 &&
src/build/canopyRegistration.ts:194:            t.cy < title.cy - 30,
src/build/canopyRegistration.ts:209:            t.cy < parent.cy - 50 &&
src/build/canopyRegistration.ts:210:            t.cx > parent.cx + 40,
src/build/canopyRegistration.ts:243:              t.cx - lt.cx < 100,
src/build/canopyRegistration.ts:266:            parent.cx - 20,
src/build/canopyRegistration.ts:268:            number.cx + 100,
src/build/canopyRegistration.ts:269:            title.cy - 30,
src/build/canopyRegistration.ts:284:                box: [bounds[0], number.cy - 20, bounds[2], title.cy + 30],
src/build/canopyRegistration.ts:293:                  Math.min(nt.cx, lt.cx) - 20,
src/build/canopyRegistration.ts:294:                  Math.min(nt.cy, lt.cy) - 20,
src/build/canopyRegistration.ts:295:                  Math.max(ft.cx, rx) + 20,
src/build/canopyRegistration.ts:296:                  Math.max(nt.cy, lt.cy) + 20,
src/build/columnGeometry.ts:268:          t.cx > r.bounds[0] - 300,
src/build/columnGeometry.ts:280:        Math.abs(t.cx - rect.at[0]) < 22,
src/build/columnGeometry.ts:317:            t.cy - title.cy < 25 &&
src/build/columnGeometry.ts:318:            Math.abs(t.cx - title.cx) < 110,
src/build/columnGeometry.ts:327:            t.cx > title.cx - 50 &&
src/build/columnGeometry.ts:328:            t.cx < title.cx + 850 &&
src/build/columnGeometry.ts:329:            t.cy < title.cy - 100 &&
src/build/columnGeometry.ts:330:            title.cy - t.cy < 650,
src/build/columnGeometry.ts:339:            t.cx < title.cx + 850 &&
src/build/columnGeometry.ts:347:            Math.abs(v.cx - t.cx) < 60 &&
src/build/columnGeometry.ts:357:            Math.abs((l.x1 + l.x2) / 2 - t.cx) < 80 &&
src/build/columnGeometry.ts:393:          box: [sg.cx - 20, post.top - 10, sg.cx + 20, post.bottom + 10],
src/build/roofMemberGeometry.ts:31:                Math.abs(t.cx - g.cx) < 30 &&
src/build/roofMemberGeometry.ts:32:                Math.abs(t.cy - g.cy) < 30,
src/build/roofMemberGeometry.ts:177:              t.cx > Math.min(...sourcePoints.map((p) => p[0])) - 25 &&
src/build/roofMemberGeometry.ts:178:              t.cx < Math.max(...sourcePoints.map((p) => p[0])) + 25 &&
src/build/roofMemberGeometry.ts:179:              Math.abs(t.cy - sourcePoints[0][1]) < 30,
src/build/hssColumnPlanSections.ts:10:      const header=ts.find(t=>t.str.trim()==='SIZE' && t.cy>heading.cy && t.cy-heading.cy<35 && Math.abs(t.cx-heading.cx)<150);
src/build/foundationSlabOptionEvidence.ts:12:      if(!ts.some(t=>/^CONCRETE FOOTING SCHEDULE$/i.test(t.str.trim()) && t.cy<tag.cy && tag.cy-t.cy<220 && Math.abs(t.cx-tag.cx)<400))continue;
src/build/foundationSlabOptionEvidence.ts:14:      if(!row.some(t=>t.str.trim()==='ST' && t.cx-tag.cx<80))continue;
src/build/foundationSlabOptionEvidence.ts:21:          const nums=dt.filter(t=>t.str.trim()===match[1] && Math.abs(t.cy-title.cy)<2 && t.cx<title.cx && title.cx-t.cx<220);
src/build/foundationSlabOptionEvidence.ts:24:          if(!dt.some(t=>t.str.trim().toUpperCase()===match[2].toUpperCase() && Math.abs(t.cx-n.cx)<2 && t.cy-n.cy>8 && t.cy-n.cy<22))continue;
src/build/canopyMemberGeometry.ts:108:          t.cy - title.cy < 30 &&
src/build/canopyMemberGeometry.ts:109:          Math.abs(t.cx - title.cx) < 180
src/build/canopyMemberGeometry.ts:128:        : title.cx + 500;
src/build/canopyMemberGeometry.ts:132:          t.cx > title.cx - 300 &&
src/build/canopyMemberGeometry.ts:135:          t.cy > title.cy - 700,
src/build/canopyMemberGeometry.ts:141:            Math.abs(t.cx - label.cx) < 45 &&
src/build/canopyMemberGeometry.ts:148:            p.box[0] > title.cx - 350 &&
src/build/canopyMemberGeometry.ts:150:            p.box[1] > label.cy - 100 &&
src/build/canopyMemberGeometry.ts:151:            p.box[3] < label.cy + 100,
src/build/canopyMemberGeometry.ts:180:            Math.min(l.x1, l.x2) > title.cx - 350 &&
src/build/canopyMemberGeometry.ts:181:            Math.max(l.x1, l.x2) < label.cx + 80,
src/build/canopyMemberGeometry.ts:389:            t.cx - mark.cx < 160 &&
src/build/canopyMemberGeometry.ts:401:            box: [mark.cx - 12, mark.cy - 8, size.cx + 70, size.cy + 8],
src/build/roofBeamPlane.ts:47:            Math.abs(t.cx - label.cx) < 60 &&
src/build/roofBeamPlane.ts:62:            Math.abs((l.x1 + l.x2) / 2 - label.cx) < 100 &&
src/build/roofBeamPlane.ts:77:          Math.abs(t.cx - high.cx) < 20 &&
src/build/roofBeamPlane.ts:79:          t.cy - high.cy < 200,
src/build/roofBeamPlane.ts:96:          high.cy - t.cy < 150 &&
src/build/roofBeamPlane.ts:97:          t.cx < high.cx + 40 &&
src/build/roofBeamPlane.ts:155:              Math.min(...row.map((t) => t.cx)) - 25,
src/build/roofBeamPlane.ts:157:              high.cx + 65,
src/build/roofBeamPlane.ts:171:          Math.abs(a.sources[0].box![1] - b.sources[0].box![1]) > 100 ||
src/build/roofBeamPlane.ts:172:          Math.abs(a.sources[0].box![0] - b.sources[0].box![0]) > 100) &&
src/build/roof.ts:73:        .filter((t) => /^\d{4,5}$/.test(t.str) && Math.abs(t.cy - high.cy) < 5 && Math.abs(t.cx - high.cx) < 140)
src/build/roof.ts:76:        (t) => /T\/?O LOW BEAM/i.test(t.str) && t.cy > high.cy && t.cy - high.cy < 200 && Math.abs(t.cx - high.cx) < 20,
src/build/roof.ts:80:        .filter((t) => /^\d{4,5}$/.test(t.str) && Math.abs(t.cy - low.cy) < 5 && Math.abs(t.cx - low.cx) < 140)
src/build/roof.ts:88:      const labels = ts.filter((t) => axes[t.str.trim()] && t.cy < high.cy && high.cy - t.cy < 140 && Math.abs(t.cx - high.cx) < 1300);
src/build/roof.ts:101:          if (!g || t.cx - g.at(-1)!.cx > 250) groups.push([t]);
src/build/roof.ts:110:          if (aa.axis !== bb.axis || Math.abs(last.cx - first.cx) < 150) continue;
src/build/roof.ts:121:              Math.min(l.x1, l.x2) < first.cx + 20 &&
src/build/roof.ts:122:              Math.max(l.x1, l.x2) > last.cx - 20 &&
src/build/roof.ts:123:              Math.min(l.y1, l.y2) > high.cy - 60 &&
src/build/roof.ts:124:              Math.max(l.y1, l.y2) < low.cy + 40 &&
src/build/roof.ts:166:        (a.source.id !== b.source.id || Math.abs(a.source.box![0] - b.source.box![0]) > 150),
src/build/facades.ts:38:      const labels = ts.filter((t) => axes[t.str.trim()] && t.cy < py && py - t.cy < 500 && t.cx < sheet.width * 0.87);
src/build/facades.ts:51:          if (!group || t.cx - group.at(-1)!.cx > 300 || group.some((x) => x.str === t.str)) groups.push([t]);
src/build/facades.ts:55:          if (group.length < 3 || px < group[0].cx - 80 || px > group.at(-1)!.cx + 80) continue;
src/build/roofRegistration.ts:63:          t.cy - title.cy < 35 &&
src/build/roofRegistration.ts:64:          Math.abs(t.cx - title.cx) < 180
src/build/roofRegistration.ts:199:            Math.min(title.cx - 160, scales[0].t.cx - 30),
src/build/roofRegistration.ts:201:            title.cx + 180,
src/build/floorBeamGeometry.ts:140:        Math.abs(panels[0].t.cy - toppings[0].t.cy) > 50
src/build/floorBeamGeometry.ts:166:                  Math.abs(n.cx - t.cx) < 75,
src/build/floorBeamGeometry.ts:179:                Math.abs((l.x1 + l.x2) / 2 - t.cx) < 90,
src/build/floorBeamGeometry.ts:198:                Math.abs(d.t.cx - high.t.cx) < 30,
src/build/floorBeamGeometry.ts:212:              l.x1 < high.t.cx - 80 &&
src/build/floorBeamGeometry.ts:213:              l.x1 > high.t.cx - 900,
src/build/floorBeamGeometry.ts:286:                  Math.min(panels[0].t.cx, toppings[0].t.cx) - 150,
src/build/floorBeamGeometry.ts:288:                  Math.max(panels[0].t.cx, toppings[0].t.cx) + 150,
src/build/foundationWallGeometry.ts:61:    Math.max(...plan.texts.map((t) => t.cx)) + 50,
src/build/foundationWallGeometry.ts:62:    Math.max(...plan.texts.map((t) => t.cy)) + 50,
src/build/foundationWallGeometry.ts:77:              t.cx < tag.cx + 180,
src/build/foundationWallGeometry.ts:100:                [tag.cx - 10, tag.cy - 5, tag.cx + 180, tag.cy + 5],
src/build/foundationWallGeometry.ts:118:              t.cy - n.cy < 25,
src/build/foundationWallGeometry.ts:134:                title.cx - m.n.cx < 500,
src/build/foundationWallGeometry.ts:142:                  Math.abs(m.n.cy - marker.n.cy) < 20 && m.n.cx > marker.n.cx,
src/build/foundationWallGeometry.ts:144:              .map((m) => m.n.cx - 20),
src/build/foundationWallGeometry.ts:145:            marker.n.cx + 850,
src/build/foundationWallGeometry.ts:147:          const bounds = [marker.n.cx - 20, title.cy - 450, right, title.cy];
src/build/foundationWallGeometry.ts:169:                Math.abs(v.cx - t.cx) < 50 &&
src/build/foundationWallGeometry.ts:306:                    Math.hypot(q[0] - t.cx, q[1] - t.cy) < 35,
src/build/foundationWallGeometry.ts:322:                  t.cy < section.source.box![3] - 200,
src/build/foundationWallGeometry.ts:334:                    sheet.cy - t.cy < 22,
src/build/foundationGeometry.ts:60:          v.cy - t.cy < 20 &&
src/build/foundationGeometry.ts:61:          Math.abs(v.cx - t.cx) < 100,
src/build/foundationGeometry.ts:93:            Math.min(label.cx, n.cx) - 30,
src/build/foundationGeometry.ts:95:            Math.max(label.cx, n.cx) + 30,
src/build/foundationGeometry.ts:120:        t.cy - title.cy < 60 &&
src/build/foundationGeometry.ts:121:        Math.abs(t.cx - title.cx) < 450,
src/build/foundationGeometry.ts:135:        t.cx - depth.cx < 120,
src/build/foundationGeometry.ts:149:            t.cy > title.cy + 20 &&
src/build/foundationGeometry.ts:151:            Math.abs(t.cx - title.cx) < 300,
src/build/foundationGeometry.ts:153:        .sort((a, b) => a.cy - b.cy)[0]?.cy ?? title.cy + 450;
src/build/foundationGeometry.ts:158:          Math.abs(t.cx - mark.cx) < 25 &&
src/build/foundationGeometry.ts:168:                Math.abs(t.cx - head.cx) < 30 && pattern.test(t.str.trim()),
src/build/foundationGeometry.ts:205:          mark.cx - 30,
src/build/foundationGeometry.ts:207:          size.cx + 60,
src/build/foundationGeometry.ts:222:          t.cy < title.cy + 60 &&
src/build/foundationGeometry.ts:223:          Math.abs(t.cx - title.cx) < 300,
src/build/foundationGeometry.ts:232:            Math.abs(t.cx - mark.cx) < 25 &&
src/build/foundationGeometry.ts:234:            t.cy < mark.cy + 120,
src/build/foundationGeometry.ts:240:              Math.abs(t.cx - size.cx) < 30 &&
src/build/foundationGeometry.ts:266:              box: [mark.cx, title.cy, size.cx, mark.cy + 120] as [
src/build/foundationGeometry.ts:294:      const peers = titles.filter((t) => Math.abs(t.cy - title.cy) < 20);
src/build/foundationGeometry.ts:312:          t.cy > title.cy - 450,
src/build/foundationGeometry.ts:328:            t.cy - ground.cy < 20 &&
src/build/foundationGeometry.ts:329:            Math.abs(t.cx - ground.cx) < 100,
src/build/foundationGeometry.ts:341:            Math.min(t.cx, title.cx) - 100,
src/build/foundationGeometry.ts:343:            Math.max(t.cx, title.cx) + 100,
src/build/foundationGeometry.ts:835:          Math.min(note.t.cx, note.title.cx) - 20,
src/build/foundationGeometry.ts:837:          Math.max(note.t.cx, note.title.cx) + 20,
src/build/foundationGeometry.ts:1025:      return m && Math.hypot(t.cx - title.cx, t.cy - title.cy) < 100
src/build/foundationGeometry.ts:1033:      Math.max(...ts.map((t) => t.cx)) + 50,
src/build/foundationGeometry.ts:1034:      Math.max(...ts.map((t) => t.cy)) + 50,
src/build/foundationGeometry.ts:1472:                (axis === 0 ? t.cy : t.cx) >= a - 20 &&
src/build/foundationGeometry.ts:1473:                (axis === 0 ? t.cy : t.cx) <= b + 20,
src/build/foundationGeometry.ts:1506:                    Math.abs((axis === 0 ? t.cx : t.cy) - at) < 30 &&
src/build/foundationGeometry.ts:1507:                    (axis === 0 ? t.cy : t.cx) >= a - 25 &&
src/build/foundationGeometry.ts:1508:                    (axis === 0 ? t.cy : t.cx) <= b + 25,
src/build/foundationGeometry.ts:1548:    Math.max(...plan.texts.map((t) => t.cx)) + 50,
src/build/foundationGeometry.ts:1549:    Math.max(...plan.texts.map((t) => t.cy)) + 50,
src/build/foundationGeometry.ts:1557:      const peers = titles.filter((t) => Math.abs(t.cy - title.cy) < 20);
src/build/foundationGeometry.ts:1559:        title.cx - 350,
src/build/foundationGeometry.ts:1565:        title.cx + 350,
src/build/foundationGeometry.ts:1575:          t.cy > title.cy - 450,
src/build/foundationGeometry.ts:1591:          t.cy - number.cy < 25,
src/build/foundationGeometry.ts:1615:            t.cy - floor.cy < 20 &&
src/build/foundationGeometry.ts:1616:            Math.abs(t.cx - floor.cx) < 100,
src/build/foundationGeometry.ts:1635:              v.cy - t.cy < 20 &&
src/build/foundationGeometry.ts:1636:              Math.abs(v.cx - t.cx) < 100,
src/build/foundationGeometry.ts:1654:              sheet.cy - t.cy < 22,
src/build/foundationGeometry.ts:1684:              Math.min(Math.abs(lo - bubble), Math.abs(hi - bubble)) > 35 ||
src/build/foundationGeometry.ts:1723:            box: [left, title.cy - 450, right, title.cy + 25],
src/build/foundationGeometry.ts:1778:      Math.hypot(t.cx - tag.cx, t.cy - tag.cy) < 25,
src/build/foundationGeometry.ts:1791:          t.cy < title.cy + 40 &&
src/build/foundationGeometry.ts:1792:          Math.abs(t.cx - title.cx) < 350,
src/build/foundationGeometry.ts:1802:          Math.abs(t.cx - markHead.cx) < 25 &&
src/build/foundationGeometry.ts:1804:          t.cy < markHead.cy + 250,
src/build/foundationGeometry.ts:1810:          row.cy + 30,
src/build/foundationGeometry.ts:1816:            Math.abs(t.cx - anchorsHead.cx) < 150 &&
src/build/foundationGeometry.ts:1823:            Math.abs(t.cx - anchorsHead.cx) > 150
src/build/foundationGeometry.ts:1845:              anchorsHead.cx + 150,
src/build/foundationGeometry.ts:1903:          (axis === 0 ? t.cy : t.cx) >= a - 20 &&
src/build/foundationGeometry.ts:1904:          (axis === 0 ? t.cy : t.cx) <= b + 20,
src/build/foundationGeometry.ts:1929:              Math.abs((horizontal ? t.cx : t.cy) - u1) < 30 &&
src/build/foundationGeometry.ts:1930:              (horizontal ? t.cy : t.cx) >= a - 25 &&
src/build/foundationGeometry.ts:1931:              (horizontal ? t.cy : t.cx) <= b + 25,
src/build/foundationGeometry.ts:2543:        Math.abs(v.cx - t.cx) < 40 &&
src/build/foundationGeometry.ts:2545:        v.cy - t.cy < 20,
src/build/foundationGeometry.ts:2929:          Math.min(box[0], d.t.cx - 40),
src/build/foundationGeometry.ts:2931:          Math.max(box[2], d.t.cx + 40),
src/build/foundationGeometry.ts:3231:          t.cy < title.cy + 50 &&
src/build/foundationGeometry.ts:3232:          Math.abs(t.cx - title.cx) < 400,
src/build/foundationGeometry.ts:3242:          t.cx - mark.cx < 150,
src/build/foundationGeometry.ts:3249:          Math.abs(t.cx - mark.cx) < 25 &&
src/build/foundationGeometry.ts:3251:          t.cy < mark.cy + 250,
src/build/foundationGeometry.ts:3256:            Math.abs(t.cx - size.cx) < 35 &&
src/build/foundationGeometry.ts:3262:            Math.abs(t.cx - depth.cx) < 25 &&
src/build/foundationGeometry.ts:3276:            box: [tag.cx - 10, tag.cy - 5, depth.cx + 25, tag.cy + 5],
src/build/foundationGeometry.ts:3358:        Math.abs(v.cx - t.cx) < 40 &&
src/build/foundationGeometry.ts:3360:        v.cy - t.cy < 20,
src/build/foundationGeometry.ts:3442:          tag.cx < x0 - 30 ||
src/build/foundationGeometry.ts:3443:          tag.cx > x1 + 30 ||
src/build/foundationGeometry.ts:3444:          tag.cy < y0 - 30 ||
src/build/foundationGeometry.ts:3445:          tag.cy > y1 + 30
src/build/foundationGeometry.ts:3524:          Math.min(r.x0, d.t.cx - 40),
src/build/foundationGeometry.ts:3526:          Math.max(r.x1, d.t.cx + 40),
src/build/foundationGeometry.ts:3579:  const us=plan.texts.filter(v=>/^U\/S FTG:\s*-?\d+$/i.test(v.str.trim())&&Math.abs(v.cx-t.cx)<40&&v.cy>t.cy&&v.cy-t.cy<20);if(us.length!==1)return [];
src/build/foundationGeometry.ts:3599:  const candidates=datums.filter(d=>connected.some(v=>Math.hypot(v.other[0]-d.t.cx,v.other[1]-(d.t.cy+d.us.cy)/2)<70));
src/build/flatRoofBeamGeometry.ts:36:          Math.abs(t.cx - label.cx) < 65 &&
src/build/flatRoofBeamGeometry.ts:69:          Math.abs((l.x1 + l.x2) / 2 - label.cx) < 90 &&
src/build/flatRoofBeamGeometry.ts:82:          box: [label.cx - 60, label.cy - 8, ns[0].cx + 20, ns[0].cy + 8],
src/build/roofSpanEvidence.ts:188:            Math.hypot(t.cx - c[0], t.cy - c[1]) < 30,
src/build/datumEvidence.ts:40:        .filter((v) => Math.abs(v.cy - t.cy) < 4 && Math.abs(v.cx - t.cx) < 150 && imperialFeet(v.str) !== null)
src/build/datumEvidence.ts:51:        box: [Math.min(t.cx, value.cx) - 60, t.cy - 15, Math.max(t.cx, value.cx) + 60, t.cy + 15],
src/build/roofCantileverGeometry.ts:184:              Math.abs(v.cx - t.cx) < 70 &&
src/build/roofCantileverGeometry.ts:185:              Math.abs(v.cy - t.cy) < 20,
src/build/roofCantileverGeometry.ts:276:              t.cx > title.cx - 300 &&
src/build/roofCantileverGeometry.ts:277:              t.cx < title.cx + 300 &&
src/build/roofCantileverGeometry.ts:278:              t.cy < title.cy - 100 &&
src/build/roofCantileverGeometry.ts:279:              title.cy - t.cy < 800,
src/build/roofCantileverGeometry.ts:292:                t.cy - title.cy < 25 &&
src/build/roofCantileverGeometry.ts:293:                Math.abs(t.cx - title.cx) < 300,
src/build/roofCantileverGeometry.ts:301:              Math.abs(t.cx - title.cx) < 300 &&
src/build/roofCantileverGeometry.ts:303:              t.cy < title.cy - 100,
src/build/roofCantileverGeometry.ts:309:              Math.abs(t.cx - label.cx) < 50 &&
src/build/roofCantileverGeometry.ts:408:                  titleLeft - t.cx < 50,
src/build/roofCantileverGeometry.ts:428:                    Math.abs(note.cx - ref.cx) > 100 ||
src/build/roofCantileverGeometry.ts:429:                    Math.abs(note.cy - ref.cy) > 180
src/build/roofCantileverGeometry.ts:436:                    Math.abs(ref.cx - outer.at) > 220 ||
src/build/roofCantileverGeometry.ts:447:                            Math.abs(t.cx - g.cx) < 40 &&
src/build/roofCantileverGeometry.ts:448:                            Math.abs(t.cy - g.cy) < 30,
src/build/roofCantileverGeometry.ts:450:                        t.cx > title.cx - 250 &&
src/build/roofCantileverGeometry.ts:451:                        t.cx < title.cx + 500 &&
src/build/roofCantileverGeometry.ts:452:                        t.cy > title.cy - 800 &&
src/build/roofCantileverGeometry.ts:469:                  Math.min(routes[0].ref.cx, routes[0].note.cx) - 100,
src/build/roofCantileverGeometry.ts:470:                  Math.min(routes[0].ref.cy, routes[0].note.cy) - 20,
src/build/roofCantileverGeometry.ts:471:                  Math.max(routes[0].ref.cx, routes[0].note.cx) + 120,
src/build/roofCantileverGeometry.ts:472:                  Math.max(routes[0].ref.cy, routes[0].note.cy) + 20,
src/build/roofCantileverGeometry.ts:481:                t.cx > title.cx - 250 &&
src/build/roofCantileverGeometry.ts:482:                t.cx < title.cx + 500 &&
src/build/roofCantileverGeometry.ts:483:                t.cy < title.cy - 300 &&
src/build/roofCantileverGeometry.ts:484:                title.cy - t.cy < 900,
src/build/roofCantileverGeometry.ts:503:                  t.cy - title.cy < 25 &&
src/build/roofCantileverGeometry.ts:504:                  Math.abs(t.cx - title.cx) < 300,
src/build/roofCantileverGeometry.ts:513:                  t.cx > title.cx - 250 &&
src/build/roofCantileverGeometry.ts:514:                  t.cx < title.cx + 500 &&
src/build/roofCantileverGeometry.ts:516:                  t.cy < title.cy - 100,
src/build/roofCantileverGeometry.ts:522:                  Math.abs(v.cx - t.cx) < 50 &&
src/build/roofCantileverGeometry.ts:533:                    Math.abs((l.x1 + l.x2) / 2 - t.cx) < 80 &&
src/build/roofCantileverGeometry.ts:588:                  at.cx - 20,
src/build/roofCantileverGeometry.ts:590:                  at.cx + 20,
```
