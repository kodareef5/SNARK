# Timber generation prompts

Built-in image generator; no API/CLI fallback. All returned source pictures are retained unchanged in `source/`.

## Source 01 — hewn oak surface

Use case: photorealistic-natural
Asset type: physically based game material source, flat unlit base colour texture.
Primary request: A square seamless texture of ONE continuous surface of ancient hewn structural oak, covering 3 metres by 3 metres. Horizontal wood grain running left to right throughout. This is surface material for heavy fortress beams, lintels and thick door timbers, later cut into arbitrary narrow horizontal strips by the game. The square is filled entirely with oak surface.
Materials: dense old oak, shallow overlapping scalloped adze cuts and irregular hand-hewn facets, long narrow tapered drying checks running with the grain, small unobtrusive scattered knots with grain gently curving around them, fine medullary ray flecks, open elongated pores and fine fibres. Surface is warm weathered grey-brown with darker brown inside pores and splits. Convincing tactile old oak at multiple scales; grain remains predominantly horizontal. Many quiet varied details across the entire surface, no hero knot or prominent landmark. Adze marks are short local cross-grain scallops, never broad vertical stripes.
Composition: orthographic surface capture, edge-to-edge, uniform detail density, tileable in both directions; no individual feature spans the full height. No planks, boards, joints, seams, beam edges, end grain, border, nails, screws, metal, saw marks, paint, moss, rot or text. Never divide the square into horizontal boards. All dark splits taper and terminate locally; none is a straight full-width gap.
Lighting: completely diffuse flat albedo, no directional light, shadows, shiny highlights, vignette or large colour gradient. Wood surface colour only.
Colour: dark warm muted grey-brown oak, overall sRGB close to (118,92,66), restrained local contrast, weathered fibres slightly greyer. No golden orange varnish.
Resolution: request 2048 by 2048, square, crisp photoreal material detail.

Feedback revision 01 uses the retained source and procedural changes in `build_material.py`; no additional image-generation call or prompt was used.
