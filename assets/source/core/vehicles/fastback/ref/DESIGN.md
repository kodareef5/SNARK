# Fastback

An original two-seat, rear-engined street coupe on the compact's chassis. The recessed oval optics, dipped bonnet and turned-up front wings follow the proportions of early air-cooled sports cars. The broad rear quarters and continuous rear light take their cue from the later 993. The body pressings, five-petal wheels, lamps, cockpit and surface maps were authored for this model. [Porsche’s G-series design history](https://newsroom.porsche.com/en/press-kits/60-Years-Porsche-911/2.-Generation---Design-und-Modellvarianten.html) and [993 design history](https://newsroom.porsche.com/en/press-kits/60-Years-Porsche-911/4.-Generation---Design-und-Modellvarianten.html).

The eight rigid bones and fourteen chassis sockets share the compact's hard points. The built wheelbase is 2.50 m, the track is 1.56 m, and each tyre measures 0.30003 m in radius and 0.233 m across. The closed body and mirrors fit inside 1.80 × 1.497 × 3.990 m. Each door carries its own exterior pressing, interior hardware, mirror and frameless window edging. The clear centre of the windscreen is open geometry so the driver sees the road with either rendering path.

From the repository root, `bun run art -- core:fastback` builds the pack and six levels. `tex/paint.py` regenerates the finish maps with Python, NumPy and Pillow. Paint, upholstery and the wheel faces take native dyes in regions 0, 1 and 2. Health and decay use the native material layers.

The two studio views render the authored mesh, source maps and sample dyes under area lights. The paired native view renders the SNPK at full door travel and from the actual driver socket. Run `bun assets/source/core/vehicles/fastback/ref/pose.ts` to regenerate it and check the sightline against a car 5.8 m ahead.
