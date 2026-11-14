# Two rigid pieces from one script: a crate and its lid. Each is a mesh object
# named as asset.ts names it, modelled about the origin as the piece stands in
# the game. Blender's +Z is up, and the exporter turns that into the engine's +Y.
# A material named region0 takes the colour the game gives the piece. Any other
# takes the palette colour nearest its base colour.

import bmesh
import bpy

wood = bpy.data.materials.new("region0")
iron = bpy.data.materials.new("Iron")
iron.use_nodes = True
iron.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.1, 0.11, 0.13, 1)


def box(bm, lo, hi, material):
    made = bmesh.ops.create_cube(bm, size=1)["verts"]
    for v in made:
        for k in range(3):
            v.co[k] = lo[k] + (v.co[k] + 0.5) * (hi[k] - lo[k])
    for f in {f for v in made for f in v.link_faces}:
        f.material_index = material


def piece(name, boxes):
    bm = bmesh.new()
    for lo, hi, material in boxes:
        box(bm, lo, hi, material)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(wood)
    mesh.materials.append(iron)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, mesh))


# The crate is a metre across, with an iron band round its middle.
piece("crate", [((-0.5, -0.5, -0.5), (0.5, 0.5, 0.5), 0), ((-0.52, -0.52, -0.06), (0.52, 0.52, 0.06), 1)])
piece("lid", [((-0.54, -0.54, -0.04), (0.54, 0.54, 0.04), 0), ((-0.1, -0.03, 0.04), (0.1, 0.03, 0.1), 1)])
