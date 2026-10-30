# Door swing and wall hosting (T34)

Reviewed 30 October 2026 on the refreshed demos under `.agents-data`. Frederick has 2,855 saved measurements; Kelso has 2,105. Their project JSON SHA-256 values are listed below. The project JSON and PDFs were read only.

Build It now reads door-plan vector linework, reconnects curved chords into quarter-circle swing candidates, and searches within 2 m of each saved door tag. A candidate must have a wall run within 0.4 m of a possible opening midpoint on the same level. The door is snapped to that wall and the arc's PDF box is retained as a second source; the original tag box remains first. Each arc is used at most once. If no swing can be matched, the old 600 mm wall-proximity placement remains provisional and the model raises a review issue. No geometry is invented for an unhosted tag.

| Demo and sheet | Doors | Hosted before | Hosted after | Swing verified after | Still unhosted |
| --- | ---: | ---: | ---: | ---: | ---: |
| Frederick A211 | 50 | 20 | 30 | 30 | 20 |
| Frederick A212 | 38 | 29 | 34 | 26 | 4 |
| Frederick A213 | 35 | 26 | 30 | 29 | 5 |
| Frederick A214 | 32 | 23 | 28 | 28 | 4 |
| Kelso A2.1 | 15 | 15 | 15 | 0 | 0 |
| Kelso A2.2 | 18 | 14 | 14 | 0 | 4 |
| **Frederick total** | **155** | **98** | **122** | **113** | **33** |
| **Kelso total** | **33** | **29** | **29** | **0** | **4** |

The nine Frederick doors hosted only by proximity remain provisional. Kelso A2.2 has 74,870 vector segments but zero marked curved segments, so the PDF supplies no vector swing arcs to verify. Its existing 29 hosts remain proximity based. Frederick's A211 has 53 detected swing arcs and A212 has 49; detection is deliberately limited to plausible quarter-circle groups, not tag circles. The schedule finish is unchanged: Frederick **2025-08-06**, Kelso **2027-08-25**.

## Unhosted saved door measurement IDs

### Frederick

Project JSON SHA-256: `84ac0c87482e2afeabc99dc251fb6d216f7ac894f2b4168b2f7e15b198c0825d` (2855 measurements).

**A211 (20):** `9bcd6840-6822-4563-acf6-16a5bd2c6406`, `2852ed09-4148-41b3-9dbf-5f9567646ab1`, `30773ffb-3ad9-4dfd-baa4-c4eebd84bc0a`, `cdad0fa2-d2a8-4145-80d0-1bae0a09f03b`, `1c452fd5-e135-42ac-8a7d-3549e95dd5c4`, `61b25a49-f3de-4068-b55e-6935a4e7cf16`, `4b01d2c3-7552-450e-af16-b0233a99ee62`, `f316c042-d413-4e0e-baa7-f24e95732f09`, `8df62ed9-2a4d-45e4-8a35-c5f2d907f899`, `7580faa6-8165-4171-ada4-ee4c1d84897a`, `735948a5-8ce6-4cc1-8a1f-3b18ce940579`, `9ba2680b-9f8d-4888-8f61-7a8dddff0ab6`, `c7a7091e-28c0-48ce-87c0-f61470183b10`, `727eaf6a-8581-4de5-adef-2e51ebf887a8`, `8533da46-e4c6-4599-8f5a-017ced2054fb`, `f2c1ad15-440a-4ec9-bf47-d1bbf116793e`, `50246774-7992-4d92-9edc-174354313196`, `b0ca98c5-f3af-4be1-92b8-065cb39a0a34`, `9504bd80-2031-4f1c-be9c-50b789bcc4da`, `0084d5c9-b8ef-4e8b-bc89-54de8e895006`.

**A212 (4):** `4276587d-3382-48d5-adce-f1a2d2b61a88`, `19dab313-2af2-4ce9-8ff5-ca4a669c7404`, `5f5fcacc-4a7e-4264-bd41-fc330f608760`, `b12b5727-41c9-4271-86aa-e2f7d5fba634`.

**A213 (5):** `4ccc9118-7101-4efb-bfe5-5c5c5f33ad3f`, `97cb1699-99df-48f7-b03b-af3b1ff8c19d`, `9e5c8b50-c10d-4c73-bd4f-8496119420f1`, `9efb54d9-7bd9-4f4a-8a94-67af78627794`, `7fab0960-9d37-4d08-846a-cbf355b8a03c`.

**A214 (4):** `dcee9be8-d19e-4417-9dad-9bf236e5f7d6`, `4881032b-48c1-435c-99e4-c9354b50c09e`, `00653c0e-1f58-4e35-87a9-e0ba9544ab43`, `0251d443-aa0b-4eaa-9ca7-c95688fb1cef`.

### Kelso

Project JSON SHA-256: `ea9f01c96a9f0eb7e2765704ae13e52b61700a6dd82a925ddbddd3e4d96c0f8b` (2105 measurements).

**A2.2 (4):** `d14769fd-fc45-46e6-a351-0d7ad97a095c`, `ca91402a-1df0-420c-b079-1070c18467a7`, `aa04dcec-eb22-47c1-aa3c-d022fdaf906b`, `05c587bc-8236-41f7-850d-dd189f5dd86f`.

The saved tag, inferred wall, and arc source can be inspected in Build It. These remaining IDs require drawing review or richer linework before assigning a new 3D wall host.
