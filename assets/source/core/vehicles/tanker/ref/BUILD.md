# Tideline water tanker

Grab3D's CC0 three-axle rigid tanker supplies the bonnet, tank, ladder, running gear and cabin furnishings. The source GLB is in `assets/raw/grab3d/tanker-truck.glb`. SNARK supplies the cab doors and window frames, fleet paintwork, wheels' raised hardware, gauges, rig, driving tune, distance models and damage poses.

The ordinary build uses the checked-in packs. For art iteration, run these from the repository root.

```sh
bun tools/art.ts core:tanker core:tanker_wrecks --no-sheet
bun tools/urban/dev.ts --tanker --port 8814
```

The yard starts beside an empty truck. The centre lane runs between eight ordinary map statics. Their IDs are `core:tanker_abandoned`, `core:tanker_impact`, `core:tanker_burnout`, `core:tanker_stripped`, `core:tanker_rollover`, `core:tanker_separated`, `core:tanker_cistern` and `core:tanker_rear_crush`. Place them at ground height. The separated tank lies on the truck's left, so allow room on that side.

If the donor or the silhouette changes, regenerate the prepared geometry and map collision before rebuilding the packs. Python requires NumPy and SciPy. The atlas authoring script uses Pillow.

```sh
cd assets/source/core/vehicles/tanker
python3 ref/prepare.py
python3 ref/shells.py
blender -b -P ref/arches.py
python3 ref/measure.py
python3 tex/paint.py
```
