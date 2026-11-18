# Canopy Brachiosaurus

The full Grab3D Brachiosaurus carries its head almost twelve metres above the ground. The 18,000-triangle fitted body preserves that carriage, the slope from shoulders to hips, the barrel chest and the sideways curve at the tip of the tail. Five neck joints carry the browsing reach. Four planted columns support the walk. The defensive stomp shifts weight to the other three feet before the left forefoot lands. [Model and poses](canopy-brachio.jpg)

The two distant bodies use cross sections that follow the turn from shoulders to neck and from neck to muzzle. Each has four closed, broad soles and an articulated tail. The seven body levels contain 18,000, 8,800, 4,600, 2,100, 850, 572 and 288 triangles. The first three draw the textured hide in a single material. The body and worn saddle use 12.7 MB of textures in the largest runtime format. [Distance comparison](canopy-brachio-lods.jpg)

The hide takes its pattern from the donor, with eucalyptus-grey dorsal patches, a warm buff flank, and a light throat. The final texture chart carries the amber iris and its small catchlight. Six regions support colour variation. The sloping back supports a level leather seat over a woven pad. A cinch wraps the barrel between the legs, and a short ladder hangs on the boarding side. The species uses SNARK’s existing Bronto sauropod recordings.

## Rebuild

The full download is an unrigged 181,914-triangle GLB with a 4K colour map. Its embedded metadata names Grab3D and CC0-1.0. The input SHA-256 is `a8b8028c1bf373d155ba2b9d1d63114af5ef91f0002aa2ba2ba1e5b161a8a2f8`. The fitted mesh and repainted maps are checked in. A normal build needs only the last command below.

```sh
mkdir -p var/brachio
blender -b --factory-startup --disable-autoexec --python-exit-code 1 -P assets/source/core/creatures/brachio/ref/prepare.py -- /path/to/brachiosaurus.glb var/brachio/atlas.npz
python3 assets/source/core/creatures/brachio/ref/paint.py /path/to/brachiosaurus.glb var/brachio/atlas.npz
bun tools/art.ts core:brachio --no-sheet
```

The painter uses NumPy, SciPy and Pillow. To ride the fitted adult in a separate save, start the review paddock.

```sh
bun tools/dinosaurs/dev.ts --brachio --port 8806 --dist var/brachio/play --db var/brachio/paddock.db
```
