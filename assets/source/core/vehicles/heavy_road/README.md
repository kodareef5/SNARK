# District bus and freight tractor

The [school bus](https://grab3d.com/models/vehicles/school-bus/) and [semi truck](https://grab3d.com/models/vehicles/semi-truck/) come from Grab3D's CC0 vehicle collection. The original GLBs are in `assets/raw/grab3d`. Their wheel centers, bonnet profiles, mirrors and chassis fittings establish the proportions of the SNARK models. Both cabs have open sightlines and rigid doors. The bus has six passenger rows sharing the curbside entrance. The tractor drives on its own, and the box trailer is a separate map static.

From the repository root, regenerate the prepared parts and paint with Python, NumPy, SciPy and Pillow, then build the native packs with Blender on the path.

```sh
python3 assets/source/core/vehicles/heavy_road/build.py bus semi
python3 assets/source/core/vehicles/heavy_road/trailer.py
bun tools/art.ts core:bus core:semi core:box_trailer --no-sheet
```

The ordinary game can spawn `core:bus` and `core:semi`. The transport yard puts both beside spawn and parks `core:box_trailer` ahead of them.

```sh
bun tools/urban/dev.ts --freight --dist var/coaches/client --port 8816
```
