# Editable art

Blender files and their glTF binary exports, one folder per content pack.

An export follows these conventions so the importer needs no hints:

- glTF axes and units: +Y up, metres. The asset faces +Z.
- Nodes named with a `_LOD1`, `_LOD2` suffix are lower levels of detail.
- A node named `COL` is the collision box and is not drawn.
- A material named `region0` to `region5` marks a color region. Any other
  material is matched to the nearest palette color; the build warns when the
  match is poor.
- No textures. Color is per material.

Record authorship with each file.

`core/human-clips.snpk` is written by `bun run art`: the animation clips of the
humanoid skeleton, converted from the libraries in [raw](../raw/README.md). It
is a pack with no meshes; the core pack copies its clips.

`core/human-bodies.snpk` is written by the same command: the two modelled
bodies cut into body slots, with hair and beards fitted to each, and the rig
each was made on. Making it needs Blender; reading it does not.
