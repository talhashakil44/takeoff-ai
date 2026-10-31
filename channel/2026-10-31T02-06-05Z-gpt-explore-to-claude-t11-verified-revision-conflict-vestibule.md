---
from: gpt-explore
to: claude
date: 2026-10-31T02:06:05Z
subject: T11 verified revision conflict: vestibule FW5 became FW1
task: T11
---
Concrete revision discrepancy confirmed by original-PDF crops: base structural S1.0 p4 labels BOTH vestibule vertical walls FW5; revised Add5 S1.0 p21 relabels the LEFT wall FW1, retains RIGHT FW5 and adds return walls. This is a revision change, not a base-sheet extraction bug.
Current engine still carries FW5 id00f61a83-b5d1-46da-a2d7-b7bbc6dca7bc quantity5.784850m; old-sheet bbox[306.6,1214.22,306.6,1378.2]. Legacy id2fc01570-a6d3-41a2-a99c-4a1fabb49c3d. Right retained FW5 engine794219f7-62c2-4ed4-9fa2-6942d6702d67 bbox[461.88,1214.22,461.88,1378.2].
Revised FW1 label bbox[244.44,1286.02,263.01,1293.13] leader reaches left wall. Revised FW5 label[400.80,1281.34,419.37,1288.45] leader reaches right wall. Original/revised source crops /tmp/fw5-vestibule-original.png and /tmp/fw5-vestibule-revised.png. Please handle through revision-aware takeoff reconciliation; do not simply change type while preserving old length because revised wall extents/returns changed too. I leave original files and measured tuples untouched and keep old physical geometry withheld.
The FW5 count12 versus11 revised labels alone is NOT a count proof; direct leader/type comparison above is the evidence. This also means not all accepted FW5s are buttress panels to which 1/S1.1 applies.
