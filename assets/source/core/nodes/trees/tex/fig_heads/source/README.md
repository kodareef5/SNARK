The three `*_generated.png` files are unmodified selected outputs from the built-in imagegen tool. The six source generations used only written descriptions informed by the project's fig/banyan concepts, leaf sheet and current fig cards. The scale revisions used their preceding generated image as the edit input. No photographs, web imagery or other game's images were used.

- [top_heads_generated.png](top_heads_generated.png): six top views, two columns by three rows; sun, middle, shade. The builder repacks them into the upper-half atlas order.
- [underside_generated.png](underside_generated.png): the pale shaded leaf backs and their carrying twigs.
- [interior_generated.png](interior_generated.png): dark leaf texture; the builder makes it periodic with minimum-error joins.
- [sprays_reference.png](sprays_reference.png): the existing fig atlas's top-left 1024px square composited on dark green for inspection. This is a reference only, not a generated original or an atlas input.
- [originals.json](originals.json): selected original dimensions and SHA-256 fingerprints.
- [generation_history.json](generation_history.json): initial generations, scale revisions, prompt paths, input relationships and selection decisions. Superseded local sources were replaced; their hashes and prompts remain.
- `*_prompt.txt` and `*_scale_revision_prompt.txt`: exact prompts submitted to built-in imagegen.
- [layout.json](layout.json): output cell locations, physical pitches, height encoding, means and removed directional components.
- [interior_quilt.json](interior_quilt.json): deterministic minimum-error seam paths used for the repeat tile.
- [round1_structure.json](round1_structure.json): frozen round-one hashes for height, normal, ORM, the generated originals and seam paths, plus the layout without colour fields. The checker enforces these during the round-two palette revision.

The build reads only the three selected generated originals. The checker also reads the existing fig cards and named concepts from sibling project folders, without changing them. The material builder and diagnostic renderer adapt the reviewed oak round-2 code; their complete local versions are provided here and do not import or execute sibling scripts.

Round two changes only the builder's pigment transfer, using the means and young-growth ceiling in `../BRIEF_ROUND2.md`. It retains the exact round-one tonal mapping before recolouring, so neither generated artwork nor any relief, surface or layout input is revised. The source prompts describe the original generation, not the final recoloured palette.

All authored project files are in `fig_heads/`. The image tool also retains its automatically managed original outputs in its own cache; those files were only read when copying the selected originals here.
