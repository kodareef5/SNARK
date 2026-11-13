# Reduces the meshes of a glTF file to a few levels of detail and writes them
# as one glTF binary, keeping what the art conversion reads afterwards: vertex
# positions, texture coordinates, joint weights, the skeleton, and material
# names. It does nothing else. Everything that decides how the game sees a body
# (which bone a vertex follows, which color it has, which body slot it belongs
# to) is done in TypeScript by tools/pack/skin.ts, where it can be tested.
#
#   blender --background --factory-startup --python tools/blender/reduce.py -- \
#       in.gltf out.glb 4000,1400,450
#
# The numbers are triangle targets per level for the whole file. Each mesh gets
# a share of a level's target in proportion to its own triangle count, and is
# written as "<name>_LOD<level>".

import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
source, out = argv[0], argv[1]
targets = [int(t) for t in argv[2].split(",")]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


total = sum(triangles(o) for o in meshes)
keep = []
for obj in meshes:
    have = triangles(obj)
    base = obj.name
    for level, target in enumerate(targets):
        copy = obj.copy()
        copy.data = obj.data.copy()
        bpy.context.scene.collection.objects.link(copy)
        copy.name = f"{base}_LOD{level}"
        copy.data.name = copy.name
        want = max(4, round(target * have / total))
        if want < have:
            mod = copy.modifiers.new("reduce", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = want / have
            mod.use_collapse_triangulate = True
            # The armature modifier must stay last so the result is still skinned.
            bpy.context.view_layer.objects.active = copy
            while copy.modifiers.find("reduce") > 0:
                bpy.ops.object.modifier_move_up(modifier="reduce")
            bpy.ops.object.modifier_apply(modifier="reduce")
        keep.append(copy)
        print(f"reduce: {copy.name}: {have} -> {triangles(copy)} triangles")
    bpy.data.objects.remove(obj, do_unlink=True)

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_image_format="NONE",
    export_animations=False,
    export_skins=True,
    export_normals=False,
    export_texcoords=True,
    export_yup=True,
)
print(f"reduce: wrote {out}")
