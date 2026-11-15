# Visual review and selection

Every render was visually inspected in the image tool output. This record explains what changed, rather than declaring a numerical quality score. No external pictures were used. The PNGs in this directory are untouched native outputs; selected finals in the parent directory are byte-for-byte copies. `manifest.json` records their sizes, hashes, requests and edit ancestry.

## Royal lineup

- **v01 — rejected.** Strong pale/green material separation, four readable individuals and convincing dead/yellow leaves. The scale figure was too tall relative to the trees; grey columns were too thick for the requested dimensions. Crown widths also needed a small reduction.
- **v02 — selected.** Smaller human, slimmer stems and shafts, slightly narrower crowns. The four full silhouettes remain clear, R2 retains its missing sector and dead frond, and R4 is visibly young. The long pale columns now carry the composition. Build the shallow swell and exact shaft length from DESIGN.md; the painting is not a measured orthographic drawing.

## Coconut lineup

- **v01 — rejected.** Good distinct sweep, kink, S-bend and wind-shaped crown; useful fruit and stalk details. Trunks and root flares were too bulky, human scale too large, and outer crown tips crowded the frame.
- **v02 — rejected for label error.** Corrected slim stems, compact ground contact and full framing. The image edit incorrectly changed the human label to “1.08 m” while resizing the figure.
- **v03 — selected.** Corrected the label to “1.8 m”; inspected the figure, four IDs, crown edges and base contacts again. The four individuals retain distinct histories. Their projected leans mostly face the same direction in this sheet; placement must rotate the full 3D curves as described in DESIGN.md.

## Parts

- **v01 — rejected.** All eleven required studies and labels were present; feet and crown attachments were particularly useful. The two top-view fronds ended too bluntly and retained too much width near the tip.
- **v02 — selected.** Both top-view specimens now narrow through the distal third to pointed rachis tips. Side arches remain distinct from the flattened top views. Royal sheath, coconut petiole bases/fruit/stalks, root collars, dead material and surface contrast remain visible. The studies are enlarged independently; use the written dimensions for reconstruction.

## Stumps

- **v01 — rejected.** Strong hacked faces, dense fibre ends and axial splinters; no oak-style growth rings. The person standing behind enlarged stumps made their actual height ambiguous.
- **v02 — selected.** Replaced that figure with a detached scale inset containing one person and both stump silhouettes on a common baseline. Large material studies remain readable. Main cut heights are 0.65 m and 0.55 m, with taller isolated splinters; the inset is a scale guide rather than a third object in the scene.

## Near grove

- **v01 — rejected.** Strong boulevard setting, bay, lamp-post stumps, broken roof and accessible trunk contacts. The nearest royal's visible crownshaft implied a short tree inconsistent with a level eye-height view at 3 m. Foreground stems were also too heavy.
- **v02 — selected.** The closest royal continues upward out of frame with no visible crownshaft. Narrower royal and coconut stems, and the coconut base moved farther down the road, improve the scale. Ruined-building palm, explorer, road, bay and material lighting remain coherent. Painted perspective is indicative; camera height and metre-scale placement need confirmation in engine.

## Distant grove

- **v01 — rejected for the distance brief.** Attractive coastline and crown rhythm, but large foreground palms made it a scenic overview instead of a useful distant-readability reference.
- **v02 — selected.** Intervening water fills the foreground, the nearest bank is gone, and the hillside reads as hundreds of small stars on thin lines. Many crowns remain separated against ochre ground and pale ruins; shore, boulevard, shells and broken seawall supply scale. Some nearer palms are larger than the smallest few-dozen-pixel examples, while most of the slope tests that range. Camera distance is art-directed rather than derived from calibrated 3D projection.

## Flat distant grove

- **v01 — rejected for palette.** Coastline, ruins and road closely match the accepted painted view. Distinct low-poly palms survive without leaflet and bark textures. Greens were too bright and uniform; broad regions still used more smooth shading than intended.
- **v02 — selected.** Darker olive/forest crown tones restore separation against warm terrain. The same bays, buildings, seawall and distribution remain recognizable. Blades, stems and terrain are reduced to flat faces without painted bark, foliage or ground detail. Treat this as the geometry and colour simplification target; generate actual mesh topology from the written construction rules.

## Final file checks

The final check decodes all archived PNGs, verifies their integrity, checks that every render has a matching exact request and a prompt in `prompts.md`, confirms every edit input is present locally, and compares each selected final byte-for-byte with its source. Native output dimensions are recorded per image in `manifest.json`. No resampling, raster compositing or post-generation image editing was performed outside the image tool.
