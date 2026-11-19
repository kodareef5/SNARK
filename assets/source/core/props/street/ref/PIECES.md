# Street furniture construction register

Seventeen plates cover eighteen fixtures and thirty-one form entries. The route and speed posts share a sheet and have independent origins. Two later entries, the pay station (18) and the crosswalk bars (19), have no measured plate: their numbers are the model's.

## Drawing conventions

Coordinates are metres in local **(X, Y, Z)** order. X follows the kerb from left to right in the front view, Y points up and Z points toward the road. The rust-coloured datum marks grade at the centre of the installed foot or the centre of a multi-foot assembly. A failed form keeps the original installation datum. The fence and guardrail origins are halfway between their post axes.

Front looks from +Z and side from −X. Plan looks down from +Y. In plan, +Z is down the page unless the view is marked “+Z right.” The three measured views share one scale per fixture. Perspective studies and enlarged details are fitted separately. The utility pole elevation stops at grade. Its table includes the buried toe.

Part ranges are axis-aligned minimum and maximum coordinates in the **posed** form. Endpoints and overall drawing dimensions are independently rounded to 0.01 m, so subtracting two rounded endpoints can differ from a dimension string by 0.01 m. Positive rotations follow the right-hand rule. Apply rotations before the stated final translation. Zero tilt describes the assembly at its origin, including any slopes built into its members.

Value **V** is the approximate diffuse, unlit sRGB luma on a 0–100 scale. Sheet swatches are the local colours before lighting. The texture combines broad sun fade, dark recesses, white zinc bloom, joint corrosion and rain runs. Use a shared atlas with alpha masks for fabric, chain links and fine edge breaks. Sheet-metal and glass edges can use a double-sided face or a folded 0.02 m visual edge. All smaller marks belong to the atlas.

Cut schedules below each reference form give centres, section profiles, end points and repeat positions. Box sizes follow local X × Y × Z. For rotated boxes, the positive half-axis tips locate the three face centres. Coordinates in an outline follow its perimeter. Join successive ring stations linearly. Paint patch bounds include transparent margins. All setbacks and spacings are illustrative game-placement values.

## Plate index

