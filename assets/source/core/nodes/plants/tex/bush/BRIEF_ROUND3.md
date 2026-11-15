# The berry bush atlas, round 3

Your round 2 sprays made the bush: built from them it is now a dense, rounded shrub with its berry bunches on the outside, and the colours of the six berries show. One thing is left, and it is in the packed layer only. Change nothing else: every element, the twins, the base colour, the regions, the height and normal stay exactly as they are.

In the game's light a smooth surface reflects the sky, and berries as glossy as now (roughness about 0.40) turn pastel: red reads salmon pink, deep blue reads lavender, from a few metres off. Leaves at about 0.6 still take a blue cast where they turn away. And the occlusion is nearly white (a mean of 0.95), so the inside of each spray is lit as brightly as its outer leaves and the bush looks flat.

- **Roughness**: berries 0.62 to 0.70 (a soft satin highlight, not a mirror); leaf faces 0.68 to 0.78; stems and bark as they are.
- **Occlusion**: make it say where light cannot reach. Darker toward the foot of each spray and where leaves overlap and under berry bunches, about 0.55 to 0.7 deep inside a spray, 1 on the open outer leaves; a mean over the drawn pixels of about 0.80. The game multiplies only the light from the sky by it, so it shades the inside of the bush without blackening it.

Rebuild every layer from `source/` with `build_atlas.py`, run `check_atlas.py`, and add to `REPORT.md` what changed and the new means.
