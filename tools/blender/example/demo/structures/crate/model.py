# Two rigid pieces from one script: a crate and its lid. Each is a mesh object
# named as asset.ts names it, modelled about the origin as the piece stands in
# the game. Blender's +Z is up, and the exporter turns that into the engine's +Y.
#
# The crate's sides are the material "Planks", whose pictures asset.ts names.
# Its faces have texture coordinates in metres, so the picture runs unbroken
# round the crate and on over the next one. "Iron" has no pictures: it takes
# the palette colour nearest its base colour. The lid's top is "region0", which
# takes the colour the game gives the piece, and has no texture coordinates, so
# the lid is drawn flat.

import bmesh
import bpy

planks = bpy.data.materials.new("Planks")
region = bpy.data.materials.new("region0")
iron = bpy.data.materials.new("Iron")
iron.use_nodes = True
iron.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.1, 0.11, 0.13, 1)


def box(bm, lo, hi, material, uv):
    made = bmesh.ops.create_cube(bm, size=1)["verts"]
    for v in made:
        for k in range(3):
            v.co[k] = lo[k] + (v.co[k] + 0.5) * (hi[k] - lo[k])
    bm.normal_update()
    for f in {f for v in made for f in v.link_faces}:
        f.material_index = material
        if uv is None:
            continue
        # A face is laid on the picture as it is seen from outside: across it and up it, a metre to a picture.
        n = f.normal
        axis = max(range(3), key=lambda k: abs(n[k]))
        for loop in f.loops:
            x, y, z = loop.vert.co
            across = (y, -x, x)[axis] * (1 if n[axis] > 0 else -1)
            loop[uv].uv = (across, y if axis == 2 else z)


def piece(name, boxes, materials, textured):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap") if textured else None
    for lo, hi, material in boxes:
        box(bm, lo, hi, material, uv)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for material in materials:
        mesh.materials.append(material)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new(name, mesh))


# The crate is a metre across, with an iron band round its middle.
piece("crate", [((-0.5, -0.5, -0.5), (0.5, 0.5, 0.5), 0), ((-0.52, -0.52, -0.06), (0.52, 0.52, 0.06), 1)], [planks, iron], True)
piece("lid", [((-0.54, -0.54, -0.04), (0.54, 0.54, 0.04), 0), ((-0.1, -0.03, 0.04), (0.1, 0.03, 0.1), 1)], [region, iron], False)
