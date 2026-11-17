# The two urban vans

The panel van has a high cargo roof, pressed side panels, split rear doors and eight-slot steel wheels. The nearside slider opens onto a ribbed floor between two wheel tubs. The cab has two seats and a protective bulkhead. The Caravan uses the same wheel, front-door and cab construction with a lower touring body, crowned hood, wraparound front lights, bonded rear glass, six-spoke alloys and four captain's chairs. Both rear passenger doors slide. The modelled roof rails, dashboard, seats, door cards, mirrors and steering wheel belong to their respective chassis or moving leaves.

The designers used production dimensions and door arrangements to establish the two silhouettes. Ford's medium-roof Transit provided a reference for raised load floors and tall sliding openings. The Pacifica fleet specifications provided a reference for minivan proportions and the two passenger doors. The geometry, badges, plate, texture maps and interiors here are original. [Ford Transit technical specifications](https://www.fromtheroad.ford.com/content/dam/fordmediasite/us/en/library/2026/specs/2026_Ford_Transit_Specs.pdf) · [Stellantis fleet specifications](https://www.stellantisfleet.com/content/dam/fca-fleet/na/fleet/en_us/shopping-tools/brochures-literature/docs/234202_25DOMFLT_FBG_Interactive_Q02_REV.pdf)

| Contract | Panel van | Caravan |
| --- | --- | --- |
| Closed envelope, length × width with mirrors × height | 5.64 × 2.16 × 2.52 m | 5.04 × 2.06 × 1.83 m |
| Axle spacing / wheel track | 3.30 / 1.67 m | 3.04 / 1.60 m |
| Tire radius / width | .355 / .225 m | .320 / .215 m |
| Front pelvis, driver-left positive X | ±.46, .87, .80 m | ±.45, .67, .72 m |
| Rear pelvis | — | ±.45, .67, −.42 m |
| Slider outward / rearward travel | .115 / 1.26 m on the right | .115 / 1.04 m on both sides |

Coordinates use the compact's ground origin, +Y up, +Z forward. The measured dimensions are in `content/vehicles/van-dimensions.json`. The simulation anchors and exported rig sockets are defined in `content/vehicles/van-art.ts`. The front windscreen has a clear geometric aperture, a tinted upper strip and a bonded perimeter on both vans. The Caravan's rear screen has an exterior tint and a cutout interior face. Each driver's review image places another van ahead, as seen from the actual eye socket.

Build the two native packs and check all six levels with `bun run art -- core:panel_van core:caravan`. The original compact provides the closed mesh primitives in `../compact/parts.py`. Run `python3 -B assets/source/core/vehicles/van_common/paint.py` after editing the shared atlas artwork and rebuild the packs. The painter uses NumPy, Pillow and DejaVu Sans Bold. Run `bun assets/source/core/vehicles/van_common/review.ts` to regenerate each asset's exterior, open-door, interior and driver-eye views.