| Plate | Fixture | Forms |
|---:|---|---|
| 01 | [Street lamp](#piece-lamp) · [Plate](lamp.png) | Standing, Leaning, Fallen |
| 02 | [Junction signal](#piece-signal) · [Plate](signal.png) | Standing, Bent |
| 03 | [Stop sign](#piece-stop) · [Plate](stop.png) | Standing, Bent |
| 04 | [Street-name blades](#piece-name) · [Plate](name.png) | Standing |
| 05 | [Route & speed signs](#piece-posts) · [Plate](posts.png) | Speed limit, Evacuation route |
| 06 | [Utility pole](#piece-pole) · [Plate](pole.png) | Standing, Leaning |
| 07 | [Fire hydrant](#piece-hydrant) · [Plate](hydrant.png) | Standing |
| 08 | [Slatted bench](#piece-bench) · [Plate](bench.png) | Whole, Broken |
| 09 | [Litter bin](#piece-bin) · [Plate](bin.png) | Standing, Tipped |
| 10 | [Bus shelter](#piece-shelter) · [Plate](shelter.png) | Whole, Wrecked |
| 11 | [Collection mailbox](#piece-mailbox) · [Plate](mailbox.png) | Standing |
| 12 | [Parking meter](#piece-meter) · [Plate](meter.png) | Whole, Broken |
| 13 | [Pipe bollard](#piece-bollard) · [Plate](bollard.png) | Standing |
| 14 | [Chain-link fence](#piece-fence) · [Plate](fence.png) | Whole, Sagging, Down |
| 15 | [W-beam guardrail](#piece-rail) · [Plate](rail.png) | Whole, Bent |
| 16 | [Expressway billboard](#piece-billboard) · [Plate](billboard.png) | Whole, Bare |
| 17 | [Newspaper box](#piece-newsbox) · [Plate](newsbox.png) | Standing |
| 18 | [Pay station](#piece-paystation) | Standing, Broken |
| 19 | [Crosswalk bars](#piece-crosswalk) | Fresh, Worn |

<a id="piece-lamp"></a>

## 01 · Street lamp

[Open measured plate](lamp.png)

Use a 12-sided base-to-tip taper. Plate is 0.42 m square. Davit centreline stations (Y, Z) are (7.94, 0.01), (8.12, 0.18), (8.43, 0.61), (8.77, 1.37), (8.94, 2.19), (8.94, 2.60). Paint four anchor nuts, the access cover and the broken lens pattern.

At the plate, paint four nuts on a 0.29 × 0.29 m bolt pattern. The handhole patch is 0.11 × 0.30 m centred at Y 0.69 m on the +Z face. The lens fracture runs across the lower bowl.

### Standing

Cracked lens in a chalked cobra head. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.24 … 0.24 m, Y 0.00 … 9.12 m, Z -0.21 … 3.34 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Anchor plate | -0.21 … 0.21 | 0.00 … 0.05 | -0.21 … 0.21 | Galvanised steel | zinc grey | V60 |
| ↳ Anchor-nut pattern (atlas) | -0.21 … 0.21 | 0.05 … 0.05 | -0.21 … 0.21 | Galvanised steel | aged zinc | V60 |
| Tapered mast | -0.15 … 0.15 | 0.05 … 8.03 | -0.15 … 0.15 | Galvanised steel | zinc grey | V60 |
| ↳ Handhole cover (atlas) | -0.05 … 0.05 | 0.54 … 0.84 | 0.14 … 0.14 | Galvanised steel | zinc with oxide rim | V60 |
| Swept davit | -0.08 … 0.08 | 7.86 … 8.99 | 0.01 … 2.60 | Galvanised steel | zinc grey | V60 |
| Cobra-head casting | -0.24 … 0.24 | 8.95 … 9.12 | 2.42 … 3.34 | Aluminium | oxidised silver | V66 |
| Prismatic lens | -0.20 … 0.20 | 8.83 … 8.97 | 2.66 … 3.26 | Glass | clouded pearl | V77 |
| ↳ Lens fractures (atlas) | -0.20 … 0.07 | 8.83 … 8.97 | 2.66 … 3.26 | Glass | smoke grey | V31 |
| Lens gasket | -0.20 … 0.20 | 8.95 … 8.98 | 2.64 … 3.26 | Plastic | carbon grey | V24 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Anchor plate | Box 0.42 × 0.05 × 0.42 at (0.00, 0.03, 0.00). |
| Tapered mast | 12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.05, 0.29), (0.44, 0.28), (7.75, 0.16), (8.03, 0.15). |
| Swept davit | 8 facets, rings normal to local Z. (X, Y, Z, diameters X/Y) (0.00, 7.94, 0.01, 0.16, 0.16), (0.00, 8.12, 0.18, 0.16, 0.16), (0.00, 8.43, 0.61, 0.15, 0.14), (0.00, 8.77, 1.37, 0.12, 0.12), (0.00, 8.94, 2.19, 0.10, 0.10), (0.00, 8.94, 2.60, 0.09, 0.09). Apply pose rotation to the section axes. |
| Cobra-head casting | 12 facets, rings normal to local Y. (X, Y, Z, diameters X/Z) (0.00, 8.95, 2.87, 0.30, 0.64), (0.00, 9.00, 2.88, 0.47, 0.92), (0.00, 9.09, 2.85, 0.40, 0.74), (0.00, 9.12, 2.81, 0.20, 0.40). Apply pose rotation to the section axes. |
| Prismatic lens | 10 facets, rings normal to local Y. (X, Y, Z, diameters X/Z) (0.00, 8.83, 2.98, 0.19, 0.36), (0.00, 8.87, 2.98, 0.34, 0.54), (0.00, 8.97, 2.96, 0.39, 0.64). Apply pose rotation to the section axes. |
| Lens gasket | 10 facets, centre (X, Z) = (0.00, 2.95). Stations (Y, diameters X/Z) (8.95, 0.40, 0.65), (8.98, 0.41, 0.66). |

</details>

### Leaning

The footing lifts and the mast leans roadward. **Pose.** Entire mast and plate +15° about X at (0.00, 0.00, 0.00), then lifted 0.06 m on the exposed footing.

**Assembly envelope.** X -0.27 … 0.27 m, Y 0.00 … 8.23 m, Z -0.27 … 5.56 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Heaved footing | -0.27 … 0.27 | 0.00 … 0.13 | -0.27 … 0.21 | Concrete | limestone grey | V66 |
| Anchor plate | -0.21 … 0.21 | 0.00 … 0.16 | -0.20 … 0.22 | Galvanised steel | zinc grey | V60 |
| ↳ Anchor-nut pattern (atlas) | -0.21 … 0.21 | 0.05 … 0.16 | -0.19 … 0.22 | Galvanised steel | aged zinc | V60 |
| Tapered mast | -0.15 … 0.15 | 0.07 … 7.83 | -0.13 … 2.15 | Galvanised steel | zinc grey | V60 |
| ↳ Handhole cover (atlas) | -0.05 … 0.05 | 0.54 … 0.83 | 0.28 … 0.36 | Galvanised steel | zinc with oxide rim | V60 |
| Swept davit | -0.08 … 0.08 | 7.64 … 8.23 | 2.04 … 4.84 | Galvanised steel | zinc grey | V60 |
| Cobra-head casting | -0.24 … 0.24 | 7.87 … 8.19 | 4.67 … 5.56 | Aluminium | oxidised silver | V66 |
| Prismatic lens | -0.20 … 0.20 | 7.77 … 8.03 | 4.89 … 5.47 | Glass | clouded pearl | V77 |
| ↳ Lens fractures (atlas) | -0.20 … 0.07 | 7.78 … 8.03 | 4.89 … 5.47 | Glass | smoke grey | V31 |
| Lens gasket | -0.20 … 0.20 | 7.86 … 8.04 | 4.87 … 5.48 | Plastic | carbon grey | V24 |

<details>
<summary>Changed members and cut geometry</summary>

| Member | Construction in metres |
|---|---|
| Heaved footing | Extrude outline (-0.27, 0.00, -0.27), (-0.27, 0.00, 0.21), (-0.27, 0.13, -0.27) by (0.54, 0.00, 0.00). |

</details>

### Fallen

The stub stays upright. The head lies beside the shaft. **Pose.** Shaft and davit −90° about Z at (0.00, 0.44, 0.00), translated (+0.44, −0.30, +0.16). Head +75° about Z at (0.00, 8.95, 2.87), translated (+6.42, −8.74, −0.42) and settled onto its side at grade.

**Assembly envelope.** X -0.21 … 8.99 m, Y 0.00 … 0.54 m, Z -0.21 … 2.92 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Anchor plate | -0.21 … 0.21 | 0.00 … 0.05 | -0.21 … 0.21 | Galvanised steel | zinc grey | V60 |
| ↳ Anchor-nut pattern (atlas) | -0.21 … 0.21 | 0.05 … 0.05 | -0.21 … 0.21 | Galvanised steel | aged zinc | V60 |
| Fracture stub | -0.15 … 0.15 | 0.05 … 0.54 | -0.15 … 0.15 | Galvanised steel | zinc grey | V60 |
| Detached mast | 0.44 … 8.03 | 0.00 … 0.28 | 0.02 … 0.30 | Galvanised steel | zinc grey | V60 |
| ↳ Handhole cover (atlas) | 0.54 … 0.84 | 0.09 … 0.19 | 0.30 … 0.30 | Galvanised steel | zinc with oxide rim | V60 |
| Swept davit | 7.86 … 8.99 | 0.06 … 0.22 | 0.17 … 2.76 | Galvanised steel | zinc grey | V60 |
| Cobra-head casting | 6.23 … 6.46 | 0.00 … 0.45 | 2.00 … 2.92 | Aluminium | oxidised silver | V66 |
| Prismatic lens | 6.35 … 6.56 | 0.03 … 0.41 | 2.24 … 2.84 | Glass | clouded pearl | V77 |
| ↳ Lens fractures (atlas) | 6.35 … 6.55 | 0.03 … 0.25 | 2.24 … 2.84 | Glass | smoke grey | V31 |
| Lens gasket | 6.34 … 6.47 | 0.02 … 0.42 | 2.22 … 2.84 | Plastic | carbon grey | V24 |

<details>
<summary>Changed members and cut geometry</summary>

| Member | Construction in metres |
|---|---|
| Fracture stub | 12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.05, 0.29), (0.43, 0.28).<br>Panel (0.14, 0.43, 0.00), (0.12, 0.43, 0.06), (0.14, 0.54, 0.03).<br>Panel (0.04, 0.43, 0.13), (-0.02, 0.43, 0.14), (0.01, 0.54, 0.14).<br>Panel (-0.14, 0.43, 0.00), (-0.12, 0.43, -0.06), (-0.14, 0.54, -0.03).<br>Panel (0.04, 0.43, -0.13), (0.10, 0.43, -0.10), (0.07, 0.54, -0.12). |
| Detached mast | 12 facets, rings normal to local Y. (X, Y, Z, Ø) (0.44, 0.14, 0.16, 0.28), (7.75, 0.14, 0.16, 0.16), (8.03, 0.14, 0.16, 0.15). Apply pose rotation to the section axes. |
| Swept davit | 8 facets, rings normal to local Z. (X, Y, Z, diameters X/Y) (7.94, 0.14, 0.17, 0.16, 0.16), (8.12, 0.14, 0.34, 0.16, 0.16), (8.43, 0.14, 0.77, 0.15, 0.14), (8.77, 0.14, 1.53, 0.12, 0.12), (8.94, 0.14, 2.35, 0.10, 0.10), (8.94, 0.14, 2.76, 0.09, 0.09). Apply pose rotation to the section axes. |
| Cobra-head casting | 12 facets, rings normal to local Y. (X, Y, Z, diameters X/Z) (6.42, 0.21, 2.45, 0.30, 0.64), (6.37, 0.23, 2.46, 0.47, 0.92), (6.28, 0.25, 2.43, 0.40, 0.74), (6.26, 0.26, 2.39, 0.20, 0.40). Apply pose rotation to the section axes. |
| Prismatic lens | 10 facets, rings normal to local Y. (X, Y, Z, diameters X/Z) (6.54, 0.18, 2.56, 0.19, 0.36), (6.50, 0.19, 2.56, 0.34, 0.54), (6.40, 0.22, 2.54, 0.39, 0.64). Apply pose rotation to the section axes. |
| Lens gasket | 10 facets, rings normal to local Y. (X, Y, Z, diameters X/Z) (6.42, 0.21, 2.53, 0.40, 0.65), (6.40, 0.22, 2.53, 0.41, 0.66). Apply pose rotation to the section axes. |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.90 m | Davit points +Z over the carriageway. | Collectors and commercial avenues. Repeat at 30.00–45.00 m along one verge or stagger across a broad road. | Keep drive aprons, tree crowns and the pedestrian through route clear. |

**Atlas treatment.** Anchor nuts and handhole · zinc V60. Lens fracture · smoke grey V31.

**Distance model.** Keep mast, elbow and head. Fallen LOD keeps three masses for stub, shaft and head.

<a id="piece-signal"></a>

## 02 · Junction signal

[Open measured plate](signal.png)

Pole top 6.60 m. The arm projects 9.20 m. Restore the tube from centreline (Y, Z) in m: (6.28, 0.03), (6.54, 1.10), (6.68, 3.20), (6.72, 5.00), (6.74, 7.10), (6.73, 9.20). Root Ø0.34 m, tip Ø0.13 m. Each three-aspect head has Ø0.30 m lenses and an open-bottom 0.22 m visor. Lens inks are faded red V36, amber V54 and green V43. Pedestrian hand is amber, unlit.

The hanger axis and backplate lie on the arm centreline. Each housing projects 0.27 m toward approach traffic, visors reach 0.48 m. Set the pedestrian display at Y 2.44 m. Blacken the inside of each visor.

### Standing

The far head has twisted on its hanger. **Pose.** Far head +18° about local vertical at (0.00, 6.74, 8.65) from the −X approach bearing, then −13° about X at that hanger. Other parts 0°.

**Assembly envelope.** X -0.50 … 0.34 m, Y 0.00 … 6.82 m, Z -0.34 … 9.20 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Anchor plate | -0.34 … 0.34 | 0.00 … 0.07 | -0.34 … 0.34 | Galvanised steel | zinc grey | V60 |
| ↳ Anchor-nut pattern (atlas) | -0.34 … 0.34 | 0.07 … 0.07 | -0.34 … 0.34 | Galvanised steel | aged zinc | V60 |
| Signal mast | -0.24 … 0.24 | 0.07 … 6.60 | -0.24 … 0.24 | Galvanised steel | zinc grey | V60 |
| Tapered mast arm | -0.17 … 0.17 | 6.12 … 6.82 | 0.03 … 9.20 | Galvanised steel | zinc grey | V60 |
| Street blade | -0.12 … -0.10 | 6.07 … 6.49 | 1.12 … 2.80 | Aluminium | grey-green | V49 |
| Pedestrian unit | -0.21 … 0.21 | 2.22 … 2.67 | 0.15 … 0.37 | Painted steel | charcoal | V28 |
| ↳ Pedestrian hand (atlas) | -0.21 … 0.21 | 2.22 … 2.67 | 0.37 … 0.37 | Plastic | unlit amber | V54 |
| Pedestrian hood | -0.23 … 0.23 | 2.66 … 2.69 | 0.14 … 0.50 | Painted steel | charcoal | V28 |
| Near backplate | -0.02 … 0.02 | 5.50 … 6.62 | 3.94 … 4.47 | Painted steel | charcoal | V28 |
| Near housing | -0.27 … -0.02 | 5.57 … 6.56 | 4.02 … 4.38 | Painted steel | safety ochre | V62 |
| Near aspects | -0.27 … -0.27 | 5.61 … 6.55 | 4.05 … 4.35 | Plastic | carbon grey | V24 |
| ↳ Dull green lens (atlas) | -0.27 … -0.27 | 5.61 … 5.91 | 4.05 … 4.35 | Plastic | dull green | V43 |
| ↳ Dull amber lens (atlas) | -0.27 … -0.27 | 5.93 … 6.23 | 4.05 … 4.35 | Plastic | dull amber | V54 |
| ↳ Dull red lens (atlas) | -0.27 … -0.27 | 6.25 … 6.55 | 4.05 … 4.35 | Plastic | dull red | V36 |
| Near visors | -0.48 … -0.26 | 5.72 … 6.56 | 4.04 … 4.36 | Painted steel | charcoal | V28 |
| Near hanger | -0.05 … 0.05 | 6.58 … 6.74 | 4.16 … 4.25 | Galvanised steel | smoked zinc | V44 |
| Far backplate | -0.10 … 0.10 | 5.52 … 6.70 | 8.43 … 9.16 | Painted steel | charcoal | V28 |
| Far housing | -0.31 … 0.04 | 5.59 … 6.65 | 8.52 … 9.15 | Painted steel | safety ochre | V62 |
| Far aspects | -0.31 … -0.21 | 5.69 … 6.60 | 8.66 … 9.08 | Plastic | carbon grey | V24 |
| ↳ Dull green lens (atlas) | -0.31 … -0.21 | 5.69 … 5.98 | 8.81 … 9.08 | Plastic | dull green | V43 |
| ↳ Dull amber lens (atlas) | -0.31 … -0.21 | 6.00 … 6.29 | 8.73 … 9.01 | Plastic | dull amber | V54 |
| ↳ Dull red lens (atlas) | -0.31 … -0.21 | 6.31 … 6.60 | 8.66 … 8.94 | Plastic | dull red | V36 |
| Far visors | -0.50 … -0.20 | 5.76 … 6.63 | 8.65 … 9.16 | Painted steel | charcoal | V28 |
| Far hanger | -0.04 … 0.04 | 6.60 … 6.78 | 8.60 … 8.72 | Galvanised steel | smoked zinc | V44 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Anchor plate | Box 0.68 × 0.07 × 0.68 at (0.00, 0.04, 0.00). |
| Signal mast | 12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.07, 0.48), (0.48, 0.45), (6.60, 0.30). |
| Tapered mast arm | 10 facets, rings normal to local Z. (X, Y, Z, Ø) (0.00, 6.28, 0.03, 0.34), (0.00, 6.54, 1.10, 0.31), (0.00, 6.68, 3.20, 0.26), (0.00, 6.72, 5.00, 0.22), (0.00, 6.74, 7.10, 0.17), (0.00, 6.73, 9.20, 0.13). Apply pose rotation to the section axes. |
| Street blade | Extrude outline (-0.10, 6.07, 1.15), (-0.10, 6.07, 2.78), (-0.10, 6.10, 2.80), (-0.10, 6.47, 2.80), (-0.10, 6.49, 2.78), (-0.10, 6.49, 1.15), (-0.10, 6.47, 1.12), (-0.10, 6.10, 1.12) by (-0.02, 0.00, 0.00). |
| Pedestrian unit | Box 0.42 × 0.45 × 0.22 at (0.00, 2.44, 0.26). |
| Pedestrian hood | Box 0.45 × 0.03 × 0.36 at (0.00, 2.68, 0.32). |
| Near backplate | Extrude outline (0.02, 5.50, 4.00), (0.02, 5.50, 4.40), (0.02, 5.57, 4.47), (0.02, 6.56, 4.47), (0.02, 6.62, 4.40), (0.02, 6.62, 4.00), (0.02, 6.56, 3.94), (0.02, 5.57, 3.94) by (-0.04, 0.00, 0.00). |
| Near housing | Box 0.36 × 0.99 × 0.25 at (-0.14, 6.06, 4.20). Positive half-axis tips (-0.14, 6.06, 4.38), (-0.14, 6.56, 4.20), (-0.27, 6.06, 4.20). |
| Near aspects | Stack on 0.32 m centres. Each opening is Ø0.30 m. Lens colours descend red, amber, green.<br>Twelve-sided disks, Ø0.30 m. Centres at (−0.27, 5.76, 4.20), (−0.27, 6.08, 4.20), (−0.27, 6.40, 4.20). Colours from bottom are green V43, amber V54 and red V36. |
| Near visors | Three open-bottom cowls, radius 0.16 m, eight segments over a 210° arc, depth 0.22 m. Arc ends 15° below the horizontal. Use the centres of the corresponding aspects. |
| Near hanger | 8-sided tube Ø0.09 from (0.00, 6.58, 4.20) to (0.00, 6.74, 4.20). |
| Far backplate | Extrude outline (-0.05, 5.52, 8.73), (0.08, 5.60, 9.10), (0.10, 5.68, 9.15), (0.10, 6.64, 8.93), (0.08, 6.69, 8.85), (-0.05, 6.61, 8.48), (-0.07, 6.53, 8.43), (-0.07, 5.57, 8.66) by (-0.03, 0.00, 0.01). |
| Far housing | Box 0.36 × 0.99 × 0.25 at (-0.13, 6.12, 8.84). Positive half-axis tips (-0.08, 6.15, 9.01), (-0.13, 6.60, 8.73), (-0.25, 6.13, 8.88). |
| Far aspects | Stack on 0.32 m centres. Each opening is Ø0.30 m. Lens colours descend red, amber, green.<br>Use the near head pattern at Z 8.65 m, raised 0.03 m, then apply the +18° hanger yaw and −13° roll about X. |
| Far visors | Duplicate the near cowls on the far housing and apply both hanger rotations. |
| Far hanger | 8-sided tube Ø0.09 from (0.00, 6.61, 8.68) to (0.00, 6.77, 8.64). |

</details>

### Bent

Two folds pull the arm down. The far head is gone. **Pose.** About +X, pitch the outer 2.10 m spans down 16° then 30° absolute, at (0.00, 6.72, 5.00) and (0.00, 6.14, 7.02). Far assembly removed.

**Assembly envelope.** X -0.48 … 0.34 m, Y 0.00 … 6.82 m, Z -0.34 … 8.84 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Anchor plate | -0.34 … 0.34 | 0.00 … 0.07 | -0.34 … 0.34 | Galvanised steel | zinc grey | V60 |
| ↳ Anchor-nut pattern (atlas) | -0.34 … 0.34 | 0.07 … 0.07 | -0.34 … 0.34 | Galvanised steel | aged zinc | V60 |
| Signal mast | -0.24 … 0.24 | 0.07 … 6.60 | -0.24 … 0.24 | Galvanised steel | zinc grey | V60 |
| Tapered mast arm | -0.17 … 0.17 | 5.03 … 6.82 | 0.03 … 8.84 | Galvanised steel | zinc grey | V60 |
| Street blade | -0.12 … -0.10 | 6.07 … 6.49 | 1.12 … 2.80 | Aluminium | grey-green | V49 |
| Pedestrian unit | -0.21 … 0.21 | 2.22 … 2.67 | 0.15 … 0.37 | Painted steel | charcoal | V28 |
| ↳ Pedestrian hand (atlas) | -0.21 … 0.21 | 2.22 … 2.67 | 0.37 … 0.37 | Plastic | unlit amber | V54 |
| Pedestrian hood | -0.23 … 0.23 | 2.66 … 2.69 | 0.14 … 0.50 | Painted steel | charcoal | V28 |
| Near backplate | -0.02 … 0.02 | 5.50 … 6.62 | 3.94 … 4.47 | Painted steel | charcoal | V28 |
| Near housing | -0.27 … -0.02 | 5.57 … 6.56 | 4.02 … 4.38 | Painted steel | safety ochre | V62 |
| Near aspects | -0.27 … -0.27 | 5.61 … 6.55 | 4.05 … 4.35 | Plastic | carbon grey | V24 |
| ↳ Dull green lens (atlas) | -0.27 … -0.27 | 5.61 … 5.91 | 4.05 … 4.35 | Plastic | dull green | V43 |
| ↳ Dull amber lens (atlas) | -0.27 … -0.27 | 5.93 … 6.23 | 4.05 … 4.35 | Plastic | dull amber | V54 |
| ↳ Dull red lens (atlas) | -0.27 … -0.27 | 6.25 … 6.55 | 4.05 … 4.35 | Plastic | dull red | V36 |
| Near visors | -0.48 … -0.26 | 5.72 … 6.56 | 4.04 … 4.36 | Painted steel | charcoal | V28 |
| Near hanger | -0.05 … 0.05 | 6.58 … 6.74 | 4.16 … 4.25 | Galvanised steel | smoked zinc | V44 |

<details>
<summary>Changed members and cut geometry</summary>

| Member | Construction in metres |
|---|---|
| Tapered mast arm | 10 facets, rings normal to local Z. (X, Y, Z, Ø) (0.00, 6.28, 0.03, 0.34), (0.00, 6.54, 1.10, 0.31), (0.00, 6.68, 3.20, 0.26), (0.00, 6.72, 5.00, 0.22), (0.00, 6.14, 7.02, 0.17), (0.00, 5.09, 8.84, 0.13). Apply pose rotation to the section axes. |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 1.20 m | Mast arm +Z. Vehicle lenses and blade face −X, upstream of +X traffic. Pedestrian face reads from the opposing crossing. | At the far side of each controlled approach to a major junction. Centre the heads over their served lanes. Repeat per approach. | Keep the crosswalk, ramp landing, turning envelope and a nominal 5.50 m overhead lane envelope clear in the standing form. |

**Atlas treatment.** Lens rings and mounting bolts · charcoal V28. Street letters · chalk V84.

**Distance model.** Retain pole, long arm and two backplates. Bake each three-aspect face and its visors into a single head block.

<a id="piece-stop"></a>

## 03 · Stop sign

[Open measured plate](stop.png)

Regular octagon 0.76 m across flats. Centre at Y 2.51 m. Use a two-sided sheet or a 0.02 m folded silhouette proxy. White border, lettering and two fixing heads belong to the face artwork.

Use 0.22 m corner cuts on the 0.76 m square blank. Place one painted fixing on the top and bottom centreline, each 0.07 m from its nearest edge.

### Standing

Red sheeting has bleached to dusty pink. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.38 … 0.38 m, Y 0.00 … 2.89 m, Z -0.02 … 0.05 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Punched channel post | -0.03 … 0.03 | 0.00 … 2.76 | -0.02 … 0.02 | Galvanised steel | zinc grey | V60 |
| ↳ Channel perforations (atlas) | -0.03 … 0.03 | 0.00 … 2.76 | -0.02 … -0.02 | Galvanised steel | dark recess | V23 |
| Octagonal face | -0.38 … 0.38 | 2.13 … 2.89 | 0.03 … 0.05 | Aluminium | bleached stop red | V48 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Punched channel post | Folded 0.06 m wide × 0.04 m deep channel. Punched holes on nominal 0.03 m centres are atlas ink.<br>Fold a U in X/Z through (−0.03, +0.02), (−0.03, −0.02), (+0.03, −0.02), (+0.03, +0.02). Extrude the channel to the listed top Y. |
| Octagonal face | Extrude outline (-0.16, 2.13, 0.03), (0.16, 2.13, 0.03), (0.38, 2.35, 0.03), (0.38, 2.66, 0.03), (0.16, 2.89, 0.03), (-0.16, 2.89, 0.03), (-0.38, 2.66, 0.03), (-0.38, 2.35, 0.03) by (0.00, 0.00, 0.02). |

</details>

### Bent

The channel folds just above its socket. **Pose.** Above (0.00, 0.42, 0.00), rotate −35° about Z. The upper post and face move together.

**Assembly envelope.** X -0.03 … 1.60 m, Y 0.00 … 2.53 m, Z -0.02 … 0.05 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Straight stump | -0.03 … 0.03 | 0.00 … 0.42 | -0.02 … 0.02 | Galvanised steel | zinc grey | V60 |
| ↳ Channel perforations (atlas) | -0.03 … 0.03 | 0.00 … 0.42 | -0.02 … -0.02 | Galvanised steel | dark recess | V23 |
| Bent upper post | -0.02 … 1.37 | 0.40 … 2.35 | -0.02 … 0.02 | Galvanised steel | zinc grey | V60 |
| ↳ Channel perforations (atlas) | -0.02 … 1.37 | 0.40 … 2.35 | -0.02 … -0.02 | Galvanised steel | dark recess | V23 |
| Octagonal face | 0.79 … 1.60 | 1.73 … 2.53 | 0.03 … 0.05 | Aluminium | bleached stop red | V48 |

<details>
<summary>Changed members and cut geometry</summary>

| Member | Construction in metres |
|---|---|
| Straight stump | Folded 0.06 m wide × 0.04 m deep channel. Punched holes on nominal 0.03 m centres are atlas ink.<br>Use the upright U-channel section to the listed hinge height. |
| Bent upper post | Folded 0.06 m wide × 0.04 m deep channel. Punched holes on nominal 0.03 m centres are atlas ink.<br>Reuse the upper U-channel section and rotate around the hinge in the pose instruction. |
| Octagonal face | Extrude outline (0.85, 1.91, 0.03), (1.11, 1.73, 0.03), (1.42, 1.78, 0.03), (1.60, 2.04, 0.03), (1.54, 2.35, 0.03), (1.28, 2.53, 0.03), (0.97, 2.47, 0.03), (0.79, 2.22, 0.03) by (0.00, 0.00, 0.02). |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.75 m | Asset front +Z. At a junction yaw the entire sign to face the arriving lane. | One per stopped approach on the driver’s right, near the stop line. Repeat at each controlled corner. | Keep the ramp flare, side-road sight triangle and crosswalk approach clear. |

**Atlas treatment.** Border and STOP legend · chalk V84. Channel holes · shadow V23.

**Distance model.** Retain the eight-sided face, its faded word and the post bend.

<a id="piece-name"></a>

## 04 · Street-name blades

[Open measured plate](name.png)

Clamp two double-sided blades at 90°. Main pair reads Brineleaf St and Tidemoth Ln. Alternate pair reads Reedwake Dr and Siltwing Ct, using the same sizes. Use pale, weathered letters on grey-green.

Apply the legend to both sides before crossing the upper blade. Reserve 0.02 m around the lettering for the keyline and scoured metal edge.

### Standing

Two faded green blades mark the intersection. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.46 … 0.46 m, Y 0.00 … 3.15 m, Z -0.43 … 0.43 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Round post | -0.04 … 0.04 | 0.00 … 2.74 | -0.04 … 0.04 | Galvanised steel | zinc grey | V60 |
| Blade clamp | -0.04 … 0.04 | 2.70 … 2.97 | -0.04 … 0.04 | Galvanised steel | smoked zinc | V44 |
| Lower street blade | -0.46 … 0.46 | 2.73 … 2.93 | -0.01 … 0.01 | Aluminium | grey-green | V49 |
| Upper cross blade | -0.01 … 0.01 | 2.95 … 3.15 | -0.43 … 0.43 | Aluminium | grey-green | V49 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Round post | 8-sided tube Ø0.07 from (0.00, 0.00, 0.00) to (0.00, 2.74, 0.00). |
| Blade clamp | Box 0.08 × 0.07 × 0.08 at (0.00, 2.74, 0.00).<br>Box 0.07 × 0.06 × 0.07 at (0.00, 2.94, 0.00). |
| Lower street blade | Extrude outline (-0.44, 2.73, -0.01), (0.44, 2.73, -0.01), (0.46, 2.76, -0.01), (0.46, 2.91, -0.01), (0.44, 2.93, -0.01), (-0.44, 2.93, -0.01), (-0.46, 2.91, -0.01), (-0.46, 2.76, -0.01) by (0.00, 0.00, 0.02). |
| Upper cross blade | Extrude outline (-0.01, 2.95, 0.41), (-0.01, 2.95, -0.41), (-0.01, 2.98, -0.43), (-0.01, 3.13, -0.43), (-0.01, 3.15, -0.41), (-0.01, 3.15, 0.41), (-0.01, 3.13, 0.43), (-0.01, 2.98, 0.43) by (0.02, 0.00, 0.00). |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.80 m | Lower blade long axis X. Upper blade runs Z. Both read on two faces. | At signed intersections, usually two diagonally opposite corners. Align each blade along its named street. | Keep corner ramps, turning pedestrians and the view of traffic signs clear. |

**Atlas treatment.** Lettering and inset keyline · chalk V84. Clamp fixings · dark zinc V44.

**Distance model.** Keep the crossed blanks as double-sided planes at right angles.

<a id="piece-posts"></a>

## 05 · Route & speed signs

[Open measured plate](posts.png)

Two separate spawnable assets. Each owns its own (0.00, 0.00, 0.00) at its post. Set the panels with their bottom edges at 2.11 m. The speed face is 0.61 × 0.76 m, the hurricane route graphic 0.61 × 0.61 m. Sign skins are two-sided, with a maximum 0.02 m folded-edge proxy.

Use an independent mesh pivot for each post. Typical speed-mark ink occupies the central 0.45 m of the blank. The hurricane icon, disk, words and arrow share a single face patch.

The game posts six limits on this one panel and post, each a piece of its own with its own face: 25, 30, 35, 40, 45 and 55 mph (`speed25`, `speed30`, `speed35`, `speed40`, `speed45`, and `speed` for 55).

### Speed limit

A 35 mph speed panel on a punched channel. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.31 … 0.31 m, Y 0.00 … 2.87 m, Z -0.02 … 0.05 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Punched channel post | -0.03 … 0.03 | 0.00 … 2.75 | -0.02 … 0.02 | Galvanised steel | zinc grey | V60 |
| ↳ Channel perforations (atlas) | -0.03 … 0.03 | 0.00 … 2.75 | -0.02 … -0.02 | Galvanised steel | dark recess | V23 |
| Speed-limit panel | -0.31 … 0.31 | 2.11 … 2.87 | 0.03 … 0.05 | Aluminium | traffic white | V78 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Punched channel post | Folded 0.06 m wide × 0.04 m deep channel. Punched holes on nominal 0.03 m centres are atlas ink.<br>Fold a U in X/Z through (−0.03, +0.02), (−0.03, −0.02), (+0.03, −0.02), (+0.03, +0.02). Extrude the channel to the listed top Y. |
| Speed-limit panel | Extrude outline (-0.27, 2.11, 0.03), (0.27, 2.11, 0.03), (0.31, 2.15, 0.03), (0.31, 2.84, 0.03), (0.27, 2.87, 0.03), (-0.27, 2.87, 0.03), (-0.31, 2.84, 0.03), (-0.31, 2.15, 0.03) by (0.00, 0.00, 0.02). |

</details>

### Evacuation route

A hurricane marker carries a right arrow. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.31 … 0.31 m, Y 0.00 … 2.72 m, Z -0.02 … 0.05 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Punched channel post | -0.03 … 0.03 | 0.00 … 2.69 | -0.02 … 0.02 | Galvanised steel | zinc grey | V60 |
| ↳ Channel perforations (atlas) | -0.03 … 0.03 | 0.00 … 2.69 | -0.02 … -0.02 | Galvanised steel | dark recess | V23 |
| Evacuation marker | -0.31 … 0.31 | 2.11 … 2.72 | 0.03 … 0.05 | Aluminium | evacuation blue | V50 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Punched channel post | Folded 0.06 m wide × 0.04 m deep channel. Punched holes on nominal 0.03 m centres are atlas ink.<br>Fold a U in X/Z through (−0.03, +0.02), (−0.03, −0.02), (+0.03, −0.02), (+0.03, +0.02). Extrude the channel to the listed top Y. |
| Evacuation marker | Extrude outline (-0.27, 2.11, 0.03), (0.27, 2.11, 0.03), (0.31, 2.15, 0.03), (0.31, 2.69, 0.03), (0.27, 2.72, 0.03), (-0.27, 2.72, 0.03), (-0.31, 2.69, 0.03), (-0.31, 2.15, 0.03) by (0.00, 0.00, 0.02). |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.85 m each | The +Z face is the legend. Yaw it toward approaching drivers. Turn the arrow artwork to match the selected route. | Speed panels follow zone changes and major entrances, with illustrative repeat spacing 400.00–800.00 m. Put the route marker ahead of a designated decision point and again beyond the turn. | Keep both panels out of sight triangles, crosswalk landings and the open pedestrian path. |

**Atlas treatment.** Speed ink · charcoal V25. Route disk / arrow · chalk V84. Storm symbol · faded red V41.

**Distance model.** Use a single signed plane and a square shaft for each post.

<a id="piece-pole"></a>

## 06 · Utility pole

[Open measured plate](pole.png)

Total timber 12.00 m, buried 1.50 m. Diameter at grade 0.42 m, at top 0.24 m. Three attachment saddles at (−1.00, 10.26, 0.18), (0.00, 10.26, 0.18) and (1.00, 10.26, 0.18). The cutout upper jaw and transformer bushing indicate the short primary jumper endpoints. Draw ground lead and climbing holes into the shaft atlas.

Keep the buried length for the leaning pose. The climber-hole atlas spans Y 0.75–5.35 m. Insulator profiles have a lower skirt, a narrow groove and a wire saddle.

### Standing

Three vacant wire saddles survive on the crossarm. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -1.20 … 1.20 m, Y -1.50 … 10.50 m, Z -0.24 … 0.36 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Creosoted shaft | -0.23 … 0.23 | -1.50 … 10.50 | -0.23 … 0.23 | Creosoted wood | weathered umber | V41 |
| ↳ Climbing holes (atlas) | -0.06 … 0.06 | 0.75 … 5.35 | 0.17 … 0.21 | Creosoted wood | dark recess | V23 |
| Timber crossarm | -1.20 … 1.20 | 9.84 … 9.99 | 0.11 … 0.25 | Creosoted wood | weathered umber | V41 |
| Crossarm braces | -0.78 … 0.78 | 9.16 … 9.86 | 0.12 … 0.19 | Galvanised steel | smoked zinc | V44 |
| Three pin insulators | -1.09 … 1.09 | 9.98 … 10.27 | 0.09 … 0.27 | Glass | grey jade | V55 |
| Transformer tank | 0.09 … 0.69 | 7.44 … 8.21 | -0.24 … 0.36 | Painted steel | putty | V60 |
| Tank brackets | -0.02 … 0.38 | 7.54 … 8.07 | -0.01 … 0.12 | Galvanised steel | smoked zinc | V44 |
| Tank bushing | 0.36 … 0.50 | 8.21 … 8.42 | -0.01 … 0.13 | Glass | grey jade | V55 |
| Fuse cutout | -0.58 … -0.10 | 8.48 … 8.95 | 0.13 … 0.20 | Aluminium | oxidised silver | V66 |
| Cutout insulator | -0.49 … -0.29 | 8.52 … 8.90 | 0.09 … 0.24 | Glass | grey jade | V55 |
| Ground lead artwork | -0.15 … -0.05 | 0.00 … 10.40 | 0.08 … 0.19 | Creosoted wood | weathered umber | V41 |
| ↳ Ground lead and staples (atlas) | -0.15 … -0.05 | 0.00 … 10.40 | 0.08 … 0.19 | Creosoted wood | brown lead artwork | V28 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Creosoted shaft | 12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (-1.50, 0.45), (0.00, 0.42), (4.00, 0.36), (8.00, 0.29), (10.50, 0.24). |
| Timber crossarm | Box 2.40 × 0.15 × 0.14 at (0.00, 9.91, 0.18). |
| Crossarm braces | Bar 0.05 × 0.03 from (0.00, 9.18, 0.13) to (-0.76, 9.84, 0.18).<br>Bar 0.05 × 0.03 from (0.00, 9.18, 0.13) to (0.76, 9.84, 0.18). |
| Three pin insulators | Centres at X −1.00, 0.00 and 1.00 m, Z 0.18 m. Wire saddles at Y 10.26 m.<br>8 facets, centre (X, Z) = (-1.00, 0.18). Stations (Y, Ø) (9.98, 0.09), (10.08, 0.09), (10.09, 0.19), (10.13, 0.16), (10.14, 0.11), (10.16, 0.16), (10.20, 0.13), (10.21, 0.09), (10.27, 0.10).<br>8 facets, centre (X, Z) = (0.00, 0.18). Stations (Y, Ø) (9.98, 0.09), (10.08, 0.09), (10.09, 0.19), (10.13, 0.16), (10.14, 0.11), (10.16, 0.16), (10.20, 0.13), (10.21, 0.09), (10.27, 0.10).<br>8 facets, centre (X, Z) = (1.00, 0.18). Stations (Y, Ø) (9.98, 0.09), (10.08, 0.09), (10.09, 0.19), (10.13, 0.16), (10.14, 0.11), (10.16, 0.16), (10.20, 0.13), (10.21, 0.09), (10.27, 0.10). |
| Transformer tank | 12 facets, centre (X, Z) = (0.39, 0.06). Stations (Y, Ø) (7.44, 0.43), (7.49, 0.56), (8.14, 0.56), (8.17, 0.60), (8.21, 0.58). |
| Tank brackets | Box 0.39 × 0.08 × 0.13 at (0.18, 7.58, 0.06).<br>Box 0.39 × 0.08 × 0.13 at (0.18, 8.03, 0.06). |
| Tank bushing | 12 facets, centre (X, Z) = (0.43, 0.06). Stations (Y, Ø) (8.21, 0.11), (8.27, 0.08), (8.29, 0.14), (8.33, 0.08), (8.36, 0.12), (8.42, 0.06). |
| Fuse cutout | Bar 0.07 × 0.07 from (-0.10, 8.66, 0.16) to (-0.40, 8.69, 0.16).<br>8-sided tube Ø0.07 from (-0.42, 8.49, 0.16) to (-0.55, 8.94, 0.16). |
| Cutout insulator | 8-sided tube Ø0.10 from (-0.34, 8.53, 0.16) to (-0.44, 8.89, 0.16).<br>8-sided tube Ø0.15 to Ø0.12 from (-0.37, 8.62, 0.16) to (-0.37, 8.65, 0.16).<br>8-sided tube Ø0.15 to Ø0.12 from (-0.39, 8.71, 0.16) to (-0.40, 8.74, 0.16).<br>8-sided tube Ø0.15 to Ø0.12 from (-0.42, 8.80, 0.16) to (-0.42, 8.83, 0.16). |
| Ground lead artwork | Atlas stripe on the shaft, with two staple marks per 0.55 m repeat.<br>Follow the shaft taper from grade to Y 10.40 m, at −38° from the road-facing generator. Paint the lead and staples on the wood UVs. |

</details>

### Leaning

The timber and all its hardware lean together. **Pose.** +12° about Z at (0.00, 0.00, 0.00). Buried toe stays integral to the rotating shaft.

**Assembly envelope.** X -3.25 … 0.53 m, Y -1.51 … 10.30 m, Z -0.24 … 0.36 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Creosoted shaft | -2.30 … 0.53 | -1.51 … 10.30 | -0.23 … 0.23 | Creosoted wood | weathered umber | V41 |
| ↳ Climbing holes (atlas) | -1.17 … -0.10 | 0.72 … 5.25 | 0.17 … 0.21 | Creosoted wood | dark recess | V23 |
| Timber crossarm | -3.25 … -0.87 | 9.37 … 10.02 | 0.11 … 0.25 | Creosoted wood | weathered umber | V41 |
| Crossarm braces | -2.80 … -1.28 | 8.96 … 9.80 | 0.12 … 0.19 | Galvanised steel | smoked zinc | V44 |
| Three pin insulators | -3.17 … -1.03 | 9.54 … 10.26 | 0.09 … 0.27 | Glass | grey jade | V55 |
| Transformer tank | -1.61 … -0.90 | 7.31 … 8.17 | -0.24 … 0.36 | Painted steel | putty | V60 |
| Tank brackets | -1.69 … -1.20 | 7.37 … 7.97 | -0.01 … 0.12 | Galvanised steel | smoked zinc | V44 |
| Tank bushing | -1.38 … -1.23 | 8.11 … 8.33 | -0.01 … 0.13 | Glass | grey jade | V55 |
| Fuse cutout | -2.43 … -1.89 | 8.20 … 8.65 | 0.13 … 0.20 | Aluminium | oxidised silver | V66 |
| Cutout insulator | -2.32 … -2.06 | 8.25 … 8.63 | 0.09 … 0.24 | Glass | grey jade | V55 |
| Ground lead artwork | -2.26 … -0.10 | -0.03 … 10.16 | 0.08 … 0.19 | Creosoted wood | weathered umber | V41 |
| ↳ Ground lead and staples (atlas) | -2.26 … -0.10 | -0.03 … 10.16 | 0.08 … 0.19 | Creosoted wood | brown lead artwork | V28 |

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 1.20 m | Crossarm extends along X in the plate. For lines following the street, yaw the crossarm perpendicular to the wire run. | Distribution side of residential streets and older commercial collectors. Space at 30.00–50.00 m, shortening the span at corners. | Keep driveways, sight triangles, overhead tree canopy and a clear footway outside the fall envelope. |

**Atlas treatment.** Ground lead · oxide brown V28. Step holes · dark wood V23.

**Distance model.** Retain the timber taper, crossarm and tank. Bake the three crowns into the crossarm cutout.

<a id="piece-hydrant"></a>

## 07 · Fire hydrant

[Open measured plate](hydrant.png)

Bonnet profile (Y, radius) in m: (0.70, 0.15), (0.75, 0.14), (0.81, 0.12), (0.86, 0.07), (0.87, 0.05). Use a five-sided operating nut, two Ø0.15 m side nozzles and a Ø0.21 m front pumper. Cap wrench bosses are pentagons. Paint bonnet ribs, bolt heads and chain links.

The casting bears six painted bolt heads on a 0.31 m diameter circle at the bonnet joint. Keep the pumper clear of both side caps in silhouette. An eight-sided body, six-sided nozzle roots and open internal ends keep the main casting economical.

### Standing

Oxide rings the ground flange and cap shoulders. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.25 … 0.25 m, Y 0.00 … 0.91 m, Z -0.18 … 0.27 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Ground flange | -0.18 … 0.18 | 0.00 … 0.05 | -0.18 … 0.18 | Rust | iron oxide | V35 |
| Barrel and neck | -0.15 … 0.15 | 0.04 … 0.67 | -0.15 … 0.15 | Cast iron | faded scarlet | V41 |
| Bonnet flange | -0.17 … 0.17 | 0.65 … 0.72 | -0.17 … 0.17 | Cast iron | faded scarlet | V41 |
| ↳ Fixing head marks (atlas) | -0.17 … 0.17 | 0.70 … 0.70 | -0.15 … 0.15 | Rust | iron oxide | V35 |
| Ribbed bonnet | -0.15 … 0.15 | 0.70 … 0.87 | -0.15 … 0.15 | Cast iron | faded scarlet | V41 |
| Operating nut | -0.03 … 0.03 | 0.87 … 0.91 | -0.03 … 0.03 | Cast iron | graphite | V29 |
| Hose nozzles | -0.19 … 0.19 | 0.38 … 0.54 | -0.07 … 0.07 | Cast iron | faded scarlet | V41 |
| Hose caps | -0.25 … 0.25 | 0.37 … 0.55 | -0.09 … 0.09 | Cast iron | faded scarlet | V41 |
| Pumper nozzle | -0.11 … 0.11 | 0.29 … 0.51 | 0.07 … 0.20 | Cast iron | faded scarlet | V41 |
| Pumper cap | -0.12 … 0.12 | 0.28 … 0.52 | 0.19 … 0.27 | Cast iron | faded scarlet | V41 |
| Retainer chains | -0.23 … 0.23 | 0.24 … 0.46 | 0.06 … 0.21 | Galvanised steel | smoked zinc | V44 |
| ↳ Retainer link artwork (atlas) | -0.23 … 0.23 | 0.24 … 0.46 | 0.06 … 0.21 | Galvanised steel | smoked zinc | V44 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Ground flange | 8 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.00, 0.35), (0.04, 0.35), (0.05, 0.27). |
| Barrel and neck | 8 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.04, 0.25), (0.20, 0.25), (0.56, 0.27), (0.67, 0.29). |
| Bonnet flange | 8 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.65, 0.30), (0.69, 0.33), (0.72, 0.29). |
| Ribbed bonnet | 8 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.70, 0.29), (0.75, 0.29), (0.81, 0.24), (0.86, 0.15), (0.87, 0.10). |
| Operating nut | 5 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.87, 0.07), (0.91, 0.07). |
| Hose nozzles | 6-sided tube Ø0.15 from (-0.08, 0.46, 0.00) to (-0.19, 0.46, 0.00).<br>6-sided tube Ø0.15 from (0.08, 0.46, 0.00) to (0.19, 0.46, 0.00). |
| Hose caps | 8-sided tube Ø0.17 to Ø0.15 from (-0.18, 0.46, 0.00) to (-0.23, 0.46, 0.00).<br>5-sided tube Ø0.07 from (-0.22, 0.46, 0.00) to (-0.25, 0.46, 0.00).<br>8-sided tube Ø0.17 to Ø0.15 from (0.18, 0.46, 0.00) to (0.23, 0.46, 0.00).<br>5-sided tube Ø0.07 from (0.22, 0.46, 0.00) to (0.25, 0.46, 0.00). |
| Pumper nozzle | 8-sided tube Ø0.20 to Ø0.21 from (0.00, 0.40, 0.07) to (0.00, 0.40, 0.20). |
| Pumper cap | 8-sided tube Ø0.24 to Ø0.21 from (0.00, 0.40, 0.19) to (0.00, 0.40, 0.24).<br>5-sided tube Ø0.09 from (0.00, 0.40, 0.24) to (0.00, 0.40, 0.27). |
| Retainer chains | Two flank alpha patches and a shorter pumper patch carry the open-link chain mask.<br>Three alpha skins from the caps to the casting. Side card corners on each side are (±0.23, 0.28, 0.06), (±0.08, 0.28, 0.14), (±0.08, 0.46, 0.14), (±0.23, 0.46, 0.06). Pumper run uses (0.14, 0.24, 0.08), (0.06, 0.24, 0.21), (0.06, 0.41, 0.21), (0.14, 0.41, 0.08). |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.65 m | Pumper outlet faces +Z toward the kerb. Hose nozzles face ±X. | Put near intersections and along the water-main side of residential or commercial blocks, e.g. 90.00–150.00 m intervals. | Leave room around all caps and above the operating nut, with a clear approach from the road. |

**Atlas treatment.** Bonnet ribs · red iron V41. Flange studs · oxide V35. Three chain runs · dark zinc V44.

**Distance model.** Keep the barrel and bonnet silhouette, a large pumper cap and two side cap silhouettes.

<a id="piece-bench"></a>

## 08 · Slatted bench

[Open measured plate](bench.png)

Nominal width 1.90 m, seat top 0.46 m. Bend legs from square 0.06 m tube, centred at X ±0.77 m. Keep the silhouette open through the slats. Paint worn edges, seam rust, shoe holes and polishing on the front lip.

The surviving back slats share the rake of the uprights. Cut missing slats out of the silhouette, including their end grain and fastener decals.

### Whole

Continuous slats bridge two bent-steel supports. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.95 … 0.95 m, Y 0.00 … 0.88 m, Z -0.30 … 0.30 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Anchor shoes | -0.82 … 0.82 | 0.00 … 0.04 | -0.30 … 0.30 | Rust | iron oxide | V35 |
| Bent steel legs | -0.80 … 0.80 | 0.03 … 0.45 | -0.27 … 0.27 | Painted steel | eucalyptus | V41 |
| Back uprights | -0.79 … 0.79 | 0.40 … 0.87 | -0.29 … -0.12 | Painted steel | eucalyptus | V41 |
| Seat slats | -0.95 … 0.95 | 0.43 … 0.46 | -0.20 … 0.26 | Painted steel | eucalyptus | V41 |
| Back slats | -0.95 … 0.95 | 0.52 … 0.88 | -0.30 … -0.17 | Painted steel | eucalyptus | V41 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Anchor shoes | Box 0.10 × 0.04 × 0.11 at (-0.77, 0.02, -0.25).<br>Box 0.10 × 0.04 × 0.11 at (-0.77, 0.02, 0.25).<br>Box 0.10 × 0.04 × 0.11 at (0.77, 0.02, -0.25).<br>Box 0.10 × 0.04 × 0.11 at (0.77, 0.02, 0.25). |
| Bent steel legs | Bar 0.06 × 0.06 from (-0.77, 0.04, -0.25) to (-0.77, 0.41, -0.14).<br>Bar 0.06 × 0.06 from (-0.77, 0.41, -0.14) to (-0.77, 0.43, 0.19).<br>Bar 0.06 × 0.06 from (-0.77, 0.43, 0.19) to (-0.77, 0.04, 0.25).<br>Bar 0.06 × 0.06 from (0.77, 0.04, -0.25) to (0.77, 0.41, -0.14).<br>Bar 0.06 × 0.06 from (0.77, 0.41, -0.14) to (0.77, 0.43, 0.19).<br>Bar 0.06 × 0.06 from (0.77, 0.43, 0.19) to (0.77, 0.04, 0.25). |
| Back uprights | Bar 0.04 × 0.05 from (-0.77, 0.41, -0.14) to (-0.77, 0.87, -0.27).<br>Bar 0.04 × 0.05 from (0.77, 0.41, -0.14) to (0.77, 0.87, -0.27). |
| Seat slats | Full array of six 1.90 × 0.03 × 0.07 m slats on 0.08 m pitch from Z −0.17 m. The broken form retains four.<br>Box 1.90 × 0.03 × 0.07 at (0.00, 0.44, -0.17).<br>Box 1.90 × 0.03 × 0.07 at (0.00, 0.44, -0.09).<br>Box 1.90 × 0.03 × 0.07 at (0.00, 0.44, -0.01).<br>Box 1.90 × 0.03 × 0.07 at (0.00, 0.44, 0.07).<br>Box 1.90 × 0.03 × 0.07 at (0.00, 0.44, 0.15).<br>Box 1.90 × 0.03 × 0.07 at (0.00, 0.44, 0.23). |
| Back slats | Full array of four 1.90 × 0.07 × 0.03 m slats at 0.09 m vertical pitch, back raked 15°. The broken form retains two.<br>Box 1.90 × 0.07 × 0.03 at (0.00, 0.56, -0.20). Positive half-axis tips (0.95, 0.56, -0.20), (0.00, 0.60, -0.21), (0.00, 0.57, -0.18).<br>Box 1.90 × 0.07 × 0.03 at (0.00, 0.65, -0.22). Positive half-axis tips (0.95, 0.65, -0.22), (0.00, 0.69, -0.23), (0.00, 0.66, -0.21).<br>Box 1.90 × 0.07 × 0.03 at (0.00, 0.75, -0.25). Positive half-axis tips (0.95, 0.75, -0.25), (0.00, 0.78, -0.26), (0.00, 0.75, -0.23).<br>Box 1.90 × 0.07 × 0.03 at (0.00, 0.84, -0.27). Positive half-axis tips (0.95, 0.84, -0.27), (0.00, 0.87, -0.28), (0.00, 0.84, -0.26). |

</details>

### Broken

The right support folds. Four slats are missing. **Pose.** Seat, back and uprights rotate −11° about Z at (−0.77, 0.43, 0.00). Right rear leg inclines 78° from up about its shoe at (0.77, 0.04, −0.23), meeting the kink at (0.89, 0.13, 0.16). Seat slats 2 and 5 and back slats 2 and 4 are missing, counted rear-to-front and bottom-up.

**Assembly envelope.** X -0.95 … 0.99 m, Y 0.00 … 0.87 m, Z -0.30 … 0.30 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Anchor shoes | -0.82 … 0.82 | 0.00 … 0.04 | -0.30 … 0.30 | Rust | iron oxide | V35 |
| Bent steel legs | -0.80 … 0.97 | 0.00 … 0.45 | -0.27 … 0.29 | Painted steel | eucalyptus | V41 |
| Back uprights | -0.80 … 0.85 | 0.11 … 0.87 | -0.29 … -0.12 | Painted steel | eucalyptus | V41 |
| Seat slats | -0.95 … 0.92 | 0.10 … 0.49 | -0.20 … 0.26 | Painted steel | eucalyptus | V41 |
| Back slats | -0.93 … 0.99 | 0.19 … 0.81 | -0.27 … -0.17 | Painted steel | eucalyptus | V41 |

<details>
<summary>Changed members and cut geometry</summary>

| Member | Construction in metres |
|---|---|
| Bent steel legs | Bar 0.06 × 0.06 from (-0.77, 0.04, -0.25) to (-0.77, 0.41, -0.14).<br>Bar 0.06 × 0.06 from (-0.77, 0.41, -0.14) to (-0.77, 0.43, 0.19).<br>Bar 0.06 × 0.06 from (-0.77, 0.43, 0.19) to (-0.77, 0.04, 0.25).<br>Bar 0.06 × 0.06 from (0.77, 0.04, -0.23) to (0.89, 0.13, 0.16).<br>Bar 0.06 × 0.06 from (0.89, 0.13, 0.16) to (0.94, 0.03, 0.27). |
| Back uprights | Bar 0.04 × 0.05 from (-0.77, 0.41, -0.14) to (-0.69, 0.86, -0.27).<br>Bar 0.04 × 0.05 from (0.74, 0.12, -0.14) to (0.82, 0.56, -0.27). |
| Seat slats | Full array of six 1.90 × 0.03 × 0.07 m slats on 0.08 m pitch from Z −0.17 m. The broken form retains four.<br>Box 1.90 × 0.03 × 0.07 at (-0.01, 0.30, -0.17). Positive half-axis tips (0.92, 0.11, -0.17), (-0.01, 0.31, -0.17), (-0.01, 0.30, -0.14).<br>Box 1.90 × 0.03 × 0.07 at (-0.01, 0.30, -0.01). Positive half-axis tips (0.92, 0.11, -0.01), (-0.01, 0.31, -0.01), (-0.01, 0.30, 0.02).<br>Box 1.90 × 0.03 × 0.07 at (-0.01, 0.30, 0.07). Positive half-axis tips (0.92, 0.11, 0.07), (-0.01, 0.31, 0.07), (-0.01, 0.30, 0.10).<br>Box 1.90 × 0.03 × 0.07 at (-0.01, 0.30, 0.23). Positive half-axis tips (0.92, 0.11, 0.23), (-0.01, 0.31, 0.23), (-0.01, 0.30, 0.26). |
| Back slats | Full array of four 1.90 × 0.07 × 0.03 m slats at 0.09 m vertical pitch, back raked 15°. The broken form retains two.<br>Box 1.90 × 0.07 × 0.03 at (0.01, 0.41, -0.20). Positive half-axis tips (0.94, 0.23, -0.20), (0.02, 0.45, -0.21), (0.01, 0.42, -0.18).<br>Box 1.90 × 0.07 × 0.03 at (0.05, 0.59, -0.25). Positive half-axis tips (0.98, 0.41, -0.25), (0.05, 0.63, -0.26), (0.05, 0.60, -0.23). |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 1.10 m | Seated occupants face +Z. Slats run along the kerb. | At bus stops and park edges. Use one per waiting area or 12.00–25.00 m between seats along a promenade. | Keep the path behind the back and the boarding area ahead of the seat open. |

**Atlas treatment.** Weld toes and fixing heads · oxide V35. Rubbed front lip · exposed zinc V60.

**Distance model.** Use alpha slat gaps on seat and back planes and keep the two supports. Lower the broken end physically.

<a id="piece-bin"></a>

## 09 · Litter bin

[Open measured plate](bin.png)

Twelve-sided liner, twenty-four 0.05 m battens, Ø0.56 m lid with a Ø0.31 m centre opening. Model the annular slope of the lid. The body is cylindrical and hollow above the liner.

The hoops stand proud of the slate-green slats. The liner has a dark top below the annular opening, creating a deep, unlit mouth.

### Standing

A dark liner shows through the green steel slats. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.28 … 0.28 m, Y 0.00 … 0.87 m, Z -0.28 … 0.28 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Base ring | -0.26 … 0.26 | 0.00 … 0.10 | -0.26 … 0.26 | Galvanised steel | smoked zinc | V44 |
| Inner liner | -0.25 … 0.25 | 0.07 … 0.76 | -0.25 … 0.25 | Painted steel | charcoal | V28 |
| Vertical slats | -0.27 … 0.27 | 0.08 … 0.79 | -0.27 … 0.27 | Painted steel | eucalyptus | V41 |
| Retaining hoops | -0.27 … 0.27 | 0.11 … 0.75 | -0.27 … 0.27 | Galvanised steel | smoked zinc | V44 |
| Rolled lid and lip | -0.28 … 0.28 | 0.77 … 0.87 | -0.28 … 0.28 | Galvanised steel | smoked zinc | V44 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Base ring | 12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.00, 0.45), (0.04, 0.45), (0.06, 0.51), (0.10, 0.51). |
| Inner liner | 12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.07, 0.44), (0.76, 0.50). |
| Vertical slats | Twenty-four slats on 15° centres. Each is 0.05 m wide and 0.03 m deep.<br>Box 0.05 × 0.72 × 0.03 at (0.00, 0.44, 0.25).<br>Box 0.05 × 0.72 × 0.03 at (0.07, 0.44, 0.24). Positive half-axis tips (0.09, 0.44, 0.24), (0.07, 0.79, 0.24), (0.07, 0.44, 0.26).<br>Box 0.05 × 0.72 × 0.03 at (0.13, 0.44, 0.22). Positive half-axis tips (0.15, 0.44, 0.21), (0.13, 0.79, 0.22), (0.13, 0.44, 0.23).<br>Box 0.05 × 0.72 × 0.03 at (0.18, 0.44, 0.18). Positive half-axis tips (0.20, 0.44, 0.16), (0.18, 0.79, 0.18), (0.19, 0.44, 0.19).<br>Box 0.05 × 0.72 × 0.03 at (0.22, 0.44, 0.13). Positive half-axis tips (0.23, 0.44, 0.11), (0.22, 0.79, 0.13), (0.23, 0.44, 0.13).<br>Box 0.05 × 0.72 × 0.03 at (0.24, 0.44, 0.07). Positive half-axis tips (0.25, 0.44, 0.04), (0.24, 0.79, 0.07), (0.26, 0.44, 0.07).<br>Box 0.05 × 0.72 × 0.03 at (0.25, 0.44, 0.00). Positive half-axis tips (0.25, 0.44, -0.02), (0.25, 0.79, 0.00), (0.27, 0.44, 0.00).<br>Box 0.05 × 0.72 × 0.03 at (0.24, 0.44, -0.07). Positive half-axis tips (0.24, 0.44, -0.09), (0.24, 0.79, -0.07), (0.26, 0.44, -0.07).<br>Box 0.05 × 0.72 × 0.03 at (0.22, 0.44, -0.13). Positive half-axis tips (0.21, 0.44, -0.15), (0.22, 0.79, -0.13), (0.23, 0.44, -0.13).<br>Box 0.05 × 0.72 × 0.03 at (0.18, 0.44, -0.18). Positive half-axis tips (0.16, 0.44, -0.20), (0.18, 0.79, -0.18), (0.19, 0.44, -0.19).<br>Box 0.05 × 0.72 × 0.03 at (0.13, 0.44, -0.22). Positive half-axis tips (0.11, 0.44, -0.23), (0.13, 0.79, -0.22), (0.13, 0.44, -0.23).<br>Box 0.05 × 0.72 × 0.03 at (0.07, 0.44, -0.24). Positive half-axis tips (0.04, 0.44, -0.25), (0.07, 0.79, -0.24), (0.07, 0.44, -0.26).<br>Box 0.05 × 0.72 × 0.03 at (0.00, 0.44, -0.25). Positive half-axis tips (-0.02, 0.44, -0.25), (0.00, 0.79, -0.25), (0.00, 0.44, -0.27).<br>Box 0.05 × 0.72 × 0.03 at (-0.07, 0.44, -0.24). Positive half-axis tips (-0.09, 0.44, -0.24), (-0.07, 0.79, -0.24), (-0.07, 0.44, -0.26).<br>Box 0.05 × 0.72 × 0.03 at (-0.13, 0.44, -0.22). Positive half-axis tips (-0.15, 0.44, -0.21), (-0.13, 0.79, -0.22), (-0.13, 0.44, -0.23).<br>Box 0.05 × 0.72 × 0.03 at (-0.18, 0.44, -0.18). Positive half-axis tips (-0.20, 0.44, -0.16), (-0.18, 0.79, -0.18), (-0.19, 0.44, -0.19).<br>Box 0.05 × 0.72 × 0.03 at (-0.22, 0.44, -0.13). Positive half-axis tips (-0.23, 0.44, -0.11), (-0.22, 0.79, -0.13), (-0.23, 0.44, -0.13).<br>Box 0.05 × 0.72 × 0.03 at (-0.24, 0.44, -0.07). Positive half-axis tips (-0.25, 0.44, -0.04), (-0.24, 0.79, -0.07), (-0.26, 0.44, -0.07).<br>Box 0.05 × 0.72 × 0.03 at (-0.25, 0.44, 0.00). Positive half-axis tips (-0.25, 0.44, 0.02), (-0.25, 0.79, 0.00), (-0.27, 0.44, 0.00).<br>Box 0.05 × 0.72 × 0.03 at (-0.24, 0.44, 0.07). Positive half-axis tips (-0.24, 0.44, 0.09), (-0.24, 0.79, 0.07), (-0.26, 0.44, 0.07).<br>Box 0.05 × 0.72 × 0.03 at (-0.22, 0.44, 0.13). Positive half-axis tips (-0.21, 0.44, 0.15), (-0.22, 0.79, 0.13), (-0.23, 0.44, 0.13).<br>Box 0.05 × 0.72 × 0.03 at (-0.18, 0.44, 0.18). Positive half-axis tips (-0.16, 0.44, 0.20), (-0.18, 0.79, 0.18), (-0.19, 0.44, 0.19).<br>Box 0.05 × 0.72 × 0.03 at (-0.13, 0.44, 0.22). Positive half-axis tips (-0.11, 0.44, 0.23), (-0.13, 0.79, 0.22), (-0.13, 0.44, 0.23).<br>Box 0.05 × 0.72 × 0.03 at (-0.07, 0.44, 0.24). Positive half-axis tips (-0.04, 0.44, 0.25), (-0.07, 0.79, 0.24), (-0.07, 0.44, 0.26). |
| Retaining hoops | 12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.11, 0.53), (0.14, 0.53).<br>12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.71, 0.53), (0.75, 0.53). |
| Rolled lid and lip | Revolve six (Y, radius) stations around Y with twelve facets. Use (0.77, 0.26), (0.79, 0.28), (0.83, 0.27), (0.87, 0.22), (0.87, 0.16), (0.84, 0.15). Leave the inner aperture open. |

</details>

### Tipped

The rolled rim rests against the pavement. **Pose.** Rotate −90° about Z at (0.00, 0.00, 0.00), then translate (0.00, +0.28, 0.00).

**Assembly envelope.** X 0.00 … 0.87 m, Y 0.00 … 0.56 m, Z -0.28 … 0.28 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Base ring | 0.00 … 0.10 | 0.02 … 0.53 | -0.26 … 0.26 | Galvanised steel | smoked zinc | V44 |
| Inner liner | 0.07 … 0.76 | 0.03 … 0.53 | -0.25 … 0.25 | Painted steel | charcoal | V28 |
| Vertical slats | 0.08 … 0.79 | 0.01 … 0.55 | -0.27 … 0.27 | Painted steel | eucalyptus | V41 |
| Retaining hoops | 0.11 … 0.75 | 0.01 … 0.55 | -0.27 … 0.27 | Galvanised steel | smoked zinc | V44 |
| Rolled lid and lip | 0.77 … 0.87 | 0.00 … 0.56 | -0.28 … 0.28 | Galvanised steel | smoked zinc | V44 |

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.85 m | The opening points up. Cylindrical body may take any yaw. | At stop exits, corners, parks and pedestrian routes. One bin per waiting area, or 30.00–60.00 m apart on active streets. | Keep boarding doors, kerb ramps and litter collection access open. |

**Atlas treatment.** Slat ends and hoop joints · oxide V35. Exposed edges · zinc V60.

**Distance model.** Bake the slats and hoops into the cylindrical shell. Keep the projecting lid rim and dark opening.

<a id="piece-shelter"></a>

## 10 · Bus shelter

[Open measured plate](shelter.png)

Canopy 4.00 × 1.56 m at 2.53 m high. Five square 0.08 m posts at X −1.84, 0.00 and +1.84 m on Z −0.62 m, plus the two outer posts at Z +0.62 m. Advertising case on +X end. Main origin is centre of the shelter footprint, separate flag socket at (+2.48, 0.00, +0.15).

The steel posts enclose a nominal 3.68 × 1.24 m centre grid. Jagged glass rests in the sill channels. Separate left-end and rear cutout faces avoid overlapping transparent faces at the corner.

### Whole

Glass survives in the lower channels. The bench stays fixed. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -2.00 … 2.65 m, Y 0.00 … 2.73 m, Z -0.78 … 0.80 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Post shoes | -1.92 … 1.92 | 0.00 … 0.06 | -0.70 … 0.70 | Rust | iron oxide | V35 |
| Shelter posts | -1.88 … 1.88 | 0.00 … 2.39 | -0.66 … 0.66 | Galvanised steel | smoked zinc | V44 |
| Folded canopy | -2.00 … 2.00 | 2.36 … 2.53 | -0.78 … 0.78 | Painted steel | putty | V60 |
| Roof fascia | -2.00 … 2.00 | 2.39 … 2.52 | 0.77 … 0.80 | Painted steel | eucalyptus | V41 |
| Glazing rails | -1.87 … 1.87 | 0.23 … 2.24 | -0.65 … 0.62 | Galvanised steel | smoked zinc | V44 |
| Surviving glazing | -1.84 … 1.80 | 0.27 … 1.72 | -0.62 … 0.58 | Glass | bottle green | V64 |
| Shelter bench | -1.21 … 1.21 | 0.42 … 0.50 | -0.42 … -0.06 | Painted steel | eucalyptus | V41 |
| Bench brackets | -0.88 … 0.88 | 0.05 … 0.45 | -0.61 … -0.12 | Galvanised steel | smoked zinc | V44 |
| Advertising case | 1.77 … 1.91 | 0.26 … 2.20 | -0.56 … 0.56 | Galvanised steel | smoked zinc | V44 |
| Poster skin | 1.75 … 1.93 | 0.35 … 2.12 | -0.49 … 0.49 | Plastic | faded seafoam | V71 |
| Bus-stop post | 2.45 … 2.51 | 0.00 … 2.68 | 0.12 … 0.18 | Galvanised steel | zinc grey | V60 |
| Stop flag | 2.32 … 2.65 | 2.26 … 2.73 | 0.19 … 0.21 | Aluminium | grey-green | V49 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Post shoes | Box 0.16 × 0.06 × 0.16 at (-1.84, 0.03, -0.62).<br>Box 0.16 × 0.06 × 0.16 at (-1.84, 0.03, 0.62).<br>Box 0.16 × 0.06 × 0.16 at (0.00, 0.03, -0.62).<br>Box 0.16 × 0.06 × 0.16 at (1.84, 0.03, -0.62).<br>Box 0.16 × 0.06 × 0.16 at (1.84, 0.03, 0.62). |
| Shelter posts | Box 0.08 × 2.39 × 0.08 at (-1.84, 1.20, -0.62).<br>Box 0.08 × 2.39 × 0.08 at (-1.84, 1.20, 0.62).<br>Box 0.08 × 2.39 × 0.08 at (0.00, 1.20, -0.62).<br>Box 0.08 × 2.39 × 0.08 at (1.84, 1.20, -0.62).<br>Box 0.08 × 2.39 × 0.08 at (1.84, 1.20, 0.62). |
| Folded canopy | Four-metre roof with folded front fascia. Rear gutter falls to Y 2.38 m.<br>Extrude outline (-2.00, 2.36, -0.78), (-2.00, 2.44, -0.78), (-2.00, 2.53, 0.67), (-2.00, 2.53, 0.78), (-2.00, 2.40, 0.78) by (4.00, 0.00, 0.00). |
| Roof fascia | Box 4.00 × 0.13 × 0.03 at (0.00, 2.46, 0.79). |
| Glazing rails | Box 3.68 × 0.05 × 0.05 at (0.00, 0.25, -0.62).<br>Box 0.05 × 0.05 × 1.24 at (-1.84, 0.25, 0.00).<br>Box 0.05 × 0.05 × 1.24 at (1.84, 0.25, 0.00).<br>Box 3.68 × 0.05 × 0.05 at (0.00, 2.22, -0.62).<br>Box 0.05 × 0.05 × 1.24 at (-1.84, 2.22, 0.00).<br>Box 0.05 × 0.05 × 1.24 at (1.84, 2.22, 0.00). |
| Surviving glazing | Single alpha planes. Keep broken boundaries in the mesh and fine spider fractures in the atlas.<br>Panel (-1.80, 0.27, -0.62), (-1.45, 0.27, -0.62), (-1.45, 0.86, -0.62), (-1.80, 1.72, -0.62).<br>Panel (-1.45, 0.27, -0.62), (-1.00, 0.27, -0.62), (-1.00, 1.13, -0.62), (-1.45, 0.86, -0.62).<br>Panel (-1.00, 0.27, -0.62), (-0.78, 0.27, -0.62), (-0.78, 0.63, -0.62), (-1.00, 1.13, -0.62).<br>Panel (-0.78, 0.27, -0.62), (-0.39, 0.27, -0.62), (-0.39, 0.83, -0.62), (-0.78, 0.63, -0.62).<br>Panel (-0.39, 0.27, -0.62), (-0.04, 0.27, -0.62), (-0.04, 0.59, -0.62), (-0.39, 0.83, -0.62).<br>Panel (0.04, 0.27, -0.62), (0.45, 0.27, -0.62), (0.45, 0.74, -0.62), (0.04, 0.53, -0.62).<br>Panel (0.45, 0.27, -0.62), (0.72, 0.27, -0.62), (0.72, 0.46, -0.62), (0.45, 0.74, -0.62).<br>Panel (0.72, 0.27, -0.62), (1.00, 0.27, -0.62), (1.00, 0.64, -0.62), (0.72, 0.46, -0.62).<br>Panel (1.00, 0.27, -0.62), (1.42, 0.27, -0.62), (1.42, 0.84, -0.62), (1.00, 0.64, -0.62).<br>Panel (1.42, 0.27, -0.62), (1.80, 0.27, -0.62), (1.80, 1.44, -0.62), (1.42, 0.84, -0.62).<br>Panel (-1.84, 0.27, -0.58), (-1.84, 0.27, -0.32), (-1.84, 1.07, -0.32), (-1.84, 1.52, -0.58).<br>Panel (-1.84, 0.27, -0.32), (-1.84, 0.27, 0.05), (-1.84, 1.31, 0.05), (-1.84, 1.07, -0.32).<br>Panel (-1.84, 0.27, 0.05), (-1.84, 0.27, 0.31), (-1.84, 0.58, 0.31), (-1.84, 1.31, 0.05).<br>Panel (-1.84, 0.27, 0.31), (-1.84, 0.27, 0.58), (-1.84, 0.82, 0.58), (-1.84, 0.58, 0.31). |
| Shelter bench | Box 2.42 × 0.08 × 0.36 at (0.00, 0.46, -0.24). |
| Bench brackets | Bar 0.06 × 0.06 from (-0.85, 0.27, -0.59) to (-0.85, 0.43, -0.13).<br>Bar 0.06 × 0.06 from (-0.85, 0.07, -0.59) to (-0.85, 0.43, -0.27).<br>Bar 0.06 × 0.06 from (0.85, 0.27, -0.59) to (0.85, 0.43, -0.13).<br>Bar 0.06 × 0.06 from (0.85, 0.07, -0.59) to (0.85, 0.43, -0.27). |
| Advertising case | Box 0.14 × 1.94 × 1.11 at (1.84, 1.23, 0.00). |
| Poster skin | Box 0.98 × 1.77 × 0.02 at (1.76, 1.23, 0.00). Positive half-axis tips (1.76, 1.23, 0.49), (1.76, 2.12, 0.00), (1.75, 1.23, 0.00).<br>Box 0.98 × 1.77 × 0.02 at (1.92, 1.23, 0.00). Positive half-axis tips (1.92, 1.23, -0.49), (1.92, 2.12, 0.00), (1.93, 1.23, 0.00). |
| Bus-stop post | 8-sided tube Ø0.07 from (2.48, 0.00, 0.15) to (2.48, 2.68, 0.15). |
| Stop flag | Extrude outline (2.35, 2.26, 0.19), (2.61, 2.26, 0.19), (2.65, 2.29, 0.19), (2.65, 2.69, 0.19), (2.61, 2.73, 0.19), (2.35, 2.73, 0.19), (2.32, 2.69, 0.19), (2.32, 2.29, 0.19) by (0.00, 0.00, 0.02). |

</details>

### Wrecked

The canopy drops at the right end. The bench lies out front. **Pose.** Canopy −25° about Z at (−1.84, 2.39, 0.00). Sheared uprights end at (X, Y) (−1.84, 2.39), (−0.17, 1.61), (1.50, 0.83) m. They rake 0°, +6° and +23° about Z at their original foot centres. Bench +82° about X at (0.00, 0.46, −0.24), then displaced (−0.20, −0.27, +1.30). Glazing, case and rails have fallen away.

**Assembly envelope.** X -2.00 … 2.65 m, Y 0.00 … 2.73 m, Z -0.78 … 1.12 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Post shoes | -1.92 … 1.92 | 0.00 … 0.06 | -0.70 … 0.70 | Rust | iron oxide | V35 |
| Shelter posts | -1.88 … 1.87 | 0.02 … 2.39 | -0.66 … 0.66 | Galvanised steel | smoked zinc | V44 |
| Folded canopy | -2.00 … 1.70 | 0.74 … 2.58 | -0.78 … 0.78 | Painted steel | putty | V60 |
| Roof fascia | -1.98 … 1.69 | 0.77 … 2.57 | 0.77 … 0.80 | Painted steel | eucalyptus | V41 |
| Shelter bench | -1.41 … 1.01 | 0.00 … 0.37 | 1.00 … 1.12 | Painted steel | eucalyptus | V41 |
| Bus-stop post | 2.45 … 2.51 | 0.00 … 2.68 | 0.12 … 0.18 | Galvanised steel | zinc grey | V60 |
| Stop flag | 2.32 … 2.65 | 2.26 … 2.73 | 0.19 … 0.21 | Aluminium | grey-green | V49 |

<details>
<summary>Changed members and cut geometry</summary>

| Member | Construction in metres |
|---|---|
| Shelter posts | Bar 0.08 × 0.08 from (-1.84, 0.03, -0.62) to (-1.84, 2.39, -0.62).<br>Bar 0.08 × 0.08 from (-1.84, 0.03, 0.62) to (-1.84, 2.39, 0.62).<br>Bar 0.08 × 0.08 from (0.00, 0.03, -0.62) to (-0.17, 1.61, -0.62).<br>Bar 0.08 × 0.08 from (1.84, 0.03, -0.62) to (1.50, 0.83, -0.62).<br>Bar 0.08 × 0.08 from (1.84, 0.03, 0.62) to (1.50, 0.83, 0.62). |
| Folded canopy | Four-metre roof with folded front fascia. Rear gutter falls to Y 2.38 m.<br>Extrude outline (-2.00, 2.43, -0.78), (-1.96, 2.50, -0.78), (-1.93, 2.58, 0.67), (-1.93, 2.58, 0.78), (-1.98, 2.47, 0.78) by (3.63, -1.69, 0.00). |
| Roof fascia | Box 4.00 × 0.13 × 0.03 at (-0.14, 1.67, 0.79). Positive half-axis tips (1.67, 0.83, 0.79), (-0.12, 1.73, 0.79), (-0.14, 1.67, 0.80). |
| Shelter bench | Box 2.42 × 0.08 × 0.36 at (-0.20, 0.18, 1.06). Positive half-axis tips (1.01, 0.18, 1.06), (-0.20, 0.19, 1.10), (-0.20, 0.01, 1.09). |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 2.10 m to shelter centre | Open boarding face +Z, long axis parallel to kerb. Flag on +X end. | At signed bus stops on transit corridors, ideally beyond the intersection. Illustrative stop spacing 250.00–450.00 m. | Keep the boarding pad, accessible approach, doorway paths and rear through-route open. Place the bench clear of the boarding doorway. |

**Atlas treatment.** Poster ink · grey-green V48. Shoe nuts and gutter seams · oxide V35.

**Distance model.** Keep the roof, corner posts and opaque ad panel, with the surviving glass on masked planes.

<a id="piece-mailbox"></a>

## 11 · Collection mailbox

[Open measured plate](mailbox.png)

Vault 0.61 m wide × 0.54 m deep, underside at 0.30 m. Extrude the arched hood along X, crown at 1.27 m. Mouth at Y 1.04 m, grip projects to Z 0.37 m. The only lettering is MAIL.

Put the pull-down hinge line at the bottom of the chute and the wide grip above it. Print the access seam below and leave the large side cheeks plain.

### Standing

The curved hood shelters a stiff pull-down chute. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.31 … 0.31 m, Y 0.00 … 1.27 m, Z -0.27 … 0.37 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Foot pads | -0.31 … 0.31 | 0.00 … 0.04 | -0.27 … 0.27 | Rust | iron oxide | V35 |
| Splayed legs | -0.30 … 0.30 | 0.03 … 0.33 | -0.26 … 0.26 | Painted steel | postal slate | V42 |
| Collection vault | -0.31 … 0.31 | 0.30 … 0.97 | -0.27 … 0.27 | Painted steel | postal slate | V42 |
| ↳ Vault access seam (atlas) | -0.28 … 0.28 | 0.39 … 0.89 | 0.27 … 0.27 | Painted steel | dark postal slate | V25 |
| Rolled hood | -0.31 … 0.31 | 0.96 … 1.27 | -0.27 … 0.27 | Painted steel | postal slate | V42 |
| Pull-down chute | -0.26 … 0.26 | 0.93 … 1.09 | 0.24 … 0.34 | Painted steel | postal slate | V42 |
| Chute grip | -0.18 … 0.18 | 1.02 … 1.06 | 0.33 … 0.37 | Cast iron | graphite | V29 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Foot pads | Box 0.08 × 0.04 × 0.09 at (-0.27, 0.02, -0.23).<br>Box 0.08 × 0.04 × 0.09 at (-0.27, 0.02, 0.23).<br>Box 0.08 × 0.04 × 0.09 at (0.27, 0.02, -0.23).<br>Box 0.08 × 0.04 × 0.09 at (0.27, 0.02, 0.23). |
| Splayed legs | Bar 0.06 × 0.06 from (-0.27, 0.04, -0.23) to (-0.25, 0.32, -0.20).<br>Bar 0.06 × 0.06 from (-0.27, 0.04, 0.23) to (-0.25, 0.32, 0.20).<br>Bar 0.06 × 0.06 from (0.27, 0.04, -0.23) to (0.25, 0.32, -0.20).<br>Bar 0.06 × 0.06 from (0.27, 0.04, 0.23) to (0.25, 0.32, 0.20). |
| Collection vault | Box 0.61 × 0.67 × 0.54 at (0.00, 0.64, 0.00). |
| Rolled hood | Extrude outline (-0.31, 0.96, -0.27), (-0.31, 1.10, -0.27), (-0.31, 1.19, -0.24), (-0.31, 1.25, -0.15), (-0.31, 1.27, -0.03), (-0.31, 1.25, 0.09), (-0.31, 1.20, 0.18), (-0.31, 1.10, 0.26), (-0.31, 0.99, 0.27) by (0.61, 0.00, 0.00). |
| Pull-down chute | Extrude outline (-0.26, 0.93, 0.26), (-0.26, 1.01, 0.26), (-0.26, 1.09, 0.24), (-0.26, 1.08, 0.32), (-0.26, 1.03, 0.34), (-0.26, 0.97, 0.34) by (0.51, 0.00, 0.00). |
| Chute grip | Box 0.35 × 0.04 × 0.04 at (0.00, 1.04, 0.35). |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.85 m | Chute face +Z. Rotate at placement when the collection route serves the sidewalk side. | Near post-office approaches, residential junctions or major foot-traffic generators. Use one per selected node. | Leave space to pull the chute and service the lower vault. Keep ramps and bus landings clear. |

**Atlas treatment.** MAIL · chalk V84. Vault seam, lock and throat · dark steel V25.

**Distance model.** Keep the arched top, chute lip and leg gap. The side profile carries the identity.

<a id="piece-meter"></a>

## 12 · Parking meter

[Open measured plate](meter.png)

Post Ø0.07 m, 1.06 m exposed after failure. Cast head width 0.26 m, depth 0.17 m. Use the stepped shoulders, rounded crown and waisted vault profile. Make the graduated dial, pointer, coin slot and lock atlas details.

Make the upper socket concentric with the post. A dark octagonal atlas aperture on the broken post gives it a hollow end at 1.06 m.

### Whole

A cloudy dial sits above a locked coin vault. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.13 … 0.13 m, Y 0.00 … 1.56 m, Z -0.08 … 0.11 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Meter post | -0.04 … 0.04 | 0.00 … 1.06 | -0.04 … 0.04 | Galvanised steel | zinc grey | V60 |
| ↳ Socket opening (atlas) | -0.03 … 0.03 | 1.06 … 1.06 | -0.03 … 0.03 | Galvanised steel | dark interior | V23 |
| Meter collar | -0.07 … 0.07 | 1.02 … 1.11 | -0.07 … 0.07 | Galvanised steel | smoked zinc | V44 |
| Coin vault | -0.10 … 0.09 | 1.07 … 1.31 | -0.08 … 0.08 | Painted steel | eucalyptus | V41 |
| Meter casting | -0.13 … 0.13 | 1.26 … 1.56 | -0.08 … 0.09 | Painted steel | eucalyptus | V41 |
| Dial window | -0.10 … 0.10 | 1.34 … 1.51 | 0.08 … 0.10 | Glass | clouded pearl | V77 |
| Coin plate | -0.01 … 0.08 | 1.26 … 1.33 | 0.09 … 0.11 | Aluminium | oxidised silver | V66 |
| ↳ Coin-slot insert (atlas) | -0.01 … 0.08 | 1.26 … 1.33 | 0.11 … 0.11 | Aluminium | charcoal recess | V25 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Meter post | 8-sided tube Ø0.07 from (0.00, 0.00, 0.00) to (0.00, 1.06, 0.00). |
| Meter collar | 8 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (1.02, 0.10), (1.09, 0.11), (1.11, 0.14). |
| Coin vault | Extrude outline (-0.07, 1.07, -0.08), (0.07, 1.07, -0.08), (0.09, 1.26, -0.08), (0.06, 1.31, -0.08), (-0.07, 1.31, -0.08), (-0.10, 1.25, -0.08) by (0.00, 0.00, 0.17). |
| Meter casting | Extrude outline (-0.09, 1.26, -0.08), (0.09, 1.26, -0.08), (0.13, 1.35, -0.08), (0.13, 1.43, -0.08), (0.11, 1.51, -0.08), (0.06, 1.55, -0.08), (0.00, 1.56, -0.08), (-0.06, 1.55, -0.08), (-0.11, 1.51, -0.08), (-0.13, 1.43, -0.08), (-0.13, 1.35, -0.08) by (0.00, 0.00, 0.17). |
| Dial window | Extrude outline (-0.07, 1.34, 0.08), (0.07, 1.34, 0.08), (0.10, 1.38, 0.08), (0.10, 1.47, 0.08), (0.07, 1.51, 0.08), (-0.07, 1.51, 0.08), (-0.10, 1.47, 0.08), (-0.10, 1.38, 0.08) by (0.00, 0.00, 0.02). |
| Coin plate | Box 0.09 × 0.06 × 0.02 at (0.03, 1.30, 0.10). |

</details>

### Broken

Only the galvanised mounting post remains. **Pose.** Head, collar and vault removed at Y 1.06 m. Remaining shaft 0° about the ground origin.

**Assembly envelope.** X -0.04 … 0.04 m, Y 0.00 … 1.06 m, Z -0.04 … 0.04 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Meter post | -0.04 … 0.04 | 0.00 … 1.06 | -0.04 … 0.04 | Galvanised steel | zinc grey | V60 |
| ↳ Socket opening (atlas) | -0.03 … 0.03 | 1.06 … 1.06 | -0.03 … 0.03 | Galvanised steel | dark interior | V23 |

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.60 m | Plate shows +Z dial face. Yaw to the local pay side when instanced. | On metered commercial blocks, one meter near the head of each marked parallel stall. Typical stall pitch 6.00–7.00 m. | Keep car door swing, wheelchair transfer aisles and the pedestrian through route clear. |

**Atlas treatment.** Dial graduations · ivory V76. Slot and lock recess · charcoal V24.

**Distance model.** Keep the round-shouldered head and slim post. Drop the head geometry for the broken version.

<a id="piece-bollard"></a>

## 13 · Pipe bollard

[Open measured plate](bollard.png)

Nominal Ø0.17 m steel pipe with a shallow convex concrete plug, crown Y 1.03 m. Paint the wall lip, circumferential scrape and foot oxidation. The pipe wall is represented by its outer surface.

Bake the steel lip and cement boundary into the top UV. Use more brushing and corrosion in the lowest 0.15 m and chalkier yellow on the sunward shoulder.

### Standing

Yellow paint flakes away at the embedded foot. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.11 … 0.11 m, Y 0.00 … 1.03 m, Z -0.11 … 0.11 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Concrete socket | -0.11 … 0.11 | 0.00 … 0.03 | -0.11 … 0.11 | Concrete | limestone grey | V66 |
| Pipe shell | -0.08 … 0.08 | 0.02 … 1.02 | -0.08 … 0.08 | Painted steel | safety ochre | V62 |
| Concrete fill | -0.07 … 0.07 | 1.01 … 1.03 | -0.07 … 0.07 | Concrete | limestone grey | V66 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Concrete socket | 12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.00, 0.23), (0.03, 0.22). |
| Pipe shell | Twelve-sided open shell. Profile (Y, radius) through (0.02, 0.08), (1.01, 0.08), (1.02, 0.08) and (1.01, 0.07). The nominal full outside diameter is 0.17 m. |
| Concrete fill | 12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (1.01, 0.15), (1.02, 0.14), (1.03, 0.09). |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.65 m | Cylindrical, no preferred yaw. Place row along X. | Across service entrances, protecting cabinets and storefront corners. Along a row, use a nominal centre pitch of 1.45 m and adapt the accessible opening to the site. | Keep access routes, door swing and service openings unobstructed. |

**Atlas treatment.** Foot corrosion · oxide V35. Weathered cement aggregate · grey V66.

**Distance model.** Reduce to a six-sided column with a light concrete top.

<a id="piece-fence"></a>

## 14 · Chain-link fence

[Open measured plate](fence.png)

Set post axes every 3.00 m, sharing the end post between adjacent instances. Nominal exposed height 1.84 m. Top rail Ø0.05 m, centre 1.79 m. Stretch an alpha-tested diamond texture over the open spans. Tension wire is a masked line on a 0.02 m ribbon.

A repeating 0.48 × 0.48 m atlas region carries eight diamond repeats. The fabric may show a backing silhouette through every opening. Share the upper rail and post sockets between successive bays.

### Whole

Diamond fabric hangs between two terminal edges. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -1.53 … 1.53 m, Y 0.00 … 1.84 m, Z -0.03 … 0.03 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Line posts | -1.53 … 1.53 | 0.00 … 1.84 | -0.03 … 0.03 | Galvanised steel | zinc grey | V60 |
| Top rail | -1.50 … 1.50 | 1.77 … 1.81 | -0.02 … 0.03 | Galvanised steel | zinc grey | V60 |
| Diamond fabric | -1.50 … 1.50 | 0.07 … 1.79 | 0.03 … 0.03 | Galvanised steel | dark wire | V42 |
| Tension wire | -1.50 … 1.50 | 0.06 … 0.08 | 0.03 … 0.03 | Galvanised steel | dark wire | V42 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Line posts | Two Ø0.06 m posts, their axes 3.00 m apart.<br>8-sided tube Ø0.06 from (-1.50, 0.00, 0.00) to (-1.50, 1.84, 0.00).<br>8-sided tube Ø0.06 from (1.50, 0.00, 0.00) to (1.50, 1.84, 0.00). |
| Top rail | 8-sided tube Ø0.05 from (-1.50, 1.79, 0.01) to (1.50, 1.79, 0.01). |
| Diamond fabric | Two-sided alpha skin, 0.06 m diamond pitch. Do not generate individual links.<br>Panel (-1.50, 0.07, 0.03), (-0.50, 0.07, 0.03), (-0.50, 1.79, 0.03), (-1.50, 1.79, 0.03).<br>Panel (-0.50, 0.07, 0.03), (0.50, 0.07, 0.03), (0.50, 1.79, 0.03), (-0.50, 1.79, 0.03).<br>Panel (0.50, 0.07, 0.03), (1.50, 0.07, 0.03), (1.50, 1.79, 0.03), (0.50, 1.79, 0.03). |
| Tension wire | Alpha ribbon carrying a thin wire line. Physical wire gauge is painted.<br>Panel (-1.50, 0.06, 0.03), (1.50, 0.06, 0.03), (1.50, 0.08, 0.03), (-1.50, 0.08, 0.03). |

</details>

### Sagging

A leaning post lets the lower fabric belly out. **Pose.** Right post +15° about Z at (1.50, 0.00, 0.00). Rail folds in X/Y at X −0.94, −0.32, 0.24, 0.73 m. Span pitches from left are −11°, −17°, −7°, +14°, +32°. Bottom tear peaks at (0.24, 0.52, 0.52).

**Assembly envelope.** X -1.53 … 1.53 m, Y -0.01 … 1.84 m, Z -0.03 … 0.52 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Line posts | -1.53 … 1.53 | -0.01 … 1.84 | -0.03 … 0.03 | Galvanised steel | zinc grey | V60 |
| Top rail | -1.50 … 1.05 | 1.40 … 1.81 | 0.00 … 0.14 | Galvanised steel | zinc grey | V60 |
| Diamond fabric | -1.50 … 1.04 | 0.07 … 1.79 | 0.02 … 0.52 | Galvanised steel | dark wire | V42 |
| Tension wire | -1.50 … 1.47 | 0.06 … 0.08 | 0.03 … 0.03 | Galvanised steel | dark wire | V42 |

<details>
<summary>Changed members and cut geometry</summary>

| Member | Construction in metres |
|---|---|
| Line posts | Two Ø0.06 m posts, their axes 3.00 m apart.<br>8-sided tube Ø0.06 from (-1.50, 0.00, 0.00) to (-1.50, 1.84, 0.00).<br>8-sided tube Ø0.06 from (1.50, 0.00, 0.00) to (1.02, 1.78, 0.00). |
| Top rail | 8-sided tube Ø0.05 from (-1.50, 1.79, 0.02) to (-0.94, 1.68, 0.03).<br>8-sided tube Ø0.05 from (-0.94, 1.68, 0.03) to (-0.32, 1.49, 0.07).<br>8-sided tube Ø0.05 from (-0.32, 1.49, 0.07) to (0.24, 1.42, 0.12).<br>8-sided tube Ø0.05 from (0.24, 1.42, 0.12) to (0.73, 1.54, 0.07).<br>8-sided tube Ø0.05 from (0.73, 1.54, 0.07) to (1.04, 1.73, 0.02). |
| Diamond fabric | Two-sided alpha skin, 0.06 m diamond pitch. Do not generate individual links.<br>Panel (-1.50, 0.07, 0.02), (-0.94, 0.11, 0.15), (-0.94, 1.68, 0.03).<br>Panel (-1.50, 0.07, 0.02), (-0.94, 1.68, 0.03), (-1.50, 1.79, 0.02).<br>Panel (-0.94, 0.11, 0.15), (-0.32, 0.24, 0.31), (-0.32, 1.49, 0.07).<br>Panel (-0.94, 0.11, 0.15), (-0.32, 1.49, 0.07), (-0.94, 1.68, 0.03).<br>Panel (-0.32, 0.24, 0.31), (0.24, 0.52, 0.52), (0.24, 1.42, 0.12).<br>Panel (-0.32, 0.24, 0.31), (0.24, 1.42, 0.12), (-0.32, 1.49, 0.07).<br>Panel (0.24, 0.52, 0.52), (0.73, 0.19, 0.32), (0.73, 1.54, 0.07).<br>Panel (0.24, 0.52, 0.52), (0.73, 1.54, 0.07), (0.24, 1.42, 0.12).<br>Panel (0.73, 0.19, 0.32), (1.04, 0.11, 0.09), (1.04, 1.73, 0.02).<br>Panel (0.73, 0.19, 0.32), (1.04, 1.73, 0.02), (0.73, 1.54, 0.07). |
| Tension wire | Alpha ribbon carrying a thin wire line. Physical wire gauge is painted.<br>Panel (-1.50, 0.06, 0.03), (1.47, 0.06, 0.03), (1.47, 0.08, 0.03), (-1.50, 0.08, 0.03). |

</details>

### Down

The top rail lies out from the line of standing posts. **Pose.** Fabric and rail +90° about X along the lower edge at (0.00, 0.07, 0.03), then settle at Y 0.03 m. Both posts remain vertical.

**Assembly envelope.** X -1.53 … 1.53 m, Y 0.00 … 1.84 m, Z -0.03 … 1.77 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Line posts | -1.53 … 1.53 | 0.00 … 1.84 | -0.03 … 0.03 | Galvanised steel | zinc grey | V60 |
| Top rail | -1.50 … 1.50 | 0.00 … 0.05 | 1.73 … 1.77 | Galvanised steel | zinc grey | V60 |
| Diamond fabric | -1.50 … 1.50 | 0.03 … 0.03 | 0.03 … 1.75 | Galvanised steel | dark wire | V42 |
| Tension wire | -1.50 … 1.50 | 0.03 … 0.03 | 0.03 … 0.05 | Galvanised steel | dark wire | V42 |

<details>
<summary>Changed members and cut geometry</summary>

| Member | Construction in metres |
|---|---|
| Top rail | 8-sided tube Ø0.05 from (-1.50, 0.03, 1.75) to (1.50, 0.03, 1.75). |
| Diamond fabric | Two-sided alpha skin, 0.06 m diamond pitch. Do not generate individual links.<br>Panel (-1.50, 0.03, 0.03), (1.50, 0.03, 0.03), (1.50, 0.03, 1.75), (-1.50, 0.03, 1.75). |
| Tension wire | Alpha ribbon carrying a thin wire line. Physical wire gauge is painted.<br>Panel (-1.50, 0.03, 0.03), (1.50, 0.03, 0.03), (1.50, 0.03, 0.05), (-1.50, 0.03, 0.05). |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 2.50 m typical, at lot line | Run along X. The road-facing bulge of the sagging panel points +Z. | Industrial boundaries, vacant lots and service yards. Repeat in 3.00 m bays along the property line. | Break the sequence for gates, driveways and required corner sight lines. |

**Atlas treatment.** Diamond wire and bottom tension line · zinc V42. Bindings · dark zinc V44.

**Distance model.** One double-sided fabric sheet, two posts and a rail. Keep the lifted edge in the sagging bay. Mip the alpha pattern.

<a id="piece-rail"></a>

## 15 · W-beam guardrail

[Open measured plate](rail.png)

Open W profile stations (Y, Z) in m: (0.40, 0.32), (0.43, 0.29), (0.48, 0.38), (0.50, 0.38), (0.56, 0.29), (0.61, 0.38), (0.64, 0.38), (0.69, 0.29), (0.71, 0.31). Sheet thickness and splice bolts are atlas marks. Place the 0.15 × 0.29 × 0.18 m blockouts at X ±0.95 m.

Whole longitudinal stations (X, ΔY, ΔZ) in m are (−2.00, 0.00, 0.00), (−0.95, 0.00, 0.00), (0.95, 0.00, 0.00), (2.00, 0.00, 0.00). Bent stations are (−2.00, 0.00, 0.00), (−0.95, 0.00, 0.00), (−0.32, 0.00, 0.00), (0.25, −0.04, −0.22), (0.59, −0.11, −0.49), (0.96, −0.09, −0.43), (1.37, −0.04, −0.32), (1.91, −0.02, −0.24).

### Whole

Twin corrugations run past two blocked-out posts. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -2.00 … 2.00 m, Y 0.00 … 0.72 m, Z -0.06 … 0.38 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Channel posts | -1.03 … 1.03 | 0.00 … 0.72 | -0.06 … 0.06 | Galvanised steel | smoked zinc | V44 |
| Timber blockouts | -1.03 … 1.03 | 0.42 … 0.71 | 0.07 … 0.25 | Creosoted wood | weathered umber | V41 |
| Corrugated W-beam | -2.00 … 2.00 | 0.40 … 0.71 | 0.29 … 0.38 | Galvanised steel | zinc grey | V60 |
| Splice and fixings | -1.89 … 0.98 | 0.46 … 0.65 | 0.29 … 0.38 | Rust | iron oxide | V35 |
| ↳ Fixing head marks (atlas) | -0.98 … 0.98 | 0.53 … 0.58 | 0.29 … 0.29 | Rust | iron oxide | V35 |
| ↳ Splice bolt pattern (atlas) | -1.89 … -1.66 | 0.46 … 0.65 | 0.38 … 0.38 | Rust | iron oxide | V35 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Channel posts | Box 0.15 × 0.72 × 0.04 at (-0.95, 0.36, 0.04).<br>Box 0.15 × 0.72 × 0.04 at (-0.95, 0.36, -0.04).<br>Box 0.03 × 0.72 × 0.12 at (-0.95, 0.36, 0.00).<br>Box 0.15 × 0.72 × 0.04 at (0.95, 0.36, 0.04).<br>Box 0.15 × 0.72 × 0.04 at (0.95, 0.36, -0.04).<br>Box 0.03 × 0.72 × 0.12 at (0.95, 0.36, 0.00). |
| Timber blockouts | Box 0.15 × 0.29 × 0.18 at (-0.95, 0.56, 0.16).<br>Box 0.15 × 0.29 × 0.18 at (0.95, 0.56, 0.16). |
| Corrugated W-beam | Open folded section. Local profile given in build note.<br>Sweep the nine-station W section in the build note through the longitudinal stations in the form. Give it a two-sided zinc material. |
| Splice and fixings | Rust and fasteners are painted directly over the corrugations.<br>Apply two splice bands at X −1.77 m across the raised corrugations at Y 0.49 and 0.63 m. Paint a post fixing at each attached blockout. |

</details>

### Bent

The beam folds inland and tears free of the right post. **Pose.** Plan folds about Y at X −0.32, 0.25, 0.59, 0.96, 1.37 m. Successive spans yaw +21°, +38°, −9°, −15°, −8° from +X, driven inland. Maximum displacement (0.00, −0.11, −0.49) at X 0.59 m. Right post remains vertical.

**Assembly envelope.** X -2.00 … 1.91 m, Y 0.00 … 0.72 m, Z -0.20 … 0.38 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Channel posts | -1.03 … 1.03 | 0.00 … 0.72 | -0.06 … 0.06 | Galvanised steel | smoked zinc | V44 |
| Timber blockouts | -1.03 … 1.03 | 0.42 … 0.71 | 0.07 … 0.25 | Creosoted wood | weathered umber | V41 |
| Corrugated W-beam | -2.00 … 1.91 | 0.29 … 0.71 | -0.20 … 0.38 | Galvanised steel | zinc grey | V60 |
| Splice and fixings | -1.89 … -0.92 | 0.46 … 0.65 | 0.29 … 0.38 | Rust | iron oxide | V35 |
| ↳ Fixing head marks (atlas) | -0.98 … -0.92 | 0.53 … 0.58 | 0.29 … 0.29 | Rust | iron oxide | V35 |
| ↳ Splice bolt pattern (atlas) | -1.89 … -1.66 | 0.46 … 0.65 | 0.38 … 0.38 | Rust | iron oxide | V35 |

<details>
<summary>Changed members and cut geometry</summary>

| Member | Construction in metres |
|---|---|
| Corrugated W-beam | Open folded section. Local profile given in build note.<br>Sweep the nine-station W section in the build note through the longitudinal stations in the form. Give it a two-sided zinc material. |
| Splice and fixings | Rust and fasteners are painted directly over the corrugations.<br>Apply two splice bands at X −1.77 m across the raised corrugations at Y 0.49 and 0.63 m. Paint a post fixing at each attached blockout. |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.80 m to rail origin | Corrugated traffic face points +Z, posts and blockouts lie inland. | Along waterfront drops or expressway shoulders. Repeat the 4.00 m module, connecting beam ends. Treat terminals as separate site assets. | Keep the dynamic deflection space behind the beam and the travelled lane ahead clear. Avoid lining pedestrian crossings. |

**Atlas treatment.** Splice bolts and washer marks · oxide V35. Crest wear · bright zinc V60.

**Distance model.** Bake corrugation into the face beyond reading distance. Retain the inward fold and both posts.

<a id="piece-billboard"></a>

## 16 · Expressway billboard

[Open measured plate](billboard.png)

Face 14.60 × 4.30 m. Face bottom Y 10.00 m, top 14.30 m. Nine uprights spaced 1.81 m, five horizontal stringers at Y 10.00, 11.07, 12.15, 13.23 and 14.30 m. Catwalk three planks on eight outriggers. Four floods point up and back toward the face at −48° around X. The repeating texture follows the whole vinyl rectangle across every torn strip.

Make the uninterrupted vinyl blank first. Use whole-blank UV coordinates on each strip, so the printed horizon continues across the tears. Leave the catwalk lip visible below the bottom hem.

### Whole

Torn vinyl exposes the right-hand frame bays. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -7.30 … 7.30 m, Y 0.00 … 14.34 m, Z -0.74 … 2.00 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Monopole footing | -0.74 … 0.74 | 0.00 … 0.16 | -0.74 … 0.74 | Concrete | limestone grey | V66 |
| ↳ Anchor-nut pattern (atlas) | -0.74 … 0.74 | 0.16 … 0.16 | -0.74 … 0.74 | Galvanised steel | aged zinc | V60 |
| Steel base plate | -0.55 … 0.55 | 0.16 … 0.25 | -0.55 … 0.55 | Rust | iron oxide | V35 |
| ↳ Anchor-nut pattern (atlas) | -0.55 … 0.55 | 0.25 … 0.25 | -0.55 … 0.55 | Galvanised steel | aged zinc | V60 |
| Monopole | -0.47 … 0.47 | 0.25 … 12.23 | -0.47 … 0.47 | Painted steel | oxide brown | V36 |
| Head girder | -6.37 … 6.37 | 11.42 … 11.88 | -0.20 … 0.26 | Painted steel | oxide brown | V36 |
| Cantilever brackets | -5.48 … 5.48 | 10.08 … 14.19 | -0.05 … 0.53 | Painted steel | oxide brown | V36 |
| Face uprights | -7.30 … 7.30 | 10.00 … 14.30 | 0.43 … 0.53 | Galvanised steel | smoked zinc | V44 |
| Horizontal stringers | -7.30 … 7.30 | 9.96 … 14.34 | 0.55 … 0.63 | Galvanised steel | smoked zinc | V44 |
| Catwalk outriggers | -7.04 … 7.04 | 9.70 … 9.83 | 0.44 … 1.24 | Painted steel | oxide brown | V36 |
| Catwalk planks | -7.30 … 7.30 | 9.83 … 9.90 | 0.72 … 1.23 | Galvanised steel | smoked zinc | V44 |
| Floodlight arms | -5.43 … 5.43 | 9.57 … 9.85 | 0.92 … 1.87 | Galvanised steel | zinc grey | V60 |
| Lamp housings | -5.64 … 5.64 | 9.53 … 9.83 | 1.72 … 2.00 | Painted steel | charcoal | V28 |
| Floodlight lenses | -5.60 … 5.60 | 9.64 … 9.81 | 1.73 … 1.89 | Glass | clouded pearl | V77 |
| Torn vinyl | -7.30 … 7.30 | 10.03 … 14.30 | 0.65 … 0.81 | Plastic | faded seafoam | V71 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Monopole footing | Box 1.48 × 0.16 × 1.48 at (0.00, 0.08, 0.00). |
| Steel base plate | Box 1.10 × 0.09 × 1.10 at (0.00, 0.21, 0.00). |
| Monopole | 12 facets, centre (X, Z) = (0.00, 0.00). Stations (Y, Ø) (0.25, 0.94), (1.24, 0.94), (9.66, 0.76), (12.23, 0.76). |
| Head girder | Box 12.74 × 0.46 × 0.46 at (0.00, 11.65, 0.03). |
| Cantilever brackets | Bar 0.11 × 0.11 from (-5.42, 11.65, 0.00) to (-5.42, 10.10, 0.48).<br>Bar 0.11 × 0.11 from (-5.42, 11.65, 0.00) to (-5.42, 14.18, 0.48).<br>Bar 0.11 × 0.11 from (-1.81, 11.65, 0.00) to (-1.81, 10.10, 0.48).<br>Bar 0.11 × 0.11 from (-1.81, 11.65, 0.00) to (-1.81, 14.18, 0.48).<br>Bar 0.11 × 0.11 from (1.81, 11.65, 0.00) to (1.81, 10.10, 0.48).<br>Bar 0.11 × 0.11 from (1.81, 11.65, 0.00) to (1.81, 14.18, 0.48).<br>Bar 0.11 × 0.11 from (5.42, 11.65, 0.00) to (5.42, 10.10, 0.48).<br>Bar 0.11 × 0.11 from (5.42, 11.65, 0.00) to (5.42, 14.18, 0.48). |
| Face uprights | Box 0.09 × 4.30 × 0.10 at (-7.25, 12.15, 0.48).<br>Box 0.09 × 4.30 × 0.10 at (-5.44, 12.15, 0.48).<br>Box 0.09 × 4.30 × 0.10 at (-3.63, 12.15, 0.48).<br>Box 0.09 × 4.30 × 0.10 at (-1.81, 12.15, 0.48).<br>Box 0.09 × 4.30 × 0.10 at (0.00, 12.15, 0.48).<br>Box 0.09 × 4.30 × 0.10 at (1.81, 12.15, 0.48).<br>Box 0.09 × 4.30 × 0.10 at (3.63, 12.15, 0.48).<br>Box 0.09 × 4.30 × 0.10 at (5.44, 12.15, 0.48).<br>Box 0.09 × 4.30 × 0.10 at (7.25, 12.15, 0.48). |
| Horizontal stringers | Box 14.60 × 0.08 × 0.08 at (0.00, 10.00, 0.59).<br>Box 14.60 × 0.08 × 0.08 at (0.00, 11.07, 0.59).<br>Box 14.60 × 0.08 × 0.08 at (0.00, 12.15, 0.59).<br>Box 14.60 × 0.08 × 0.08 at (0.00, 13.23, 0.59).<br>Box 14.60 × 0.08 × 0.08 at (0.00, 14.30, 0.59). |
| Catwalk outriggers | Bar 0.08 × 0.08 from (-7.00, 9.74, 0.44) to (-7.00, 9.79, 1.24).<br>Bar 0.08 × 0.08 from (-5.00, 9.74, 0.44) to (-5.00, 9.79, 1.24).<br>Bar 0.08 × 0.08 from (-3.00, 9.74, 0.44) to (-3.00, 9.79, 1.24).<br>Bar 0.08 × 0.08 from (-1.00, 9.74, 0.44) to (-1.00, 9.79, 1.24).<br>Bar 0.08 × 0.08 from (1.00, 9.74, 0.44) to (1.00, 9.79, 1.24).<br>Bar 0.08 × 0.08 from (3.00, 9.74, 0.44) to (3.00, 9.79, 1.24).<br>Bar 0.08 × 0.08 from (5.00, 9.74, 0.44) to (5.00, 9.79, 1.24).<br>Bar 0.08 × 0.08 from (7.00, 9.74, 0.44) to (7.00, 9.79, 1.24). |
| Catwalk planks | Box 14.60 × 0.07 × 0.15 at (0.00, 9.86, 0.79).<br>Box 14.60 × 0.07 × 0.15 at (0.00, 9.86, 0.97).<br>Box 14.60 × 0.07 × 0.15 at (0.00, 9.86, 1.15). |
| Floodlight arms | Bar 0.07 × 0.07 from (-5.40, 9.82, 0.93) to (-5.40, 9.60, 1.86).<br>Bar 0.07 × 0.07 from (-1.80, 9.82, 0.93) to (-1.80, 9.60, 1.86).<br>Bar 0.07 × 0.07 from (1.80, 9.82, 0.93) to (1.80, 9.60, 1.86).<br>Bar 0.07 × 0.07 from (5.40, 9.82, 0.93) to (5.40, 9.60, 1.86). |
| Lamp housings | Box 0.48 × 0.12 × 0.29 at (-5.40, 9.68, 1.86). Positive half-axis tips (-5.16, 9.68, 1.86), (-5.40, 9.72, 1.82), (-5.40, 9.79, 1.96).<br>Box 0.48 × 0.12 × 0.29 at (-1.80, 9.68, 1.86). Positive half-axis tips (-1.56, 9.68, 1.86), (-1.80, 9.72, 1.82), (-1.80, 9.79, 1.96).<br>Box 0.48 × 0.12 × 0.29 at (1.80, 9.68, 1.86). Positive half-axis tips (2.04, 9.68, 1.86), (1.80, 9.72, 1.82), (1.80, 9.79, 1.96).<br>Box 0.48 × 0.12 × 0.29 at (5.40, 9.68, 1.86). Positive half-axis tips (5.64, 9.68, 1.86), (5.40, 9.72, 1.82), (5.40, 9.79, 1.96). |
| Floodlight lenses | Box 0.40 × 0.02 × 0.22 at (-5.40, 9.73, 1.81). Positive half-axis tips (-5.20, 9.73, 1.81), (-5.40, 9.73, 1.80), (-5.40, 9.81, 1.88).<br>Box 0.40 × 0.02 × 0.22 at (-1.80, 9.73, 1.81). Positive half-axis tips (-1.60, 9.73, 1.81), (-1.80, 9.73, 1.80), (-1.80, 9.81, 1.88).<br>Box 0.40 × 0.02 × 0.22 at (1.80, 9.73, 1.81). Positive half-axis tips (2.00, 9.73, 1.81), (1.80, 9.73, 1.80), (1.80, 9.81, 1.88).<br>Box 0.40 × 0.02 × 0.22 at (5.40, 9.73, 1.81). Positive half-axis tips (5.60, 9.73, 1.81), (5.40, 9.73, 1.80), (5.40, 9.81, 1.88). |
| Torn vinyl | Two-sided textured skin. Continuous top hem, irregular tears and exposed steel bays.<br>Panel (-7.27, 10.04, 0.68), (-5.64, 10.05, 0.67), (-5.60, 14.30, 0.65), (-7.30, 14.30, 0.65).<br>Panel (-5.57, 10.03, 0.73), (-3.24, 10.18, 0.81), (-3.20, 14.30, 0.65), (-5.60, 14.30, 0.65).<br>Panel (-3.17, 10.03, 0.78), (-1.44, 10.09, 0.67), (-1.40, 14.30, 0.65), (-3.20, 14.30, 0.65).<br>Panel (-1.37, 10.12, 0.68), (0.37, 10.33, 0.81), (0.40, 14.30, 0.65), (-1.40, 14.30, 0.65).<br>Panel (0.51, 10.04, 0.73), (1.40, 11.31, 0.67), (1.51, 14.30, 0.65), (0.40, 14.30, 0.65).<br>Panel (1.62, 13.29, 0.78), (2.31, 12.66, 0.81), (2.42, 14.30, 0.65), (1.51, 14.30, 0.65).<br>Panel (2.53, 11.40, 0.68), (3.24, 10.28, 0.67), (3.35, 14.30, 0.65), (2.42, 14.30, 0.65).<br>Panel (3.46, 13.53, 0.73), (4.08, 13.21, 0.81), (4.19, 14.30, 0.65), (3.35, 14.30, 0.65).<br>Panel (4.30, 10.72, 0.78), (5.10, 11.79, 0.67), (5.21, 14.30, 0.65), (4.19, 14.30, 0.65).<br>Panel (5.32, 13.18, 0.68), (6.23, 13.61, 0.81), (6.34, 14.30, 0.65), (5.21, 14.30, 0.65).<br>Panel (6.45, 11.51, 0.73), (7.19, 10.16, 0.67), (7.30, 14.30, 0.65), (6.34, 14.30, 0.65). |

</details>

### Bare

Only uprights and stringers outline the face. **Pose.** Vinyl detached along the top hem Y 14.30 m. Frame, pole and catwalk remain at 0° about the origin.

**Assembly envelope.** X -7.30 … 7.30 m, Y 0.00 … 14.34 m, Z -0.74 … 2.00 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Monopole footing | -0.74 … 0.74 | 0.00 … 0.16 | -0.74 … 0.74 | Concrete | limestone grey | V66 |
| ↳ Anchor-nut pattern (atlas) | -0.74 … 0.74 | 0.16 … 0.16 | -0.74 … 0.74 | Galvanised steel | aged zinc | V60 |
| Steel base plate | -0.55 … 0.55 | 0.16 … 0.25 | -0.55 … 0.55 | Rust | iron oxide | V35 |
| ↳ Anchor-nut pattern (atlas) | -0.55 … 0.55 | 0.25 … 0.25 | -0.55 … 0.55 | Galvanised steel | aged zinc | V60 |
| Monopole | -0.47 … 0.47 | 0.25 … 12.23 | -0.47 … 0.47 | Painted steel | oxide brown | V36 |
| Head girder | -6.37 … 6.37 | 11.42 … 11.88 | -0.20 … 0.26 | Painted steel | oxide brown | V36 |
| Cantilever brackets | -5.48 … 5.48 | 10.08 … 14.19 | -0.05 … 0.53 | Painted steel | oxide brown | V36 |
| Face uprights | -7.30 … 7.30 | 10.00 … 14.30 | 0.43 … 0.53 | Galvanised steel | smoked zinc | V44 |
| Horizontal stringers | -7.30 … 7.30 | 9.96 … 14.34 | 0.55 … 0.63 | Galvanised steel | smoked zinc | V44 |
| Catwalk outriggers | -7.04 … 7.04 | 9.70 … 9.83 | 0.44 … 1.24 | Painted steel | oxide brown | V36 |
| Catwalk planks | -7.30 … 7.30 | 9.83 … 9.90 | 0.72 … 1.23 | Galvanised steel | smoked zinc | V44 |
| Floodlight arms | -5.43 … 5.43 | 9.57 … 9.85 | 0.92 … 1.87 | Galvanised steel | zinc grey | V60 |
| Lamp housings | -5.64 … 5.64 | 9.53 … 9.83 | 1.72 … 2.00 | Painted steel | charcoal | V28 |
| Floodlight lenses | -5.60 … 5.60 | 9.64 … 9.81 | 1.73 … 1.89 | Glass | clouded pearl | V77 |

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 12.00 m typical, behind shoulder | Local face +Z. Yaw whole assembly toward approaching traffic for an oblique long view. | Expressway corridors or large commercial lots, scattered at selected long-view sites. Illustrative spacing 300.00–700.00 m. | Keep structural footing, catwalk projection and maintenance access outside the carriageway and away from power lines. |

**Atlas treatment.** Vinyl ink · faded sea-green V48. Bolts and lamp brackets · oxide V35.

**Distance model.** Use one torn face mask and a monopole. For bare, replace the face with a grid cutout.

<a id="piece-newsbox"></a>

## 17 · Newspaper box

[Open measured plate](newsbox.png)

Cabinet 0.53 × 0.67 × 0.44 m. Hinge the door at its foot and put the pull immediately below the masthead. Coin plate sits to the right. Print the invented Brineleaf Ledger masthead and a partly legible page behind the glazing.

Give the paper window a yellowed cover and leave its rectangular frame intact. The paper masthead reads Brineleaf Ledger. The slot, coin-return seam and lock are painted marks.

### Standing

A yellowed front page remains behind the drop door. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.28 … 0.28 m, Y 0.00 … 1.12 m, Z -0.24 … 0.30 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Pedestal foot | -0.24 … 0.24 | 0.00 … 0.06 | -0.22 … 0.22 | Rust | iron oxide | V35 |
| ↳ Anchor-nut pattern (atlas) | -0.24 … 0.24 | 0.06 … 0.06 | -0.22 … 0.22 | Galvanised steel | aged zinc | V60 |
| Pedestal | -0.13 … 0.13 | 0.05 … 0.44 | -0.12 … 0.12 | Painted steel | petrol blue | V37 |
| Vending cabinet | -0.27 … 0.27 | 0.42 … 1.09 | -0.22 … 0.22 | Painted steel | petrol blue | V37 |
| Rain hood | -0.28 … 0.28 | 1.05 … 1.12 | -0.24 … 0.28 | Painted steel | petrol blue | V37 |
| Drop door | -0.25 … 0.14 | 0.50 … 0.98 | 0.22 … 0.25 | Painted steel | putty | V60 |
| Display window | -0.21 … 0.10 | 0.57 … 0.92 | 0.25 … 0.27 | Plastic | yellowed glazing | V68 |
| Coin mechanism | 0.15 … 0.23 | 0.78 … 0.97 | 0.22 … 0.28 | Aluminium | oxidised silver | V66 |
| ↳ Coin-slot insert (atlas) | 0.15 … 0.23 | 0.78 … 0.97 | 0.28 … 0.28 | Aluminium | charcoal recess | V25 |
| Door pull | -0.16 … 0.04 | 0.94 … 0.97 | 0.25 … 0.30 | Cast iron | graphite | V29 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Pedestal foot | Box 0.47 × 0.06 × 0.43 at (0.00, 0.03, 0.00). |
| Pedestal | Box 0.26 × 0.39 × 0.25 at (0.00, 0.24, 0.00). |
| Vending cabinet | Box 0.53 × 0.67 × 0.44 at (0.00, 0.76, 0.00). |
| Rain hood | Extrude outline (-0.28, 1.07, -0.24), (-0.28, 1.12, -0.24), (-0.28, 1.09, 0.28), (-0.28, 1.05, 0.28) by (0.56, 0.00, 0.00). |
| Drop door | Box 0.39 × 0.48 × 0.03 at (-0.06, 0.74, 0.23). |
| Display window | Box 0.32 × 0.35 × 0.02 at (-0.06, 0.75, 0.26). |
| Coin mechanism | Box 0.09 × 0.18 × 0.05 at (0.19, 0.88, 0.25). |
| Door pull | Box 0.21 × 0.04 × 0.05 at (-0.06, 0.96, 0.28). |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.90 m | Display and pull face +Z. Align the rack along the kerb. | One or a small group near transit entrances and commercial corners. Use selected high-footfall blocks, about 100.00–250.00 m between groups. | Leave space to swing the drop door. Keep shop doors, bus landings, ramps and the through route clear. |

**Atlas treatment.** Masthead · chalk V84. Print and coin slot · charcoal V25.

**Distance model.** Retain the pedestal, overhanging cabinet and contrasting front window.

<a id="piece-paystation"></a>

## 18 · Pay station

No measured plate: the numbers are the model's, after a car park's multi-space pay station.

Cabinet 0.45 m wide and 0.30 m deep on a pedestal, 1.65 m to the back of its solar panel. The control panel (a blue band with a P and PAY HERE, the screen, two buttons, the keypad, the card and receipt slots) looks −Z, at the walk, as the mailbox's chute does. Every other face is one swatch of its blue-grey paint, rusting at its edges. No maker's name.

### Standing

A blue-grey kiosk with a dead screen. **Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

**Assembly envelope.** X -0.24 … 0.24 m, Y 0.00 … 1.65 m, Z -0.17 … 0.17 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Base plate | -0.20 … 0.20 | 0.00 … 0.02 | -0.15 … 0.15 | Galvanised steel | zinc grey | V60 |
| Pedestal | -0.12 … 0.12 | 0.00 … 0.50 | -0.09 … 0.09 | Painted steel | blue-grey | V29 |
| Cabinet | -0.23 … 0.23 | 0.50 … 1.20 | -0.15 … 0.15 | Painted steel | blue-grey | V29 |
| Head | -0.23 … 0.23 | 1.20 … 1.54 | -0.15 … 0.15 | Painted steel | blue-grey | V29 |
| ↳ Control panel (atlas) | -0.23 … 0.23 | 1.20 … 1.54 | -0.15 … -0.15 | Painted steel | blue band, white legend | V27 |
| ↳ Screen (atlas) | 0.01 … 0.18 | 1.35 … 1.42 | -0.15 … -0.15 | Glass | dead grey-green | V23 |
| Rain hood | -0.24 … 0.24 | 1.54 … 1.57 | -0.17 … 0.17 | Painted steel | blue-grey | V29 |
| Solar panel | -0.20 … 0.20 | 1.57 … 1.65 | -0.15 … 0.13 | Glass | dark blue cells | V20 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Base plate | Box 0.40 × 0.02 × 0.30 at (0.00, 0.01, 0.00). |
| Pedestal | Box 0.24 × 0.80 × 0.18 at (0.00, 0.10, 0.00), carried 0.30 into the ground. |
| Cabinet | Box 0.45 × 0.70 × 0.30 at (0.00, 0.85, 0.00). |
| Head | Box 0.45 × 0.3375 × 0.30 at (0.00, 1.37, 0.00), its −Z face the panel's picture. |
| Rain hood | Box 0.48 × 0.0325 × 0.335 at (0.00, 1.55, 0.00). |
| Solar panel | Box 0.40 × 0.02 × 0.29 on the hood, turned −12° about X through (0.00, 1.57, −0.15), so it rises to the back and faces the walk. |

</details>

### Broken

Torn from its pedestal and fallen on its back toward the road, its screen smashed in. **Pose.** The cabinet, head, hood and panel turned 90° about X (the panel up, the top toward +Z), lifted 0.165 m to lie on the hood's back, moved 0.06 m along +X, then turned 9° about Y through the origin. The pedestal stands to 0.45 m.

**Assembly envelope.** X -0.20 … 0.55 m, Y 0.00 … 0.45 m, Z -0.15 … 1.66 m.

| Part | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---|---|---:|
| Base plate | -0.20 … 0.20 | 0.00 … 0.02 | -0.15 … 0.15 | Galvanised steel | zinc grey | V60 |
| Pedestal stub | -0.12 … 0.12 | 0.00 … 0.45 | -0.09 … 0.09 | Painted steel | blue-grey | V29 |
| Fallen cabinet, head and hood | -0.10 … 0.55 | 0.00 … 0.34 | 0.45 … 1.66 | Painted steel | blue-grey | V29 |
| ↳ Smashed screen | 0.28 … 0.46 | 0.32 … 0.32 | 1.29 … 1.39 | Glass | crazed, shards gone to black | V20 |

<details>
<summary>Fabrication schedule</summary>

| Member | Construction in metres |
|---|---|
| Pedestal stub | Box 0.24 × 0.75 × 0.18 at (0.00, 0.075, 0.00), carried 0.30 into the ground. |
| Smashed screen | Box over the screen, 0.169 × 0.07 × 0.006, proud of the panel, its face the smashed screen's picture. Then posed with the cabinet. |

</details>

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| 0.75 m | The panel faces −Z, the walk; the road is behind it. | One for a block face of metered stalls, or at a car park's entrance and along its walkways, about one for every eight to ten stalls. | Keep the walk's through route and the doors of parked cars clear. |

**Atlas treatment.** Panel band · faded blue V27, legend chalk white V80. Keypad · pale grey V59. Screen · grey-green V23; smashed, crazed from one blow with shards gone to black. Paint swatch · blue-grey V29, rust at its edges.

**Distance model.** Past the finest, one box from the ground to the hood with the panel on its front (12 triangles); the flat level between is left out, as for the other pieces built of boxes.

<a id="piece-crosswalk"></a>

## 19 · Crosswalk bars

No measured plate: the numbers are the model's, after the continental (ladder-less) crosswalks US cities paint.

Bars 0.60 m wide with 0.60 m between them, each the crossing's 3.00 m long, running along the road so that they stand side by side across it. Local X runs across the road (the crossing's length) and Z along it. Four lengths tile a crossing of any length in 1.20 m steps: 1, 2, 4 and 8 bars, 1.20, 2.40, 4.80 and 9.60 m, each with half a gap at either end, so pieces laid end to end keep the spacing.

The bars are paint with no picture, in flat colours. Each is one quad lying 0.015 m over the origin with its back face under it, closed by being two-sided: 4 triangles a bar.

**Why the collider is buried.** A static is always met as its shape's boxes or else its own half box (shared/content/registry.ts: a shape has at least one box or convex part, and a structure's half is never zero), and only a node may be soft. Paint must be walked and driven over as the road is, so each piece's one box lies wholly under the road: X over the bars, Y −0.12 … −0.02 m, Z −1.50 … 1.50 m. The piece is laid at the road's height, so the ground is what a wheel, a body or a ray meets first, and nothing meets the box from above. Nothing harms paint: the pieces have no material.

### Fresh

**Pose.** Rigid assembly, 0° about the ground origin (0.00, 0.00, 0.00).

| Piece | Bars | X min … max (m) | Y min … max (m) | Z min … max (m) | Material | Colour | Value |
|---|---:|---:|---:|---:|---|---|---:|
| `crosswalk1` | 1 | -0.30 … 0.30 | 0.015 | -1.50 … 1.50 | Road paint | white | V77 |
| `crosswalk2` | 2 | -0.90 … 0.90 | 0.015 | -1.50 … 1.50 | Road paint | white | V77 |
| `crosswalk4` | 4 | -2.10 … 2.10 | 0.015 | -1.50 … 1.50 | Road paint | white | V77 |
| `crosswalk8` | 8 | -4.50 … 4.50 | 0.015 | -1.50 … 1.50 | Road paint | white | V77 |

Bar k of n is centred at X = 1.20 (k + 0.5) − 0.60 n.

### Worn

The same bars worn through where wheels ran along them and flaked off: each bar cut across into two to four pieces, about three in ten of them gone, their ends ragged (slanted up to 0.08 m) and their sides eaten in up to 0.10 m; at least one piece of each bar is left. The breaks are seeded by the piece's length, so each length breaks its own way. `crosswalk1_worn`, `crosswalk2_worn`, `crosswalk4_worn` and `crosswalk8_worn` lie within their fresh forms' envelopes.

| Part | Material | Colour | Value |
|---|---|---|---:|
| Pieces of bar | Road paint | faded white | V67 |
| ↳ About a third of them | Road paint | grimed | V57 |

### Setting out

| Foot to kerb face | Orientation | Placement and repetition | Keep clear |
|---|---|---|---|
| On the road | Origin at the road's height on the crossing's centre line, X across the road, Z along it. | Across the road where a pedestrian crossing is, end to end at the 1.20 m pitch, the longest pieces first. | A long piece is flat: on a cambered road its ends float or sink by the camber under them, which shorter pieces follow better. |

**Atlas treatment.** None: paint only.

**Distance model.** Past the finest, one patch over the bars in the colour of paint and road together (V55 fresh, V44 worn), 4 triangles, its error stated as 0.10 m: on medium it is first drawn about 350 m off. The low poly tier draws from the second level, so there it is the patch at every distance. A one-bar piece has the finest only.
