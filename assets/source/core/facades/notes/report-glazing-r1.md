# Facade glazing and coverings

The delivery covers all 19 named variants. Each folder contains the six registered maps and its relief measurement in millimetres. “Clear” below is the percentage of base texels with alpha zero. For frames it measures exposed vision glass. For coverings it measures how much of the window behind them remains visible.

## Reading the proofs

| Image | What to look for |
|---|---|
| [Base sheet](checks/sheet.png) | All pieces share a sill line within each group and the same pixel scale. Mid-grey surrounds each element. Blue-grey marks glass or an opening. |
| [Three suns](checks/relit.png) | Read each triplet left to right. Opposing 15° lights pick out the bead steps and reverse the light across the cloth folds. The 70° light shows the front faces. The calculation multiplies linear base colour by ambient plus diffuse light. Glazing shows the RGB stored under its alpha. |
| [Distance proof](checks/far.png) | Each pair shows the composited element at 1/8 and 1/32, at actual reduced pixel size. The filter averages in linear light. |
| [Registered layers](checks/layers.png) | The same 120 × 120 texels from the white casement appear in every column. Follow a louvre clip across the coverage, stepped height, normal, exposed metal and occlusion. Base RGB and its alpha have separate columns. |

## Construction and verification

Three original generated swatches supplied the coating grain, rotary-cut veneer and floral pigment. Their crops follow the frame stock, sheets and curved cloth surface. Rails, gasket profiles, hardware, glass blades, chipped edges and fabric folds were built at the final texture resolutions. The glass has a separate residue field for capillary runs, lower-corner salt and sill dust. This field controls film colour and roughness. The sprayed cross only changes pigment and roughness. [Material prompts](sources/prompts.txt) · [Material builder](sources/build.py)

The normal calculation uses millimetres per texel on each axis, derived from the supplied physical width and height. It reads quantized height, with wrapping along each requested tiling axis. Occlusion samples relief in eight directions against the local surface slope. Glass, including the opaque spandrels and surviving shards, has open occlusion.

I checked all 114 PNG headers, image dimensions, full 16-bit height ranges, binary coverage and metal values, hidden glass RGB, clear-glass occlusion and metadata. An independent reconstruction from the exported height and JSON matched every normal channel within one 8-bit code value. I also checked the outermost frame texels, the strip cadence, the shop mullions, the spandrel roughness and the empty centre of both broken panes. The blind was repeated in both directions and both drapes side by side under grazing light. [File checks](sources/verify.py) · [Proof renderer](sources/proofs.py)

## Glazed elements

| Element | Clear | Construction and observed result | Limit seen in review |
|---|---:|---|---|
| window-0 | 74.3% | Chalked coating over a stepped extrusion and dark gasket. The left pane sits 8 mm ahead of the right. The T formed by the transom and meeting stile is legible at 1/8. | The cam and drain slots disappear in the street view. |
| window-1 | 74.3% | Bronze stock carries narrow washed tracks and small exposed patches. Reversing the sun picks out the recessed right sash. | At 1/32 the centre stile almost merges with the glass. |
| window-2 | 74.3% | Paint flakes follow the length of each timber member. In the revised corner crop the exposed fibres turn with the mitre. | Its pale outline is hard to distinguish from window-0 at 1/32. |
| slider-0 | 74.7% | The left stile carries a rounded pull on two fixing points. Low light picks up its crown and the two runners at the foot. | At 1/8 the pull occupies less than a pixel across. |
| slider-1 | 74.7% | The pull sits on the right bronze stile. The deeper bottom rail stays visible across the street. | The bronze threshold and its runners merge at the smallest size. |
| casement-0 | 78.4% | Ten tilted glass blades fit the left opening. The layer crop shows the rising blade profile, open glass and solid end clips at the same positions. | A coverage-only view shows the clips. The blade pitch becomes clear when the normals are lit. |
| casement-1 | 78.9% | Two plain bronze leaves meet at a raised central member with a slender latch. The equal division holds at 1/8. | At 1/32 the central line is faint against the blue-grey aperture. |
| strip-0 | 79.3% | Eight lights share a 218-texel pitch. All seven divisions remain countable at 1/8, and the raised sill catches the low sun. | The gasket and cap become one line at street distance. |
| curtain-0 | 62.0% | A 5-texel side bead borders the vision panel and grey-green spandrel. The silver transom carries the division at both proof scales. | The spandrel is close in value to the proof aperture. Its back-paint colour is subtle at distance. |
| curtain-1 | 62.0% | A bronze back-painted spandrel sits below the dark cap. Long residue runs interrupt its otherwise smooth roughness. | The thin side beads largely disappear at 1/32. |
| display-0 | 86.9% | Three main lights and three fixed upper lights share two mullions. Short abrasions expose metal on the lower bead, with local dents in relief. | Individual dents need a close, grazing view. |
| display-1 | 86.7% | Broken lengths of vinyl form a bare rectangular outline on the middle light. Rougher adhesive traces continue through parts of the peeled line. | The outline survives at 1/8. Most individual breaks disappear at that scale. |

## Coverings and broken panes

| Element | Clear | Construction and observed result | Limit seen in review |
|---|---:|---|---|
| blind-0 | 17.7% | Twenty bowed slats per metre cross two continuous ladder cords. The 2 × 2 repeat keeps its pitch through both joins. Two damaged slats interrupt the fine gaps. | At 1/32 the gaps average into the yellowed slat colour. The damage repeats on each tile. |
| drape-0 | 3.6% | Floral pigment follows the surface distance over five gathered folds. The hem frays below its stitch line. Grazing light reveals the folds while the floral motif dissolves at 1/8. | The long tear gives away the repeat when several drops are hung together. |
| drape-1 | 3.8% | Plain blue-grey yarn follows a second fold profile with a different hem and two warp tears. The fold continues across both sides in the tiled view. | The returned threads across the longer tear are visible only close up. |
| boards-0 | 0.7% | Two plywood sheets have different veneer directions. The faded red cross passes over their joint. Close inspection shows lifted plies, round nail heads and downward rust runs. | At 1/32 the joint has more contrast than the spray mark. |
| boards-1 | 43.4% | Three long-grain crops sit on separate 18 mm planks with splintered ends and paired nails. All three courses and their gaps survive the smallest reduction. | The grain direction survives longer than the individual end checks. |
| shards-0 | 85.4% | Broad corner remnants, bare stretches and several long, oblique bottom fragments surround an empty centre. The revised silhouette breaks the regular spacing of the first pass. | Its narrowest retained slivers disappear at 1/32. |
| shards-1 | 85.4% | A second fracture outline puts a broad shoulder on the top edge and changes the direction of the lower fragments. Every solid texel lies within the outside quarter of the pane. | Both variants have a similar mean coverage. Their silhouettes are easier to distinguish at 1/8. |

The proofs exercise the exported textures under controlled lighting. The live room, reflections and engine mip selection were outside this texture pass.
