# A held item from one script: a stone mallet, a haft with a head bound across
# its end. It is one mesh object named as asset.ts names it, modelled as the
# hand holds it, with its grip at the origin.
#
# Blender's +Z is up, and the exporter turns that into the engine's +Y, so its
# +Y into the engine's -Z. A held piece runs along the engine's +Z, which is
# Blender's -Y: the haft runs from a little behind the hand at +Y out along -Y,
# and the head's top is up, along +Z. The hand closes round the haft at the
# origin.
#
# Neither material has pictures: each takes the palette colour nearest its base
# colour, and the piece is drawn flat. The lying mesh is made from this one by
# the build (asset.ts says dropped: "auto"), so it is not modelled.

import bmesh
import bpy


def material(name, rgb):
    made = bpy.data.materials.new(name)
    made.use_nodes = True
    next(n for n in made.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (*rgb, 1)
    return made


wood = material("Wood", (0.32, 0.2, 0.1))
stone = material("Stone", (0.35, 0.35, 0.33))


def box(bm, lo, hi, index):
    made = bmesh.ops.create_cube(bm, size=1)["verts"]
    for v in made:
        for k in range(3):
            v.co[k] = lo[k] + (v.co[k] + 0.5) * (hi[k] - lo[k])
    for f in {f for v in made for f in v.link_faces}:
        f.material_index = index


bm = bmesh.new()
# The haft: 3.2 cm square, from 6 cm behind the grip to 36 cm in front of it.
box(bm, (-0.016, -0.36, -0.016), (0.016, 0.06, 0.016), 0)
# The head: across the haft's end, standing higher above it than below.
box(bm, (-0.035, -0.4, -0.05), (0.035, -0.3, 0.09), 1)
bmesh.ops.triangulate(bm, faces=bm.faces)
mesh = bpy.data.meshes.new("mallet")
bm.to_mesh(mesh)
bm.free()
mesh.materials.append(wood)
mesh.materials.append(stone)
bpy.context.scene.collection.objects.link(bpy.data.objects.new("mallet", mesh))
