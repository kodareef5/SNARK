# Coastal Parasaur

The axial profile, limb envelopes and bone pivots live in `plan.py`. The sculpt joins the crest, snout, neck, rib cage, tail and supporting limbs into one continuous hide. Three other surfaces supply the lower jaw and two corneas. The shoulder and thigh taper into the rib cage above the elbow and knee. The broad forefoot combines the central digits into a weight-bearing mitten and the larger hind foot ends in three separated tips.

The reviewed rest surface is `skin.npz`. It holds model-space triangle positions, per-corner UVs, material and anatomical paint assignments, and up to four influences per vertex. Keeping this surface with the paint fixes its atlas coordinates across Blender voxel-remeshing versions and thread counts. The normal asset build restores it with `model.py`. The saddle and actions build on the original bones in the same Blender session.

From the repository root, build or check the committed surface with Bun and Blender.

```sh
bun run art -- core:parasaur --no-sheet
bun run art -- core:parasaur --check
```

To change the anatomy, edit the stations and relief fields in `plan.py` and `sculpt.py`. The following commands regenerate the rest surface and repaint it. The sculpt uses Blender's NumPy and the painter uses Python 3, NumPy and Pillow. Launch the sculpt script in the Blender interface to inspect its live mesh, material slots, UVs and weighted armature.

```sh
species=assets/source/core/creatures/parasaur
blender -b -t 1 --factory-startup --python-exit-code 1 --python "$species/sculpt.py"
python3 "$species/tex/paint.py"
bun run art -- core:parasaur --no-sheet
```

## Native review

The model spans 1.46 m across, 3.59 m high and 7.68 m long. The seat sits at [0, 2.57, 0.70] in the standing rest pose. The head and trailing crest carry three distinct head capsules. The jaw supplies the fourth. The former six-body ragdoll order corresponds to pelvis, skull, proximal tail, distal tail, left thigh and right thigh. The ragdoll starts at death frame 16.

The gate measured a 2 mm maximum slide for each hind foot during the 2.60 m walk and 47 mm during the 4.16 m sprint. The clips use 30 and 20 frames, respectively, matching the species' 2.60 and 6.24 m/s ground speeds. The forefeet join the walking support cycle two-thirds of a turn after the hind feet. An open-water stroke travels a stated 3 m over 35 frames. The strike closes the bill at tick 11 of the 27-tick attack.

Seven body levels contain 24,976, 10,500, 4,500, 1,700, 660, 250 and 96 triangles. Three use the hide and face maps. The fitted saddle ranges from 8,104 triangles to 42. Across both meshes the gate found zero open edges, flipped faces, inside-out components and stray influences. All 27 hit capsules are exposed. The largest texture variant uses 33.7 MiB, with 246 texels/m on the hide, 326 on the face and 29 on the tack. The lower-density tack shows broader, softer surface detail in close views.

The following commands recreate the comparison photographs and the 14-second native motion loop. Both generations use the same four RGB swatches, camera and illumination in the comparison. Colored frames load the native material role maps. The clay review sets a constant base and neutral material maps over the native normals. The motion film samples the packed clips at 15 fps. Its three loops retain their individual periods.

```sh
species=assets/source/core/creatures/parasaur
mkdir -p var/parasaur
git show "4b39253f^:$species/parasaur.snpk" > var/parasaur/previous.snpk
bun "$species/review.ts" --before=var/parasaur/previous.snpk
python3 "$species/ref/sheets.py"
```

The reviewed pack and an independent source rebuild both produced SHA-256 `9d358441769b793f58a8106015f4f486fd7e0af4ab4d67889a854c17d075d0db`. [Matched clay and painted silhouettes](native-comparison.jpg) · [Crest, forefoot, saddle and approach mesh](native-detail.jpg) · [Native walk, run and swim](native-motion.webp)
