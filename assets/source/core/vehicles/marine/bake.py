# Bakes what a vessel's painters paint from: the vessel built as `bun run art` builds it, each of its own materials'
# triangles on its picture (where each texel is on the vessel, which way it faces, what it is and which part), and the
# light the vessel hides from itself. Run it after the layout changes, then the family's paint and wear scripts:
#
#   blender --background --factory-startup --python assets/source/core/vehicles/marine/bake.py -- <vessel folder>
#
# It writes <vessel>/tex/layout.json (the layout the pictures are painted for, which the build checks),
# <vessel>/tex/bakes/<material>.npz and <material>_occlusion.png, neither kept, since this makes them again: run it whole
# before a vessel is painted. With MARINE_AO=0 it leaves the occlusion as it is, for a layout that moved by less than a
# texel since it was baked.

import json
import os
import runpy
import sys

import bpy
import numpy as np

FOLDER = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
OUT = os.path.join(FOLDER, "tex", "bakes")
os.makedirs(OUT, exist_ok=True)
os.environ["MARINE_LAYOUT"] = "new"
sys.dont_write_bytecode = True
sys.path.insert(0, FOLDER)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
runpy.run_path(os.path.join(FOLDER, "model.py"), run_name="__main__")

objects = [o for o in bpy.data.objects if o.type == "MESH"]
facts = json.loads(objects[0]["marine"])
names, parts, sizes = facts["tags"], facts["parts"], facts["sizes"]
from layout import layout_hash  # noqa: E402  (the shipyard put marine/ on the path)

# Each own material's triangles: corners on the picture (u across, v down, 0 to 1), on the vessel in the engine's
# frame, their normals, and each triangle's tag and part.
for name, size in sizes.items():
    uv, pos, nrm, tag, part = [], [], [], [], []
    for o in objects:
        me = o.data
        m = next((k for k, mat in enumerate(me.materials) if mat and mat.name == name), -1)
        if m < 0:
            continue
        me.calc_loop_triangles()
        uvs = me.uv_layers.active.data
        tags, owners = me.attributes["tag"].data, me.attributes["part"].data
        normals = me.corner_normals
        for t in me.loop_triangles:
            if t.material_index != m:
                continue
            uv.append([(uvs[l].uv[0], 1 - uvs[l].uv[1]) for l in t.loops])
            # Blender's frame back to the engine's: x, z, -y.
            pos.append([(me.vertices[v].co.x, me.vertices[v].co.z, -me.vertices[v].co.y) for v in t.vertices])
            nrm.append([(normals[l].vector.x, normals[l].vector.z, -normals[l].vector.y) for l in t.loops])
            tag.append(tags[t.polygon_index].value)
            part.append(owners[t.polygon_index].value)
    np.savez_compressed(os.path.join(OUT, f"{name}.npz"), uv=np.array(uv, np.float32), pos=np.array(pos, np.float32),
                        nrm=np.array(nrm, np.float32), tag=np.array(tag, np.int16), part=np.array(part, np.int16),
                        tags=np.array(names), parts=np.array(parts), size=size)
    print(f"bake: {name}, {len(tag)} triangles")

# Occlusion: what each texel sees of the open sky within a reach that grows with the vessel, every part in place.
occlusion = os.environ.get("MARINE_AO") != "0"
reach = float(os.environ.get("MARINE_REACH", "1.2"))
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = int(os.environ.get("MARINE_SAMPLES", "96"))
scene.world = bpy.data.worlds.new("sky")
scene.world.light_settings.distance = reach
images = {}
for mat in {m for o in objects for m in o.data.materials if m}:
    mat.use_nodes = True
    size = sizes.get(mat.name, 64)
    img = bpy.data.images.new(f"{mat.name}_occlusion", size, size, alpha=False, float_buffer=True)
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    mat.node_tree.nodes.active = node
    images[mat.name] = img
for o in objects:
    o.modifiers.clear()
    o.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
if occlusion:
    bpy.ops.object.bake(type="AO", margin=16, margin_type="EXTEND")
scene.render.image_settings.color_depth = "16"
scene.render.image_settings.color_mode = "BW"
for name in sizes if occlusion else ():
    img = images[name]
    img.filepath_raw = os.path.join(OUT, f"{name}_occlusion.png")
    img.file_format = "PNG"
    img.save_render(img.filepath_raw, scene=scene)
    print(f"bake: {name}_occlusion.png")

with open(os.path.join(FOLDER, "tex", "layout.json"), "w") as f:
    json.dump({"about": "The layout tex/ is painted for, written by ../marine/bake.py and checked on every build.",
               "hash": layout_hash(objects)}, f)
    f.write("\n")
print("bake: done")
