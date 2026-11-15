# The sea grape atlas, round 2

Your first set is good: built from it the sea grape reads at once, big round leaves on crooked grey limbs with its bunches hanging. One thing is left, and it is in the packed layer only. Change nothing else: every element, the base colour, the height and normal stay exactly as they are.

In the game's light a smooth surface reflects the sky. Leaves as smooth as now (roughness about 0.4 to 0.6) turn blue-grey wherever they tilt away from the eye, which on a shrub of a hundred leaves is half of them; and the occlusion is almost white (a mean of 0.99), so leaves lying over others are lit as brightly as open ones.

- **Roughness**: leaf faces 0.62 to 0.74, leathery satin, a little smoother along the midrib; fruit 0.55 to 0.65; stalks and bark as they are.
- **Occlusion**: darker where the stalk joins the blade and along the veins' hollows, about 0.7 there, 1 on the open blade; the fruit darker between the grapes; a mean over the drawn pixels of about 0.85. The game multiplies only the light from the sky by it.

Rebuild every layer from `source/` with `build_atlas.py`, run `check_atlas.py`, and add to `REPORT.md` what changed and the new means.
