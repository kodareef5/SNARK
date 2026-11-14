# Image generation prompts

Built-in `image_gen` tool. No API/CLI fallback. All returned source images are retained unchanged in `source/`.

## 01 — forged iron albedo source

```text
Use case: photorealistic-natural
Asset type: source albedo texture for a physically based game material, square, edge-to-edge.
Primary request: a completely continuous surface of dark hand-forged wrought iron, viewed orthographically straight down, as an unlit base-colour scan. The field represents about 1.2 metres square. Dense subtle overlapping hand-hammered dimples 5 to 20 mm across, irregular small forge-scale flakes, extremely faint fine fibrous striations running horizontally. Weathered but sound iron, with small scattered dark umber rust blooms and tiny muted orange-brown flecks in pits, covering about 12 percent of the surface. Several dozen small irregular rust areas, softly spreading and distributed evenly, none a memorable large shape.
Color palette: mostly charcoal iron, dark warm grey reflectance near sRGB (43,41,39), dark brown oxidation with only a little subdued orange. Fine convincing material variation, low contrast.
Lighting: strictly flat unlit albedo, diffuse cross-polarized scan appearance. No directional illumination, no highlights, no cast shadows, no gradients, no vignette. Hammer marks should be subtle material changes, not shaded craters.
Composition: one continuous uniform sheet texture filling the entire square; seamless repeat in both axes; same overall texture density in all corners.
Constraints: no objects, no borders or edges, no seams, no panels, no straps, no rivets, no bolts, no ring, no nails, no writing, no watermark, no decorative pattern, no large rust patch, no dramatic cracks. Fine material detail, not concrete or leather. 2048 by 2048 requested.
```

Parameters: `transparent_background: false`. Brand-new generation; no reference images.

Returned image: `source/generated_iron_01.png`, 1254 × 1254, RGB. Copied unchanged from the built-in tool's output. This was the only image generation call. The subsequent revisions were scripted material construction, as requested; no additional image prompts were used.
